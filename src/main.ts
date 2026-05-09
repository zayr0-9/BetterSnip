import fs from "fs";
import http from "http";
import path from "path";
import { Readable } from "stream";
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  dialog,
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
import { captureNativeScreenshot } from "./nativeCapture";
import { copyNativeFileToClipboard } from "./nativeClipboard";
import { cancelNativeRecording, startNativeRecording, stopNativeRecording } from "./nativeRecorder";
import type {
  AgentCaptureOptions,
  AgentCaptureResult,
  AppConfig,
  ForegroundInfo,
  RecordingJob,
  Rect,
} from "./types";

let tray: Tray | undefined;
let settingsWindow: BrowserWindow | null = null;
let overlayWindows: BrowserWindow[] = [];
let config: AppConfig;
let foregroundAtSnip: ForegroundInfo | null = null;
let annotationWindow: BrowserWindow | null = null;
let annotationFilePath: string | null = null;
let recordingControlsWindow: BrowserWindow | null = null;
let recordingBorderWindow: BrowserWindow | null = null;
let recordingJob: RecordingJob | null = null;
const skipPreviewRecordings = new Set<string>();

function recordingBitrate(): number {
  if (config.recordingQuality === "low") return 3_000_000;
  if (config.recordingQuality === "medium") return 5_000_000;
  return 8_000_000;
}
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
if (process.platform === "win32") app.setAppUserModelId("com.bettersnip.app");

const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const appIconPath = isDev
  ? path.resolve(__dirname, "..", "build", "icon.ico")
  : path.join(process.resourcesPath, "icon.ico");

function appIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(appIconPath);
  if (image.isEmpty()) console.warn(`BetterSnip icon not found: ${appIconPath}`);
  return image;
}

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

function directorySize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  return fs.readdirSync(dirPath, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) return total + directorySize(entryPath);
      if (entry.isFile()) return total + fs.statSync(entryPath).size;
    } catch (err) {
      console.warn("Failed to read storage usage entry", entryPath, err);
    }
    return total;
  }, 0);
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
    icon: appIcon(),
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
    icon: appIcon(),
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  loadRendererPage(annotationWindow, "annotate.html");
  annotationWindow.once("ready-to-show", () => {
    annotationWindow?.show();
    annotationWindow?.focus();
  });
  annotationWindow.on("closed", () => {
    annotationWindow = null;
    annotationFilePath = null;
  });
}

function createRecordingWindow(job: RecordingJob): void {
  recordingJob = job;
  const controlW = 170;
  const controlH = 52;

  recordingBorderWindow = new BrowserWindow({
    width: Math.max(1, Math.round(job.rect.width)),
    height: Math.max(1, Math.round(job.rect.height)),
    x: Math.round(job.rect.x),
    y: Math.round(job.rect.y),
    title: "Recording Border",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  recordingBorderWindow.setContentProtection(true);
  recordingBorderWindow.setAlwaysOnTop(true, "screen-saver");
  recordingBorderWindow.setIgnoreMouseEvents(true, { forward: true });
  loadRendererPage(recordingBorderWindow, "recorder.html", { view: "border" });
  recordingBorderWindow.on("closed", () => {
    recordingBorderWindow = null;
  });

  recordingControlsWindow = new BrowserWindow({
    width: controlW,
    height: controlH,
    x: Math.round(job.rect.x + job.rect.width / 2 - controlW / 2),
    y: Math.max(0, Math.round(job.rect.y - controlH - 6)),
    title: "Recording Controls",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  recordingControlsWindow.setContentProtection(true);
  recordingControlsWindow.setAlwaysOnTop(true, "screen-saver");
  loadRendererPage(recordingControlsWindow, "recorder.html", { view: "controls" });
  recordingControlsWindow.on("closed", () => {
    recordingControlsWindow = null;
  });
}

function createTray(): void {
  tray = new Tray(appIcon());
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
  const snipHotkey = config.hotkey || "Alt+Shift+S";
  const recordHotkey = config.fullScreenRecordHotkey || "Alt+Shift+R";
  const ok = globalShortcut.register(snipHotkey, startSnip);
  const recordOk = recordHotkey === snipHotkey || globalShortcut.register(recordHotkey, startFullScreenRecording);
  if (!ok)
    dialog.showErrorBox(
      "BetterSnip",
      `Could not register hotkey: ${snipHotkey}`,
    );
  if (!recordOk)
    dialog.showErrorBox(
      "BetterSnip",
      `Could not register full-screen record hotkey: ${recordHotkey}`,
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

  overlayWindows = overlayWindows.filter((w) => !w.isDestroyed());
  if (overlayWindows.length) return;

  snipStarting = true;
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
      fullscreen: true,
      fullscreenable: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    loadRendererPage(win, "overlay.html", {
      x: String(display.bounds.x),
      y: String(display.bounds.y),
      width: String(display.bounds.width),
      height: String(display.bounds.height),
    });
    win.once("ready-to-show", () => {
      win.show();
      win.setFullScreen(true);
      win.setAlwaysOnTop(true, "screen-saver");
      win.moveTop();
      win.focus();
    });
    win.on("closed", () => {
      overlayWindows = overlayWindows.filter((w) => w !== win);
    });
    return win;
  });
  setTimeout(() => {
    snipStarting = false;
  }, 500);
}

async function prepareRecording(rect: Rect, audio = false, skipPreview = false): Promise<string> {
  if (process.platform !== "win32")
    throw new Error(
      "Video snip is Windows-only for now. macOS/Linux paths are reserved for future native handling.",
    );
  if (recordingJob) throw new Error("A recording is already active.");
  ensureSaveDir();
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 1 ||
    rect.height < 1
  ) {
    throw new Error("Invalid capture rect.");
  }
  const display = screen.getDisplayMatching(rect);
  const displays = screen.getAllDisplays();
  const monitorIndex = Math.max(0, displays.findIndex((d) => d.id === display.id));
  const slug = buildForegroundSlug(foregroundAtSnip) || "recording";
  const filePath = uniqueFilePath(config.saveDir, `${slug}-${timestamp()}`, "mp4");
  const crop = {
    x: Math.max(0, Math.round((rect.x - display.bounds.x) * display.scaleFactor)),
    y: Math.max(0, Math.round((rect.y - display.bounds.y) * display.scaleFactor)),
    width: Math.max(1, Math.round(rect.width * display.scaleFactor)),
    height: Math.max(1, Math.round(rect.height * display.scaleFactor)),
  };
  const job = {
    sourceId: "native-wgc",
    filePath,
    rect,
    displayBounds: display.bounds,
    scaleFactor: display.scaleFactor,
    crop,
  };
  recordingJob = job;
  if (skipPreview) skipPreviewRecordings.add(filePath);
  await startNativeRecording({
    filePath,
    rect: crop,
    monitorIndex,
    fps: config.recordingFps,
    bitrate: recordingBitrate(),
    audio: !!audio,
    audioBitrate: 128_000,
  });
  createRecordingWindow(job);
  closeOverlays();
  return filePath;
}

async function startFullScreenRecording(): Promise<void> {
  if (recordingJob) {
    if (skipPreviewRecordings.has(recordingJob.filePath)) await stopRecording();
    return;
  }
  foregroundAtSnip = await getForegroundApp();
  const focused = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  await prepareRecording(focused.bounds, false, true).catch((err) =>
    dialog.showErrorBox("BetterSnip", err instanceof Error ? err.message : String(err)),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showSavedToast(
  filePath: string,
  options: { openAnnotationOnClick?: boolean } = {},
): void {
  const body = `${path.basename(filePath)} saved${config.copyToClipboard ? " and copied to clipboard" : ""}.`;
  const openOnClick = () => {
    if (options.openAnnotationOnClick) createAnnotationWindow(filePath);
    else shell.showItemInFolder(filePath);
  };
  if (Notification.isSupported()) {
    const notification = new Notification({ title: "BetterSnip saved", body });
    notification.on("click", openOnClick);
    notification.show();
  } else {
    tray?.displayBalloon?.({ title: "BetterSnip saved", content: body });
  }
}

function copyFileToClipboard(filePath: string): void {
  const exists = fs.existsSync(filePath);
  const size = exists ? fs.statSync(filePath).size : 0;
  console.log("[clipboard] copyFileToClipboard called", {
    filePath,
    exists,
    size,
    copyToClipboard: config.copyToClipboard,
    platform: process.platform,
  });

  if (!config.copyToClipboard) {
    console.log("[clipboard] skipped: copyToClipboard setting is disabled");
    return;
  }

  if (!exists || size <= 0) {
    console.warn("[clipboard] skipped: file does not exist or is empty", {
      filePath,
      exists,
      size,
    });
    return;
  }

  if (process.platform === "win32") {
    void copyNativeFileToClipboard(filePath)
      .then(() => console.log("[clipboard] native file clipboard copy complete", { filePath }))
      .catch((err) => console.error("[clipboard] native file clipboard copy failed", err));
    return;
  }

  try {
    clipboard.writeText(filePath);
    console.log("[clipboard] wrote file path as text", {
      readBack: clipboard.readText(),
    });
  } catch (err) {
    console.error("[clipboard] failed to copy file", err);
  }
}

function normalizeCaptureRect(rect?: Rect): Rect {
  const r = rect || screen.getPrimaryDisplay().bounds;
  if (
    !Number.isFinite(r.x) ||
    !Number.isFinite(r.y) ||
    !Number.isFinite(r.width) ||
    !Number.isFinite(r.height) ||
    r.width < 1 ||
    r.height < 1
  ) {
    throw new Error("Invalid capture rect.");
  }
  return r;
}

function getNativeCrop(rect: Rect): {
  display: Electron.Display;
  monitorIndex: number;
  crop: Rect;
} {
  const display = screen.getDisplayMatching(rect);
  const displays = screen.getAllDisplays();
  const monitorIndex = Math.max(0, displays.findIndex((d) => d.id === display.id));
  return {
    display,
    monitorIndex,
    crop: {
      x: Math.max(0, Math.round((rect.x - display.bounds.x) * display.scaleFactor)),
      y: Math.max(0, Math.round((rect.y - display.bounds.y) * display.scaleFactor)),
      width: Math.max(1, Math.round(rect.width * display.scaleFactor)),
      height: Math.max(1, Math.round(rect.height * display.scaleFactor)),
    },
  };
}

async function captureAndSave(rect: Rect): Promise<string> {
  ensureSaveDir();

  rect = normalizeCaptureRect(rect);
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.setIgnoreMouseEvents(true);
      win.hide();
    }
  }
  await sleep(300);

  if (process.platform !== "win32")
    throw new Error("Screenshot capture currently requires Windows.Graphics.Capture on Windows.");

  const { monitorIndex, crop } = getNativeCrop(rect);
  const ext = config.imageFormat === "jpg" ? "jpg" : "png";
  const slug = buildForegroundSlug(foregroundAtSnip) || "screenshot";
  const filePath = uniqueFilePath(config.saveDir, `${slug}-${timestamp()}`, ext);

  await captureNativeScreenshot({ filePath, rect: crop, monitorIndex, format: ext });

  if (config.copyToClipboard) {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) clipboard.writeImage(image);
  }
  return filePath;
}

async function captureScreenshotForAgent(
  options: AgentCaptureOptions,
): Promise<AgentCaptureResult> {
  ensureSaveDir();
  if (process.platform !== "win32")
    throw new Error("Screenshot capture currently requires Windows.");

  const rect = normalizeCaptureRect(options.rect);
  const { display, monitorIndex, crop } = getNativeCrop(rect);
  const ext = options.format === "jpg" ? "jpg" : "png";
  const mimeType = ext === "jpg" ? "image/jpeg" : "image/png";
  const save = options.save !== false;
  const filePath = save
    ? uniqueFilePath(config.saveDir, `agent-screenshot-${timestamp()}`, ext)
    : path.join(app.getPath("temp"), `bettersnip-agent-${Date.now()}.${ext}`);

  await captureNativeScreenshot({ filePath, rect: crop, monitorIndex, format: ext });
  if (save) settingsWindow?.webContents.send("gallery:changed");

  const result: AgentCaptureResult = {
    kind: "screenshot",
    mimeType,
    requestedRect: rect,
    displayBounds: display.bounds,
    scaleFactor: display.scaleFactor,
    nativeCrop: crop,
    outputWidth: crop.width,
    outputHeight: crop.height,
  };
  if (save || options.returnType === "path") result.path = filePath;
  if (options.returnType === "base64") result.base64 = fs.readFileSync(filePath, "base64");
  if (!save && options.returnType !== "path") fs.rmSync(filePath, { force: true });
  return result;
}

async function recordVideoForAgent(
  options: AgentCaptureOptions,
): Promise<AgentCaptureResult> {
  ensureSaveDir();
  if (process.platform !== "win32") throw new Error("Video capture currently requires Windows.");
  if (recordingJob) throw new Error("A recording is already active.");

  const rect = normalizeCaptureRect(options.rect);
  const { display, monitorIndex, crop } = getNativeCrop(rect);
  const save = options.save !== false;
  const durationMs = Math.max(250, Math.min(options.durationMs || 3000, 120000));
  const filePath = save
    ? uniqueFilePath(config.saveDir, `agent-recording-${timestamp()}`, "mp4")
    : path.join(app.getPath("temp"), `bettersnip-agent-${Date.now()}.mp4`);

  await startNativeRecording({
    filePath,
    rect: crop,
    monitorIndex,
    fps: options.fps || config.recordingFps,
    bitrate: options.bitrate || recordingBitrate(),
  });
  await sleep(durationMs);
  await stopNativeRecording();

  if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0)
    throw new Error("Video recording produced no data.");
  if (save) settingsWindow?.webContents.send("gallery:changed");

  const result: AgentCaptureResult = {
    kind: "video",
    mimeType: "video/mp4",
    requestedRect: rect,
    displayBounds: display.bounds,
    scaleFactor: display.scaleFactor,
    nativeCrop: crop,
    outputWidth: crop.width - (crop.width % 2),
    outputHeight: crop.height - (crop.height % 2),
    durationMs,
  };
  if (save || options.returnType === "path") result.path = filePath;
  if (options.returnType === "base64") result.base64 = fs.readFileSync(filePath, "base64");
  if (!save && options.returnType !== "path") fs.rmSync(filePath, { force: true });
  return result;
}

async function agentCapture(options: AgentCaptureOptions): Promise<AgentCaptureResult> {
  if (!options || typeof options !== "object") throw new Error("Invalid JSON body.");
  if (options.kind === "screenshot") return captureScreenshotForAgent(options);
  if (options.kind === "video") return recordVideoForAgent(options);
  throw new Error("kind must be 'screenshot' or 'video'.");
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function startAgentHttpServer(): void {
  const port = Number(process.env.BETTERSNIP_AGENT_PORT || 47831);
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true, app: "BetterSnip" });
      return;
    }
    if (req.method !== "POST" || req.url !== "/capture") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy(new Error("Request too large."));
    });
    req.on("end", async () => {
      try {
        const result = await agentCapture(JSON.parse(body || "{}"));
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[agent-api] listening on http://127.0.0.1:${port}`);
  });
}

ipcMain.handle("settings:get", () => config);
ipcMain.handle("settings:storageUsage", () => {
  ensureSaveDir();
  return { bytes: directorySize(config.saveDir) };
});
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
  const source = path.parse(annotationFilePath);
  const targetPath = saveAsCopy
    ? uniqueFilePath(source.dir, `${source.name}-edited`, "png")
    : source.ext.toLowerCase() === ".png"
      ? annotationFilePath
      : path.join(source.dir, `${source.name}.png`);
  fs.writeFileSync(targetPath, buffer);
  if (!saveAsCopy && targetPath !== annotationFilePath) {
    try {
      fs.unlinkSync(annotationFilePath);
    } catch (err) {
      console.warn("Failed to remove original annotation file", err);
    }
    annotationFilePath = targetPath;
  }
  if (config.copyToClipboard)
    clipboard.writeImage(nativeImage.createFromBuffer(buffer));
  enqueueDescription(targetPath, config);
  settingsWindow?.webContents.send("gallery:changed");
  showSavedToast(targetPath);
  return targetPath;
});

ipcMain.handle("gallery:list", () => {
  ensureSaveDir();
  const exts = new Set([".png", ".jpg", ".jpeg", ".webm", ".mp4"]);
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
        type: ext === ".webm" || ext === ".mp4" ? "video" : "image",
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
  if (![".png", ".jpg", ".jpeg", ".webm", ".mp4"].includes(ext))
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
async function stopRecording(): Promise<void> {
  console.log("[recording:stop] stop requested", {
    hasRecordingJob: !!recordingJob,
    jobFilePath: recordingJob?.filePath,
  });
  const filePath = await stopNativeRecording();
  console.log("[recording:stop] native stop returned", {
    filePath,
    exists: !!filePath && fs.existsSync(filePath),
    size: filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
  });
  recordingControlsWindow?.close();
  recordingBorderWindow?.close();
  recordingJob = null;
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    settingsWindow?.webContents.send("gallery:changed");
    copyFileToClipboard(filePath);
    showSavedToast(filePath);
    if (skipPreviewRecordings.delete(filePath)) return;
    setTimeout(() => createAnnotationWindow(filePath), 100);
  } else {
    console.warn("[recording:stop] skipped post-save actions: no valid output file", { filePath });
  }
}
ipcMain.handle("recording:stop", stopRecording);
ipcMain.handle("recording:cancel", () => {
  cancelNativeRecording();
  recordingJob = null;
  recordingControlsWindow?.close();
  recordingBorderWindow?.close();
  closeOverlays();
});
ipcMain.handle("recording:save", (_, buffer) => {
  console.log("[recording:save] save requested", {
    hasRecordingJob: !!recordingJob,
    jobFilePath: recordingJob?.filePath,
    bytes: buffer?.byteLength || 0,
  });
  if (!recordingJob) throw new Error("No active recording.");
  if (!buffer || buffer.byteLength < 100)
    throw new Error("Recording produced no video data.");
  fs.writeFileSync(recordingJob.filePath, Buffer.from(buffer));
  const filePath = recordingJob.filePath;
  console.log("[recording:save] wrote recording file", {
    filePath,
    exists: fs.existsSync(filePath),
    size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
  });
  recordingJob = null;
  settingsWindow?.webContents.send("gallery:changed");
  copyFileToClipboard(filePath);
  showSavedToast(filePath);
  setTimeout(() => createAnnotationWindow(filePath), 100);
  return filePath;
});
ipcMain.handle("recording:prepare", async (_, rect, audio = false, options?: { skipPreview?: boolean }) =>
  prepareRecording(rect, audio, !!options?.skipPreview),
);
ipcMain.handle("snip:capture", async (_, rect, mode = "image") => {
  if (mode === "video")
    throw new Error("Use recording:prepare for video snip.");
  try {
    const filePath = await captureAndSave(rect);
    settingsWindow?.webContents.send("gallery:changed");

    showSavedToast(filePath, {
      openAnnotationOnClick: !config.openEditorAfterCapture,
    });

    // Show the newest image capture in the editor unless disabled. If an editor is
    // already open, createAnnotationWindow updates annotationFilePath and reloads
    // that window so the new screenshot replaces the previous edit session.
    if (config.openEditorAfterCapture) createAnnotationWindow(filePath);
    return filePath;
  } finally {
    closeOverlays();
  }
});

app.whenReady().then(() => {
  protocol.handle("bettersnip-file", (request) => {
    const encodedPath = new URL(request.url).pathname.slice(1);
    const filePath = Buffer.from(encodedPath, "base64url").toString("utf8");
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    if (!stat?.isFile()) return new Response("Not found", { status: 404 });

    const ext = path.extname(filePath).toLowerCase();
    const type =
      ext === ".webm"
        ? "video/webm"
        : ext === ".mp4"
          ? "video/mp4"
          : ext === ".png"
            ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : "application/octet-stream";
    const range = request.headers.get("range");
    const makeHeaders = (status: number, extra: Record<string, string> = {}) =>
      new Headers({
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        ...extra,
      });

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416 });
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2]
        ? Math.min(Number(match[2]), stat.size - 1)
        : stat.size - 1;
      if (start > end || start >= stat.size)
        return new Response(null, {
          status: 416,
          headers: makeHeaders(416, { "Content-Range": `bytes */${stat.size}` }),
        });
      return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })) as BodyInit, {
        status: 206,
        headers: makeHeaders(206, {
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        }),
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(filePath)) as BodyInit, {
      headers: makeHeaders(200, { "Content-Length": String(stat.size) }),
    });
  });

  config = loadConfig();
  ensureSaveDir();
  startAgentHttpServer();
  createTray();
  registerHotkey();
  applyAutoStart(config.autoStart);
  startDescriptionQueue(config);
  createSettingsWindow(config.onboardingComplete ? "settings" : "onboarding");
});

app.on("window-all-closed", () => {});
app.on("will-quit", () => globalShortcut.unregisterAll());
