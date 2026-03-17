// index.js
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory queues
let downloadQueue = [];
let zipQueue = [];
let currentDownload = null;

// Download function using yt-dlp
function downloadSong(url, outputPath) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', [
      url,
      '-o',
      `${outputPath}/%(title)s.%(ext)s`
    ]);

    ytdlp.stdout.on('data', (data) => {
      console.log(`yt-dlp: ${data}`);
      if (currentDownload) {
        currentDownload.progress = data.toString();
      }
    });

    ytdlp.stderr.on('data', (data) => {
      console.error(`yt-dlp error: ${data}`);
    });

    ytdlp.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });
  });
}

// Process download queue
async function processQueue() {
  if (currentDownload || downloadQueue.length === 0) return;
  currentDownload = downloadQueue.shift();
  currentDownload.status = 'Downloading';

  const outputPath = path.join(__dirname, 'downloads', currentDownload.id);
  fs.mkdirSync(outputPath, { recursive: true });

  try {
    await downloadSong(currentDownload.url, outputPath);
    currentDownload.status = 'Zipping';

    // Zip the download
    const zipPath = path.join(__dirname, 'zips', `${currentDownload.id}.zip`);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });

    await zipFolder(outputPath, zipPath);

    currentDownload.status = 'Done';
    currentDownload.zip = `/zips/${currentDownload.id}.zip`;

    // Add to zip queue for auto-delete
    zipQueue.push({ zipPath, downloadPath: outputPath, timestamp: Date.now() });

  } catch (err) {
    console.error(err);
    currentDownload.status = 'Error';
  } finally {
    currentDownload = null;
    setImmediate(processQueue); // Process next in queue
  }
}

// Zip folder
function zipFolder(source, out) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(out);

    archive
      .directory(source, false)
      .on('error', err => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

// Auto-delete zips and downloads after 1 hour
setInterval(() => {
  const now = Date.now();
  zipQueue = zipQueue.filter(item => {
    if (now - item.timestamp > 3600000) {
      if (fs.existsSync(item.zipPath)) fs.unlinkSync(item.zipPath);
      if (fs.existsSync(item.downloadPath)) fs.rmSync(item.downloadPath, { recursive: true, force: true });
      return false;
    }
    return true;
  });
}, 60000); // check every 60s

// API to add download
app.post('/download', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).send({ error: 'No URL provided' });

  const id = Date.now().toString();
  const download = { id, url, status: 'Queued', progress: 0, zip: null };
  downloadQueue.push(download);

  processQueue();
  res.send({ id });
});

// API for dashboard status
app.get('/status', (req, res) => {
  res.send({
    current: currentDownload,
    queue: downloadQueue,
    zips: zipQueue.map(item => ({
      zip: path.basename(item.zipPath),
      timestamp: item.timestamp
    }))
  });
});

// Serve zips
app.use('/zips', express.static(path.join(__dirname, 'zips')));

// Start server
app.listen(PORT, () => console.log(`Music Hub running: http://localhost:${PORT}`));
