const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, desktopCapturer, screen, clipboard, nativeImage, shell, Notification } = require('electron');
const { loadConfig, saveConfig } = require('./config');
const { getForegroundApp, buildForegroundSlug } = require('./platform/foreground');

let tray;
let settingsWindow;
let overlayWindow;
let config;
let foregroundAtSnip = null;

app.setName('BetterSnip');
if (process.platform === 'win32') app.setAppUserModelId('BetterSnip');

const isDev = !app.isPackaged;

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function ensureSaveDir() {
  if (!config.saveDir) config.saveDir = path.join(app.getPath('pictures'), 'BetterSnip');
  fs.mkdirSync(config.saveDir, { recursive: true });
}

function uniqueFilePath(dir, base, ext) {
  let file = path.join(dir, `${base}.${ext}`);
  let i = 2;
  while (fs.existsSync(file)) file = path.join(dir, `${base}-${i++}.${ext}`);
  return file;
}

function createSettingsWindow(mode = 'settings') {
  if (settingsWindow) return settingsWindow.show();
  if (settingsWindow) return settingsWindow.show();
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 560,
    title: 'BetterSnip Settings',
    frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: { mode } });
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('BetterSnip');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Snip', click: startSnip },
    { label: 'Settings', click: createSettingsWindow },
    { label: 'Open Save Folder', click: () => { ensureSaveDir(); shell.openPath(config.saveDir); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(config.hotkey || 'Alt+Shift+S', startSnip);
  if (!ok) dialog.showErrorBox('BetterSnip', `Could not register hotkey: ${config.hotkey}`);
}

async function startSnip() {
  if (overlayWindow) return;
  foregroundAtSnip = await getForegroundApp();
  const displays = screen.getAllDisplays();
  const bounds = displays.reduce((acc, d) => ({
    x: Math.min(acc.x, d.bounds.x),
    y: Math.min(acc.y, d.bounds.y),
    right: Math.max(acc.right, d.bounds.x + d.bounds.width),
    bottom: Math.max(acc.bottom, d.bounds.y + d.bounds.height)
  }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity });

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.right - bounds.x,
    height: bounds.bottom - bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showSavedToast(filePath) {
  const body = `${path.basename(filePath)} saved and copied to clipboard.`;
  if (Notification.isSupported()) {
    const notification = new Notification({ title: 'BetterSnip saved', body });
    notification.on('click', () => shell.showItemInFolder(filePath));
    notification.show();
  } else {
    tray?.displayBalloon?.({ title: 'BetterSnip saved', content: body });
  }
}

async function captureAndSave(rect) {
  ensureSaveDir();
  if (overlayWindow) overlayWindow.hide();
  await sleep(160);
  const display = screen.getDisplayMatching(rect);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor }
  });
  const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
  const img = source.thumbnail;
  const crop = {
    x: Math.round((rect.x - display.bounds.x) * display.scaleFactor),
    y: Math.round((rect.y - display.bounds.y) * display.scaleFactor),
    width: Math.round(rect.width * display.scaleFactor),
    height: Math.round(rect.height * display.scaleFactor)
  };
  const cropped = img.crop(crop);
  const ext = config.imageFormat === 'jpg' ? 'jpg' : 'png';
  const buffer = ext === 'jpg' ? cropped.toJPEG(92) : cropped.toPNG();
  const slug = buildForegroundSlug(foregroundAtSnip) || 'screenshot';
  const filePath = uniqueFilePath(config.saveDir, `${slug}-${timestamp()}`, ext);
  fs.writeFileSync(filePath, buffer);
  if (config.copyToClipboard) clipboard.writeImage(cropped);
  return filePath;
}

ipcMain.handle('settings:get', () => config);
ipcMain.handle('settings:chooseDir', async () => {
  const result = await dialog.showOpenDialog(settingsWindow, { title: 'Choose BetterSnip save folder', properties: ['openDirectory', 'createDirectory'] });
  if (!result.canceled) {
    config.saveDir = result.filePaths[0];
    config = saveConfig(config);
  }
  return config;
});
ipcMain.handle('settings:openDir', () => {
  ensureSaveDir();
  shell.openPath(config.saveDir);
});
ipcMain.handle('onboarding:finish', (_, next) => {
  config = saveConfig({ ...config, ...next, onboardingComplete: true });
  ensureSaveDir();
  registerHotkey();
  return config;
});
ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.handle('window:close', () => BrowserWindow.getFocusedWindow()?.close());
ipcMain.handle('settings:save', (_, next) => {
  config = saveConfig({ ...config, ...next });
  ensureSaveDir();
  registerHotkey();
  return config;
});
ipcMain.handle('snip:cancel', () => { if (overlayWindow) overlayWindow.close(); });
ipcMain.handle('snip:capture', async (_, rect) => {
  const filePath = await captureAndSave(rect);
  if (overlayWindow) overlayWindow.close();
  showSavedToast(filePath);
  return filePath;
});

app.whenReady().then(() => {
  config = loadConfig();
  ensureSaveDir();
  createTray();
  registerHotkey();
  createSettingsWindow(config.onboardingComplete ? 'settings' : 'onboarding');
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
