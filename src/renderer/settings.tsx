import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { AppConfig, CaptureInfo, ImageFormat } from "../types";
import { Icons } from "./components/Icons";

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
  imageFormat: "png",
  copyToClipboard: true,
  autoStart: false,
  onboardingComplete: false,
  lmStudio: defaultLm,
};

function TitleBar() {
  return (
    <header className="drag-region h-14 shrink-0 flex items-center justify-between bg-white/95 border-b border-slate-200 shadow-sm">
      <div className="px-4 flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/25">
          <Icons.Scissors />
        </span>
        <span>BetterSnip</span>
      </div>
      <div className="no-drag flex h-full">
        <button
          onClick={() => window.betterSnip.minimizeWindow()}
          title="Minimize"
          className="grid w-12 place-items-center hover:bg-slate-100 text-slate-600"
        >
          <Icons.Minimize />
        </button>
        <button
          onClick={() => window.betterSnip.maximizeWindow()}
          title="Maximize"
          className="grid w-12 place-items-center hover:bg-slate-100 text-slate-600"
        >
          <Icons.Maximize />
        </button>
        <button
          onClick={() => window.betterSnip.closeWindow()}
          title="Close"
          className="grid w-12 place-items-center hover:bg-red-500 text-slate-600 hover:text-white"
        >
          <Icons.Close />
        </button>
      </div>
    </header>
  );
}

function Thumb({
  item,
  active,
  small,
  onClick,
}: {
  item: CaptureInfo;
  active: boolean;
  small?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={item.name}
      className={`${small ? "h-16 w-24" : "h-[96px] w-[136px]"} shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm ${active ? "thumb-current" : ""}`}
    >
      {item.type === "video" ? (
        <div className="grid h-full w-full place-items-center bg-slate-900 text-white">
          <div className="text-center">
            <Icons.Play className="mx-auto h-6 w-6" />
            <div className="max-w-full truncate px-1 text-[10px]">
              {item.name}
            </div>
          </div>
        </div>
      ) : (
        <img
          src={item.url}
          className="h-full w-full object-cover"
          alt={item.name}
        />
      )}
    </button>
  );
}

function SettingsApp() {
  const [settings, setSettings] = useState<AppConfig>(defaultSettings);
  const [gallery, setGallery] = useState<CaptureInfo[]>([]);
  const [currentImage, setCurrentImage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [onboardingStatus, setOnboardingStatus] = useState("");
  const [swipeX, setSwipeX] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const modalThumbsRef = useRef<HTMLDivElement>(null);
  const [thumbPages, setThumbPages] = useState({ count: 0, current: 0 });
  const thumbMeasureRaf = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const params = new URLSearchParams(location.search);
  const isOnboarding = params.get("mode") === "onboarding";
  const item = gallery[currentImage];

  const loadGallery = useCallback(
    async () => setGallery(await window.betterSnip.listGallery()),
    [],
  );

  useEffect(() => {
    window.betterSnip.getSettings().then((s) => {
      setSettings({
        ...defaultSettings,
        ...s,
        lmStudio: { ...defaultLm, ...s.lmStudio },
      });
      if (!isOnboarding) loadGallery();
    });
  }, [isOnboarding, loadGallery]);
  useEffect(() => {
    window.betterSnip.onGalleryChanged(() => loadGallery());
  }, [loadGallery]);

  const updateThumbPages = useCallback(() => {
    const el = rowRef.current;
    if (!el) {
      setThumbPages({ count: 0, current: 0 });
      return;
    }

    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const pageWidth = Math.max(1, el.clientWidth);
    const count = Math.max(1, Math.ceil(maxScroll / pageWidth) + 1);
    const current = Math.min(
      count - 1,
      Math.max(0, Math.round(el.scrollLeft / pageWidth)),
    );
    setThumbPages({ count, current });
  }, []);

  useEffect(() => {
    if (thumbMeasureRaf.current !== null)
      cancelAnimationFrame(thumbMeasureRaf.current);
    thumbMeasureRaf.current = requestAnimationFrame(updateThumbPages);

    const onResize = () => updateThumbPages();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (thumbMeasureRaf.current !== null)
        cancelAnimationFrame(thumbMeasureRaf.current);
    };
  }, [gallery.length, isOnboarding, updateThumbPages]);

  const centerModalThumb = useCallback(
    (index = currentImage) => {
      modalThumbsRef.current?.children[index]?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    },
    [currentImage],
  );

  useEffect(() => {
    if (modalOpen) centerModalThumb();
  }, [modalOpen, currentImage, centerModalThumb]);
  useEffect(() => {
    if (!modalOpen || !item || item.type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.src = item.url;
    v.load();
    v.play().catch(() => {});
  }, [modalOpen, item]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!modalOpen) return;
      if (e.key === "Escape") closeModal();
      if (e.key === "ArrowLeft") moveImage(-1, true);
      if (e.key === "ArrowRight") moveImage(1, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scrollThumbnailsBy = useCallback(
    (ref: React.RefObject<HTMLDivElement | null>, direction: number) => {
      const el = ref.current;
      if (!el) return;
      const thumb = el.firstElementChild as HTMLElement | null;
      const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
      const step = thumb ? thumb.offsetWidth + gap : 160;
      const visibleSteps = Math.max(1, Math.floor(el.clientWidth / step) - 1);
      el.scrollBy({
        left: direction * step * visibleSteps,
        behavior: "smooth",
      });
    },
    [],
  );

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  function updateLm(key: keyof AppConfig["lmStudio"], value: any) {
    setSettings((s) => ({ ...s, lmStudio: { ...s.lmStudio, [key]: value } }));
  }
  async function chooseFolder() {
    const s = await window.betterSnip.chooseDir();
    setSettings({
      ...defaultSettings,
      ...s,
      lmStudio: { ...defaultLm, ...s.lmStudio },
    });
  }
  function nudge(direction: number) {
    scrollThumbnailsBy(rowRef, direction);
  }
  function openGallery(index: number) {
    setCurrentImage(Math.max(0, Math.min(index, gallery.length - 1)));
    setModalOpen(true);
  }
  function closeModal() {
    videoRef.current?.pause();
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
  function moveImage(delta: number, slideThumbs = false) {
    if (!gallery.length) return;
    const next = (currentImage + delta + gallery.length) % gallery.length;
    setCurrentImage(next);
    if (slideThumbs) requestAnimationFrame(() => centerModalThumb(next));
  }

  async function save() {
    const s = await window.betterSnip.saveSettings({
      hotkey: settings.hotkey.trim() || "Alt+Shift+S",
      imageFormat: settings.imageFormat,
      copyToClipboard: settings.copyToClipboard,
      autoStart: settings.autoStart,
      lmStudio: {
        ...settings.lmStudio,
        address: settings.lmStudio.address.trim() || "localhost",
        port: settings.lmStudio.port.trim() || "1234",
        model: settings.lmStudio.model.trim() || "gemma-3-4b-it",
        systemPrompt:
          settings.lmStudio.systemPrompt.trim() || defaultLm.systemPrompt,
      },
    });
    setSettings({
      ...defaultSettings,
      ...s,
      lmStudio: { ...defaultLm, ...s.lmStudio },
    });
    setStatus(`Saved. Hotkey: ${s.hotkey}`);
    setTimeout(() => setStatus(""), 2500);
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
    });
    location.href = "settings.html?mode=settings";
  }

  return (
    <div className="settings-page bg-slate-50 text-slate-900 h-screen overflow-hidden flex flex-col">
      <TitleBar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        {!isOnboarding ? (
          <section className="mx-auto w-full max-w-[1120px] px-3 py-7 sm:px-6 sm:py-8 space-y-8">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
                Settings
              </h1>
              <p className="mt-2 text-lg text-slate-500">
                Configure your lightweight screenshot workflow.
              </p>
            </div>
            <section className="space-y-4">
              <label className="text-base font-semibold text-slate-800">
                Save folder
              </label>
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
              <button
                onClick={() => window.betterSnip.openDir()}
                className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-4 text-base font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700"
              >
                <Icons.Image className="h-5 w-5" />
                Browse Gallery
              </button>
            </section>
            <section className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-800">
                  Recent gallery
                </h2>
                <button
                  onClick={loadGallery}
                  className="inline-flex items-center gap-2 text-base font-medium text-blue-600 hover:text-blue-700"
                >
                  Refresh <Icons.Refresh className="h-5 w-5" />
                </button>
              </div>
              <div className="relative px-14">
                <button
                  onClick={() => nudge(-1)}
                  className="absolute left-0 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-900 shadow-lg hover:bg-slate-50"
                >
                  <Icons.ChevronLeft className="h-6 w-6" />
                </button>
                <div
                  ref={rowRef}
                  className="gallery-scroll flex min-h-[118px] gap-5 overflow-x-auto overscroll-contain px-2 py-1"
                  onScroll={updateThumbPages}
                >
                  {gallery.slice(0, 30).map((g, i) => (
                    <Thumb
                      key={g.path}
                      item={g}
                      active={i === currentImage}
                      onClick={() => openGallery(i)}
                    />
                  ))}
                </div>
                <button
                  onClick={() => nudge(1)}
                  className="absolute right-0 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-900 shadow-lg hover:bg-slate-50"
                >
                  <Icons.ChevronRight className="h-6 w-6" />
                </button>
              </div>
              <div className="flex justify-center gap-2">
                {Array.from({ length: Math.max(1, thumbPages.count) }).map(
                  (_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-7 rounded-full ${i === thumbPages.current ? "bg-blue-600" : "bg-slate-200"}`}
                    ></span>
                  ),
                )}
              </div>
              {!gallery.length && (
                <p className="text-sm text-slate-500">
                  No screenshots found yet.
                </p>
              )}
            </section>
            <section className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                <label className="text-base font-semibold text-slate-800">
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
              <div></div>
              <div className="space-y-3">
                <label className="text-base font-semibold text-slate-800">
                  Image format
                </label>
                <div
                  className={`custom-select relative ${formatOpen ? "open" : ""}`}
                >
                  <button
                    id="imageFormatButton"
                    onClick={() => setFormatOpen((v) => !v)}
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
                    checked={settings.autoStart}
                    onChange={(e) => update("autoStart", e.target.checked)}
                    type="checkbox"
                    className="h-5 w-5 rounded accent-blue-600"
                  />
                  <span>Start with Windows</span>
                </label>
              </div>
            </section>
            <details className="group rounded-none border-y border-slate-200 bg-transparent py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-base font-semibold text-slate-800">
                <span className="inline-flex items-center gap-3">
                  <Icons.Sparkle className="h-7 w-7 text-blue-600" /> LM Studio
                  image description
                </span>
                <Icons.ChevronDown className="h-5 w-5 transition group-open:rotate-180" />
              </summary>
              <div className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-4">
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
                    onChange={(e) => updateLm("systemPrompt", e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Uses LM Studio OpenAI-compatible one-shot{" "}
                  <code>/v1/chat/completions</code>. Descriptions are stored in{" "}
                  <code>descriptions.json</code> in your save folder.
                </p>
              </div>
            </details>
            <div className="flex items-center gap-4">
              <button
                onClick={save}
                className="inline-flex h-12 items-center gap-3 rounded-xl bg-emerald-600 px-6 text-base font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-700"
              >
                <Icons.Save className="h-5 w-5" />
                Save settings
              </button>
              <p className="text-sm text-slate-500">{status}</p>
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
      {modalOpen && item && (
        <div className="fixed inset-0 z-50 bg-black/95 text-white">
          <button
            onClick={closeModal}
            className="absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <Icons.Close className="h-5 w-5" />
          </button>
          <button
            onClick={async () => {
              closeModal();
              await window.betterSnip.openAnnotation(item.path);
            }}
            className="absolute right-16 top-4 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <Icons.Edit className="h-5 w-5" />
          </button>
          <button
            onClick={requestDeleteCurrentImage}
            className="absolute right-28 top-4 z-20 grid h-10 w-10 place-items-center rounded-full bg-red-500/20 text-red-100 hover:bg-red-500/35"
            title="Delete"
          >
            <Icons.Trash className="h-5 w-5" />
          </button>
          {deleteConfirmOpen && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-neutral-900/30 px-4 backdrop-blur-sm">
              <div className="delete-confirm-card w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
                <h3 className="text-lg font-semibold">Delete this capture?</h3>
                <p className="mt-2 break-words text-sm text-slate-600">
                  This will permanently delete {item.name}.
                </p>
                <label className="mt-5 flex items-center gap-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={skipDeleteConfirm}
                    onChange={(e) => setSkipDeleteConfirm(e.target.checked)}
                    className="h-4 w-4 rounded accent-red-500"
                  />
                  <span>Don't ask me again this session</span>
                </label>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setDeleteConfirmOpen(false)}
                    className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void deleteCurrentImage()}
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-700 text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
          <button
            onClick={() => moveImage(-1, true)}
            className="absolute left-4 top-1/2 z-20 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-slate-250/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition hover:scale-105 hover:bg-slate-950/50"
          >
            <Icons.ChevronLeft className="h-8 w-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
          </button>
          <button
            onClick={() => moveImage(1, true)}
            className="absolute right-4 top-1/2 z-20 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-slate-250/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition hover:scale-105 hover:bg-slate-950/50"
          >
            <Icons.ChevronRight className="h-8 w-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
          </button>
          <div
            onPointerDown={(e) => setSwipeX(e.clientX)}
            onPointerUp={(e) => {
              if (swipeX !== null && Math.abs(e.clientX - swipeX) > 50)
                moveImage(e.clientX < swipeX ? 1 : -1);
              setSwipeX(null);
            }}
            onWheel={(e) => {
              if (Math.abs(e.deltaX) > Math.abs(e.deltaY))
                moveImage(e.deltaX > 0 ? 1 : -1);
            }}
            className="flex h-full flex-col"
          >
            <div className="flex min-h-0 flex-1 items-center justify-center p-6 pb-3">
              {item.type === "video" ? (
                <video
                  ref={videoRef}
                  className="max-h-full max-w-full rounded-xl shadow-2xl"
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <img
                  src={item.url}
                  alt={item.name}
                  className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                  draggable="false"
                />
              )}
            </div>
            <div className="shrink-0 border-t border-white/10 bg-black/80 p-3">
              <p className="mb-2 truncate text-center text-sm text-slate-200">
                {currentImage + 1} / {gallery.length} — {item.name}
              </p>
              <div
                ref={modalThumbsRef}
                onWheel={(e) => e.stopPropagation()}
                className="gallery-scroll flex gap-3 overflow-x-auto overscroll-contain px-[45%] py-2"
              >
                {gallery.map((g, i) => (
                  <Thumb
                    key={g.path}
                    item={g}
                    active={i === currentImage}
                    small
                    onClick={() => setCurrentImage(i)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
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
