import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { Rect, SnipMode } from "../types";

const params = new URLSearchParams(location.search);
const display: Rect = {
  x: Number(params.get("x") || 0),
  y: Number(params.get("y") || 0),
  width: Number(params.get("width") || window.innerWidth),
  height: Number(params.get("height") || window.innerHeight),
};

function OverlayApp() {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const modebarRef = useRef<HTMLDivElement>(null);
  const recordControlsRef = useRef<HTMLDivElement>(null);
  const recordBtnRef = useRef<HTMLButtonElement>(null);
  const stopBtnRef = useRef<HTMLButtonElement>(null);
  const imageModeRef = useRef<HTMLButtonElement>(null);
  const videoModeRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const box = boxRef.current!;
    const hint = hintRef.current!;
    const shade = shadeRef.current!;
    const modebar = modebarRef.current!;
    const recordControls = recordControlsRef.current!;
    const recordBtn = recordBtnRef.current!;
    const stopBtn = stopBtnRef.current!;
    const imageMode = imageModeRef.current!;
    const videoMode = videoModeRef.current!;
    const closeBtn = closeBtnRef.current!;

    let startPoint: { x: number; y: number } | null = null;
    let current: { x: number; y: number } | null = null;
    let selectedLocal: Rect | null = null;
    let dragging = false;
    let mode: SnipMode = "image";
    let videoReady = false;
    let recording = false;
    let captureInProgress = false;

    function clampPoint(e: MouseEvent): { x: number; y: number } {
      return {
        x: Math.max(0, Math.min(e.clientX, display.width)),
        y: Math.max(0, Math.min(e.clientY, display.height)),
      };
    }

    function localRect(): Rect {
      if (!startPoint || !current) return { x: 0, y: 0, width: 0, height: 0 };
      return {
        x: Math.min(startPoint.x, current.x),
        y: Math.min(startPoint.y, current.y),
        width: Math.abs(current.x - startPoint.x),
        height: Math.abs(current.y - startPoint.y),
      };
    }

    function absoluteRect(r: Rect): Rect {
      return {
        x: display.x + r.x,
        y: display.y + r.y,
        width: r.width,
        height: r.height,
      };
    }

    function updateModeButtons(): void {
      imageMode.className = `rounded px-3 py-1 ${mode === "image" ? "bg-sky-600" : "hover:bg-white/15"}`;
      videoMode.className = `rounded px-3 py-1 ${mode === "video" ? "bg-red-600" : "hover:bg-white/15"}`;
    }

    function setMode(next: SnipMode): void {
      if (recording || captureInProgress) return;
      mode = next;
      videoReady = false;
      selectedLocal = null;
      startPoint = null;
      current = null;
      dragging = false;
      box.style.display = "none";
      recordControls.style.display = "none";
      shade.style.display = "block";
      modebar.style.display = "block";
      hint.style.display = "block";
      hint.textContent =
        "Choose image or video, then drag to select. Esc cancels.";
      box.classList.remove("video-ready");
      updateModeButtons();
    }

    function updateBox(): void {
      const r = localRect();
      Object.assign(box.style, {
        display: "block",
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    }

    function placeControls(r: Rect): void {
      recordControls.style.left = `${r.x + r.width / 2}px`;
      recordControls.style.top = `${Math.max(44, r.y - 8)}px`;
      recordControls.style.display = "flex";
    }

    function onImageMode(e: MouseEvent): void {
      e.stopPropagation();
      setMode("image");
    }

    function onVideoMode(e: MouseEvent): void {
      e.stopPropagation();
      setMode("video");
    }

    function onMouseDown(e: MouseEvent): void {
      const target = e.target as Element | null;
      if (target?.closest("button") || recording || captureInProgress) return;
      dragging = true;
      videoReady = false;
      selectedLocal = null;
      startPoint = clampPoint(e);
      current = clampPoint(e);
      recordControls.style.display = "none";
      box.classList.remove("video-ready");
      updateBox();
    }

    function onMouseMove(e: MouseEvent): void {
      if (!dragging) return;
      current = clampPoint(e);
      updateBox();
    }

    async function onMouseUp(e: MouseEvent): Promise<void> {
      if (!dragging) return;
      dragging = false;
      current = clampPoint(e);
      const r = localRect();
      if (r.width < 5 || r.height < 5) {
        await window.betterSnip.cancelSnip();
        return;
      }

      if (mode === "image") {
        captureInProgress = true;
        document.body.style.cursor = "wait";
        hint.textContent = "Capturing screenshot...";
        modebar.style.display = "none";
        recordControls.style.display = "none";
        try {
          await window.betterSnip.captureSnip(absoluteRect(r), "image");
        } catch (err) {
          captureInProgress = false;
          hint.textContent =
            err instanceof Error ? err.message : "Screenshot failed.";
          document.body.style.cursor = "crosshair";
          setTimeout(() => window.betterSnip.cancelSnip(), 1400);
        } finally {
          window.betterSnip.cancelSnip().catch(() => {});
        }
        return;
      }

      selectedLocal = r;
      videoReady = true;
      box.classList.add("video-ready");
      hint.textContent =
        "Press ● to start recording. Border stays visible while recording.";
      placeControls(r);
    }

    async function onRecord(e: MouseEvent): Promise<void> {
      e.stopPropagation();
      if (!videoReady || !selectedLocal || recording) return;
      recording = true;
      const r = selectedLocal;

      shade.style.display = "none";
      modebar.style.display = "none";
      hint.style.display = "none";
      box.classList.add("video-ready");
      Object.assign(box.style, {
        display: "block",
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      placeControls(r);

      recordBtn.disabled = true;
      recordBtn.className =
        "grid h-9 w-9 place-items-center rounded-full text-red-400/40";
      stopBtn.disabled = false;
      stopBtn.className =
        "grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15";

      try {
        await window.betterSnip.prepareRecording(absoluteRect(r));
      } catch (err) {
        recording = false;
        alert(err instanceof Error ? err.message : String(err));
        await window.betterSnip.cancelSnip();
      }
    }

    async function onStop(e: MouseEvent): Promise<void> {
      e.stopPropagation();
      if (!recording) return;
      stopBtn.disabled = true;
      stopBtn.className =
        "grid h-9 w-9 place-items-center rounded-full text-white/40";
      await window.betterSnip.stopRecording();
    }

    function closeOverlay(): void {
      window.betterSnip.cancelSnip();
    }

    function onCloseClick(e: MouseEvent): void {
      e.stopPropagation();
      closeOverlay();
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeOverlay();
    }

    imageMode.addEventListener("click", onImageMode);
    videoMode.addEventListener("click", onVideoMode);
    recordBtn.addEventListener("click", onRecord);
    stopBtn.addEventListener("click", onStop);
    closeBtn.addEventListener("click", onCloseClick);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    setMode("image");

    return () => {
      imageMode.removeEventListener("click", onImageMode);
      videoMode.removeEventListener("click", onVideoMode);
      recordBtn.removeEventListener("click", onRecord);
      stopBtn.removeEventListener("click", onStop);
      closeBtn.removeEventListener("click", onCloseClick);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="h-screen w-screen overflow-hidden cursor-crosshair select-none"
    >
      <div ref={shadeRef} className="fixed inset-0 z-[1] bg-black/35" />
      <button
        ref={closeBtnRef}
        type="button"
        title="Close overlay"
        aria-label="Close overlay"
        className="fixed right-4 top-4 z-30 grid h-9 w-9 place-items-center rounded-full bg-zinc-950/85 text-white shadow-lg hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/70"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div
        ref={boxRef}
        className="fixed z-[2] hidden border-2 border-sky-400 bg-sky-400/10 pointer-events-none shadow-[0_0_0_99999px_rgba(0,0,0,0.28)] [&.video-ready]:z-10 [&.video-ready]:border-red-500 [&.video-ready]:border-dashed [&.video-ready]:bg-transparent [&.video-ready]:shadow-none"
      />
      <div
        ref={modebarRef}
        className="fixed z-20 top-[58px] left-1/2 -translate-x-1/2 rounded bg-zinc-950/85 text-white p-1 text-sm"
      >
        <button ref={imageModeRef} className="rounded px-3 py-1 bg-sky-600">
          Image
        </button>
        <button
          ref={videoModeRef}
          className="rounded px-3 py-1 hover:bg-white/15"
        >
          Video
        </button>
      </div>
      <div
        ref={hintRef}
        className="fixed z-20 top-4 left-1/2 -translate-x-1/2 rounded bg-zinc-950/80 text-white px-4 py-2 text-sm"
      >
        Choose image or video, then drag to select. Esc cancels.
      </div>
      <div
        ref={recordControlsRef}
        className="fixed z-30 hidden -translate-x-1/2 -translate-y-full items-center rounded-full bg-zinc-950/90 text-white px-2 py-1 shadow-lg"
      >
        <button
          ref={recordBtnRef}
          title="Record"
          className="grid h-9 w-9 place-items-center rounded-full text-red-400 hover:bg-white/15"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="7" />
          </svg>
        </button>
        <button
          ref={stopBtnRef}
          title="Stop"
          className="grid h-9 w-9 place-items-center rounded-full text-white/40"
          disabled
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<OverlayApp />);
