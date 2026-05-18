import fs from "fs";
import path from "path";
import { app } from "electron";
import type { AppConfig, PartialAppConfig } from "./types";

export const DEFAULTS: AppConfig = {
  saveDir: "",
  hotkey: "Alt+Shift+S",
  fullScreenRecordHotkey: "Alt+Shift+R",
  imageFormat: "png",
  recordingFps: 30,
  recordingQuality: "high",
  recordingVideoBitrate: 8_000_000,
  recordingResolution: "source",
  videoRecordingFormat: "argb",
  copyToClipboard: true,
  openEditorAfterCapture: true,
  autoStart: false,
  onboardingComplete: false,
  lmStudio: {
    enabled: false,
    address: "localhost",
    port: "1234",
    model: "gemma-3-4b-it",
    autoLoad: true,
    systemPrompt: "Describe this screenshot clearly and concisely.",
  },
};

function configPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function presetRecordingBitrate(quality = DEFAULTS.recordingQuality): number {
  if (quality === "low") return 3_000_000;
  if (quality === "medium") return 5_000_000;
  return 8_000_000;
}

function normalizeRecordingBitrate(value: unknown, quality = DEFAULTS.recordingQuality): number {
  const fallback = presetRecordingBitrate(quality);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(Math.min(Math.max(numeric, 500_000), 100_000_000));
}

function normalizeConfig(config: PartialAppConfig = {}): AppConfig {
  const quality = config.recordingQuality || DEFAULTS.recordingQuality;
  return {
    ...DEFAULTS,
    ...config,
    recordingVideoBitrate: normalizeRecordingBitrate(config.recordingVideoBitrate, quality),
    lmStudio: { ...DEFAULTS.lmStudio, ...(config.lmStudio || {}) },
  };
}

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return normalizeConfig();
  }
}

export function saveConfig(config: PartialAppConfig): AppConfig {
  const next = normalizeConfig(config);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}
