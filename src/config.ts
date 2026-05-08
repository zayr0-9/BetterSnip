import fs from "fs";
import path from "path";
import { app } from "electron";
import type { AppConfig, PartialAppConfig } from "./types";

export const DEFAULTS: AppConfig = {
  saveDir: "",
  hotkey: "Alt+Shift+S",
  imageFormat: "png",
  copyToClipboard: true,
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

function normalizeConfig(config: PartialAppConfig = {}): AppConfig {
  return {
    ...DEFAULTS,
    ...config,
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
