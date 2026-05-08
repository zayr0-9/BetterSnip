let mediaStream;
let canvasStream;
let recorder;
let chunks = [];
let raf = 0;
let stopped = false;
let startedAt = Date.now();

const $ = (id) => document.getElementById(id);

setInterval(() => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}, 500);

async function start() {
  const job = await window.betterSnip.getRecordingJob();
  if (!job || process.platform !== 'win32') throw new Error('Recording MVP is Windows-only for now.');

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: job.sourceId, minFrameRate: 30, maxFrameRate: 30 } }
  });

  const video = $('preview');
  video.srcObject = mediaStream;
  video.muted = true;
  await new Promise(resolve => {
    video.onloadedmetadata = resolve;
    video.play().catch(resolve);
  });
  await video.play();

  const canvas = document.createElement('canvas');
  canvas.width = job.crop.width;
  canvas.height = job.crop.height;
  const ctx = canvas.getContext('2d');

  function draw() {
    ctx.drawImage(video, job.crop.x, job.crop.y, job.crop.width, job.crop.height, 0, 0, canvas.width, canvas.height);
    raf = requestAnimationFrame(draw);
  }
  draw();

  canvasStream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp8') ? 'video/webm; codecs=vp8' : 'video/webm';
  recorder = new MediaRecorder(canvasStream, { mimeType });
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    await window.betterSnip.saveRecording(buffer);
    window.betterSnip.closeWindow();
  };
  recorder.start();
}

function stop() {
  if (stopped) return;
  stopped = true;
  cancelAnimationFrame(raf);
  if (recorder?.state === 'recording') recorder.requestData();
  mediaStream?.getTracks().forEach(t => t.stop());
  canvasStream?.getTracks().forEach(t => t.stop());
  if (recorder?.state === 'recording') recorder.stop();
  else window.betterSnip.closeWindow();
}

$('stop').addEventListener('click', stop);
window.betterSnip.onRecordingStop(() => stop());
window.addEventListener('keydown', e => { if (e.key === 'Escape') stop(); });
window.addEventListener('beforeunload', () => { mediaStream?.getTracks().forEach(t => t.stop()); });

start().catch(async (err) => {
  console.error(err);
  alert(err.message || String(err));
  await window.betterSnip.cancelRecording?.();
  window.betterSnip.closeWindow();
});
