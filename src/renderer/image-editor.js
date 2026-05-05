const $ = (id) => document.getElementById(id);
const FabricCanvas = window.fabric.Canvas;
const FabricImage = window.fabric.FabricImage || window.fabric.Image;
const PencilBrush = window.fabric.PencilBrush;

let canvas;
let imageInfo;
let baseImage;
let imageScale = 1;

function setBrush() {
  if (!canvas) return;
  if (!canvas.freeDrawingBrush) canvas.freeDrawingBrush = new PencilBrush(canvas);
  canvas.isDrawingMode = true;
  canvas.freeDrawingBrush.color = $('color').value;
  canvas.freeDrawingBrush.width = Number($('width').value);
  $('widthLabel').textContent = $('width').value;
}

function drawnObjects() {
  return canvas ? canvas.getObjects().filter(o => o !== baseImage) : [];
}

async function loadImage() {
  imageInfo = await window.betterSnip.getAnnotationImage();
  if (!imageInfo) return;

  const img = await FabricImage.fromURL(`${imageInfo.url}?t=${Date.now()}`);
  const wrap = document.querySelector('.canvas-wrap');
  const viewportW = Math.max(400, wrap.clientWidth - 40);
  const viewportH = Math.max(320, wrap.clientHeight - 40);
  imageScale = Math.min(1, viewportW / img.width, viewportH / img.height);
  if (canvas) canvas.dispose();
  canvas = new FabricCanvas('canvas', { width: viewportW, height: viewportH, backgroundColor: '#fff', selection: false });

  img.set({ scaleX: imageScale, scaleY: imageScale, selectable: false, evented: false, hoverCursor: 'crosshair' });
  baseImage = img;
  canvas.add(baseImage);
  canvas.centerObject(baseImage);
  baseImage.setCoords();
  canvas.sendObjectToBack(baseImage);
  canvas.renderAll();

  canvas.on('path:created', (e) => {
    if (!e.path) return;
    canvas.bringObjectToFront(e.path);
    e.path.setCoords();
    canvas.requestRenderAll();
  });
  setBrush();
}

async function undo() {
  const objects = drawnObjects();
  const last = objects.at(-1);
  if (last) canvas.remove(last);
  canvas?.renderAll();
  setBrush();
}

async function save(saveAsCopy = false) {
  if (!canvas) return;
  const b = baseImage.getBoundingRect();
  const dataUrl = canvas.toDataURL({
    format: 'png',
    quality: 1,
    multiplier: 1 / imageScale,
    left: b.left,
    top: b.top,
    width: b.width,
    height: b.height
  });
  await window.betterSnip.saveAnnotation(dataUrl, saveAsCopy);
  window.betterSnip.closeWindow();
}

$('color').addEventListener('input', setBrush);
$('width').addEventListener('input', setBrush);
$('undo').addEventListener('click', undo);
$('clear').addEventListener('click', () => { drawnObjects().forEach(o => canvas.remove(o)); canvas?.renderAll(); });
$('save').addEventListener('click', () => save(false));
$('saveCopy').addEventListener('click', () => save(true));
$('discard').addEventListener('click', () => window.betterSnip.closeWindow());
$('minimize').addEventListener('click', () => window.betterSnip.minimizeWindow());
$('close').addEventListener('click', () => window.betterSnip.closeWindow());

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') undo();
});
window.addEventListener('resize', () => setTimeout(loadImage, 150));

loadImage();
