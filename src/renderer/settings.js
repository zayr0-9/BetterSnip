const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isOnboarding = params.get('mode') === 'onboarding';
let onboardingStep = 1;

async function load() {
  const s = await window.betterSnip.getSettings();
  $('saveDir').value = s.saveDir || '';
  $('onboardSaveDir').value = s.saveDir || '';
  $('hotkey').value = s.hotkey || 'Alt+Shift+S';
  $('onboardHotkey').value = s.hotkey || 'Alt+Shift+S';
  $('imageFormat').value = s.imageFormat || 'png';
  $('copyToClipboard').checked = s.copyToClipboard !== false;

  $('settingsView').classList.toggle('hidden', isOnboarding);
  $('onboardingView').classList.toggle('hidden', !isOnboarding);
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

async function chooseFolder(targetId) {
  const s = await window.betterSnip.chooseDir();
  $(targetId).value = s.saveDir || '';
  $('saveDir').value = s.saveDir || '';
  $('onboardSaveDir').value = s.saveDir || '';
}

$('chooseDir').addEventListener('click', () => chooseFolder('saveDir'));
$('onboardChooseDir').addEventListener('click', () => chooseFolder('onboardSaveDir'));
$('openDir').addEventListener('click', () => window.betterSnip.openDir());
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
    copyToClipboard: $('copyToClipboard').checked
  });
  $('status').textContent = `Saved. Hotkey: ${s.hotkey}`;
  setTimeout(() => $('status').textContent = '', 2500);
});

load().then(renderOnboarding);
