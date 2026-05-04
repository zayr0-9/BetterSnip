const box = document.getElementById('box');
let start = null;
let current = null;
let dragging = false;

function updateBox() {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  Object.assign(box.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}

window.addEventListener('mousedown', (e) => {
  dragging = true;
  start = { x: e.screenX, y: e.screenY, clientX: e.clientX, clientY: e.clientY };
  current = { x: e.screenX, y: e.screenY, clientX: e.clientX, clientY: e.clientY };
  updateBox();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  current = { x: e.screenX, y: e.screenY, clientX: e.clientX, clientY: e.clientY };
  updateBox();
});

window.addEventListener('mouseup', async (e) => {
  if (!dragging) return;
  dragging = false;
  current = { x: e.screenX, y: e.screenY, clientX: e.clientX, clientY: e.clientY };
  const rect = {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
  if (rect.width < 5 || rect.height < 5) return window.betterSnip.cancelSnip();
  document.body.style.cursor = 'wait';
  await window.betterSnip.captureSnip(rect);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.betterSnip.cancelSnip();
});
