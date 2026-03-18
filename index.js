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

// Queues
let downloadQueue = [];
let zipQueue = [];
let currentDownload = null;

// Convert Spotify URL to YouTube search
async function spotifyToYouTubeSearch(url) {
  return 'ytsearch1:' + url;
}

// Download songs (supports playlists)
async function downloadSong(url, outputPath) {
  const isPlaylist = url.includes('spotify.com/playlist');
  let tracks = [];

  if (isPlaylist) {
    // Get list of tracks via yt-dlp JSON
    tracks = await new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', [
        url,
        '--flat-playlist',
        '--dump-json'
      ]);

      let dataStr = '';
      ytdlp.stdout.on('data', (data) => { dataStr += data.toString(); });
      ytdlp.stderr.on('data', (data) => console.error(data.toString()));

      ytdlp.on('close', (code) => {
        if (code !== 0) return reject(new Error(`yt-dlp exited with code ${code}`));
        const list = dataStr.trim().split('\n').map(line => JSON.parse(line));
        resolve(list);
      });
    });
    console.log(`Found ${tracks.length} tracks in playlist`);
  } else {
    tracks = [{ url }]; // single track
  }

  // Download each track sequentially
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const trackUrl = isPlaylist ? track.url : track.url;

    await new Promise((resolve, reject) => {
      const trackPath = path.join(outputPath);
      fs.mkdirSync(trackPath, { recursive: true });

      const args = [
        trackUrl,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', `${trackPath}/%(title)s.%(ext)s`
      ];

      const ytdlp = spawn('yt-dlp', args);
      currentDownload.progress = `Track ${i + 1} of ${tracks.length}`;

      ytdlp.stdout.on('data', (data) => console.log(data.toString()));
      ytdlp.stderr.on('data', (data) => console.error(data.toString()));

      ytdlp.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
    });
  }
}

// Process download queue
async function processQueue() {
  if (currentDownload || downloadQueue.length === 0) return;
  currentDownload = downloadQueue.shift();
  currentDownload.status = 'Downloading';

  const outputPath = path.join(__dirname, 'downloads', currentDownload.id);

  try {
    await downloadSong(currentDownload.url, outputPath);

    // Zip all songs (single or playlist)
    currentDownload.status = 'Zipping';
    const zipPath = path.join(__dirname, 'zips', `${currentDownload.id}.zip`);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    await zipFolder(outputPath, zipPath);

    currentDownload.status = 'Done';
    currentDownload.zip = `/zips/${currentDownload.id}.zip`;
    zipQueue.push({ zipPath, downloadPath: outputPath, timestamp: Date.now() });

  } catch (err) {
    console.error(err);
    currentDownload.status = 'Error';
  } finally {
    currentDownload = null;
    setImmediate(processQueue);
  }
}

// Zip helper
function zipFolder(source, out) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(out);
    archive.directory(source, false).on('error', err => reject(err)).pipe(stream);
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
}, 60000);

// Add download
app.post('/download', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).send({ error: 'No URL provided' });

  const id = Date.now().toString();
  const download = { id, url, status: 'Queued', progress: 0, zip: null };
  downloadQueue.push(download);

  processQueue();
  res.send({ id });
});

// Dashboard status
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
