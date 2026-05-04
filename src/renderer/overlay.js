const box = document.getElementById('box');
const params = new URLSearchParams(location.search);
const display = {
  x: Number(params.get('x') || 0),
  y: Number(params.get('y') || 0),
  width: Number(params.get('width') || window.innerWidth),
  height: Number(params.get('height') || window.innerHeight)
};
let start = null;
let current = null;
let dragging = false;

function clampPoint(e) {
  return {
    x: Math.max(0, Math.min(e.clientX, display.width)),
    y: Math.max(0, Math.min(e.clientY, display.height))
  };
}

function updateBox() {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  Object.assign(box.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}

window.addEventListener('mousedown', (e) => {
  dragging = true;
  start = clampPoint(e);
  current = clampPoint(e);
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
  const local = {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
  if (local.width < 5 || local.height < 5) return window.betterSnip.cancelSnip();
  document.body.style.cursor = 'wait';
  await window.betterSnip.captureSnip({
    x: display.x + local.x,
    y: display.y + local.y,
    width: local.width,
    height: local.height
  });
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.betterSnip.cancelSnip();
});
