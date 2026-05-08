async function loadVideoView(info) {
  document.getElementById('videoPlayer').src = `${info.url}${info.url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

document.getElementById('openVideoFile').addEventListener('click', () => window.betterSnip.openAnnotationFile());
document.getElementById('closeVideo').addEventListener('click', () => window.betterSnip.closeWindow());
