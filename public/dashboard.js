const form = document.getElementById('downloadForm');
const queueEl = document.getElementById('queue');

form.addEventListener('submit', async e => {
  e.preventDefault();
  const text = document.getElementById('urls').value.trim();
  const urls = text.split('\n').map(x => x.trim()).filter(Boolean);
  if (!urls.length) return;

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

  // Polling for status
  const interval = setInterval(async () => {
    const statusRes = await fetch(`/api/status/${jobId}`);
    if (statusRes.status === 404) return; // not yet started

    const status = await statusRes.json();
    songsDiv.innerHTML = '';
    status.forEach((song, i) => {
      const songCard = document.createElement('div');
      songCard.style.marginBottom = '8px';
      songCard.innerHTML = `
        <div>${song.filename}</div>
        <div class="progress-container">
          <div class="progress-bar" style="width:${song.done ? '100%' : '10%'}">${song.done ? '100%' : 'Downloading...'}</div>
        </div>
      `;
      songsDiv.appendChild(songCard);
    });

    // Check if all done
    if (status.every(s => s.done)) {
      const downloadDiv = document.getElementById(`download-${jobId}`);
      downloadDiv.innerHTML = `<a href="/zips/${jobId}.zip" class="download-link" target="_blank">Download ZIP</a>`;
      clearInterval(interval);
    }
  }, 1000);
});
