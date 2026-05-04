const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isOnboarding = params.get('mode') === 'onboarding';
let onboardingStep = 1;
let gallery = [];
let currentImage = 0;

async function load() {
  const s = await window.betterSnip.getSettings();
  const lm = s.lmStudio || {};
  $('saveDir').value = s.saveDir || '';
  $('onboardSaveDir').value = s.saveDir || '';
  $('hotkey').value = s.hotkey || 'Alt+Shift+S';
  $('onboardHotkey').value = s.hotkey || 'Alt+Shift+S';
  $('imageFormat').value = s.imageFormat || 'png';
  $('copyToClipboard').checked = s.copyToClipboard !== false;
  $('autoStart').checked = !!s.autoStart;
  $('lmEnabled').checked = !!lm.enabled;
  renderLmToggle();
  $('lmAddress').value = lm.address || 'localhost';
  $('lmPort').value = lm.port || '1234';
  $('lmModel').value = lm.model || 'gemma-3-4b-it';
  $('lmAutoLoad').checked = lm.autoLoad !== false;
  $('lmSystemPrompt').value = lm.systemPrompt || 'Describe this screenshot clearly and concisely.';

  $('settingsView').classList.toggle('hidden', isOnboarding);
  $('onboardingView').classList.toggle('hidden', !isOnboarding);
  if (!isOnboarding) loadGallery();
}

function renderOnboarding() {
  const folderStep = onboardingStep === 1;
  $('stepNo').textContent = String(onboardingStep);
  $('stepFolder').classList.toggle('hidden', !folderStep);
  $('stepHotkey').classList.toggle('hidden', folderStep);
  $('backOnboarding').classList.toggle('invisible', folderStep);
  $('nextOnboarding').textContent = folderStep ? 'Next' : 'Finish';
  $('onboardingSubtitle').textContent = folderStep ? 'Set up your screenshot storage.' : 'Choose your capture shortcut.';
  $('onboardingStatus').textContent = '';
}

function renderLmToggle() {
  const enabled = $('lmEnabled').checked;
  $('lmToggle').textContent = enabled ? 'Enabled' : 'Disabled';
  $('lmToggle').className = enabled
    ? 'shrink-0 rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white'
    : 'shrink-0 rounded-xl px-4 py-2 text-sm font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700';
}

function makeThumb(item, index, small = false) {
  const btn = document.createElement('button');
  btn.className = `${small ? 'h-16 w-24' : 'h-20 w-28'} shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 ${index === currentImage ? 'thumb-current' : ''}`;
  btn.title = item.name;
  btn.innerHTML = `<img src="${item.url}" class="h-full w-full object-cover" alt="${item.name}">`;
  btn.addEventListener('click', () => openGallery(index));
  return btn;
}

async function loadGallery() {
  gallery = await window.betterSnip.listGallery();
  $('galleryRow').replaceChildren(...gallery.slice(0, 30).map((item, i) => makeThumb(item, i)));
  $('galleryEmpty').classList.toggle('hidden', gallery.length > 0);
}

function renderModal() {
  if (!gallery.length) return;
  const item = gallery[currentImage];
  $('modalImage').src = item.url;
  $('modalCaption').textContent = `${currentImage + 1} / ${gallery.length} — ${item.name}`;
  $('modalThumbs').replaceChildren(...gallery.map((x, i) => makeThumb(x, i, true)));
  $('modalThumbs').children[currentImage]?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function openGallery(index) {
  currentImage = Math.max(0, Math.min(index, gallery.length - 1));
  $('galleryModal').classList.remove('hidden');
  renderModal();
}

function moveImage(delta) {
  if (!gallery.length) return;
  currentImage = (currentImage + delta + gallery.length) % gallery.length;
  renderModal();
}

async function chooseFolder(targetId) {
  const s = await window.betterSnip.chooseDir();
  $(targetId).value = s.saveDir || '';
  $('saveDir').value = s.saveDir || '';
  $('onboardSaveDir').value = s.saveDir || '';
}

$('chooseDir').addEventListener('click', () => chooseFolder('saveDir'));
$('onboardChooseDir').addEventListener('click', () => chooseFolder('onboardSaveDir'));
$('openDir').addEventListener('click', () => window.betterSnip.openDir());
$('refreshGallery').addEventListener('click', loadGallery);
window.betterSnip.onGalleryChanged(() => loadGallery());
$('galleryLeft').addEventListener('click', () => $('galleryRow').scrollBy({ left: -260, behavior: 'smooth' }));
$('galleryRight').addEventListener('click', () => $('galleryRow').scrollBy({ left: 260, behavior: 'smooth' }));
$('galleryRow').addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
    e.preventDefault();
    $('galleryRow').scrollBy({ left: e.deltaY, behavior: 'smooth' });
  }
}, { passive: false });
$('closeGalleryModal').addEventListener('click', () => $('galleryModal').classList.add('hidden'));
$('prevImage').addEventListener('click', () => moveImage(-1));
$('nextImage').addEventListener('click', () => moveImage(1));
$('galleryModal').addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) moveImage(e.deltaX > 0 ? 1 : -1);
});
let swipeX = null;
$('modalSwipeArea').addEventListener('pointerdown', e => { swipeX = e.clientX; });
$('modalSwipeArea').addEventListener('pointerup', e => {
  if (swipeX === null) return;
  const dx = e.clientX - swipeX;
  if (Math.abs(dx) > 50) moveImage(dx < 0 ? 1 : -1);
  swipeX = null;
});
window.addEventListener('keydown', e => {
  if ($('galleryModal').classList.contains('hidden')) return;
  if (e.key === 'Escape') $('galleryModal').classList.add('hidden');
  if (e.key === 'ArrowLeft') moveImage(-1);
  if (e.key === 'ArrowRight') moveImage(1);
});
$('lmToggle').addEventListener('click', () => {
  $('lmEnabled').checked = !$('lmEnabled').checked;
  renderLmToggle();
});
$('minimize').addEventListener('click', () => window.betterSnip.minimizeWindow());
$('close').addEventListener('click', () => window.betterSnip.closeWindow());

$('backOnboarding').addEventListener('click', () => {
  onboardingStep = 1;
  renderOnboarding();
});

$('nextOnboarding').addEventListener('click', async () => {
  if (onboardingStep === 1) {
    if (!$('onboardSaveDir').value) {
      $('onboardingStatus').textContent = 'Select a folder first.';
      return;
    }
    onboardingStep = 2;
    renderOnboarding();
    return;
  }

  await window.betterSnip.finishOnboarding({
    saveDir: $('onboardSaveDir').value,
    hotkey: $('onboardHotkey').value.trim() || 'Alt+Shift+S'
  });
  location.href = 'settings.html?mode=settings';
});

$('save').addEventListener('click', async () => {
  const s = await window.betterSnip.saveSettings({
    hotkey: $('hotkey').value.trim() || 'Alt+Shift+S',
    imageFormat: $('imageFormat').value,
    copyToClipboard: $('copyToClipboard').checked,
    autoStart: $('autoStart').checked,
    lmStudio: {
      enabled: $('lmEnabled').checked,
      address: $('lmAddress').value.trim() || 'localhost',
      port: $('lmPort').value.trim() || '1234',
      model: $('lmModel').value.trim() || 'gemma-3-4b-it',
      autoLoad: $('lmAutoLoad').checked,
      systemPrompt: $('lmSystemPrompt').value.trim() || 'Describe this screenshot clearly and concisely.'
    }
  });
  $('status').textContent = `Saved. Hotkey: ${s.hotkey}`;
  setTimeout(() => $('status').textContent = '', 2500);
});

load().then(renderOnboarding);
