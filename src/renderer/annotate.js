const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg']);
const VIDEO_EXTS = new Set(['.webm']);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

async function mount(url, targetId) {
  const html = await fetch(url).then(r => r.text());
  document.getElementById(targetId).innerHTML = html;
}

async function boot() {
  const info = await window.betterSnip.getAnnotationImage();
  if (!info) return;
  const ext = extOf(info.name || info.path || '');
  const isVideo = VIDEO_EXTS.has(ext);
  document.getElementById('editorTitle').textContent = isVideo ? 'Video preview' : 'Annotate screenshot';

  if (isVideo) {
    await mount('video-view.html', 'videoMount');
    document.getElementById('videoView').classList.remove('hidden');
    document.getElementById('videoView').classList.add('flex');
    await loadScript('video-view.js');
    await window.loadVideoView(info);
  } else if (IMAGE_EXTS.has(ext)) {
    await mount('image-editor.html', 'imageMount');
    document.getElementById('imageView').classList.remove('hidden');
    document.getElementById('imageView').classList.add('flex');
    await loadScript('image-editor.js');
  } else {
    alert('Unsupported capture type.');
    window.betterSnip.closeWindow();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.betterSnip.closeWindow();
});

boot().catch(err => {
  console.error(err);
  alert(err.message || String(err));
});
