import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { CaptureInfo } from "../types";
import { Icons } from "./components/Icons";
import { TitleBar } from "./components/TitleBar";
import {
  ArrowUpRight,
  Ban,
  Check,
  Copy,
  Crop,
  Pause,
  Play,
  Download,
  Eraser,
  FlipHorizontal2,
  MousePointer2,
  Pencil,
  Redo2,
  Save,
  Square,
  Trash,
  Type,
  Undo2,
  X,
} from "lucide-react";
import {
  Canvas,
  FabricImage,
  Group,
  Image as LegacyImage,
  Line,
  PencilBrush,
  Rect,
  Textbox,
  Triangle,
  filters,
} from "fabric";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg"]);
const VIDEO_EXTS = new Set([".webm", ".mp4"]);
function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

type View = "loading" | "image" | "video" | "unsupported";
type Tool = "draw" | "select" | "rect" | "arrow" | "text" | "redact" | "crop" | "blur";
const TOOL_ICONS = {
  draw: Pencil,
  select: MousePointer2,
  rect: Square,
  arrow: ArrowUpRight,
  text: Type,
  redact: Ban,
  crop: Crop,
  blur: Eraser,
} satisfies Record<Tool, React.ComponentType<{ className?: string }>>;

function AnnotateApp() {
  const [info, setInfo] = useState<CaptureInfo | null>(null);
  const [view, setView] = useState<View>("loading");
  useEffect(() => {
    window.betterSnip.getAnnotationImage().then((i) => {
      setInfo(i);
      const ext = extOf(i?.name || i?.path || "");
      setView(
        VIDEO_EXTS.has(ext)
          ? "video"
          : IMAGE_EXTS.has(ext)
            ? "image"
            : "unsupported",
      );
    });
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.betterSnip.closeWindow();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (view === "unsupported") {
      alert("Unsupported capture type.");
      window.betterSnip.closeWindow();
    }
  }, [view]);
  return (
    <div className="annotate-page h-screen bg-transparent text-neutral-900 flex flex-col overflow-hidden">
      <TitleBar
        title={view === "video" ? "Video preview" : "Annotate screenshot"}
      />
      {view === "image" && info && <ImageEditor info={info} />}
      {view === "video" && info && <VideoView info={info} />}
    </div>
  );
}

function VideoView({ info }: { info: CaptureInfo }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [metadata, setMetadata] = useState({ duration: 0, width: 0, height: 0 });
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [format, setFormat] = useState<"mp4" | "webm">("mp4");
  const [formatOpen, setFormatOpen] = useState(false);
  const [quality, setQuality] = useState(23);
  const [speed, setSpeed] = useState(1);
  const [removeAudio, setRemoveAudio] = useState(false);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [resizeEnabled, setResizeEnabled] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [resizeAdvancedOpen, setResizeAdvancedOpen] = useState(false);
  const [resizePreset, setResizePreset] = useState("Original");
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [resize, setResize] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState(info);
  const [processing, setProcessing] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoUrl = useMemo(
    () => `${current.url}${current.url.includes("?") ? "&" : "?"}t=${Date.now()}`,
    [current.url],
  );

  useEffect(() => {
    window.betterSnip.getVideoMetadata(current.path).then((m) => {
      setMetadata(m);
      setStartTime(0);
      setPlayhead(0);
      setEndTime(Number(m.duration.toFixed(2)) || 0);
      setCrop({ x: 0, y: 0, width: m.width || 0, height: m.height || 0 });
      setResize({ width: m.width || 0, height: m.height || 0 });
      setResizePreset("Original");
      const ext = extOf(current.name || current.path);
      if (ext === ".webm") setFormat("webm");
      else setFormat("mp4");
    }).catch((err) => console.error("Failed to read video metadata", err));
  }, [current.path]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setPlayhead(video.currentTime || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
    };
  }, [videoUrl]);

  function seekTo(time: number) {
    const duration = metadata.duration || 0;
    const clamped = Math.max(0, Math.min(duration || time, time));
    setPlayhead(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }

  const resizePresets = useMemo(() => {
    const sourceW = metadata.width || resize.width || 0;
    const sourceH = metadata.height || resize.height || 0;
    const ratio = sourceW && sourceH ? sourceH / sourceW : 9 / 16;
    const make = (label: string, width: number) => ({
      label,
      width,
      height: Math.max(2, Math.round(width * ratio)),
    });
    return [
      { label: "Original", width: sourceW, height: sourceH },
      make("1080p", 1920),
      make("720p", 1280),
      make("480p", 854),
      make("360p", 640),
      { label: "Custom", width: resize.width, height: resize.height },
    ].filter((preset) => preset.width > 0 && preset.height > 0);
  }, [metadata.width, metadata.height, resize.width, resize.height]);

  function chooseResizePreset(preset: { label: string; width: number; height: number }) {
    setResizePreset(preset.label);
    setResizeOpen(false);
    if (preset.label === "Original") {
      setResizeEnabled(false);
      setResize({ width: metadata.width || preset.width, height: metadata.height || preset.height });
      return;
    }
    setResizeEnabled(true);
    setResize({ width: preset.width, height: preset.height });
  }

  async function process(saveAsCopy: boolean) {
    if (processing) return;
    setProcessing(true);
    try {
      const result = await window.betterSnip.editVideo({
        inputPath: current.path,
        startTime,
        endTime,
        format,
        quality,
        speed,
        removeAudio,
        saveAsCopy,
        crop: { enabled: cropEnabled, ...crop },
        resize: { enabled: resizeEnabled, ...resize },
      });
      setCurrent(result);
      if (!saveAsCopy) await window.betterSnip.closeWindow();
    } catch (err) {
      console.error("FFmpeg edit failed", err);
      alert(err instanceof Error ? err.message : "FFmpeg edit failed.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="min-h-0 flex-1 grid grid-cols-[minmax(0,1fr)_340px] bg-slate-50 text-slate-900">
      <main className="min-h-0 flex flex-col p-5 gap-4">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
          <div>
            <div className="text-sm font-semibold text-slate-900">FFmpeg Video Editor</div>
            <div className="text-xs text-slate-500">{current.name} · {metadata.width || "?"}×{metadata.height || "?"} · {format.toUpperCase()}</div>
          </div>
          <div className="grow" />
          <button onClick={() => window.betterSnip.openAnnotationFile()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50"><Icons.External />Open</button>
          <button onClick={() => window.betterSnip.closeWindow()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50"><X className="h-4 w-4" />Close</button>
        </div>
        <div className="min-h-0 flex-1 grid place-items-center rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-xl shadow-slate-900/5">
          <div className="relative max-h-full max-w-full">
            <video ref={videoRef} key={videoUrl} src={videoUrl} className="block max-h-full max-w-full rounded-2xl shadow-2xl" autoPlay onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0 && !metadata.duration) {
                setMetadata((m) => ({ ...m, duration: d }));
                setEndTime(Number(d.toFixed(2)));
              }
            }} />
            <VideoCropOverlay
              enabled={cropEnabled}
              crop={crop}
              videoWidth={metadata.width}
              videoHeight={metadata.height}
              onChange={(next) => {
                setCropEnabled(true);
                setCrop(next);
              }}
            />
          </div>
        </div>
        <VideoTimeline
          duration={metadata.duration}
          currentTime={playhead}
          startTime={startTime}
          endTime={endTime || metadata.duration}
          playing={playing}
          onPlayPause={togglePlay}
          onSeek={seekTo}
          onRangeChange={(start, end) => {
            setStartTime(start);
            setEndTime(end);
          }}
        />
      </main>
      <aside className="settings-scroll min-h-0 overflow-auto border-l border-slate-200 bg-white/70 p-4 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-800">Trim</span>
            <span className="font-mono">{formatTime(startTime)} → {formatTime(endTime || metadata.duration)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 font-bold text-slate-800"><input type="checkbox" checked={cropEnabled} onChange={(e) => setCropEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />Crop</label>
            <span className="font-mono">{cropEnabled ? `${crop.x},${crop.y} ${crop.width}×${crop.height}` : "Off"}</span>
          </div>
        </div>
        <Panel title="Resize & speed">
          <Toggle label="Resize output" checked={resizeEnabled} setChecked={setResizeEnabled} />
          <div className={`custom-select relative ${resizeOpen ? "open" : ""}`}>
            <button
              onClick={() => setResizeOpen((v) => !v)}
              className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-3 text-left text-sm font-medium text-slate-700 shadow-inner outline-none hover:border-blue-300 hover:bg-blue-50/40 focus:ring-2 focus:ring-blue-500"
            >
              <span>{resizePreset} {resizeEnabled ? `· ${resize.width}×${resize.height}` : ""}</span>
              <Icons.ChevronDown className="custom-select-chevron h-4 w-4 text-slate-400 transition-transform" />
            </button>
            <div className="custom-select-menu pointer-events-none absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-1 text-sm text-slate-700 opacity-0 shadow-xl shadow-slate-900/10 backdrop-blur transition duration-150 ease-out -translate-y-0.5 scale-[.99]">
              {resizePresets.map((preset) => (
                <button
                  key={`${preset.label}-${preset.width}-${preset.height}`}
                  onClick={() => chooseResizePreset(preset)}
                  className="custom-select-option flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium"
                  aria-selected={resizePreset === preset.label}
                >
                  <span>{preset.label}</span>
                  <span className="text-xs opacity-70">{preset.width}×{preset.height}</span>
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setResizeAdvancedOpen((v) => !v)} className="flex w-full items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200">
            <span>Advanced manual size</span>
            <span>{resizeAdvancedOpen ? "−" : "+"}</span>
          </button>
          <div className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out ${resizeAdvancedOpen ? "grid-rows-[1fr] opacity-100 translate-y-0" : "grid-rows-[0fr] opacity-0 -translate-y-1"}`}>
            <div className="min-h-0 overflow-hidden">
              <div className="grid grid-cols-2 gap-2 pt-1">
                <NumberField label="Width" value={resize.width} setValue={(v) => { setResizePreset("Custom"); setResizeEnabled(true); setResize({ ...resize, width: v }); }} min={2} />
                <NumberField label="Height" value={resize.height} setValue={(v) => { setResizePreset("Custom"); setResizeEnabled(true); setResize({ ...resize, height: v }); }} min={2} />
              </div>
            </div>
          </div>
          <label className="block text-xs font-medium text-slate-700">Speed {speed.toFixed(2)}×<input className="mt-2 w-full accent-blue-600" type="range" min="0.25" max="4" step="0.25" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label>
        </Panel>
        <Panel title="Output">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">Format</label>
            <div className={`custom-select relative ${formatOpen ? "open" : ""}`}>
              <button
                onClick={() => setFormatOpen((v) => !v)}
                className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-3 text-left text-sm font-medium text-slate-700 shadow-inner outline-none hover:border-blue-300 hover:bg-blue-50/40 focus:ring-2 focus:ring-blue-500"
              >
                <span>{format.toUpperCase()}</span>
                <Icons.ChevronDown className="custom-select-chevron h-4 w-4 text-slate-400 transition-transform" />
              </button>
              <div className="custom-select-menu pointer-events-none absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-1 text-sm text-slate-700 opacity-0 shadow-xl shadow-slate-900/10 backdrop-blur transition duration-150 ease-out -translate-y-0.5 scale-[.99]">
                {(["mp4", "webm"] as const).map((nextFormat) => (
                  <button
                    key={nextFormat}
                    onClick={() => {
                      setFormat(nextFormat);
                      setFormatOpen(false);
                    }}
                    className="custom-select-option flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-medium"
                    aria-selected={format === nextFormat}
                  >
                    <span>{nextFormat.toUpperCase()}</span>
                    <span className="text-xs opacity-70">{nextFormat === "mp4" ? "Best compatibility" : "Web optimized"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="block text-xs font-medium text-slate-700">Quality CRF {quality}<input className="mt-2 w-full accent-blue-600" type="range" min="16" max="40" value={quality} onChange={(e) => setQuality(Number(e.target.value))} /></label>
          <Toggle label="Remove audio" checked={removeAudio} setChecked={setRemoveAudio} />
        </Panel>
        <div className="grid gap-2 pt-2">
          <button disabled={processing} onClick={() => process(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60"><Copy className="h-4 w-4" />{processing ? "Processing..." : "Save edited copy"}</button>
          <button disabled={processing} onClick={() => process(false)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-60"><Download className="h-4 w-4" />Apply to original</button>
        </div>
      </aside>
    </section>
  );
}

type VideoCrop = { x: number; y: number; width: number; height: number };

function VideoCropOverlay({
  enabled,
  crop,
  videoWidth,
  videoHeight,
  onChange,
}: {
  enabled: boolean;
  crop: VideoCrop;
  videoWidth: number;
  videoHeight: number;
  onChange: (crop: VideoCrop) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<{
    kind: "move" | "new" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
    startX: number;
    startY: number;
    crop: VideoCrop;
  } | null>(null);

  const hasVideoSize = videoWidth > 0 && videoHeight > 0;
  if (!enabled || !hasVideoSize) return null;

  function clampCrop(next: VideoCrop): VideoCrop {
    let x = Number.isFinite(next.x) ? next.x : 0;
    let y = Number.isFinite(next.y) ? next.y : 0;
    let width = Number.isFinite(next.width) ? next.width : videoWidth;
    let height = Number.isFinite(next.height) ? next.height : videoHeight;
    width = Math.max(2, Math.min(videoWidth, width));
    height = Math.max(2, Math.min(videoHeight, height));
    x = Math.max(0, Math.min(videoWidth - width, x));
    y = Math.max(0, Math.min(videoHeight - height, y));
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  const safeCrop = clampCrop(crop.width > 0 && crop.height > 0 ? crop : { x: 0, y: 0, width: videoWidth, height: videoHeight });
  const left = `${(safeCrop.x / videoWidth) * 100}%`;
  const top = `${(safeCrop.y / videoHeight) * 100}%`;
  const width = `${(safeCrop.width / videoWidth) * 100}%`;
  const height = `${(safeCrop.height / videoHeight) * 100}%`;

  function scale() {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { sx: 1, sy: 1 };
    return { sx: videoWidth / rect.width, sy: videoHeight / rect.height };
  }

  function begin(kind: NonNullable<typeof activeRef.current>["kind"], e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    activeRef.current = { kind, startX: e.clientX, startY: e.clientY, crop: safeCrop };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}

    const move = (ev: PointerEvent) => {
      const active = activeRef.current;
      if (!active) return;
      const { sx, sy } = scale();
      const dx = (ev.clientX - active.startX) * sx;
      const dy = (ev.clientY - active.startY) * sy;
      const c = active.crop;
      let next = { ...c };

      if (active.kind === "move") next = { ...c, x: c.x + dx, y: c.y + dy };
      else if (active.kind === "new") {
        next = {
          x: Math.min(c.x, c.x + dx),
          y: Math.min(c.y, c.y + dy),
          width: Math.abs(dx),
          height: Math.abs(dy),
        };
      } else {
        if (active.kind.includes("e")) next.width = c.width + dx;
        if (active.kind.includes("s")) next.height = c.height + dy;
        if (active.kind.includes("w")) {
          next.x = c.x + dx;
          next.width = c.width - dx;
        }
        if (active.kind.includes("n")) {
          next.y = c.y + dy;
          next.height = c.height - dy;
        }
      }
      onChange(clampCrop(next));
    };
    const up = () => {
      activeRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    move(e.nativeEvent);
  }

  function startNew(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(videoWidth, ((e.clientX - rect.left) / rect.width) * videoWidth));
    const y = Math.max(0, Math.min(videoHeight, ((e.clientY - rect.top) / rect.height) * videoHeight));
    activeRef.current = { kind: "new", startX: e.clientX, startY: e.clientY, crop: { x, y, width: 2, height: 2 } };
    onChange(clampCrop({ x, y, width: 2, height: 2 }));

    const move = (ev: PointerEvent) => {
      const active = activeRef.current;
      if (!active) return;
      const { sx, sy } = scale();
      const dx = (ev.clientX - active.startX) * sx;
      const dy = (ev.clientY - active.startY) * sy;
      onChange(clampCrop({
        x: Math.min(active.crop.x, active.crop.x + dx),
        y: Math.min(active.crop.y, active.crop.y + dy),
        width: Math.abs(dx),
        height: Math.abs(dy),
      }));
    };
    const up = () => {
      activeRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const handleClass = "absolute h-5 w-5 rounded-md border-2 border-white bg-blue-500 shadow-lg shadow-blue-900/30";
  const edgeClass = "absolute bg-blue-400/0 hover:bg-blue-400/25";

  return (
    <div ref={overlayRef} onPointerDown={startNew} className="absolute inset-0 z-10 cursor-crosshair select-none rounded-2xl overflow-hidden">
      <div className="absolute inset-0 bg-black/35" />
      <div className="absolute bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,.38)]" style={{ left, top, width, height }}>
        <div className="absolute inset-0 cursor-move border-2 border-blue-400 bg-blue-400/10 ring-1 ring-white/70" onPointerDown={(e) => begin("move", e)}>
          <div className="pointer-events-none absolute left-1/3 top-0 bottom-0 border-l border-white/45" />
          <div className="pointer-events-none absolute left-2/3 top-0 bottom-0 border-l border-white/45" />
          <div className="pointer-events-none absolute top-1/3 left-0 right-0 border-t border-white/45" />
          <div className="pointer-events-none absolute top-2/3 left-0 right-0 border-t border-white/45" />
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 font-mono text-xs font-bold text-white shadow">{safeCrop.width}×{safeCrop.height}</div>
        </div>
        <div onPointerDown={(e) => begin("n", e)} className={`${edgeClass} -top-3 left-5 right-5 h-6 cursor-ns-resize`} />
        <div onPointerDown={(e) => begin("s", e)} className={`${edgeClass} -bottom-3 left-5 right-5 h-6 cursor-ns-resize`} />
        <div onPointerDown={(e) => begin("w", e)} className={`${edgeClass} -left-3 top-5 bottom-5 w-6 cursor-ew-resize`} />
        <div onPointerDown={(e) => begin("e", e)} className={`${edgeClass} -right-3 top-5 bottom-5 w-6 cursor-ew-resize`} />
        <button onPointerDown={(e) => begin("nw", e)} className={`${handleClass} -left-2.5 -top-2.5 cursor-nwse-resize`} title="Resize crop" />
        <button onPointerDown={(e) => begin("ne", e)} className={`${handleClass} -right-2.5 -top-2.5 cursor-nesw-resize`} title="Resize crop" />
        <button onPointerDown={(e) => begin("sw", e)} className={`${handleClass} -left-2.5 -bottom-2.5 cursor-nesw-resize`} title="Resize crop" />
        <button onPointerDown={(e) => begin("se", e)} className={`${handleClass} -right-2.5 -bottom-2.5 cursor-nwse-resize`} title="Resize crop" />
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function VideoTimeline({
  duration,
  currentTime,
  startTime,
  endTime,
  playing,
  onPlayPause,
  onSeek,
  onRangeChange,
}: {
  duration: number;
  currentTime: number;
  startTime: number;
  endTime: number;
  playing: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onRangeChange: (start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const durationSafe = Math.max(0.01, duration || 0.01);
  const start = Math.max(0, Math.min(startTime, durationSafe));
  const end = Math.max(start, Math.min(endTime || durationSafe, durationSafe));
  const current = Math.max(0, Math.min(currentTime, durationSafe));
  const pct = (time: number) => `${(time / durationSafe) * 100}%`;

  function timeFromClientX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Number((ratio * durationSafe).toFixed(2));
  }

  function startDrag(kind: "seek" | "start" | "end" | "range", e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const initialX = e.clientX;
    const initialStart = start;
    const initialEnd = end;
    const selectionLength = Math.max(0.1, initialEnd - initialStart);

    const move = (ev: PointerEvent) => {
      const t = timeFromClientX(ev.clientX);
      if (kind === "seek") onSeek(t);
      else if (kind === "start") onRangeChange(Math.min(t, end - 0.05), end);
      else if (kind === "end") onRangeChange(start, Math.max(t, start + 0.05));
      else {
        const delta = timeFromClientX(ev.clientX) - timeFromClientX(initialX);
        const nextStart = Math.max(0, Math.min(durationSafe - selectionLength, initialStart + delta));
        onRangeChange(Number(nextStart.toFixed(2)), Number((nextStart + selectionLength).toFixed(2)));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    move(e.nativeEvent);
  }

  return (
    <div className="rounded-2xl border border-blue-400 bg-white px-4 py-3 text-slate-900 shadow-sm dark:bg-black dark:text-white">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={onPlayPause} className="grid h-9 w-9 place-items-center rounded-full bg-slate-900/10 hover:bg-slate-900/15 dark:bg-white/10 dark:hover:bg-white/20" title={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <div className="font-mono text-sm text-slate-900 dark:text-white">{formatTime(current)} / {formatTime(durationSafe)}</div>
        <div className="ml-auto text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/35">Drag range or handles to trim</div>
      </div>
      <div ref={trackRef} onPointerDown={(e) => startDrag("seek", e)} className="relative h-10 cursor-pointer select-none py-3">
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200 dark:bg-white/20" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500" style={{ left: 0, width: pct(current) }} />
        <div onPointerDown={(e) => startDrag("range", e)} className="absolute top-1/2 h-3 -translate-y-1/2 cursor-grab rounded-full bg-blue-500/25 ring-1 ring-blue-400/50 active:cursor-grabbing" style={{ left: pct(start), width: `calc(${pct(end - start)})` }} title="Drag selected section" />
        <div className="pointer-events-none absolute top-2 bottom-2 w-px bg-blue-500/80" style={{ left: pct(current) }} />
        <button onPointerDown={(e) => startDrag("seek", e)} className="absolute top-1/2 z-20 h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full bg-transparent active:cursor-grabbing" style={{ left: pct(current) }} title="Drag current position">
          <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-[50%_50%_50%_0] border border-white bg-blue-500 shadow-md shadow-blue-500/25" />
          <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
        </button>
        <button onPointerDown={(e) => startDrag("start", e)} className="absolute top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-white bg-blue-500 shadow-sm" style={{ left: pct(start) }} title="Trim start" />
        <button onPointerDown={(e) => startDrag("end", e)} className="absolute top-1/2 h-8 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-white bg-blue-500 shadow-sm" style={{ left: pct(end) }} title="Trim end" />
      </div>
      <div className="flex justify-between font-mono text-xs text-slate-500 dark:text-white/60">
        <span>IN {formatTime(start)}</span>
        <span>OUT {formatTime(end)}</span>
        <span>CLIP {formatTime(Math.max(0, end - start))}</span>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 space-y-3"><div className="text-sm font-bold text-slate-800">{title}</div>{children}</div>;
}
function Toggle({ label, checked, setChecked }: { label: string; checked: boolean; setChecked: (v: boolean) => void }) {
  return <label className="flex items-center justify-between gap-3 text-sm text-slate-700"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-blue-600" /></label>;
}
function NumberField({ label, value, setValue, min, max, step = 1 }: { label: string; value: number; setValue: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <label className="block text-xs font-medium text-slate-700">{label}<input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(e) => setValue(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" /></label>;
}

function ImageEditor({ info }: { info: CaptureInfo }) {
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const fabricCanvas = useRef<any>(null);
  const baseImage = useRef<any>(null);
  const imageScale = useRef(1);
  const toolRef = useRef<Tool>("draw");
  const redoStack = useRef<any[]>([]);
  const cropRect = useRef<any>(null);
  const [tool, setToolState] = useState<Tool>("draw");
  const [color, setColor] = useState("#ff3333");
  const [width, setWidth] = useState(8);
  const [isSaving, setIsSaving] = useState(false);
  const [redoCount, setRedoCount] = useState(0);

  function setTool(next: Tool) {
    toolRef.current = next;
    setToolState(next);
    const c = fabricCanvas.current;
    if (!c) return;
    c.isDrawingMode = next === "draw";
    c.selection = next === "select";
    c.defaultCursor = next === "select" ? "default" : "crosshair";
    drawnObjects().forEach((o: any) => {
      if (o === cropRect.current) return;
      o.selectable = next === "select";
      o.evented = next === "select";
    });
    c.discardActiveObject();
    setBrush();
    c.requestRenderAll();
  }
  function drawnObjects() {
    return fabricCanvas.current
      ? fabricCanvas.current.getObjects().filter((o: any) => o !== baseImage.current)
      : [];
  }
  function pushAdd(obj: any) {
    redoStack.current = [];
    setRedoCount(0);
    obj.__history = { type: "add", objects: [obj] };
  }
  function setBrush() {
    const c = fabricCanvas.current;
    if (!c) return;
    if (!c.freeDrawingBrush) c.freeDrawingBrush = new PencilBrush(c);
    c.freeDrawingBrush.color = color;
    c.freeDrawingBrush.width = width;
    c.isDrawingMode = toolRef.current === "draw";
  }
  useEffect(setBrush, [color, width]);

  async function loadFabricImage(url: string) {
    const ImageCtor: any = FabricImage || LegacyImage;
    return ImageCtor.fromURL(url, { crossOrigin: "anonymous" });
  }

  async function loadImage() {
    const img = await loadFabricImage(`${info.url}${info.url.includes("?") ? "&" : "?"}t=${Date.now()}`);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const viewportW = Math.max(400, wrap.clientWidth - 40);
    const viewportH = Math.max(320, wrap.clientHeight - 40);
    imageScale.current = Math.min(1, viewportW / img.width, viewportH / img.height);
    fabricCanvas.current?.dispose();
    const c = new Canvas(canvasEl.current!, {
      width: viewportW,
      height: viewportH,
      backgroundColor: "#fff",
      selection: false,
    });
    fabricCanvas.current = c;
    img.set({
      scaleX: imageScale.current,
      scaleY: imageScale.current,
      selectable: false,
      evented: false,
      hoverCursor: "crosshair",
    });
    baseImage.current = img;
    c.add(img);
    c.centerObject(img);
    img.setCoords();
    c.sendObjectToBack(img);
    c.renderAll();
    c.on("path:created", (e: any) => {
      if (!e.path) return;
      pushAdd(e.path);
      c.bringObjectToFront(e.path);
      e.path.setCoords();
      c.requestRenderAll();
    });

    const pointer = (opt: any) => {
      const e = opt.e || opt;
      if ((c as any).getScenePoint) return (c as any).getScenePoint(e);
      if ((c as any).getPointer) return (c as any).getPointer(e);
      return opt.scenePoint || opt.pointer || { x: 0, y: 0 };
    };
    let start: any = null;
    let preview: any = null;
    c.on("mouse:down", (opt: any) => {
      const activeTool = toolRef.current;
      if (activeTool === "draw" || activeTool === "select") return;
      const p = pointer(opt);
      start = p;
      if (activeTool === "text") {
        const t = new Textbox("Text", {
          left: p.x,
          top: p.y,
          originX: "left",
          originY: "top",
          fill: color,
          fontSize: Math.max(18, width * 3),
          backgroundColor: "rgba(255,255,255,.7)",
          editable: true,
        });
        c.add(t);
        pushAdd(t);
        setTool("select");
        c.setActiveObject(t);
        t.enterEditing?.();
        t.selectAll?.();
        c.requestRenderAll();
        start = null;
        return;
      }
      if (activeTool === "rect" || activeTool === "redact" || activeTool === "crop" || activeTool === "blur") {
        preview = new Rect({
          left: p.x,
          top: p.y,
          originX: "left",
          originY: "top",
          width: 1,
          height: 1,
          fill: activeTool === "redact" ? "#000" : "rgba(255,255,0,.18)",
          stroke: activeTool === "redact" ? "#000" : color,
          strokeWidth: activeTool === "crop" || activeTool === "blur" ? 2 : width,
          strokeDashArray: activeTool === "crop" || activeTool === "blur" ? [8, 5] : undefined,
          selectable: false,
          evented: false,
        });
        if ((activeTool === "crop" || activeTool === "blur") && cropRect.current) c.remove(cropRect.current);
        c.add(preview);
        if (activeTool === "crop" || activeTool === "blur") cropRect.current = preview;
      }
    });
    c.on("mouse:move", (opt: any) => {
      if (!start || !preview) return;
      const p = pointer(opt);
      preview.set({
        left: Math.min(start.x, p.x),
        top: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
        originX: "left",
        originY: "top",
      });
      preview.setCoords();
      c.requestRenderAll();
    });
    c.on("mouse:up", (opt: any) => {
      const activeTool = toolRef.current;
      if (!start) return;
      const end = pointer(opt);
      if (activeTool === "arrow") {
        const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI + 90;
        const line = new Line([start.x, start.y, end.x, end.y], { stroke: color, strokeWidth: width, selectable: false, evented: false });
        const head = new Triangle({ left: end.x, top: end.y, originX: "center", originY: "center", angle, width: width * 3, height: width * 4, fill: color, selectable: false, evented: false });
        const g = new Group([line, head], { selectable: false, evented: false });
        c.add(g);
        pushAdd(g);
      } else if (preview && activeTool === "blur") {
        if (preview.width < 3 || preview.height < 3) c.remove(preview);
        else setTimeout(() => blurSelection(preview), 0);
      } else if (preview && activeTool !== "crop") {
        if (preview.width < 3 || preview.height < 3) c.remove(preview);
        else pushAdd(preview);
      }
      preview?.setCoords();
      start = null;
      preview = null;
      c.requestRenderAll();
    });
    setTool(toolRef.current);
  }
  useEffect(() => {
    loadImage();
    const onResize = () => setTimeout(loadImage, 150);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      fabricCanvas.current?.dispose();
    };
  }, [info.url]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "z") undo();
      if ((e.ctrlKey && k === "y") || (e.ctrlKey && e.shiftKey && k === "z")) redo();
      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  function undo() {
    const c = fabricCanvas.current;
    const last = drawnObjects().filter((o: any) => o !== cropRect.current).at(-1);
    if (!c || !last) return;
    c.remove(last);
    redoStack.current.push(last);
    setRedoCount(redoStack.current.length);
    c.renderAll();
    setBrush();
  }
  function redo() {
    const c = fabricCanvas.current;
    const obj = redoStack.current.pop();
    if (!c || !obj) return;
    c.add(obj);
    c.bringObjectToFront(obj);
    setRedoCount(redoStack.current.length);
    c.renderAll();
  }
  function deleteSelected() {
    const c = fabricCanvas.current;
    const obj = c?.getActiveObject();
    if (!c || !obj || obj === baseImage.current) return;
    c.remove(obj);
    c.discardActiveObject();
    redoStack.current.push(obj);
    setRedoCount(redoStack.current.length);
    c.renderAll();
  }
  function clear() {
    drawnObjects().forEach((o: any) => fabricCanvas.current.remove(o));
    redoStack.current = [];
    setRedoCount(0);
    cropRect.current = null;
    fabricCanvas.current?.renderAll();
  }
  function invert() {
    const img = baseImage.current;
    if (!img) return;
    img.filters = img.filters || [];
    const idx = img.filters.findIndex((f: any) => f instanceof filters.Invert);
    if (idx >= 0) img.filters.splice(idx, 1);
    else img.filters.push(new filters.Invert());
    img.applyFilters();
    fabricCanvas.current?.requestRenderAll();
  }
  async function blurSelection(target?: any) {
    const c = fabricCanvas.current;
    const r = target || cropRect.current || c?.getActiveObject();
    if (!c || !r || r === baseImage.current) return alert("Draw a Crop area or select a rectangle first.");
    const b = r.getBoundingRect();
    const wasVisible = r.visible;
    r.set("visible", false);
    c.discardActiveObject();
    c.renderAll();
    const dataUrl = c.toDataURL({
      format: "png",
      left: b.left,
      top: b.top,
      width: b.width,
      height: b.height,
    });
    r.set("visible", wasVisible);
    const img = await loadFabricImage(dataUrl);
    img.set({
      left: b.left,
      top: b.top,
      originX: "left",
      originY: "top",
      selectable: false,
      evented: false,
    });
    img.filters = [new filters.Blur({ blur: 0.35 })];
    img.applyFilters();
    c.add(img);
    pushAdd(img);
    c.bringObjectToFront(img);
    if (target) {
      c.remove(r);
      if (cropRect.current === r) cropRect.current = null;
    } else {
      c.bringObjectToFront(r);
    }
    c.requestRenderAll();
  }
  async function applyCrop() {
    const c = fabricCanvas.current;
    const r = cropRect.current;
    if (!c || !r) return alert("Choose Crop, then drag an area first.");
    const b = r.getBoundingRect();
    c.remove(r);
    cropRect.current = null;
    c.discardActiveObject();
    c.renderAll();
    const dataUrl = c.toDataURL({
      format: "png",
      left: b.left,
      top: b.top,
      width: b.width,
      height: b.height,
    });
    const img = await loadFabricImage(dataUrl);
    clear();
    c.remove(baseImage.current);
    img.set({ left: b.left, top: b.top, selectable: false, evented: false });
    baseImage.current = img;
    c.add(img);
    c.sendObjectToBack(img);
    c.renderAll();
  }
  async function save(saveAsCopy = false) {
    const c = fabricCanvas.current;
    if (!c || !baseImage.current || isSaving) return;
    setIsSaving(true);
    try {
      if (cropRect.current) c.remove(cropRect.current);
      const b = baseImage.current.getBoundingRect();
      c.discardActiveObject();
      c.renderAll();
      const dataUrl = c.toDataURL({ format: "png", quality: 1, multiplier: 1 / imageScale.current, left: b.left, top: b.top, width: b.width, height: b.height });
      await window.betterSnip.saveAnnotation(dataUrl, saveAsCopy);
      await window.betterSnip.closeWindow();
    } catch (err) {
      console.error("Failed to save annotation", err);
      alert(err instanceof Error ? err.message : "Failed to save screenshot.");
      setIsSaving(false);
    }
  }

  return (
    <section className="min-h-0 flex-1 flex flex-col bg-slate-50">
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-3">
        {(["draw", "select", "rect", "arrow", "text", "redact", "crop", "blur"] as Tool[]).map((t) => {
          const ToolIcon = TOOL_ICONS[t];
          return (
            <ToolbarButton key={t} onClick={() => setTool(t)} strong={tool === t} title={t}>
              <ToolIcon className="h-4 w-4" />
            </ToolbarButton>
          );
        })}
        <label className="flex items-center gap-2 text-sm" title="Color"><input value={color} onChange={(e) => setColor(e.target.value)} type="color" className="h-8 w-10 rounded bg-transparent" /></label>
        <label className="flex items-center gap-2 text-sm" title="Size"><input value={width} onChange={(e) => setWidth(Number(e.target.value))} type="range" min="2" max="40" /><span className="w-7">{width}</span></label>
        <ToolbarButton onClick={undo} title="Undo"><Undo2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={redo} disabled={!redoCount} title="Redo"><Redo2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={deleteSelected} title="Delete"><Trash className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={() => blurSelection()} title="Blur selected/crop area"><Eraser className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={applyCrop} title="Apply crop"><Check className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={invert} title="Invert"><FlipHorizontal2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={clear} title="Clear"><Trash className="h-4 w-4" /></ToolbarButton>
        <div className="grow" />
        <ToolbarButton onClick={() => window.betterSnip.closeWindow()} title="Discard"><X className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={() => save(true)} strong disabled={isSaving} title="Save copy"><Copy className="h-4 w-4" /></ToolbarButton>
        <button onClick={() => save(false)} disabled={isSaving} title={isSaving ? "Saving..." : "Save"} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-2 text-sm font-semibold">
          <Save className="h-4 w-4" />
        </button>
      </div>
      <main ref={wrapRef} className="canvas-wrap min-h-0 flex-1 overflow-auto grid place-items-center p-5"><canvas ref={canvasEl} /></main>
    </section>
  );
}
function ToolbarButton({
  children,
  onClick,
  strong,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  strong?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-2 rounded-xl ${strong ? "bg-blue-100 text-blue-700" : "bg-neutral-100 hover:bg-neutral-200"} disabled:opacity-60 px-4 py-2 text-sm font-medium`}
    >
      {children}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(<AnnotateApp />);
