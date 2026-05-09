import fs from "fs";
import path from "path";
import { app } from "electron";
import { spawn } from "child_process";

export function resolveClipboardFileExe(): string {
  const name = "clipboard-file.exe";
  const appPath = app.getAppPath();
  const candidates = [
    // electron-builder unpacks executables from asar into app.asar.unpacked.
    path.join(process.resourcesPath || "", "app.asar.unpacked", "dist", "native", name),
    path.join(process.resourcesPath || "", "native", name),
    path.join(appPath.replace(/app\.asar$/, "app.asar.unpacked"), "dist", "native", name),
    path.join(appPath, "dist", "native", name),
    path.join(appPath, "native", "clipboard-file", "x64", "Release", name),
    path.join(appPath, "native", "clipboard-file", "Release", name),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[0];
}

export function nativeClipboardFileAvailable(): boolean {
  return fs.existsSync(resolveClipboardFileExe());
}

export async function copyNativeFileToClipboard(filePath: string): Promise<void> {
  const exe = resolveClipboardFileExe();
  if (!fs.existsSync(exe)) {
    throw new Error(
      `Native clipboard helper is not built. Build native/clipboard-file/clipboard-file.vcxproj Release|x64 and copy clipboard-file.exe to dist/native/. Missing: ${exe}`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, ["--file", filePath], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      console.log(`[clipboard-file] ${text.trim()}`);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Native clipboard helper failed (${code ?? "unknown"}): ${stderr.trim()}`));
    });
  });
}
