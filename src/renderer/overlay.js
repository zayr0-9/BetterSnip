const box = document.getElementById('box');
const hint = document.getElementById('hint');
const shade = document.getElementById('shade');
const modebar = document.getElementById('modebar');
const recordControls = document.getElementById('recordControls');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const params = new URLSearchParams(location.search);
const display = {
  x: Number(params.get('x') || 0),
  y: Number(params.get('y') || 0),
  width: Number(params.get('width') || window.innerWidth),
  height: Number(params.get('height') || window.innerHeight)
};
let start = null;
let current = null;
let selectedLocal = null;
let dragging = false;
let mode = 'image';
let videoReady = false;
let recording = false;

function clampPoint(e) {
  return { x: Math.max(0, Math.min(e.clientX, display.width)), y: Math.max(0, Math.min(e.clientY, display.height)) };
}

function setMode(next) {
  if (recording) return;
  mode = next;
  videoReady = false;
  selectedLocal = null;
  box.style.display = 'none';
  recordControls.style.display = 'none';
  shade.style.display = 'block';
  modebar.style.display = 'block';
  hint.style.display = 'block';
  box.classList.remove('video-ready');
  document.getElementById('imageMode').className = `rounded px-3 py-1 ${mode === 'image' ? 'bg-sky-600' : 'hover:bg-white/15'}`;
  document.getElementById('videoMode').className = `rounded px-3 py-1 ${mode === 'video' ? 'bg-red-600' : 'hover:bg-white/15'}`;
}

document.getElementById('imageMode').addEventListener('click', e => { e.stopPropagation(); setMode('image'); });
document.getElementById('videoMode').addEventListener('click', e => { e.stopPropagation(); setMode('video'); });

function localRect() {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}

function updateBox() {
  const r = localRect();
  Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
}

function placeControls(r) {
  recordControls.style.left = `${r.x + r.width / 2}px`;
  recordControls.style.top = `${Math.max(44, r.y - 8)}px`;
  recordControls.style.display = 'block';
}

function absoluteRect(r) {
  return { x: display.x + r.x, y: display.y + r.y, width: r.width, height: r.height };
}

window.addEventListener('mousedown', (e) => {
  if (e.target.closest('button') || recording) return;
  dragging = true;
  videoReady = false;
  start = clampPoint(e);
  current = clampPoint(e);
  recordControls.style.display = 'none';
  updateBox();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  current = clampPoint(e);
  updateBox();
});

window.addEventListener('mouseup', async (e) => {
  if (!dragging) return;
  dragging = false;
  current = clampPoint(e);
  const r = localRect();
  if (r.width < 5 || r.height < 5) return window.betterSnip.cancelSnip();

  if (mode === 'image') {
    document.body.style.cursor = 'wait';
    await window.betterSnip.captureSnip(absoluteRect(r), 'image');
    return;
  }

  selectedLocal = r;
  videoReady = true;
  box.classList.add('video-ready');
  hint.textContent = 'Press ● to start recording. Border stays visible while recording.';
  placeControls(r);
});

recordBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!videoReady || !selectedLocal || recording) return;
  recording = true;
  const r = selectedLocal;

  // Hide only the dimming/help UI. Keep the border and controls visible.
  shade.style.display = 'none';
  modebar.style.display = 'none';
  hint.style.display = 'none';
  box.classList.add('video-ready');
  Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  placeControls(r);

  recordBtn.disabled = true;
  recordBtn.className = 'rounded-full px-3 py-2 text-red-400/40';
  stopBtn.disabled = false;
  stopBtn.className = 'rounded-full px-3 py-2 text-white hover:bg-white/15';

  await window.betterSnip.prepareRecording(absoluteRect(r));
});

stopBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!recording) return;
  stopBtn.disabled = true;
  stopBtn.className = 'rounded-full px-3 py-2 text-white/40';
  await window.betterSnip.stopRecording();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.betterSnip.cancelSnip();
});
