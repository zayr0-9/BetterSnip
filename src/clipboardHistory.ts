import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { app, clipboard, nativeImage } from "electron";
import { copyNativeFileToClipboard } from "./nativeClipboard";
import type { ClipboardHistoryItem } from "./types";

const VIDEO_EXTS = new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".wmv",
  ".m4v",
  ".mpeg",
  ".mpg",
]);
const MAX_ITEMS = 500;
const MAX_TEXT_LENGTH = 250_000;

let pollTimer: NodeJS.Timeout | null = null;
let lastSignature = "";
let onChangedCallback: (() => void) | null = null;
let writeGuardUntil = 0;

function rootDir(): string {
  const dir = path.join(app.getPath("userData"), "clipboard-history");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function imagesDir(): string {
  const dir = path.join(rootDir(), "images");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(): string {
  return path.join(rootDir(), "index.json");
}

function nowId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sha1(input: string | Buffer): string {
  return require("crypto").createHash("sha1").update(input).digest("hex");
}

function readIndex(): ClipboardHistoryItem[] {
  try {
    const raw = fs.readFileSync(indexPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(items: ClipboardHistoryItem[]): void {
  fs.mkdirSync(rootDir(), { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(items.slice(0, MAX_ITEMS), null, 2));
}

function notifyChanged(): void {
  onChangedCallback?.();
}

function formatBytes(bytes?: number): string | undefined {
  if (!Number.isFinite(bytes || NaN)) return undefined;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function isVideoPath(filePath: string): boolean {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

function itemPreview(item: ClipboardHistoryItem): string {
  if (item.type === "text") return item.text?.replace(/\s+/g, " ").trim().slice(0, 180) || "Text";
  if (item.type === "image") return item.name || "Copied image";
  const count = item.filePaths?.length || 0;
  if (count === 1) return path.basename(item.filePaths![0]);
  return `${count} files`;
}

function addItem(item: ClipboardHistoryItem): void {
  const items = readIndex();
  if (items[0]?.hash === item.hash) return;
  const next = [item, ...items.filter((existing) => existing.hash !== item.hash)].slice(0, MAX_ITEMS);
  writeIndex(next);
  notifyChanged();
}

function readFileDropList(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    const command =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$c=[System.Windows.Forms.Clipboard]::GetFileDropList(); " +
      "$c | ForEach-Object { $_ }";
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const files = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((filePath) => fs.existsSync(filePath));
      resolve(files);
    });
  });
}

async function captureCurrentClipboard(): Promise<void> {
  if (Date.now() < writeGuardUntil) return;

  const formats = clipboard.availableFormats();
  if (!formats.length) return;

  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const png = image.toPNG();
    const hash = `image:${sha1(png)}`;
    if (hash === lastSignature) return;
    lastSignature = hash;
    const id = nowId();
    const filePath = path.join(imagesDir(), `${id}.png`);
    fs.writeFileSync(filePath, png);
    const size = image.getSize();
    addItem({
      id,
      type: "image",
      createdAt: Date.now(),
      hash,
      name: "Copied image",
      filePath,
      width: size.width,
      height: size.height,
      size: png.length,
      preview: `${size.width}×${size.height} image`,
    });
    return;
  }

  if (formats.some((format) => /FileNameW|FileName|FileDrop|Shell IDList/i.test(format))) {
    const files = (await readFileDropList()).filter((filePath) => !isVideoPath(filePath));
    if (files.length) {
      const hash = `files:${sha1(files.join("\n"))}`;
      if (hash === lastSignature) return;
      lastSignature = hash;
      const totalSize = files.reduce((total, filePath) => {
        try {
          return total + fs.statSync(filePath).size;
        } catch {
          return total;
        }
      }, 0);
      const item: ClipboardHistoryItem = {
        id: nowId(),
        type: "files",
        createdAt: Date.now(),
        hash,
        name: files.length === 1 ? path.basename(files[0]) : `${files.length} files`,
        filePaths: files,
        size: totalSize,
        preview: files.length === 1 ? path.basename(files[0]) : `${files.length} files (${formatBytes(totalSize) || "unknown size"})`,
      };
      addItem(item);
      return;
    }
  }

  const text = clipboard.readText().slice(0, MAX_TEXT_LENGTH);
  if (text.trim()) {
    const hash = `text:${sha1(text)}`;
    if (hash === lastSignature) return;
    lastSignature = hash;
    const item: ClipboardHistoryItem = {
      id: nowId(),
      type: "text",
      createdAt: Date.now(),
      hash,
      text,
      html: clipboard.readHTML() || undefined,
      preview: text.replace(/\s+/g, " ").trim().slice(0, 180),
      size: Buffer.byteLength(text, "utf8"),
    };
    addItem(item);
  }
}

export function startClipboardHistory(options: { enabled: boolean; onChanged: () => void }): void {
  onChangedCallback = options.onChanged;
  stopClipboardHistory();
  if (!options.enabled) return;
  lastSignature = "";
  pollTimer = setInterval(() => {
    void captureCurrentClipboard().catch((err) =>
      console.warn("[clipboard-history] failed to capture clipboard", err),
    );
  }, 1000);
}

export function stopClipboardHistory(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export function listClipboardHistory(): ClipboardHistoryItem[] {
  return readIndex().map((item) => ({ ...item, preview: item.preview || itemPreview(item) }));
}

export function deleteClipboardHistoryItem(id: string): void {
  const items = readIndex();
  const item = items.find((entry) => entry.id === id);
  if (item?.filePath && item.filePath.startsWith(rootDir())) {
    try {
      fs.rmSync(item.filePath, { force: true });
    } catch {}
  }
  writeIndex(items.filter((entry) => entry.id !== id));
  notifyChanged();
}

export function clearClipboardHistory(): void {
  fs.rmSync(rootDir(), { recursive: true, force: true });
  fs.mkdirSync(rootDir(), { recursive: true });
  writeIndex([]);
  notifyChanged();
}

export async function copyClipboardHistoryItem(id: string): Promise<void> {
  const item = readIndex().find((entry) => entry.id === id);
  if (!item) throw new Error("Clipboard history item not found.");
  writeGuardUntil = Date.now() + 1500;
  if (item.type === "text") {
    if (item.html) clipboard.write({ text: item.text || "", html: item.html });
    else clipboard.writeText(item.text || "");
    return;
  }
  if (item.type === "image") {
    if (!item.filePath || !fs.existsSync(item.filePath)) throw new Error("Image history file not found.");
    const image = nativeImage.createFromPath(item.filePath);
    if (image.isEmpty()) throw new Error("Image history file could not be read.");
    clipboard.writeImage(image);
    return;
  }
  const files = (item.filePaths || []).filter((filePath) => fs.existsSync(filePath) && !isVideoPath(filePath));
  if (!files.length) throw new Error("Copied files are no longer available.");
  if (process.platform === "win32") {
    // Existing helper currently supports one file. Copy the first for now.
    await copyNativeFileToClipboard(files[0]);
  } else {
    clipboard.writeText(files.join("\n"));
  }
}
