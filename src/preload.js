const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('betterSnip', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseDir: () => ipcRenderer.invoke('settings:chooseDir'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  finishOnboarding: (settings) => ipcRenderer.invoke('onboarding:finish', settings),
  openDir: () => ipcRenderer.invoke('settings:openDir'),
  listGallery: () => ipcRenderer.invoke('gallery:list'),
  onGalleryChanged: (callback) => ipcRenderer.on('gallery:changed', callback),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  cancelSnip: () => ipcRenderer.invoke('snip:cancel'),
  captureSnip: (rect, mode = 'image') => ipcRenderer.invoke('snip:capture', rect, mode),
  prepareRecording: (rect) => ipcRenderer.invoke('recording:prepare', rect),
  getRecordingJob: () => ipcRenderer.invoke('recording:getJob'),
  saveRecording: (buffer) => ipcRenderer.invoke('recording:save', buffer),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  cancelRecording: () => ipcRenderer.invoke('recording:cancel'),
  onRecordingStart: (callback) => ipcRenderer.on('recording:start', callback),
  onRecordingStop: (callback) => ipcRenderer.on('recording:stop', callback),
  getAnnotationImage: () => ipcRenderer.invoke('annotation:getImage'),
  saveAnnotation: (dataUrl, saveAsCopy = false) => ipcRenderer.invoke('annotation:save', dataUrl, saveAsCopy),
  openAnnotation: (filePath) => ipcRenderer.invoke('annotation:open', filePath),
  openAnnotationFile: () => ipcRenderer.invoke('annotation:openFile')
});
