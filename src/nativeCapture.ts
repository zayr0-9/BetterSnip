import fs from "fs";
import { spawn } from "child_process";
import type { Rect } from "./types";
import { resolveRecorderExe } from "./nativeRecorder";

export interface NativeScreenshotJob {
  filePath: string;
  rect: Rect;
  monitorIndex: number;
  format: "png" | "jpg";
}

export function nativeScreenshotAvailable(): boolean {
  return fs.existsSync(resolveRecorderExe());
}

export async function captureNativeScreenshot(job: NativeScreenshotJob): Promise<string> {
  const exe = resolveRecorderExe();
  if (!fs.existsSync(exe)) throw new Error(`Native capture backend not found: ${exe}`);

  const args = [
    "--screenshot",
    "--out",
    job.filePath,
    "--monitor",
    String(job.monitorIndex),
    "--x",
    String(Math.round(job.rect.x)),
    "--y",
    String(Math.round(job.rect.y)),
    "--w",
    String(Math.round(job.rect.width)),
    "--h",
    String(Math.round(job.rect.height)),
    "--format",
    job.format,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      console.log(`[native-capture] ${text.trim()}`);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Native screenshot failed (${code ?? "unknown"}): ${stderr.trim()}`));
    });
  });

  if (!fs.existsSync(job.filePath) || fs.statSync(job.filePath).size < 16)
    throw new Error("Native screenshot produced no image data.");
  return job.filePath;
}
