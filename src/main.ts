import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  dialog,
  desktopCapturer,
  screen,
  clipboard,
  nativeImage,
  shell,
  Notification,
  protocol,
  net,
} from "electron";
import { loadConfig, saveConfig } from "./config";
import { getForegroundApp, buildForegroundSlug } from "./platform/foreground";
import { enqueueDescription, startDescriptionQueue } from "./llm/lmstudio";
import type { AppConfig, ForegroundInfo, RecordingJob, Rect } from "./types";

let tray: Tray | undefined;
let settingsWindow: BrowserWindow | null = null;
let overlayWindows: BrowserWindow[] = [];
let config: AppConfig;
let foregroundAtSnip: ForegroundInfo | null = null;
let annotationWindow: BrowserWindow | null = null;
let annotationFilePath: string | null = null;
let recordingWindow: BrowserWindow | null = null;
let recordingJob: RecordingJob | null = null;
let snipStarting = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "bettersnip-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setName("BetterSnip");
if (process.platform === "win32") app.setAppUserModelId("BetterSnip");

const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

function rendererUrl(
  page: string,
  query?: Record<string, string>,
): string | null {
  if (!isDev || !devServerUrl) return null;
  const url = new URL(
    page,
    devServerUrl.endsWith("/") ? devServerUrl : `${devServerUrl}/`,
  );
  for (const [key, value] of Object.entries(query || {}))
    url.searchParams.set(key, value);
  return url.toString();
}

function loadRendererPage(
  win: BrowserWindow,
  page: string,
  query?: Record<string, string>,
): void {
  const url = rendererUrl(page, query);
  if (url) win.loadURL(url);
  else
    win.loadFile(
      path.join(__dirname, "renderer", page),
      query ? { query } : undefined,
    );

  if (isDev && page !== "overlay.html" && page !== "recorder.html") {
    win.webContents.once("did-finish-load", () =>
      win.webContents.openDevTools({ mode: "detach" }),
    );
  }
}

function mediaUrl(filePath: string, version: number): string {
  const encodedPath = Buffer.from(filePath, "utf8").toString("base64url");
  return `bettersnip-file://local/${encodedPath}?v=${version}`;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function ensureSaveDir(): void {
  if (!config.saveDir)
    config.saveDir = path.join(app.getPath("pictures"), "BetterSnip");
  fs.mkdirSync(config.saveDir, { recursive: true });
}

function uniqueFilePath(dir: string, base: string, ext: string): string {
  let file = path.join(dir, `${base}.${ext}`);
  let i = 2;
  while (fs.existsSync(file)) file = path.join(dir, `${base}-${i++}.${ext}`);
  return file;
}

function createSettingsWindow(mode = "settings"): void {
  if (settingsWindow) return settingsWindow.show();
  settingsWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "BetterSnip Settings",
    frame: false,
    backgroundMaterial: "mica",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  loadRendererPage(settingsWindow, "settings.html", { mode });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createAnnotationWindow(filePath: string): void {
  annotationFilePath = filePath;
  if (annotationWindow && !annotationWindow.isDestroyed()) {
    annotationWindow.show();
    annotationWindow.focus();

    // A new snip should replace whatever is currently being edited in the
    // existing editor window. Reloading the editor is more reliable than only
    // sending an IPC event because the current view may be an image editor,
    // a video preview, or have stale Fabric.js state from the previous file.
    loadRendererPage(annotationWindow, "annotate.html");
    return;
  }
  annotationWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: "Annotate Screenshot",
    frame: false,
    backgroundMaterial: "mica",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  loadRendererPage(annotationWindow, "annotate.html");
  annotationWindow.once("ready-to-show", () => annotationWindow?.show());
  annotationWindow.on("closed", () => {
    annotationWindow = null;
    annotationFilePath = null;
  });
}

function createRecordingWindow(job: RecordingJob): void {
  recordingJob = job;
  const controlH = 58;
  recordingWindow = new BrowserWindow({
    width: Math.max(160, Math.round(job.rect.width)),
    height: Math.max(90, Math.round(job.rect.height + controlH)),
    x: Math.round(job.rect.x),
    y: Math.max(0, Math.round(job.rect.y - controlH)),
    title: "Recording",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  recordingWindow.setContentProtection(true);
  recordingWindow.setAlwaysOnTop(true, "screen-saver");
  loadRendererPage(recordingWindow, "recorder.html");
  recordingWindow.on("closed", () => {
    recordingWindow = null;
  });
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("BetterSnip");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Snip", click: startSnip },
      { label: "Settings", click: () => createSettingsWindow() },
      {
        label: "Open Save Folder",
        click: () => {
          ensureSaveDir();
          shell.openPath(config.saveDir);
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

function registerHotkey(): void {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(config.hotkey || "Alt+Shift+S", startSnip);
  if (!ok)
    dialog.showErrorBox(
      "BetterSnip",
      `Could not register hotkey: ${config.hotkey}`,
    );
}

function applyAutoStart(enabled: boolean): void {
  if (process.platform !== "win32") return;
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    path: process.execPath,
    args: isDev ? [path.resolve(__dirname, "..")] : [],
  });
}

async function startSnip(): Promise<void> {
  if (snipStarting) return;
  snipStarting = true;
  overlayWindows = overlayWindows.filter((w) => !w.isDestroyed());
  if (overlayWindows.length) {
    closeOverlays();
    await sleep(80);
  }
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
      show: false,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    loadRendererPage(win, "overlay.html", {
      x: String(display.bounds.x),
      y: String(display.bounds.y),
      width: String(display.bounds.width),
      height: String(display.bounds.height),
    });
    win.once("ready-to-show", () => {
      win.show();
      win.focus();
    });
    win.on("closed", () => {
      overlayWindows = overlayWindows.filter((w) => w !== win);
    });
    return win;
  });
  snipStarting = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showSavedToast(filePath: string): void {
  const body = `${path.basename(filePath)} saved and copied to clipboard.`;
  if (Notification.isSupported()) {
    const notification = new Notification({ title: "BetterSnip saved", body });
    notification.on("click", () => shell.showItemInFolder(filePath));
    notification.show();
  } else {
    tray?.displayBalloon?.({ title: "BetterSnip saved", content: body });
  }
}

async function captureAndSave(rect: Rect): Promise<string> {
  ensureSaveDir();

  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    rect.width < 1 ||
    rect.height < 1
  ) {
    throw new Error("Invalid screenshot selection.");
  }

  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.setIgnoreMouseEvents(true);
      win.hide();
    }
  }
  await sleep(300);

  const display = screen.getDisplayMatching(rect);
  const requestedWidth = Math.max(
    1,
    Math.ceil(display.bounds.width * display.scaleFactor),
  );
  const requestedHeight = Math.max(
    1,
    Math.ceil(display.bounds.height * display.scaleFactor),
  );
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: requestedWidth, height: requestedHeight },
  });
  const source =
    sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty())
    throw new Error("Could not capture the selected screen.");

  const img = source.thumbnail;
  const imgSize = img.getSize();
  const scaleX = imgSize.width / display.bounds.width;
  const scaleY = imgSize.height / display.bounds.height;
  const crop = {
    x: Math.max(0, Math.floor((rect.x - display.bounds.x) * scaleX)),
    y: Math.max(0, Math.floor((rect.y - display.bounds.y) * scaleY)),
    width: Math.max(1, Math.ceil(rect.width * scaleX)),
    height: Math.max(1, Math.ceil(rect.height * scaleY)),
  };
  crop.width = Math.min(crop.width, imgSize.width - crop.x);
  crop.height = Math.min(crop.height, imgSize.height - crop.y);
  if (crop.width < 1 || crop.height < 1)
    throw new Error("Screenshot selection is outside the captured screen.");

  const cropped = img.crop(crop);
  const ext = config.imageFormat === "jpg" ? "jpg" : "png";
  const buffer = ext === "jpg" ? cropped.toJPEG(92) : cropped.toPNG();
  const slug = buildForegroundSlug(foregroundAtSnip) || "screenshot";
  const filePath = uniqueFilePath(
    config.saveDir,
    `${slug}-${timestamp()}`,
    ext,
  );
  fs.writeFileSync(filePath, buffer);
  if (config.copyToClipboard) clipboard.writeImage(cropped);
  return filePath;
}

ipcMain.handle("settings:get", () => config);
ipcMain.handle("settings:chooseDir", async () => {
  const result = await dialog.showOpenDialog(settingsWindow, {
    title: "Choose BetterSnip save folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (!result.canceled) {
    config.saveDir = result.filePaths[0];
    config = saveConfig(config);
  }
  return config;
});
ipcMain.handle("settings:openDir", () => {
  ensureSaveDir();
  shell.openPath(config.saveDir);
});
ipcMain.handle("annotation:open", (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath))
    throw new Error("Capture not found.");
  createAnnotationWindow(filePath);
  return filePath;
});
ipcMain.handle("annotation:openFile", () => {
  if (annotationFilePath) shell.openPath(annotationFilePath);
});
ipcMain.handle("annotation:getImage", () => {
  if (!annotationFilePath) return null;
  const stat = fs.existsSync(annotationFilePath)
    ? fs.statSync(annotationFilePath)
    : null;
  return {
    path: annotationFilePath,
    name: path.basename(annotationFilePath),
    url: mediaUrl(
      annotationFilePath,
      stat ? Math.round(stat.mtimeMs) : Date.now(),
    ),
  };
});
ipcMain.handle("annotation:save", (_, dataUrl, saveAsCopy = false) => {
  if (!annotationFilePath)
    throw new Error("No screenshot is open for annotation.");
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data.");
  const buffer = Buffer.from(match[2], "base64");
  const targetPath = saveAsCopy
    ? uniqueFilePath(
        path.dirname(annotationFilePath),
        `${path.parse(annotationFilePath).name}-edited`,
        "png",
      )
    : annotationFilePath;
  fs.writeFileSync(targetPath, buffer);
  if (config.copyToClipboard)
    clipboard.writeImage(nativeImage.createFromBuffer(buffer));
  enqueueDescription(targetPath, config);
  settingsWindow?.webContents.send("gallery:changed");
  showSavedToast(targetPath);
  return targetPath;
});

ipcMain.handle("gallery:list", () => {
  ensureSaveDir();
  const exts = new Set([".png", ".jpg", ".jpeg", ".webm"]);
  return fs
    .readdirSync(config.saveDir, { withFileTypes: true })
    .filter((d) => d.isFile() && exts.has(path.extname(d.name).toLowerCase()))
    .map((d) => {
      const filePath = path.join(config.saveDir, d.name);
      const stat = fs.statSync(filePath);
      const ext = path.extname(d.name).toLowerCase();
      return {
        name: d.name,
        path: filePath,
        url: mediaUrl(filePath, Math.round(stat.mtimeMs)),
        mtime: stat.mtimeMs,
        type: ext === ".webm" ? "video" : "image",
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle("gallery:delete", (_, filePath) => {
  ensureSaveDir();
  if (!filePath) throw new Error("Capture not found.");
  const target = path.resolve(filePath);
  const saveDir = path.resolve(config.saveDir);
  if (path.dirname(target) !== saveDir)
    throw new Error("Cannot delete files outside the save folder.");
  const ext = path.extname(target).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webm"].includes(ext))
    throw new Error("Unsupported capture type.");
  if (!fs.existsSync(target)) throw new Error("Capture not found.");
  fs.unlinkSync(target);
  settingsWindow?.webContents.send("gallery:changed");
});
ipcMain.handle("onboarding:finish", (_, next) => {
  config = saveConfig({ ...config, ...next, onboardingComplete: true });
  ensureSaveDir();
  registerHotkey();
  startDescriptionQueue(config);
  return config;
});
ipcMain.handle("window:minimize", () =>
  BrowserWindow.getFocusedWindow()?.minimize(),
);
ipcMain.handle("window:maximize", () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.handle("window:close", () => BrowserWindow.getFocusedWindow()?.close());
ipcMain.handle("settings:save", (_, next) => {
  config = saveConfig({ ...config, ...next });
  ensureSaveDir();
  registerHotkey();
  applyAutoStart(config.autoStart);
  startDescriptionQueue(config);
  return config;
});
function closeOverlays(): void {
  snipStarting = false;
  const all = BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && w.webContents.getURL().includes("overlay.html"),
  );
  const wins = Array.from(new Set([...overlayWindows, ...all]));
  overlayWindows = [];
  wins.forEach((w) => {
    if (!w.isDestroyed()) w.destroy();
  });
}

ipcMain.handle("snip:cancel", () => closeOverlays());
ipcMain.handle("recording:getJob", () => recordingJob);
ipcMain.handle("recording:stop", () =>
  recordingWindow?.webContents.send("recording:stop"),
);
ipcMain.handle("recording:cancel", () => {
  recordingJob = null;
  recordingWindow?.close();
  closeOverlays();
});
ipcMain.handle("recording:save", (_, buffer) => {
  if (!recordingJob) throw new Error("No active recording.");
  console.log("Saving recording bytes:", buffer?.byteLength || 0);
  if (!buffer || buffer.byteLength < 100)
    throw new Error("Recording produced no video data.");
  fs.writeFileSync(recordingJob.filePath, Buffer.from(buffer));
  const filePath = recordingJob.filePath;
  recordingJob = null;
  settingsWindow?.webContents.send("gallery:changed");
  showSavedToast(filePath);
  setTimeout(() => createAnnotationWindow(filePath), 100);
  return filePath;
});
ipcMain.handle("recording:prepare", async (_, rect) => {
  if (process.platform !== "win32")
    throw new Error(
      "Video snip is Windows-only for now. macOS/Linux paths are reserved for future native handling.",
    );
  ensureSaveDir();
  const display = screen.getDisplayMatching(rect);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 },
  });
  const source =
    sources.find((s) => s.display_id === String(display.id)) || sources[0];
  const slug = buildForegroundSlug(foregroundAtSnip) || "recording";
  const filePath = uniqueFilePath(
    config.saveDir,
    `${slug}-${timestamp()}`,
    "webm",
  );
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
      height: Math.round(rect.height * display.scaleFactor),
    },
  };
  createRecordingWindow(job);
  closeOverlays();
  return filePath;
});
ipcMain.handle("snip:capture", async (_, rect, mode = "image") => {
  if (mode === "video")
    throw new Error("Use recording:prepare for video snip.");
  try {
    const filePath = await captureAndSave(rect);
    settingsWindow?.webContents.send("gallery:changed");

    // Always show the newest image capture in the editor. If an editor is already
    // open, createAnnotationWindow updates annotationFilePath and reloads that
    // window so the new screenshot replaces the previous edit session.
    createAnnotationWindow(filePath);
    return filePath;
  } finally {
    closeOverlays();
  }
});

app.whenReady().then(() => {
  protocol.handle("bettersnip-file", (request) => {
    const encodedPath = new URL(request.url).pathname.slice(1);
    const filePath = Buffer.from(encodedPath, "base64url").toString("utf8");
    return net.fetch(pathToFileURL(filePath).toString());
  });

  config = loadConfig();
  ensureSaveDir();
  createTray();
  registerHotkey();
  applyAutoStart(config.autoStart);
  startDescriptionQueue(config);
  createSettingsWindow(config.onboardingComplete ? "settings" : "onboarding");
});

app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
