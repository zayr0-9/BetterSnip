const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  saveDir: '',
  hotkey: 'Alt+Shift+S',
  imageFormat: 'png',
  copyToClipboard: true,
  autoStart: false,
  onboardingComplete: false,
  lmStudio: {
    enabled: false,
    address: 'localhost',
    port: '1234',
    model: 'gemma-3-4b-it',
    autoLoad: true,
    systemPrompt: 'Describe this screenshot clearly and concisely.'
  }
};

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(config) {
  const next = { ...DEFAULTS, ...config };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
