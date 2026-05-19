import { contextBridge, ipcRenderer } from "electron";
import type { BetterSnipApi, PartialAppConfig, Rect, SnipMode } from "./types";

const api: BetterSnipApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  chooseDir: () => ipcRenderer.invoke("settings:chooseDir"),
  getStorageUsage: () => ipcRenderer.invoke("settings:storageUsage"),
  saveSettings: (settings: PartialAppConfig) =>
    ipcRenderer.invoke("settings:save", settings),
  finishOnboarding: (settings: PartialAppConfig) =>
    ipcRenderer.invoke("onboarding:finish", settings),
  openDir: () => ipcRenderer.invoke("settings:openDir"),
  listGallery: () => ipcRenderer.invoke("gallery:list"),
  deleteGalleryItem: (filePath: string) =>
    ipcRenderer.invoke("gallery:delete", filePath),
  copyGalleryItem: (filePath: string) =>
    ipcRenderer.invoke("gallery:copy", filePath),
  listClipboardHistory: () => ipcRenderer.invoke("clipboardHistory:list"),
  copyClipboardHistoryItem: (id: string) =>
    ipcRenderer.invoke("clipboardHistory:copy", id),
  deleteClipboardHistoryItem: (id: string) =>
    ipcRenderer.invoke("clipboardHistory:delete", id),
  setClipboardHistoryFavorite: (id: string, favorite: boolean) =>
    ipcRenderer.invoke("clipboardHistory:favorite", id, favorite),
  clearClipboardHistory: () => ipcRenderer.invoke("clipboardHistory:clear"),
  onClipboardHistoryChanged: (callback: () => void) => {
    ipcRenderer.on("clipboardHistory:changed", callback);
  },
  onGalleryChanged: (callback: () => void) => {
    ipcRenderer.on("gallery:changed", callback);
  },
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  cancelSnip: () => ipcRenderer.invoke("snip:cancel"),
  captureSnip: (rect: Rect, mode: SnipMode = "image") =>
    ipcRenderer.invoke("snip:capture", rect, mode),
  prepareRecording: (rect: Rect, audio?: boolean, options?: { skipPreview?: boolean }) =>
    ipcRenderer.invoke("recording:prepare", rect, audio, options),
  getRecordingJob: () => ipcRenderer.invoke("recording:getJob"),
  saveRecording: (buffer: ArrayBuffer) =>
    ipcRenderer.invoke("recording:save", buffer),
  stopRecording: () => ipcRenderer.invoke("recording:stop"),
  cancelRecording: () => ipcRenderer.invoke("recording:cancel"),
  onRecordingStart: (callback: () => void) => {
    ipcRenderer.on("recording:start", callback);
  },
  onRecordingStop: (callback: () => void) => {
    ipcRenderer.on("recording:stop", callback);
  },
  getAnnotationImage: () => ipcRenderer.invoke("annotation:getImage"),
  saveAnnotation: (dataUrl: string, saveAsCopy = false) =>
    ipcRenderer.invoke("annotation:save", dataUrl, saveAsCopy),
  openAnnotation: (filePath: string) =>
    ipcRenderer.invoke("annotation:open", filePath),
  openAnnotationFile: () => ipcRenderer.invoke("annotation:openFile"),
  getVideoMetadata: (filePath: string) =>
    ipcRenderer.invoke("video:metadata", filePath),
  editVideo: (options) => ipcRenderer.invoke("video:edit", options),
};

contextBridge.exposeInMainWorld("betterSnip", api);
