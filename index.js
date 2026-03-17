const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

const SONGS_DIR = path.join(__dirname, 'downloads');
const ZIP_DIR = path.join(__dirname, 'zips');

if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR);
if (!fs.existsSync(ZIP_DIR)) fs.mkdirSync(ZIP_DIR);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ---- Download Queue with per-song tracking ----
const downloadQueue = [];
let isDownloading = false;
const downloadStatus = {};

function processQueue() {
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;

  const job = downloadQueue.shift();
  const jobId = job.id;
  downloadStatus[jobId] = job.urls.map(u => ({ filename: u.filename, done: false }));

  let currentIndex = 0;

  function nextDownload() {
    if (currentIndex >= job.urls.length) {
      // ZIP creation
      const zipName = `${jobId}.zip`;
      const zipPath = path.join(ZIP_DIR, zipName);

      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        // Auto delete songs + zip after 1 hour
        setTimeout(() => {
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
          job.urls.forEach(u => {
            const songPath = path.join(SONGS_DIR, u.filename);
            if (fs.existsSync(songPath)) fs.unlinkSync(songPath);
          });
        }, 1000 * 60 * 60);

        job.resolve({ zipName });
        isDownloading = false;
        processQueue();
      });

      archive.pipe(output);
      job.urls.forEach(f => {
        archive.file(path.join(SONGS_DIR, f.filename), { name: f.filename });
      });
      archive.finalize();
      return;
    }

    const item = job.urls[currentIndex];
    const cmd = `./venv/bin/spotdl "${item.url}" --output "${path.join(SONGS_DIR, item.filename)}"`;

    const downloadProcess = exec(cmd);

    downloadProcess.on('close', () => {
      downloadStatus[jobId][currentIndex].done = true;
      currentIndex++;
      nextDownload();
    });
  }

  nextDownload();
}

app.post('/api/download', (req, res) => {
  const { urls } = req.body;
  if (!urls || urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' });
  }

  const jobId = `job-${Date.now()}`;
  const items = urls.map((u, i) => {
    return { url: u, filename: `song-${jobId}-${i}.mp3` };
  });

  const promise = new Promise(resolve => {
    downloadQueue.push({ id: jobId, urls: items, resolve });
    processQueue();
  });

  res.json({ status: 'queued', jobId });

  promise.then(result => {
    console.log(`Job complete: ${jobId}`);
  });
});

app.get('/api/status/:jobId', (req, res) => {
  const status = downloadStatus[req.params.jobId];
  if (!status) return res.status(404).json({ error: 'Not found' });
  res.json(status); // Array of song statuses
});

app.use('/zips', express.static(ZIP_DIR));

app.listen(PORT, () => console.log(`Music Hub running: http://localhost:${PORT}`));
