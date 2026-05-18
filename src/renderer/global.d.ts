import type {
  AppConfig,
  BetterSnipApi,
  CaptureInfo,
  ClipboardHistoryItem,
  PartialAppConfig,
  RecordingJob,
  Rect,
  SnipMode,
} from "../types";

declare global {
  type AppConfig = import("../types").AppConfig;
  type CaptureInfo = import("../types").CaptureInfo;
  type ClipboardHistoryItem = import("../types").ClipboardHistoryItem;
  type PartialAppConfig = import("../types").PartialAppConfig;
  type RecordingJob = import("../types").RecordingJob;
  type Rect = import("../types").Rect;
  type SnipMode = import("../types").SnipMode;

  interface Window {
    betterSnip: BetterSnipApi;
    fabric: any;
    loadVideoView?: (info: CaptureInfo) => Promise<void>;
  }
}

export {};
