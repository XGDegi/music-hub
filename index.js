// index.js
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let downloadQueue = [];
let zipQueue = [];
let currentDownload = null;

// Convert Spotify URL to YouTube search URL
function spotifyToYouTubeSearch(url) {
  // Extract track/playlist name from URL (simplified)
  const parts = url.split('/');
  const id = parts[parts.length - 1].split('?')[0];
  return `ytsearch1:${id}`; // searches YouTube for top match
}

// Download songs, playlist support
async function downloadSong(url, outputPath) {
  const isPlaylist = url.includes('spotify.com/playlist');
  let tracks = [];

  if (isPlaylist) {
    // Get track list from playlist using yt-dlp JSON
    tracks = await new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', [
        spotifyToYouTubeSearch(url),
        '--flat-playlist',
        '--dump-json'
      ]);

      let dataStr = '';
      ytdlp.stdout.on('data', d => (dataStr += d.toString()));
      ytdlp.stderr.on('data', d => console.error(d.toString()));

      ytdlp.on('close', code => {
        if (code !== 0) return reject(new Error(`yt-dlp exited with code ${code}`));
        const list = dataStr.trim().split('\n').map(line => JSON.parse(line));
        resolve(list);
      });
    });
  } else {
    tracks = [{ url: spotifyToYouTubeSearch(url) }];
  }

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const trackUrl = track.url;

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

      ytdlp.stdout.on('data', d => console.log(d.toString()));
      ytdlp.stderr.on('data', d => console.error(d.toString()));

      ytdlp.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
    });
  }
}

async function processQueue() {
  if (currentDownload || downloadQueue.length === 0) return;
  currentDownload = downloadQueue.shift();
  currentDownload.status = 'Downloading';

  const outputPath = path.join(__dirname, 'downloads', currentDownload.id);

  try {
    await downloadSong(currentDownload.url, outputPath);

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

function zipFolder(source, out) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(out);
    archive.directory(source, false).on('error', err => reject(err)).pipe(stream);
    stream.on('close', () => resolve());
    archive.finalize();
  });
}

// Auto-delete after 1 hour
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

// Status
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

app.listen(PORT, () => console.log(`Music Hub running: http://localhost:${PORT}`));
