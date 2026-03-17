const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;

const SONGS_DIR = path.join(__dirname, 'downloads');
const ZIP_DIR = path.join(__dirname, 'zips');

if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR);
if (!fs.existsSync(ZIP_DIR)) fs.mkdirSync(ZIP_DIR);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Queue + status tracking
const downloadQueue = [];
let isDownloading = false;
const downloadStatus = {}; // { jobId: [ {filename, done} ] }

function processQueue() {
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;

  const job = downloadQueue.shift();
  const jobId = job.id;
  downloadStatus[jobId] = []; // will populate as songs start downloading

  let currentIndex = 0;

  function downloadNextUrl() {
    if (currentIndex >= job.urls.length) {
      // ZIP everything in SONGS_DIR
      const zipName = `${jobId}.zip`;
      const zipPath = path.join(ZIP_DIR, zipName);

      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        // Auto delete songs + zip after 1 hour
        setTimeout(() => {
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
          fs.readdirSync(SONGS_DIR).forEach(f => {
            fs.unlinkSync(path.join(SONGS_DIR, f));
          });
        }, 1000 * 60 * 60);

        job.resolve({ zipName });
        isDownloading = false;
        processQueue();
      });

      archive.pipe(output);
      fs.readdirSync(SONGS_DIR).forEach(f => {
        archive.file(path.join(SONGS_DIR, f), { name: f });
      });
      archive.finalize();
      return;
    }

    const url = job.urls[currentIndex];
    const cmd = './venv/bin/spotdl';
    const args = [url, '--output', SONGS_DIR];
    const child = spawn(cmd, args);

    // Listen to stdout to detect when a song starts and ends
    child.stdout.on('data', data => {
      const str = data.toString();
      // SpotDL outputs lines like: "Downloading: <song name>"
      const match = str.match(/Downloading: (.+)/);
      if (match) {
        const songName = match[1].trim();
        // Add to status array if not exists
        if (!downloadStatus[jobId].some(s => s.filename === songName)) {
          downloadStatus[jobId].push({ filename: songName, done: false });
        }
      }
    });

    child.stderr.on('data', data => {
      console.error(data.toString());
    });

    child.on('close', () => {
      // Mark all songs that were downloaded from this URL as done
      downloadStatus[jobId].forEach(s => s.done = true);
      currentIndex++;
      downloadNextUrl();
    });
  }

  downloadNextUrl();
}

app.post('/api/download', (req, res) => {
  const { urls } = req.body;
  if (!urls || urls.length === 0) return res.status(400).json({ error: 'No URLs provided' });

  const jobId = `job-${Date.now()}`;
  const promise = new Promise(resolve => {
    downloadQueue.push({ id: jobId, urls, resolve });
    processQueue();
  });

  res.json({ status: 'queued', jobId });

  promise.then(result => console.log(`Job complete: ${jobId}`));
});

app.get('/api/status/:jobId', (req, res) => {
  const status = downloadStatus[req.params.jobId];
  if (!status) return res.status(404).json({ error: 'Not found' });
  res.json(status); // Array of { filename, done }
});

app.use('/zips', express.static(ZIP_DIR));

app.listen(PORT, () => console.log(`Music Hub running: http://localhost:${PORT}`));
