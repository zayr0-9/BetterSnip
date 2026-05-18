import fs from "fs";
import path from "path";
import { app } from "electron";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { once } from "events";
import type { Rect, VideoRecordingFormat } from "./types";

export interface NativeRecordingJob {
  filePath: string;
  rect: Rect;
  monitorIndex: number;
  fps: number;
  bitrate: number;
  audio?: boolean;
  audioBitrate?: number;
  videoFormat?: VideoRecordingFormat;
}

let child: ChildProcessWithoutNullStreams | null = null;
let activeJob: NativeRecordingJob | null = null;
let preferredVideoFormat: VideoRecordingFormat =
  // ARGB DXGI is still GPU-backed and is much more compatible across drivers.
  // NV12 can hang inside IMFSinkWriter::Finalize on some hardware encoders, so
  // keep NV12 as an opt-in until we add a robust encoder capability probe.
  process.env.BETTERSNIP_RECORDER_VIDEO_FORMAT === "nv12" ? "nv12" : "argb";

export function getActiveNativeRecording(): NativeRecordingJob | null {
  return activeJob;
}

export function nativeRecorderAvailable(): boolean {
  return fs.existsSync(resolveRecorderExe());
}

export function resolveRecorderExe(): string {
  const name = "win-recorder.exe";
  const appPath = app.getAppPath();
  const cwd = process.cwd();
  const candidates = [
    // electron-builder unpacks executables from asar into app.asar.unpacked.
    path.join(process.resourcesPath || "", "app.asar.unpacked", "dist", "native", name),
    path.join(process.resourcesPath || "", "native", name),
    path.join(appPath.replace(/app\.asar$/, "app.asar.unpacked"), "dist", "native", name),
    path.join(appPath, "dist", "native", name),
    path.join(appPath, "native", "win-recorder", "x64", "Release", name),
    path.join(appPath, "native", "win-recorder", "Release", name),
    // Dev mode runs Electron from node_modules, so app.getAppPath()/resourcesPath
    // can point at Electron's own install instead of the project root. Check the
    // working tree too so `pnpm dev` can use the locally-built native helper.
    path.join(cwd, "dist", "native", name),
    path.join(cwd, "native", "win-recorder", "x64", "Release", name),
    path.join(cwd, "native", "win-recorder", "Release", name),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[0];
}

function buildRecorderArgs(job: NativeRecordingJob, videoFormat: VideoRecordingFormat): string[] {
  return [
    "--out", job.filePath,
    "--monitor", String(job.monitorIndex),
    "--fps", String(job.fps),
    "--bitrate", String(job.bitrate),
    "--audio", String(!!job.audio),
    "--audio-bitrate", String(job.audioBitrate || 128000),
    "--video-format", videoFormat,
    "--x", String(Math.max(0, Math.round(job.rect.x))),
    "--y", String(Math.max(0, Math.round(job.rect.y))),
    "--width", String(Math.max(1, Math.round(job.rect.width))),
    "--height", String(Math.max(1, Math.round(job.rect.height))),
  ];
}

function spawnRecorder(exe: string, job: NativeRecordingJob, videoFormat: VideoRecordingFormat): ChildProcessWithoutNullStreams {
  const proc = spawn(exe, buildRecorderArgs(job, videoFormat), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  proc.stderr.on("data", (d) => console.log(`[win-recorder:${videoFormat}] ${String(d).trim()}`));
  proc.on("error", (err) => {
    console.error("win-recorder spawn failed", err);
    if (child === proc) {
      child = null;
      activeJob = null;
    }
  });
  proc.on("exit", () => {
    if (child === proc) {
      child = null;
      activeJob = null;
    }
  });
  return proc;
}

async function waitForRecorderStartup(proc: ChildProcessWithoutNullStreams, videoFormat: VideoRecordingFormat): Promise<"ready" | "failed"> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = "";
    const done = (result: "ready" | "failed") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.stderr.off("data", onData);
      proc.off("exit", onExit);
      resolve(result);
    };
    const onData = (d: Buffer) => {
      stderr += String(d);
      if (stderr.includes("READY")) done("ready");
      if (
        videoFormat === "nv12" &&
        /ERR (CreateTexture2D encoder|CreateVideoProcessor|CreateVideoProcessorInputView|CreateVideoProcessorOutputView|VideoProcessorBlt|MFCreateDXGISurfaceBuffer|WriteSample nv12|WriteSample 0x)/.test(stderr)
      ) {
        done("failed");
      }
    };
    const onExit = () => done("failed");
    const timer = setTimeout(() => done("ready"), 1500);
    proc.stderr.on("data", onData);
    proc.once("exit", onExit);
  });
}

async function stopProcess(proc: ChildProcessWithoutNullStreams, timeoutMs = 1500): Promise<void> {
  if (proc.killed) return;
  const exited = once(proc, "exit").then(() => true, () => true);
  try {
    proc.stdin.write("stop\n");
    proc.stdin.end();
  } catch {
    if (!proc.killed) proc.kill();
  }
  await Promise.race([
    exited,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]).then((ok) => {
    if (!ok && !proc.killed) proc.kill();
  });
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

  const firstFormat = job.videoFormat || preferredVideoFormat;
  console.log(
    firstFormat === "nv12"
      ? "[win-recorder] using optional NV12 D3D11 Video Processor path"
      : "[win-recorder] using default ARGB GPU-backed Media Foundation path",
  );
  child = spawnRecorder(exe, job, firstFormat);
  const startup = await waitForRecorderStartup(child, firstFormat);
  if (startup === "ready" || firstFormat === "argb") return;

  console.warn("[win-recorder] NV12 recorder startup failed; falling back to ARGB DXGI path");
  const failed = child;
  child = null;
  await stopProcess(failed);
  try { fs.rmSync(job.filePath, { force: true }); } catch {}

  if (!job.videoFormat) preferredVideoFormat = "argb";
  child = spawnRecorder(exe, job, "argb");
  const fallbackStartup = await waitForRecorderStartup(child, "argb");
  if (fallbackStartup === "failed") {
    const failedFallback = child;
    child = null;
    activeJob = null;
    await stopProcess(failedFallback);
    throw new Error("Native recorder failed to start with both NV12 and ARGB GPU paths.");
  }
}

export async function stopNativeRecording(): Promise<string | null> {
  const current = child;
  const filePath = activeJob?.filePath || null;
  if (!current) return filePath;

  // Do not return while the native process is still finalizing the MP4. The UI
  // closes immediately in main.ts, but post-save actions must wait for
  // IMFSinkWriter::Finalize() and process exit; otherwise the file is often
  // still 0 bytes, especially on slower disks/OneDrive folders.
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      resolve();
    };
    const killTimer = setTimeout(() => {
      console.warn("[win-recorder] graceful stop/finalize timed out; killing native recorder");
      if (!current.killed) current.kill();
      done();
    }, 60000);
    current.once("exit", done);
    try {
      current.stdin.write("stop\n", (err) => {
        if (err) console.warn("[win-recorder] failed to write stop command", err);
      });
      current.stdin.end();
    } catch (err) {
      console.warn("[win-recorder] failed to stop native recorder", err);
      if (!current.killed) current.kill();
      done();
    }
  });
  return filePath;
}

export function cancelNativeRecording(): void {
  if (child && !child.killed) child.kill();
  child = null;
  activeJob = null;
}
