export type SnipMode = 'image' | 'video';
export type ImageFormat = 'png' | 'jpg';
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
  imageFormat: ImageFormat;
  copyToClipboard: boolean;
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
  mtime?: number;
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

export interface BetterSnipApi {
  getSettings(): Promise<AppConfig>;
  chooseDir(): Promise<AppConfig>;
  saveSettings(settings: PartialAppConfig): Promise<AppConfig>;
  finishOnboarding(settings: PartialAppConfig): Promise<AppConfig>;
  openDir(): Promise<void>;
  listGallery(): Promise<CaptureInfo[]>;
  deleteGalleryItem(filePath: string): Promise<void>;
  onGalleryChanged(callback: () => void): void;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  cancelSnip(): Promise<void>;
  captureSnip(rect: Rect, mode?: SnipMode): Promise<string>;
  prepareRecording(rect: Rect): Promise<string>;
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
}

export {};
