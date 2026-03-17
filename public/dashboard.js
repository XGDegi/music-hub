const form = document.getElementById('downloadForm');
const queueEl = document.getElementById('queue');

form.addEventListener('submit', async e => {
  e.preventDefault();
  const text = document.getElementById('urls').value.trim();
  const urls = text.split('\n').map(x => x.trim()).filter(Boolean);

  const response = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls })
  });
  const data = await response.json();

  const li = document.createElement('li');
  li.id = data.jobId;
  li.textContent = `Job ${data.jobId}: Queued`;
  queueEl.appendChild(li);

  const interval = setInterval(async () => {
    const statusRes = await fetch(`/api/status/${data.jobId}`);
    if (statusRes.status === 404) {
      li.textContent = `Job ${data.jobId}: Completed`;
      clearInterval(interval);
      return;
    }
    const status = await statusRes.json();
    li.textContent = `Job ${data.jobId}: ${status.progress} / ${status.total} songs downloaded`;
  }, 1000);
});
