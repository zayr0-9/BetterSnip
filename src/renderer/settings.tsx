import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type {
  AppConfig,
  CaptureInfo,
  ImageFormat,
  PartialAppConfig,
  VideoQuality,
  VideoRecordingFormat,
} from "../types";
import { Icons } from "./components/Icons";
import { TitleBar } from "./components/TitleBar";
import { GalleryLightbox } from "./components/gallery/GalleryLightbox";
import { GallerySection, type GalleryViewMode } from "./components/gallery/GallerySection";

const defaultLm = {
  enabled: false,
  address: "localhost",
  port: "1234",
  model: "gemma-3-4b-it",
  autoLoad: true,
  systemPrompt: "Describe this screenshot clearly and concisely.",
};
const defaultSettings: AppConfig = {
  saveDir: "",
  hotkey: "Alt+Shift+S",
  fullScreenRecordHotkey: "Alt+Shift+R",
  imageFormat: "png",
  recordingFps: 30,
  recordingQuality: "high",
  videoRecordingFormat: "argb",
  copyToClipboard: true,
  openEditorAfterCapture: true,
  autoStart: false,
  onboardingComplete: false,
  lmStudio: defaultLm,
};

function SettingsApp() {
  const [settings, setSettings] = useState<AppConfig>(defaultSettings);
  const [gallery, setGallery] = useState<CaptureInfo[]>([]);
  const [currentImage, setCurrentImage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [fpsOpen, setFpsOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lmStudioOpen, setLmStudioOpen] = useState(false);
  const [galleryViewMode, setGalleryViewMode] = useState<GalleryViewMode>("strip");
  const [status, setStatus] = useState("");
  const [storageUsage, setStorageUsage] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [onboardingStatus, setOnboardingStatus] = useState("");
  const saveTimer = useRef<number | null>(null);
  const statusTimer = useRef<number | null>(null);
  const lastSavedSettings = useRef("");
  const params = new URLSearchParams(location.search);
  const isOnboarding = params.get("mode") === "onboarding";
  const item = gallery[currentImage];

  const formatBytes = useCallback((bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024)),
    );
    const value = bytes / 1024 ** index;
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }, []);

  const loadStorageUsage = useCallback(async () => {
    const usage = await window.betterSnip.getStorageUsage();
    setStorageUsage(`${formatBytes(usage.bytes)} used`);
  }, [formatBytes]);

  const loadGallery = useCallback(async () => {
    setGallery(await window.betterSnip.listGallery());
    void loadStorageUsage();
  }, [loadStorageUsage]);

  function hydrateSettings(s: PartialAppConfig): AppConfig {
    return {
      ...defaultSettings,
      ...s,
      lmStudio: { ...defaultLm, ...s.lmStudio },
    };
  }

  function settingsPayload(source: AppConfig): PartialAppConfig {
    return {
      hotkey: source.hotkey.trim() || "Alt+Shift+S",
      fullScreenRecordHotkey:
        source.fullScreenRecordHotkey.trim() || "Alt+Shift+R",
      imageFormat: source.imageFormat,
      recordingFps: source.recordingFps,
      recordingQuality: source.recordingQuality,
      videoRecordingFormat: source.videoRecordingFormat,
      copyToClipboard: source.copyToClipboard,
      openEditorAfterCapture: source.openEditorAfterCapture,
      autoStart: source.autoStart,
      lmStudio: {
        ...source.lmStudio,
        address: source.lmStudio.address.trim() || "localhost",
        port: source.lmStudio.port.trim() || "1234",
        model: source.lmStudio.model.trim() || "gemma-3-4b-it",
        systemPrompt:
          source.lmStudio.systemPrompt.trim() || defaultLm.systemPrompt,
      },
    };
  }

  useEffect(() => {
    window.betterSnip.getSettings().then((s) => {
      const next = hydrateSettings(s);
      lastSavedSettings.current = JSON.stringify(settingsPayload(next));
      setSettings(next);
      setSettingsLoaded(true);
      if (!isOnboarding) loadGallery();
    });
  }, [isOnboarding, loadGallery]);
  useEffect(() => {
    window.betterSnip.onGalleryChanged(() => loadGallery());
  }, [loadGallery]);

  useEffect(() => {
    if (!settingsLoaded || isOnboarding) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const payload = settingsPayload(settings);
      const key = JSON.stringify(payload);
      if (key === lastSavedSettings.current) return;
      setStatus("Saving…");
      try {
        const saved = await window.betterSnip.saveSettings(payload);
        lastSavedSettings.current = key;
        const hydrated = hydrateSettings(saved);
        const hydratedKey = JSON.stringify(settingsPayload(hydrated));
        if (hydratedKey !== key) {
          lastSavedSettings.current = hydratedKey;
          setSettings(hydrated);
        }
        setStatus("Saved");
      } catch (err) {
        setStatus(
          err instanceof Error ? err.message : "Could not save settings",
        );
      }
      if (statusTimer.current !== null)
        window.clearTimeout(statusTimer.current);
      statusTimer.current = window.setTimeout(() => setStatus(""), 2500);
    }, 500);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [settings, settingsLoaded, isOnboarding]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest(".custom-select")) return;
      setFormatOpen(false);
      setFpsOpen(false);
      setQualityOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);


  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  function updateLm(key: keyof AppConfig["lmStudio"], value: any) {
    setSettings((s) => ({ ...s, lmStudio: { ...s.lmStudio, [key]: value } }));
  }
  async function chooseFolder() {
    const s = await window.betterSnip.chooseDir();
    const next = hydrateSettings(s);
    lastSavedSettings.current = JSON.stringify(settingsPayload(next));
    setSettings(next);
    setStatus("Saved");
    void loadStorageUsage();
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(""), 2500);
  }
  function openGallery(index: number) {
    setCurrentImage(Math.max(0, Math.min(index, gallery.length - 1)));
    setModalOpen(true);
  }
  function closeModal() {
    setModalOpen(false);
    setDeleteConfirmOpen(false);
  }
  async function deleteCurrentImage() {
    if (!item) return;
    const deleteIndex = currentImage;
    await window.betterSnip.deleteGalleryItem(item.path);
    const nextGallery = await window.betterSnip.listGallery();
    setGallery(nextGallery);
    if (!nextGallery.length) {
      closeModal();
      setCurrentImage(0);
      return;
    }
    setCurrentImage(Math.min(deleteIndex, nextGallery.length - 1));
    setDeleteConfirmOpen(false);
  }
  function requestDeleteCurrentImage() {
    if (skipDeleteConfirm) void deleteCurrentImage();
    else setDeleteConfirmOpen(true);
  }
  function moveImage(delta: number) {
    if (!gallery.length) return;
    setCurrentImage((currentImage + delta + gallery.length) % gallery.length);
  }

  async function finishOnboarding() {
    if (onboardingStep === 1) {
      if (!settings.saveDir) {
        setOnboardingStatus("Select a folder first.");
        return;
      }
      setOnboardingStep(2);
      setOnboardingStatus("");
      return;
    }
    await window.betterSnip.finishOnboarding({
      saveDir: settings.saveDir,
      hotkey: settings.hotkey.trim() || "Alt+Shift+S",
      fullScreenRecordHotkey:
        settings.fullScreenRecordHotkey.trim() || "Alt+Shift+R",
    });
    location.href = "settings.html?mode=settings";
  }

  return (
    <div className="settings-page bg-transparent text-neutral-900 h-screen overflow-hidden flex flex-col">
      <TitleBar title="BetterSnip" />
      <main className="settings-scroll flex-1 min-h-0 overflow-y-auto">
        {!isOnboarding ? (
          <section className="mx-auto w-full max-w-[1120px] px-3 py-7 sm:px-6 sm:py-8 space-y-8">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
                Settings
              </h1>
              {storageUsage && (
                <div className="mt-1 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm">
                  {storageUsage}
                </div>
              )}
              {/* <p className="mt-2 text-lg text-slate-500">
                Configure your lightweight screenshot workflow.
              </p> */}
            </div>
            <section className="space-y-4">
              <div className="flex items-center gap-3 pb-2">
                <label className="text-base font-semibold text-slate-800">
                  Save folder
                </label>
              </div>
              <div className="grid grid-cols-[56px_1fr_auto] items-center gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-blue-50 text-blue-600">
                  <Icons.Folder className="h-6 w-6" />
                </div>
                <input
                  value={settings.saveDir}
                  readOnly
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white/80 px-4 text-base text-slate-700 shadow-inner outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={chooseFolder}
                  className="h-12 rounded-xl border border-blue-600 bg-white px-7 text-base font-semibold text-blue-600 hover:bg-blue-50"
                >
                  Change
                </button>
              </div>
            </section>
            <GallerySection
              gallery={gallery}
              currentIndex={currentImage}
              viewMode={galleryViewMode}
              onViewModeChange={setGalleryViewMode}
              onOpen={openGallery}
              onRefresh={loadGallery}
              onBrowse={() => window.betterSnip.openDir()}
            />
            <section className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                <label className="block pb-2 text-base font-semibold text-slate-800">
                  Global hotkey
                </label>
                <input
                  value={settings.hotkey}
                  onChange={(e) => update("hotkey", e.target.value)}
                  placeholder="Alt+Shift+S"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white/80 px-4 text-base text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-sm text-slate-500">
                  Electron accelerator format, e.g. Alt+Shift+S, Ctrl+Shift+X.
                </p>
              </div>
              <div className="space-y-3">
                <label className="block pb-2 text-base font-semibold text-slate-800">
                  Full-screen record hotkey
                </label>
                <input
                  value={settings.fullScreenRecordHotkey}
                  onChange={(e) =>
                    update("fullScreenRecordHotkey", e.target.value)
                  }
                  placeholder="Alt+Shift+R"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white/80 px-4 text-base text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-sm text-slate-500">
                  Records the focused display immediately without opening the
                  overlay or video preview.
                </p>
              </div>
              <div className="space-y-3">
                <label className="block pb-2 text-base font-semibold text-slate-800">
                  Image format
                </label>
                <div
                  className={`custom-select relative ${formatOpen ? "open" : ""}`}
                >
                  <button
                    id="imageFormatButton"
                    onClick={() => {
                      setFormatOpen((v) => !v);
                      setFpsOpen(false);
                      setQualityOpen(false);
                    }}
                    className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-4 text-left text-base font-medium text-slate-700 shadow-inner outline-none hover:border-blue-300 hover:bg-blue-50/40 focus:ring-2 focus:ring-blue-500"
                  >
                    <span>{settings.imageFormat.toUpperCase()}</span>
                    <Icons.ChevronDown className="custom-select-chevron h-5 w-5 text-slate-400 transition-transform" />
                  </button>
                  <div
                    id="imageFormatMenu"
                    className="custom-select-menu pointer-events-none absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-1 text-base text-slate-700 opacity-0 shadow-xl shadow-slate-900/10 backdrop-blur transition duration-150 ease-out -translate-y-0.5 scale-[.99]"
                  >
                    {(["png", "jpg"] as ImageFormat[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => {
                          update("imageFormat", f);
                          setFormatOpen(false);
                        }}
                        className="custom-select-option flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium"
                        aria-selected={settings.imageFormat === f}
                      >
                        <span>{f.toUpperCase()}</span>
                        <span className="text-xs opacity-70">
                          {f === "png" ? "Best quality" : "Smaller files"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <label className="block pb-2 text-base font-semibold text-slate-800">
                  Video recording
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    className={`custom-select relative ${fpsOpen ? "open" : ""}`}
                  >
                    <button
                      id="recordingFpsButton"
                      onClick={() => {
                        setFpsOpen((v) => !v);
                        setQualityOpen(false);
                      }}
                      className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-4 text-left text-base font-medium text-slate-700 shadow-inner outline-none hover:border-blue-300 hover:bg-blue-50/40 focus:ring-2 focus:ring-blue-500"
                    >
                      <span>{settings.recordingFps} FPS</span>
                      <Icons.ChevronDown className="custom-select-chevron h-5 w-5 text-slate-400 transition-transform" />
                    </button>
                    <div
                      id="recordingFpsMenu"
                      className="custom-select-menu pointer-events-none absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-1 text-base text-slate-700 opacity-0 shadow-xl shadow-slate-900/10 backdrop-blur transition duration-150 ease-out -translate-y-0.5 scale-[.99]"
                    >
                      {[15, 30, 60].map((fps) => (
                        <button
                          key={fps}
                          onClick={() => {
                            update("recordingFps", fps);
                            setFpsOpen(false);
                          }}
                          className="custom-select-option flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium"
                          aria-selected={settings.recordingFps === fps}
                        >
                          <span>{fps} FPS</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div
                    className={`custom-select relative ${qualityOpen ? "open" : ""}`}
                  >
                    <button
                      id="recordingQualityButton"
                      onClick={() => {
                        setQualityOpen((v) => !v);
                        setFpsOpen(false);
                      }}
                      className="flex h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-4 text-left text-base font-medium text-slate-700 shadow-inner outline-none hover:border-blue-300 hover:bg-blue-50/40 focus:ring-2 focus:ring-blue-500"
                    >
                      <span>
                        {settings.recordingQuality[0].toUpperCase() +
                          settings.recordingQuality.slice(1)}
                      </span>
                      <Icons.ChevronDown className="custom-select-chevron h-5 w-5 text-slate-400 transition-transform" />
                    </button>
                    <div
                      id="recordingQualityMenu"
                      className="custom-select-menu pointer-events-none absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-1 text-base text-slate-700 opacity-0 shadow-xl shadow-slate-900/10 backdrop-blur transition duration-150 ease-out -translate-y-0.5 scale-[.99]"
                    >
                      {(["low", "medium", "high"] as VideoQuality[]).map(
                        (quality) => (
                          <button
                            key={quality}
                            onClick={() => {
                              update("recordingQuality", quality);
                              setQualityOpen(false);
                            }}
                            className="custom-select-option flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium"
                            aria-selected={
                              settings.recordingQuality === quality
                            }
                          >
                            <span>
                              {quality[0].toUpperCase() + quality.slice(1)}
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-8 border-l border-slate-200 pl-8">
                <label className="flex items-center gap-4 text-base text-slate-700">
                  <input
                    checked={settings.copyToClipboard}
                    onChange={(e) =>
                      update("copyToClipboard", e.target.checked)
                    }
                    type="checkbox"
                    className="h-5 w-5 rounded accent-blue-600"
                  />
                  <span>Copy to clipboard</span>
                </label>
                <label className="flex items-center gap-4 text-base text-slate-700">
                  <input
                    checked={settings.openEditorAfterCapture}
                    onChange={(e) =>
                      update("openEditorAfterCapture", e.target.checked)
                    }
                    type="checkbox"
                    className="h-5 w-5 rounded accent-blue-600"
                  />
                  <span>Open editor after capture</span>
                </label>
                <label className="flex items-center gap-4 text-base text-slate-700">
                  <input
                    checked={settings.autoStart}
                    onChange={(e) => update("autoStart", e.target.checked)}
                    type="checkbox"
                    className="h-5 w-5 rounded accent-blue-600"
                  />
                  <span>Start with Windows</span>
                </label>
              </div>
            </section>
            <section className="rounded-none border-y border-slate-200 bg-transparent py-4">
              <button
                type="button"
                onClick={() => setLmStudioOpen((open) => !open)}
                aria-expanded={lmStudioOpen}
                aria-controls="lm-studio-settings"
                className="flex w-full cursor-pointer items-center justify-between text-base font-semibold text-slate-800"
              >
                <span className="inline-flex items-center gap-3">
                  <Icons.Sparkle className="h-7 w-7 text-blue-600" /> LM Studio
                  image description
                </span>
                <Icons.ChevronDown
                  className={`h-5 w-5 transition-transform duration-300 ${lmStudioOpen ? "rotate-180" : ""}`}
                />
              </button>
              <div
                id="lm-studio-settings"
                className={`grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${lmStudioOpen ? "grid-rows-[1fr] opacity-100 translate-y-0" : "grid-rows-[0fr] opacity-0 -translate-y-2"}`}
              >
                <div className="overflow-hidden">
                  <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-transparent p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          LM Studio calls
                        </p>
                        <p className="text-xs text-slate-500">
                          Optional. When off, screenshots are saved without
                          contacting LM Studio.
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          updateLm("enabled", !settings.lmStudio.enabled)
                        }
                        className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${settings.lmStudio.enabled ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-slate-200 hover:bg-slate-300 text-slate-700"}`}
                      >
                        {settings.lmStudio.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                    <label className="flex items-center gap-3">
                      <input
                        checked={settings.lmStudio.autoLoad}
                        onChange={(e) => updateLm("autoLoad", e.target.checked)}
                        type="checkbox"
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span className="text-sm text-slate-700">
                        Auto-load model before describing
                      </span>
                    </label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field
                        label="Address"
                        value={settings.lmStudio.address}
                        onChange={(v) => updateLm("address", v)}
                      />
                      <Field
                        label="Port"
                        value={settings.lmStudio.port}
                        onChange={(v) => updateLm("port", v)}
                      />
                    </div>
                    <Field
                      label="Model"
                      value={settings.lmStudio.model}
                      onChange={(v) => updateLm("model", v)}
                    />
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">
                        System prompt
                      </label>
                      <textarea
                        value={settings.lmStudio.systemPrompt}
                        onChange={(e) =>
                          updateLm("systemPrompt", e.target.value)
                        }
                        rows={4}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <p className="text-xs text-slate-500">
                      Uses LM Studio OpenAI-compatible one-shot{" "}
                      <code>/v1/chat/completions</code>. Descriptions are stored
                      in <code>descriptions.json</code> in your save folder.
                    </p>
                  </div>
                </div>
              </div>
            </section>
            <section className="rounded-none border-y border-slate-200 bg-transparent py-4">
              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
                aria-controls="advanced-settings"
                className="flex w-full cursor-pointer items-center justify-between text-base font-semibold text-slate-800"
              >
                <span>Advanced Settings</span>
                <Icons.ChevronDown
                  className={`h-5 w-5 transition-transform duration-300 ${advancedOpen ? "rotate-180" : ""}`}
                />
              </button>
              <div
                id="advanced-settings"
                className={`grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${advancedOpen ? "grid-rows-[1fr] opacity-100 translate-y-0" : "grid-rows-[0fr] opacity-0 -translate-y-2"}`}
              >
                <div className="overflow-hidden">
                  <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-transparent p-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-800">
                        Video recording pipeline
                      </p>
                      <p className="text-xs text-slate-500">
                        ARGB is the default GPU-backed Media Foundation path and is the most compatible. NV12 uses D3D11 Video Processor conversion and may be faster on some systems, but can hang or fail with some GPU drivers.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {([
                        ["argb", "ARGB GPU", "Default / most compatible"],
                        ["nv12", "NV12 GPU", "Experimental / fastest when supported"],
                      ] as [VideoRecordingFormat, string, string][]).map(([format, label, description]) => (
                        <button
                          key={format}
                          type="button"
                          onClick={() => update("videoRecordingFormat", format)}
                          className={`rounded-xl border px-4 py-3 text-left transition ${settings.videoRecordingFormat === format ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-white/70 text-slate-700 hover:border-blue-300 hover:bg-blue-50/40"}`}
                        >
                          <span className="block text-sm font-semibold">{label}</span>
                          <span className="mt-1 block text-xs opacity-75">{description}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">
                      Current selection: <code>{settings.videoRecordingFormat === "nv12" ? "optional NV12 D3D11 Video Processor path" : "default ARGB GPU-backed Media Foundation path"}</code>. Applies to new recordings.
                    </p>
                  </div>
                </div>
              </div>
            </section>
            <div className="flex items-center gap-4">
              <p className="text-sm text-slate-500">
                {status || "Changes save automatically."}
              </p>
            </div>
          </section>
        ) : (
          <section className="mx-auto max-w-xl rounded-2xl bg-white border border-slate-200 shadow-sm p-6 min-h-[420px] flex flex-col mt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Welcome to BetterSnip
                </h1>
                <p className="text-slate-500 mt-1">
                  {onboardingStep === 1
                    ? "Set up your screenshot storage."
                    : "Choose your capture shortcut."}
                </p>
              </div>
              <div className="text-sm text-slate-400">{onboardingStep}/2</div>
            </div>
            {onboardingStep === 1 ? (
              <div className="space-y-5">
                <div className="rounded-2xl bg-blue-50 border border-blue-100 p-5">
                  <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 text-white">
                    <Icons.Folder className="h-7 w-7" />
                  </div>
                  <h2 className="font-semibold text-lg">
                    Choose image storage location
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    All snips will be saved here. You can change it later in
                    settings.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={settings.saveDir}
                    readOnly
                    className="flex-1 rounded-xl bg-slate-50 border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none"
                  />
                  <button
                    onClick={chooseFolder}
                    className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
                  >
                    Select folder
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5">
                  <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-600 text-white">
                    <Icons.Keyboard className="h-7 w-7" />
                  </div>
                  <h2 className="font-semibold text-lg">
                    Pick your snip hotkey
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Press this shortcut anytime to start selecting an area.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    Global hotkey
                  </label>
                  <input
                    value={settings.hotkey}
                    onChange={(e) => update("hotkey", e.target.value)}
                    placeholder="Alt+Shift+S"
                    className="w-full rounded-xl bg-slate-50 border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
            <div className="mt-auto flex items-center justify-between pt-6">
              <button
                onClick={() => setOnboardingStep(1)}
                className={`${onboardingStep === 1 ? "invisible" : ""} rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 text-sm font-medium`}
              >
                Back
              </button>
              <div className="flex items-center gap-3">
                <p className="text-sm text-red-500">{onboardingStatus}</p>
                <button
                  onClick={finishOnboarding}
                  className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 text-sm font-semibold"
                >
                  {onboardingStep === 1 ? "Next" : "Finish"}
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
      <GalleryLightbox
        open={modalOpen}
        gallery={gallery}
        currentIndex={currentImage}
        deleteConfirmOpen={deleteConfirmOpen}
        skipDeleteConfirm={skipDeleteConfirm}
        onClose={closeModal}
        onIndexChange={setCurrentImage}
        onMove={moveImage}
        onEdit={async (selectedItem) => {
          closeModal();
          await window.betterSnip.openAnnotation(selectedItem.path);
        }}
        onRequestDelete={requestDeleteCurrentImage}
        onConfirmDelete={deleteCurrentImage}
        onCancelDelete={() => setDeleteConfirmOpen(false)}
        onSkipDeleteConfirmChange={setSkipDeleteConfirm}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<SettingsApp />);
