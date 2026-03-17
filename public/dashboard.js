const form = document.getElementById('downloadForm');
const queueEl = document.getElementById('queue');

form.addEventListener('submit', async e => {
  e.preventDefault();
  const text = document.getElementById('urls').value.trim();
  const urls = text.split('\n').map(x => x.trim()).filter(Boolean);
  if (urls.length === 0) return;

  const response = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls })
  });

  const data = await response.json();
  const jobId = data.jobId;

  // Job card
  const li = document.createElement('li');
  li.className = 'job-card';
  li.id = jobId;

  li.innerHTML = `<div class="job-header">Job ${jobId}</div><div id="songs-${jobId}"></div><div id="download-${jobId}"></div>`;
  queueEl.appendChild(li);

  const songsDiv = document.getElementById(`songs-${jobId}`);
  urls.forEach((url, i) => {
    const songCard = document.createElement('div');
    songCard.style.marginBottom = '8px';
    songCard.innerHTML = `
      <div>Song ${i+1}</div>
      <div class="progress-container">
        <div class="progress-bar" id="song-${jobId}-${i}">0%</div>
      </div>
    `;
    songsDiv.appendChild(songCard);
  });

  const interval = setInterval(async () => {
    const statusRes = await fetch(`/api/status/${jobId}`);
    if (statusRes.status === 404) {
      const downloadDiv = document.getElementById(`download-${jobId}`);
      downloadDiv.innerHTML = `<a href="/zips/${jobId}.zip" class="download-link" target="_blank">Download ZIP</a>`;
      clearInterval(interval);
      return;
    }

    const status = await statusRes.json();
    status.forEach((song, i) => {
      const bar = document.getElementById(`song-${jobId}-${i}`);
      if (song.done) {
        bar.style.width = '100%';
        bar.textContent = '100%';
      } else {
        bar.style.width = '10%';
        bar.textContent = 'Downloading...';
      }
    });
  }, 1000);
});
