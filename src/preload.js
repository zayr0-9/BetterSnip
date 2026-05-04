const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('betterSnip', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseDir: () => ipcRenderer.invoke('settings:chooseDir'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  finishOnboarding: (settings) => ipcRenderer.invoke('onboarding:finish', settings),
  openDir: () => ipcRenderer.invoke('settings:openDir'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  cancelSnip: () => ipcRenderer.invoke('snip:cancel'),
  captureSnip: (rect) => ipcRenderer.invoke('snip:capture', rect)
});
