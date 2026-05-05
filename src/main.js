const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, desktopCapturer, screen, clipboard, nativeImage, shell, Notification } = require('electron');
const { loadConfig, saveConfig } = require('./config');
const { getForegroundApp, buildForegroundSlug } = require('./platform/foreground');
const { enqueueDescription, startDescriptionQueue } = require('./llm/lmstudio');

let tray;
let settingsWindow;
let overlayWindows = [];
let config;
let foregroundAtSnip = null;
let annotationWindow = null;
let annotationFilePath = null;
let recordingWindow = null;
let recordingJob = null;

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

function createAnnotationWindow(filePath) {
  annotationFilePath = filePath;
  if (annotationWindow) {
    annotationWindow.show();
    annotationWindow.focus();
    annotationWindow.webContents.send('annotation:load', filePath);
    return;
  }
  annotationWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: 'Annotate Screenshot',
    frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  annotationWindow.loadFile(path.join(__dirname, 'renderer', 'annotate.html'));
  annotationWindow.once('ready-to-show', () => annotationWindow?.show());
  annotationWindow.on('closed', () => { annotationWindow = null; annotationFilePath = null; });
}

function createRecordingWindow(job) {
  recordingJob = job;
  const controlH = 58;
  recordingWindow = new BrowserWindow({
    width: Math.max(160, Math.round(job.rect.width)),
    height: Math.max(90, Math.round(job.rect.height + controlH)),
    x: Math.round(job.rect.x),
    y: Math.max(0, Math.round(job.rect.y - controlH)),
    title: 'Recording',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  recordingWindow.setContentProtection(true);
  recordingWindow.setAlwaysOnTop(true, 'screen-saver');
  recordingWindow.loadFile(path.join(__dirname, 'renderer', 'recorder.html'));
  recordingWindow.on('closed', () => { recordingWindow = null; });
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

function applyAutoStart(enabled) {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    path: process.execPath,
    args: isDev ? [path.resolve(__dirname, '..')] : []
  });
}

async function startSnip() {
  if (overlayWindows.length) return;
  foregroundAtSnip = await getForegroundApp();

  overlayWindows = screen.getAllDisplays().map((display) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      fullscreenable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js') }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(__dirname, 'renderer', 'overlay.html'), {
      query: {
        x: String(display.bounds.x),
        y: String(display.bounds.y),
        width: String(display.bounds.width),
        height: String(display.bounds.height)
      }
    });
    win.on('closed', () => {
      overlayWindows = overlayWindows.filter(w => w !== win);
    });
    return win;
  });
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
  overlayWindows.forEach(w => w.hide());
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
ipcMain.handle('annotation:open', (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Capture not found.');
  createAnnotationWindow(filePath);
  return filePath;
});
ipcMain.handle('annotation:openFile', () => {
  if (annotationFilePath) shell.openPath(annotationFilePath);
});
ipcMain.handle('annotation:getImage', () => {
  if (!annotationFilePath) return null;
  const stat = fs.existsSync(annotationFilePath) ? fs.statSync(annotationFilePath) : null;
  return { path: annotationFilePath, name: path.basename(annotationFilePath), url: `${pathToFileURL(annotationFilePath).href}?v=${stat ? Math.round(stat.mtimeMs) : Date.now()}` };
});
ipcMain.handle('annotation:save', (_, dataUrl, saveAsCopy = false) => {
  if (!annotationFilePath) throw new Error('No screenshot is open for annotation.');
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid image data.');
  const buffer = Buffer.from(match[2], 'base64');
  const targetPath = saveAsCopy
    ? uniqueFilePath(path.dirname(annotationFilePath), `${path.parse(annotationFilePath).name}-edited`, 'png')
    : annotationFilePath;
  fs.writeFileSync(targetPath, buffer);
  if (config.copyToClipboard) clipboard.writeImage(nativeImage.createFromBuffer(buffer));
  enqueueDescription(targetPath, config);
  settingsWindow?.webContents.send('gallery:changed');
  showSavedToast(targetPath);
  return targetPath;
});

ipcMain.handle('gallery:list', () => {
  ensureSaveDir();
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webm']);
  return fs.readdirSync(config.saveDir, { withFileTypes: true })
    .filter(d => d.isFile() && exts.has(path.extname(d.name).toLowerCase()))
    .map(d => {
      const filePath = path.join(config.saveDir, d.name);
      const stat = fs.statSync(filePath);
      const ext = path.extname(d.name).toLowerCase();
      return { name: d.name, path: filePath, url: `${pathToFileURL(filePath).href}?v=${Math.round(stat.mtimeMs)}`, mtime: stat.mtimeMs, type: ext === '.webm' ? 'video' : 'image' };
    })
    .sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('onboarding:finish', (_, next) => {
  config = saveConfig({ ...config, ...next, onboardingComplete: true });
  ensureSaveDir();
  registerHotkey();
  startDescriptionQueue(config);
  return config;
});
ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.handle('window:close', () => BrowserWindow.getFocusedWindow()?.close());
ipcMain.handle('settings:save', (_, next) => {
  config = saveConfig({ ...config, ...next });
  ensureSaveDir();
  registerHotkey();
  applyAutoStart(config.autoStart);
  startDescriptionQueue(config);
  return config;
});
function closeOverlays() {
  const wins = [...overlayWindows];
  overlayWindows = [];
  wins.forEach(w => { if (!w.isDestroyed()) w.close(); });
}

ipcMain.handle('snip:cancel', () => closeOverlays());
ipcMain.handle('recording:getJob', () => recordingJob);
ipcMain.handle('recording:stop', () => recordingWindow?.webContents.send('recording:stop'));
ipcMain.handle('recording:cancel', () => { recordingJob = null; recordingWindow?.close(); closeOverlays(); });
ipcMain.handle('recording:save', (_, buffer) => {
  if (!recordingJob) throw new Error('No active recording.');
  console.log('Saving recording bytes:', buffer?.byteLength || 0);
  if (!buffer || buffer.byteLength < 100) throw new Error('Recording produced no video data.');
  fs.writeFileSync(recordingJob.filePath, Buffer.from(buffer));
  const filePath = recordingJob.filePath;
  recordingJob = null;
  settingsWindow?.webContents.send('gallery:changed');
  showSavedToast(filePath);
  setTimeout(() => createAnnotationWindow(filePath), 100);
  return filePath;
});
ipcMain.handle('recording:prepare', async (_, rect) => {
  if (process.platform !== 'win32') throw new Error('Video snip is Windows-only for now. macOS/Linux paths are reserved for future native handling.');
  ensureSaveDir();
  const display = screen.getDisplayMatching(rect);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
  const slug = buildForegroundSlug(foregroundAtSnip) || 'recording';
  const filePath = uniqueFilePath(config.saveDir, `${slug}-${timestamp()}`, 'webm');
  const job = {
    sourceId: source.id,
    filePath,
    rect,
    displayBounds: display.bounds,
    scaleFactor: display.scaleFactor,
    crop: {
      x: Math.round((rect.x - display.bounds.x) * display.scaleFactor),
      y: Math.round((rect.y - display.bounds.y) * display.scaleFactor),
      width: Math.round(rect.width * display.scaleFactor),
      height: Math.round(rect.height * display.scaleFactor)
    }
  };
  createRecordingWindow(job);
  closeOverlays();
  return filePath;
});
ipcMain.handle('snip:capture', async (_, rect, mode = 'image') => {
  if (mode === 'video') throw new Error('Use recording:prepare for video snip.');
  const filePath = await captureAndSave(rect);
  closeOverlays();
  settingsWindow?.webContents.send('gallery:changed');
  createAnnotationWindow(filePath);
  return filePath;
});

app.whenReady().then(() => {
  config = loadConfig();
  ensureSaveDir();
  createTray();
  registerHotkey();
  applyAutoStart(config.autoStart);
  startDescriptionQueue(config);
  createSettingsWindow(config.onboardingComplete ? 'settings' : 'onboarding');
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
