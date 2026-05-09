import fs from "fs";
import path from "path";
import { app } from "electron";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import type { Rect } from "./types";

export interface NativeRecordingJob {
  filePath: string;
  rect: Rect;
  monitorIndex: number;
  fps: number;
  bitrate: number;
}

let child: ChildProcessWithoutNullStreams | null = null;
let activeJob: NativeRecordingJob | null = null;

export function getActiveNativeRecording(): NativeRecordingJob | null {
  return activeJob;
}

export function nativeRecorderAvailable(): boolean {
  return fs.existsSync(resolveRecorderExe());
}

export function resolveRecorderExe(): string {
  const name = "win-recorder.exe";
  const appPath = app.getAppPath();
  const candidates = [
    // electron-builder unpacks executables from asar into app.asar.unpacked.
    path.join(process.resourcesPath || "", "app.asar.unpacked", "dist", "native", name),
    path.join(process.resourcesPath || "", "native", name),
    path.join(appPath.replace(/app\.asar$/, "app.asar.unpacked"), "dist", "native", name),
    path.join(appPath, "dist", "native", name),
    path.join(appPath, "native", "win-recorder", "x64", "Release", name),
    path.join(appPath, "native", "win-recorder", "Release", name),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[0];
}

export async function startNativeRecording(job: NativeRecordingJob): Promise<void> {
  if (child) throw new Error("A recording is already active.");
  const exe = resolveRecorderExe();
  if (!fs.existsSync(exe)) {
    throw new Error(
      `Native recorder is not built. Build native/win-recorder/win-recorder.vcxproj Release|x64 and copy win-recorder.exe to dist/native/. Missing: ${exe}`,
    );
  }
  fs.mkdirSync(path.dirname(job.filePath), { recursive: true });
  activeJob = job;
  try {
    child = spawn(exe, [
      "--out", job.filePath,
      "--monitor", String(job.monitorIndex),
      "--fps", String(job.fps),
      "--bitrate", String(job.bitrate),
    ], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  } catch (err) {
    activeJob = null;
    throw err;
  }

  child.stderr.on("data", (d) => console.log(`[win-recorder] ${String(d).trim()}`));
  child.on("error", (err) => {
    console.error("win-recorder spawn failed", err);
    child = null;
    activeJob = null;
  });
  child.on("exit", () => {
    child = null;
    activeJob = null;
  });
}

export async function stopNativeRecording(): Promise<string | null> {
  const current = child;
  const filePath = activeJob?.filePath || null;
  if (!current) return filePath;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      if (!current.killed) current.kill();
      resolve();
    }, 10000);
    current.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
    current.stdin.write("stop\n");
    current.stdin.end();
  });
  return filePath;
}

export function cancelNativeRecording(): void {
  if (child && !child.killed) child.kill();
  child = null;
  activeJob = null;
}
