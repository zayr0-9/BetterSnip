import fs from "fs";
import http from "http";
import path from "path";
import { spawn } from "child_process";
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
type FrozenSnipDisplay = {
  displayId: number;
  bounds: Rect;
  scaleFactor: number;
  monitorIndex: number;
  filePath: string;
};
let frozenSnipDisplays: FrozenSnipDisplay[] = [];
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
const projectRoot = isDev ? path.resolve(__dirname, "..") : undefined;
const appIconPath = isDev
  ? path.resolve(projectRoot!, "build", "icon.ico")
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

function ffmpegExePath(): string {
  const candidates = isDev
    ? [
        path.resolve(projectRoot!, "vendor", "ffmpeg-n7.1-latest-win64-gpl-7.1", "bin", "ffmpeg.exe"),
        path.resolve(projectRoot!, "vendor", "ffmpeg.exe"),
      ]
    : [
        path.join(process.resourcesPath, "vendor", "ffmpeg-n7.1-latest-win64-gpl-7.1", "bin", "ffmpeg.exe"),
        path.join(process.resourcesPath, "vendor", "ffmpeg.exe"),
      ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Bundled FFmpeg binary was not found.");
  return found;
}

function ffprobeExePath(): string | null {
  const candidates = isDev
    ? [
        path.resolve(projectRoot!, "vendor", "ffmpeg-n7.1-latest-win64-gpl-7.1", "bin", "ffprobe.exe"),
        path.resolve(projectRoot!, "vendor", "ffprobe.exe"),
      ]
    : [
        path.join(process.resourcesPath, "vendor", "ffmpeg-n7.1-latest-win64-gpl-7.1", "bin", "ffprobe.exe"),
        path.join(process.resourcesPath, "vendor", "ffprobe.exe"),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runProcess(exe: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${path.basename(exe)} exited with code ${code}`));
    });
  });
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

function createRecordingWindow(job: RecordingJob, options: { showBorder?: boolean } = {}): void {
  recordingJob = job;
  const controlW = 170;
  const controlH = 52;
  const showBorder = options.showBorder !== false;

  if (showBorder) {
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
  }

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
    args: isDev ? [projectRoot!] : [],
  });
}

async function startSnip(): Promise<void> {
  if (snipStarting) return;

  overlayWindows = overlayWindows.filter((w) => !w.isDestroyed());
  if (overlayWindows.length) return;

  snipStarting = true;
  foregroundAtSnip = await getForegroundApp();
  frozenSnipDisplays = [];

  // Freeze the desktop before creating/focusing the overlay. This preserves
  // transient UI like context menus that Windows would otherwise dismiss once
  // the overlay takes focus. The overlay then shows this frozen frame as its
  // background, and final region capture crops from the same frozen frame.
  try {
    frozenSnipDisplays = await captureFrozenSnipDisplays();
  } catch (err) {
    console.warn("[snip] failed to capture frozen desktop frame", err);
    frozenSnipDisplays = [];
  }

  overlayWindows = screen.getAllDisplays().map((display) => {
    const frozen = frozenSnipDisplays.find((item) => item.displayId === display.id);
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
      background: frozen ? mediaUrl(frozen.filePath, Date.now()) : "",
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

async function prepareRecording(
  rect: Rect,
  audio = false,
  skipPreview = false,
  options: { showBorder?: boolean } = {},
): Promise<string> {
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
    videoFormat: config.videoRecordingFormat,
    audio: !!audio,
    audioBitrate: 128_000,
  });
  createRecordingWindow(job, { showBorder: options.showBorder });
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
  await prepareRecording(focused.bounds, true, true, { showBorder: false }).catch((err) =>
    dialog.showErrorBox("BetterSnip", err instanceof Error ? err.message : String(err)),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupFrozenSnipDisplays(): void {
  for (const item of frozenSnipDisplays) {
    try {
      if (fs.existsSync(item.filePath)) fs.unlinkSync(item.filePath);
    } catch (err) {
      console.warn("[snip] failed to remove frozen desktop frame", item.filePath, err);
    }
  }
  frozenSnipDisplays = [];
}

async function captureFrozenSnipDisplays(): Promise<FrozenSnipDisplay[]> {
  if (process.platform !== "win32") return [];
  ensureSaveDir();

  const captures: FrozenSnipDisplay[] = [];
  const displays = screen.getAllDisplays();
  for (let monitorIndex = 0; monitorIndex < displays.length; monitorIndex += 1) {
    const display = displays[monitorIndex];
    const filePath = path.join(
      app.getPath("temp"),
      `bettersnip-freeze-${process.pid}-${display.id}-${Date.now()}.png`,
    );
    const rect = {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
    };
    await captureNativeScreenshot({ filePath, rect, monitorIndex, format: "png" });
    captures.push({
      displayId: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      monitorIndex,
      filePath,
    });
  }
  return captures;
}

async function cropFrozenSnipAndSave(rect: Rect): Promise<string | null> {
  const frozen = frozenSnipDisplays.find((item) =>
    rect.x >= item.bounds.x &&
    rect.y >= item.bounds.y &&
    rect.x < item.bounds.x + item.bounds.width &&
    rect.y < item.bounds.y + item.bounds.height,
  );
  if (!frozen) return null;

  ensureSaveDir();
  const ext = config.imageFormat === "jpg" ? "jpg" : "png";
  const slug = buildForegroundSlug(foregroundAtSnip) || "screenshot";
  const filePath = uniqueFilePath(config.saveDir, `${slug}-${timestamp()}`, ext);
  const image = nativeImage.createFromPath(frozen.filePath);
  if (image.isEmpty()) return null;

  const scale = frozen.scaleFactor;
  const crop = {
    x: Math.max(0, Math.round((rect.x - frozen.bounds.x) * scale)),
    y: Math.max(0, Math.round((rect.y - frozen.bounds.y) * scale)),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
  const size = image.getSize();
  crop.width = Math.max(1, Math.min(crop.width, size.width - crop.x));
  crop.height = Math.max(1, Math.min(crop.height, size.height - crop.y));

  const cropped = image.crop(crop);
  const data = ext === "jpg" ? cropped.toJPEG(92) : cropped.toPNG();
  fs.writeFileSync(filePath, data);
  if (config.copyToClipboard) clipboard.writeImage(cropped);
  return filePath;
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

function copyFileToClipboard(filePath: string, options: { respectSetting?: boolean } = {}): void {
  const respectSetting = options.respectSetting !== false;
  const exists = fs.existsSync(filePath);
  const size = exists ? fs.statSync(filePath).size : 0;
  console.log("[clipboard] copyFileToClipboard called", {
    filePath,
    exists,
    size,
    copyToClipboard: config.copyToClipboard,
    respectSetting,
    platform: process.platform,
  });

  if (respectSetting && !config.copyToClipboard) {
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

  const frozenFilePath = await cropFrozenSnipAndSave(rect);
  if (frozenFilePath) return frozenFilePath;

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
    videoFormat: config.videoRecordingFormat,
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

ipcMain.handle("video:metadata", async (_, filePath) => {
  const target = validateGalleryFile(filePath);
  const probe = ffprobeExePath();
  if (!probe) return { duration: 0, width: 0, height: 0 };
  const { stdout } = await runProcess(probe, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    target,
  ]);
  const parsed = JSON.parse(stdout || "{}");
  const video = parsed.streams?.find((stream: any) => stream.codec_type === "video") || {};
  return {
    duration: Number(parsed.format?.duration || video.duration || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
  };
});

ipcMain.handle("video:edit", async (_, options) => {
  if (!options?.inputPath) throw new Error("No video is open for editing.");
  const inputPath = validateGalleryFile(options.inputPath);
  const source = path.parse(inputPath);
  const format = String(options.format || source.ext.slice(1) || "mp4").toLowerCase() === "webm" ? "webm" : "mp4";
  const targetPath = options.saveAsCopy === false
    ? path.join(source.dir, `${source.name}-processing.${format}`)
    : uniqueFilePath(source.dir, `${source.name}-edited`, format);

  const args: string[] = ["-y"];
  const start = Math.max(0, Number(options.startTime || 0));
  const end = Math.max(0, Number(options.endTime || 0));
  if (start > 0) args.push("-ss", String(start));
  args.push("-i", inputPath);
  if (end > start) args.push("-t", String(end - start));

  const filtersList: string[] = [];
  const crop = options.crop || {};
  if (crop.enabled) {
    const w = Math.max(2, Math.round(Number(crop.width || 0)));
    const h = Math.max(2, Math.round(Number(crop.height || 0)));
    const x = Math.max(0, Math.round(Number(crop.x || 0)));
    const y = Math.max(0, Math.round(Number(crop.y || 0)));
    filtersList.push(`crop=${w}:${h}:${x}:${y}`);
  }
  const resize = options.resize || {};
  if (resize.enabled) {
    const w = Math.max(2, Math.round(Number(resize.width || -1)));
    const h = Math.max(2, Math.round(Number(resize.height || -1)));
    filtersList.push(`scale=${w}:${h}`);
  }
  const speed = Math.max(0.25, Math.min(4, Number(options.speed || 1)));
  if (speed !== 1) filtersList.push(`setpts=${(1 / speed).toFixed(5)}*PTS`);
  if (filtersList.length) args.push("-vf", filtersList.join(","));

  const removeAudio = !!options.removeAudio;
  if (removeAudio) args.push("-an");
  else if (speed !== 1) args.push("-filter:a", `atempo=${Math.max(0.5, Math.min(2, speed)).toFixed(5)}`);

  const quality = Number(options.quality || 23);
  if (format === "mp4") args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(quality), "-pix_fmt", "yuv420p");
  else args.push("-c:v", "libvpx-vp9", "-crf", String(quality), "-b:v", "0");
  if (!removeAudio) args.push("-c:a", format === "mp4" ? "aac" : "libopus");
  args.push(targetPath);

  await runProcess(ffmpegExePath(), args);

  let finalPath = targetPath;
  if (options.saveAsCopy === false) {
    const replacement = path.join(source.dir, `${source.name}.${format}`);
    if (replacement !== inputPath && fs.existsSync(replacement)) fs.unlinkSync(replacement);
    if (replacement === inputPath) {
      fs.unlinkSync(inputPath);
      fs.renameSync(targetPath, inputPath);
      finalPath = inputPath;
    } else {
      try { fs.unlinkSync(inputPath); } catch {}
      fs.renameSync(targetPath, replacement);
      finalPath = replacement;
    }
    annotationFilePath = finalPath;
  }

  settingsWindow?.webContents.send("gallery:changed");
  showSavedToast(finalPath);
  return {
    path: finalPath,
    name: path.basename(finalPath),
    url: mediaUrl(finalPath, Math.round(fs.statSync(finalPath).mtimeMs)),
    type: "video",
  };
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

function validateGalleryFile(filePath: string): string {
  ensureSaveDir();
  if (!filePath) throw new Error("Capture not found.");
  const target = path.resolve(filePath);
  const saveDir = path.resolve(config.saveDir);
  if (path.dirname(target) !== saveDir)
    throw new Error("Cannot access files outside the save folder.");
  const ext = path.extname(target).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webm", ".mp4"].includes(ext))
    throw new Error("Unsupported capture type.");
  if (!fs.existsSync(target)) throw new Error("Capture not found.");
  return target;
}

ipcMain.handle("gallery:copy", (_, filePath) => {
  copyFileToClipboard(validateGalleryFile(filePath), { respectSetting: false });
});

ipcMain.handle("gallery:delete", (_, filePath) => {
  const target = validateGalleryFile(filePath);
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
  cleanupFrozenSnipDisplays();
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

  // Make the UI respond immediately. Native finalization can take a moment,
  // especially with hardware encoders/audio, but the stop button should never
  // look like it failed to click.
  recordingControlsWindow?.close();
  recordingBorderWindow?.close();

  const filePath = await stopNativeRecording();
  console.log("[recording:stop] native stop returned", {
    filePath,
    exists: !!filePath && fs.existsSync(filePath),
    size: filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
  });
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
