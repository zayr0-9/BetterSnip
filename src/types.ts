export type SnipMode = 'image' | 'video';
export type ImageFormat = 'png' | 'jpg';
export type VideoQuality = 'low' | 'medium' | 'high';
export type VideoRecordingFormat = 'argb' | 'nv12';
export type RecordingResolution = 'source' | '1080p' | '720p';
export type CaptureType = 'image' | 'video';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ForegroundInfo {
  app: string;
  title: string;
}

export interface LmStudioSettings {
  enabled: boolean;
  address: string;
  port: string;
  model: string;
  autoLoad: boolean;
  systemPrompt: string;
}

export interface AppConfig {
  saveDir: string;
  hotkey: string;
  fullScreenRecordHotkey: string;
  imageFormat: ImageFormat;
  recordingFps: number;
  recordingQuality: VideoQuality;
  recordingVideoBitrate: number;
  recordingResolution: RecordingResolution;
  videoRecordingFormat: VideoRecordingFormat;
  copyToClipboard: boolean;
  keepClipboardHistory: boolean;
  openEditorAfterCapture: boolean;
  autoStart: boolean;
  onboardingComplete: boolean;
  lmStudio: LmStudioSettings;
}

export type PartialAppConfig = Partial<Omit<AppConfig, 'lmStudio'>> & {
  lmStudio?: Partial<LmStudioSettings>;
};

export interface CaptureInfo {
  name: string;
  path: string;
  url: string;
  thumbUrl?: string;
  mtime?: number;
  size?: number;
  type?: CaptureType;
}

export interface RecordingJob {
  sourceId: string;
  filePath: string;
  rect: Rect;
  displayBounds: Rect;
  scaleFactor: number;
  crop: Rect;
}

export interface QueueJob {
  imageName: string;
  filePath: string;
  status: 'pending' | 'processing' | 'retry' | 'done' | 'failed';
  attempts: number;
  nextRunAt: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export type AgentCaptureKind = 'screenshot' | 'video';
export type AgentCaptureReturnType = 'path' | 'base64';

export interface AgentCaptureOptions {
  kind: AgentCaptureKind;
  rect?: Rect;
  save?: boolean;
  returnType?: AgentCaptureReturnType;
  durationMs?: number;
  fps?: number;
  bitrate?: number;
  format?: 'png' | 'jpg' | 'mp4';
}

export interface AgentCaptureResult {
  kind: AgentCaptureKind;
  mimeType: string;
  path?: string;
  base64?: string;
  requestedRect: Rect;
  displayBounds: Rect;
  scaleFactor: number;
  nativeCrop: Rect;
  outputWidth: number;
  outputHeight: number;
  durationMs?: number;
}

export type ClipboardHistoryItemType = 'text' | 'image' | 'files';

export interface ClipboardHistoryItem {
  id: string;
  type: ClipboardHistoryItemType;
  createdAt: number;
  hash: string;
  preview: string;
  name?: string;
  text?: string;
  html?: string;
  filePath?: string;
  filePaths?: string[];
  width?: number;
  height?: number;
  size?: number;
  favorite?: boolean;
}

export interface StorageUsage {
  bytes: number;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

export interface VideoEditOptions {
  inputPath: string;
  startTime?: number;
  endTime?: number;
  format?: 'mp4' | 'webm';
  quality?: number;
  speed?: number;
  removeAudio?: boolean;
  saveAsCopy?: boolean;
  crop?: { enabled?: boolean; x?: number; y?: number; width?: number; height?: number };
  resize?: { enabled?: boolean; width?: number; height?: number };
}

export interface BetterSnipApi {
  getSettings(): Promise<AppConfig>;
  chooseDir(): Promise<AppConfig>;
  getStorageUsage(): Promise<StorageUsage>;
  saveSettings(settings: PartialAppConfig): Promise<AppConfig>;
  finishOnboarding(settings: PartialAppConfig): Promise<AppConfig>;
  openDir(): Promise<void>;
  listGallery(): Promise<CaptureInfo[]>;
  deleteGalleryItem(filePath: string): Promise<void>;
  copyGalleryItem(filePath: string): Promise<void>;
  listClipboardHistory(): Promise<ClipboardHistoryItem[]>;
  copyClipboardHistoryItem(id: string): Promise<void>;
  deleteClipboardHistoryItem(id: string): Promise<void>;
  setClipboardHistoryFavorite(id: string, favorite: boolean): Promise<void>;
  clearClipboardHistory(): Promise<void>;
  onClipboardHistoryChanged(callback: () => void): void;
  onGalleryChanged(callback: () => void): void;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  cancelSnip(): Promise<void>;
  captureSnip(rect: Rect, mode?: SnipMode): Promise<string>;
  prepareRecording(rect: Rect, audio?: boolean, options?: { skipPreview?: boolean }): Promise<string>;
  getRecordingJob(): Promise<RecordingJob | null>;
  saveRecording(buffer: ArrayBuffer): Promise<string>;
  stopRecording(): Promise<void>;
  cancelRecording(): Promise<void>;
  onRecordingStart(callback: () => void): void;
  onRecordingStop(callback: () => void): void;
  getAnnotationImage(): Promise<CaptureInfo | null>;
  saveAnnotation(dataUrl: string, saveAsCopy?: boolean): Promise<string>;
  openAnnotation(filePath: string): Promise<string>;
  openAnnotationFile(): Promise<void>;
  getVideoMetadata(filePath: string): Promise<VideoMetadata>;
  editVideo(options: VideoEditOptions): Promise<CaptureInfo>;
}

export {};
