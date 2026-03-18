// index.js
require('dotenv').config();  // Loads Spotify credentials from .env
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const SpotifyWebApi = require('spotify-web-api-node');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let downloadQueue = [];
let zipQueue = [];
let currentDownload = null;

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIPY_CLIENT_ID,
  clientSecret: process.env.SPOTIPY_CLIENT_SECRET
});

// Authenticate Spotify
async function authenticateSpotify() {
  const data = await spotifyApi.clientCredentialsGrant();
  spotifyApi.setAccessToken(data.body['access_token']);
}

// Get track names from a playlist
async function getPlaylistTracks(playlistUrl) {
  await authenticateSpotify();
  const playlistId = playlistUrl.split('/').pop().split('?')[0];

  let tracks = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await spotifyApi.getPlaylistTracks(playlistId, { offset, limit });
    response.body.items.forEach(item => {
      tracks.push(`${item.track.artists.map(a => a.name).join(', ')} - ${item.track.name}`);
    });
    if (response.body.items.length < limit) break;
    offset += limit;
  }
  return tracks;
}

// Convert track name to YouTube search URL
function trackToYouTubeSearch(trackName) {
  return `ytsearch1:${trackName}`;
}

// Download song(s) and handle playlist
async function downloadSong(url, outputPath) {
  let tracks = [];

  if (url.includes('spotify.com/playlist')) {
    const trackNames = await getPlaylistTracks(url);
    tracks = trackNames.map(name => trackToYouTubeSearch(name));
  } else if (url.includes('spotify.com/track')) {
    const trackNames = await getPlaylistTracks(url.replace('track', 'playlist')); // fallback
    tracks = [trackToYouTubeSearch(trackNames[0])];
  } else {
    tracks = [url]; // normal YouTube links still work
  }

  const totalTracks = tracks.length;

  for (let i = 0; i < totalTracks; i++) {
    const trackUrl = tracks[i];
    fs.mkdirSync(outputPath, { recursive: true });

    // Update current download progress
    currentDownload.progress = `${i + 1} / ${totalTracks}`;

    await new Promise((resolve, reject) => {
      const args = [
        trackUrl,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', `${outputPath}/%(title)s.%(ext)s`
      ];

      const ytdlp = spawn('/usr/local/bin/yt-dlp', args); // full path ensures no ENOENT

      ytdlp.stdout.on('data', d => console.log(d.toString()));
      ytdlp.stderr.on('data', d => console.error(d.toString()));

      ytdlp.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
    });
  }
}

// Queue processor
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

// Zip folder helper
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

// Status endpoint
app.get('/status', (req, res) => {
  res.send({
    current: currentDownload,   // includes progress like "3 / 100"
    queue: downloadQueue,
    zips: zipQueue.map(item => ({
      zip: path.basename(item.zipPath),
      timestamp: item.timestamp
    }))
  });
});

// Serve ZIPs
app.use('/zips', express.static(path.join(__dirname, 'zips')));

app.listen(PORT, () => console.log(`Music Hub running: http://localhost:${PORT}`));
