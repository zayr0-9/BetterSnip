# BetterSnip Project Context

BetterSnip is an Electron + React + TypeScript desktop screenshot/snipping app. It captures images/videos, saves them to a configured folder, optionally copies to clipboard, shows notifications, and opens an annotation/editor UI.

## Commands

- Install/run uses `pnpm`.
- Typecheck: `pnpm typecheck`
- Dev: `pnpm dev`
- Build TS/renderer/main: `pnpm build:ts`
- Full Windows build: `pnpm build`

## High-level data flow

1. App starts in `src/main.ts`.
2. Config is loaded from `src/config.ts` via `loadConfig()`.
3. Main process creates tray, registers global hotkeys, starts local agent API, and opens Settings/onboarding.
4. User triggers snip hotkey.
5. `src/main.ts:startSnip()` opens transparent overlay windows on all displays.
6. Overlay renderer (`src/renderer/overlay.tsx`) lets user select a rect and calls preload API `captureSnip(rect)` or recording APIs.
7. Preload (`src/preload.ts`) forwards renderer calls to Electron IPC handlers in `src/main.ts`.
8. Image capture goes through `captureAndSave(rect)` in `src/main.ts`, which calls native capture (`src/nativeCapture.ts`) and writes the image to `config.saveDir`.
9. Main process updates gallery, sends notification, copies to clipboard if enabled, and opens annotation window depending on `config.openEditorAfterCapture`.
10. Annotation renderer (`src/renderer/annotate.tsx`) loads the current `annotationFilePath` via `getAnnotationImage()`, edits with Fabric.js, then saves through `saveAnnotation()` IPC.
11. Settings renderer (`src/renderer/settings.tsx`) reads/saves config, displays gallery, and can open captures in annotation mode.

## Key files

### `src/main.ts`

Electron main process and app orchestration.

Important responsibilities/functions:

- App lifecycle, tray menu, global shortcuts, protocol handling.
- `rendererUrl()` / `loadRendererPage()` load React HTML pages in dev/prod.
- `mediaUrl(filePath, version)` creates `bettersnip-file://` URLs for local media.
- `ensureSaveDir()` ensures configured save folder exists.
- `uniqueFilePath()` avoids overwriting existing captures.
- `createSettingsWindow(mode)` opens settings/onboarding UI.
- `createAnnotationWindow(filePath)` stores `annotationFilePath` and opens/reloads `annotate.html`.
- `createRecordingWindow(job)` opens recording controls/border windows.
- `createTray()` builds tray menu.
- `registerHotkey()` registers snip and full-screen recording shortcuts.
- `applyAutoStart()` manages Windows startup behavior.
- `startSnip()` creates full-screen overlay windows for region selection.
- `prepareRecording()` starts native Windows video recording for a selected rect.
- `startFullScreenRecording()` records focused display immediately.
- `showSavedToast(filePath, options)` creates system notification. If `options.openAnnotationOnClick` is true, notification click opens annotation editor; otherwise it reveals file in folder.
- `copyFileToClipboard(filePath)` copies saved files to clipboard, using native helper on Windows.
- `captureAndSave(rect)` captures image via native capture and saves to disk.
- Agent API helpers: `captureScreenshotForAgent()`, `recordVideoForAgent()`, `agentCapture()`, `startAgentHttpServer()`.

Main IPC handlers:

- `settings:get`, `settings:chooseDir`, `settings:openDir`, `settings:save`
- `onboarding:finish`
- `window:minimize`, `window:maximize`, `window:close`
- `snip:cancel`, `snip:capture`
- `recording:prepare`, `recording:getJob`, `recording:stop`, `recording:cancel`, `recording:save`
- `annotation:open`, `annotation:getImage`, `annotation:save`, `annotation:openFile`
- `gallery:list`, `gallery:delete`

Capture notification/editor behavior:

- `openEditorAfterCapture` lives in config.
- If true, `snip:capture` calls `createAnnotationWindow(filePath)` immediately.
- If false, `snip:capture` only shows notification; clicking notification calls `createAnnotationWindow(filePath)`.

### `src/config.ts`

Config defaults and persistence.

- `DEFAULTS`: default `AppConfig` values.
- `configPath()`: resolves `%APPDATA%/BetterSnip/settings.json` equivalent via Electron `app.getPath('userData')`.
- `normalizeConfig(config)`: merges partial config with defaults and nested `lmStudio` defaults.
- `loadConfig()`: reads JSON settings, falls back to defaults.
- `saveConfig(config)`: normalizes and writes settings.

Important setting keys:

- `saveDir`
- `hotkey`
- `fullScreenRecordHotkey`
- `imageFormat`
- `recordingFps`
- `recordingQuality`
- `copyToClipboard`
- `openEditorAfterCapture`
- `autoStart`
- `onboardingComplete`
- `lmStudio`

### `src/types.ts`

Shared TypeScript types used by main, preload, and renderer.

Important interfaces/types:

- `AppConfig`, `PartialAppConfig`
- `LmStudioSettings`
- `CaptureInfo`
- `RecordingJob`
- `Rect`
- `SnipMode`, `ImageFormat`, `VideoQuality`, `CaptureType`
- Agent capture types: `AgentCaptureOptions`, `AgentCaptureResult`
- `BetterSnipApi`: API exposed by preload to renderer at `window.betterSnip`.

### `src/preload.ts`

Secure bridge between renderer and main process.

- Uses `contextBridge.exposeInMainWorld('betterSnip', api)`.
- Each API function maps to an IPC channel in `src/main.ts`.
- Renderer code should call `window.betterSnip.*`, not Electron APIs directly.

### `src/renderer/global.d.ts`

Renderer-side global type declarations.

- Declares `window.betterSnip: BetterSnipApi`.
- Exposes type aliases for renderer files.

### `src/renderer/settings.tsx`

React settings/onboarding/gallery UI.

Important responsibilities:

- Loads settings with `window.betterSnip.getSettings()`.
- Saves settings with `window.betterSnip.saveSettings()`.
- Handles onboarding setup via `finishOnboarding()`.
- Displays recent gallery using `listGallery()`.
- Deletes gallery items using `deleteGalleryItem()`.
- Opens selected gallery item in annotation editor via `openAnnotation(item.path)`.
- Provides controls for:
  - Save folder
  - Gallery browsing
  - Hotkeys
  - Image format
  - Recording FPS/quality
  - Copy to clipboard
  - Open editor after capture
  - Start with Windows
  - LM Studio image description settings

Main local state:

- `settings`: current `AppConfig` draft.
- `gallery`: list of `CaptureInfo`.
- `currentImage`, `modalOpen`: gallery preview state.
- dropdown states for image format/FPS/quality.

### `src/renderer/annotate.tsx`

React annotation/video preview UI.

Important responsibilities:

- Calls `window.betterSnip.getAnnotationImage()` on load.
- Detects file extension to show image editor, video preview, or unsupported state.
- `ImageEditor` uses Fabric.js canvas for drawing, shapes, arrows, text, crop, blur/redact, undo/redo, save.
- `VideoView` previews captured video and can open file externally.
- Saves annotated images via `window.betterSnip.saveAnnotation(dataUrl, saveAsCopy)`.
- Opens current annotation source with `window.betterSnip.openAnnotationFile()`.

### `src/renderer/overlay.tsx`

Fullscreen capture overlay UI.

Expected responsibilities:

- Runs inside transparent overlay windows created by `startSnip()`.
- Allows user to draw/select a capture rectangle.
- Calls `window.betterSnip.captureSnip(rect, 'image')` for screenshots.
- Calls recording APIs for video selection.
- Calls `window.betterSnip.cancelSnip()` on cancel.

### `src/renderer/recorder.tsx`

Recording controls/border UI.

Expected responsibilities:

- Shows recording controls or border depending on query param `view`.
- Uses recording IPC APIs exposed by preload.
- `recording:stop` saves/finishes recording in main.

### `src/renderer/components/TitleBar.tsx`

Custom frameless Electron title bar component.

- Used by settings and annotation windows.
- Calls window minimize/maximize/close APIs.

### `src/renderer/components/Icons.tsx`

Central icon component exports used by renderer pages.

### `src/nativeCapture.ts`

Native Windows screenshot capture wrapper.

- Called by `src/main.ts:captureAndSave()` and agent screenshot capture.
- Captures a specified native crop/monitor to an image file.

### `src/nativeRecorder.ts`

Native Windows video recording wrapper.

- `startNativeRecording()` starts native recording by spawning `win-recorder.exe`.
- `stopNativeRecording()` sends `stop` over stdin and waits for the native process to exit so Media Foundation MP4 finalization has completed before main checks file size.
- `cancelNativeRecording()` kills/cancels active recording.
- Video format selection:
  - Default is `argb` DXGI GPU texture input for broad compatibility across Windows GPU drivers/hardware encoders.
  - `nv12` GPU conversion path exists but is opt-in with environment variable `BETTERSNIP_RECORDER_VIDEO_FORMAT=nv12`; some drivers accept NV12 frames but hang in `IMFSinkWriter::Finalize()`.
  - The wrapper watches startup stderr and can fall back from early NV12 startup/sample errors to ARGB for the current app session.

### `native/win-recorder/main.cpp`

Native Windows capture/encode executable used by screenshots and video recording.

- Uses Windows.Graphics.Capture to capture monitor frames as D3D11 textures.
- Video recording default pipeline is GPU-backed ARGB/BGRA DXGI texture submission to Media Foundation H.264 Sink Writer, avoiding per-frame CPU readback.
- Optional `--video-format nv12` path does GPU BGRA -> NV12 conversion with D3D11 Video Processor and submits NV12 DXGI surfaces to the encoder. Keep this as opt-in/test mode until robust driver capability probing is added.
- Uses capture frame `SystemRelativeTime` / QPC timestamps rather than `frameIndex * fps`, preventing sped-up recordings when frames are dropped.
- On stop, logs `FINALIZE begin` / `FINALIZE done` or `ERR Finalize 0x...` around `IMFSinkWriter::Finalize()`.
- Audio recording, when enabled, uses WASAPI loopback and writes audio samples to the same Sink Writer.

### `src/nativeClipboard.ts`

Windows native file clipboard helper.

- Used by `copyFileToClipboard(filePath)` to place saved file itself on clipboard.

### `src/platform/foreground.ts`

Foreground app/window helpers.

- `getForegroundApp()` gets active app/window title at capture start.
- `buildForegroundSlug()` creates filename-friendly prefix for captures.

### `src/llm/lmstudio.ts`

LM Studio integration.

- Queues image description jobs.
- Uses config `lmStudio` values.
- Called after annotation save and app startup queue setup.

## Renderer pages

- `settings.html` -> `src/renderer/settings.tsx`
- `annotate.html` -> `src/renderer/annotate.tsx`
- `overlay.html` -> `src/renderer/overlay.tsx`
- `recorder.html` -> `src/renderer/recorder.tsx`

`loadRendererPage()` in `src/main.ts` loads these pages. In dev it loads from Vite server; in production it loads built files from `dist/renderer`.

## Custom protocol

`bettersnip-file://local/<base64url-path>?v=<mtime>` is registered in `src/main.ts`.

- Used to display local capture images/videos safely in renderer.
- Handles byte-range requests for video playback.
- Adds no-store caching headers so edited files refresh.

## Important implementation notes

- Keep main-process filesystem/native operations in `src/main.ts` or native helper modules.
- Renderer should use `window.betterSnip` only.
- When adding config options:
  1. Add to `AppConfig` in `src/types.ts`.
  2. Add default in `src/config.ts`.
  3. Add default in `src/renderer/settings.tsx` if settings UI needs it.
  4. Include it in settings save payload if user-editable.
- Use `pnpm typecheck` after changes.
- Prefer PowerShell commands in this environment.
