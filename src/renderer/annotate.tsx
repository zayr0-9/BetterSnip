import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type { CaptureInfo } from "../types";
import { Icons } from "./components/Icons";
import { TitleBar } from "./components/TitleBar";
import { Canvas, FabricImage, Image as LegacyImage, PencilBrush } from "fabric";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg"]);
const VIDEO_EXTS = new Set([".webm", ".mp4"]);
function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

type View = "loading" | "image" | "video" | "unsupported";

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
      <TitleBar title={view === "video" ? "Video preview" : "Annotate screenshot"} />
      {view === "image" && info && <ImageEditor info={info} />}
      {view === "video" && info && <VideoView info={info} />}
    </div>
  );
}

function VideoView({ info }: { info: CaptureInfo }) {
  return (
    <section className="min-h-0 flex-1 flex flex-col bg-neutral-50">
      <div className="shrink-0 flex items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 py-3">
        <div className="text-sm font-semibold">Video preview</div>
        <div className="grow" />
        <button
          onClick={() => window.betterSnip.openAnnotationFile()}
          className="inline-flex items-center gap-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 px-4 py-2 text-sm font-medium"
        >
          <Icons.External />
          Open file
        </button>
        <button
          onClick={() => window.betterSnip.closeWindow()}
          className="inline-flex items-center gap-2 rounded-xl bg-neutral-800 hover:bg-neutral-900 px-5 py-2 text-sm font-semibold text-white"
        >
          <Icons.Check />
          Done
        </button>
      </div>
      <main className="min-h-0 flex-1 grid place-items-center p-5">
        <video
          src={`${info.url}${info.url.includes("?") ? "&" : "?"}t=${Date.now()}`}
          className="max-h-full max-w-full rounded-xl shadow-2xl"
          controls
          autoPlay
        />
      </main>
    </section>
  );
}

function ImageEditor({ info }: { info: CaptureInfo }) {
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const fabricCanvas = useRef<any>(null);
  const baseImage = useRef<any>(null);
  const imageScale = useRef(1);
  const [color, setColor] = useState("#ff3333");
  const [width, setWidth] = useState(8);

  function drawnObjects() {
    return fabricCanvas.current
      ? fabricCanvas.current
          .getObjects()
          .filter((o: any) => o !== baseImage.current)
      : [];
  }
  function setBrush() {
    const c = fabricCanvas.current;
    if (!c) return;
    if (!c.freeDrawingBrush) c.freeDrawingBrush = new PencilBrush(c);
    c.isDrawingMode = true;
    c.freeDrawingBrush.color = color;
    c.freeDrawingBrush.width = width;
  }
  useEffect(setBrush, [color, width]);

  async function loadImage() {
    const ImageCtor: any = FabricImage || LegacyImage;
    const img = await ImageCtor.fromURL(
      `${info.url}${info.url.includes("?") ? "&" : "?"}t=${Date.now()}`,
    );
    const wrap = wrapRef.current;
    if (!wrap) return;
    const viewportW = Math.max(400, wrap.clientWidth - 40);
    const viewportH = Math.max(320, wrap.clientHeight - 40);
    imageScale.current = Math.min(
      1,
      viewportW / img.width,
      viewportH / img.height,
    );
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
      c.bringObjectToFront(e.path);
      e.path.setCoords();
      c.requestRenderAll();
    });
    setBrush();
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
      if (e.ctrlKey && e.key.toLowerCase() === "z") undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function undo() {
    const last = drawnObjects().at(-1);
    if (last) fabricCanvas.current.remove(last);
    fabricCanvas.current?.renderAll();
    setBrush();
  }
  function clear() {
    drawnObjects().forEach((o: any) => fabricCanvas.current.remove(o));
    fabricCanvas.current?.renderAll();
  }
  async function save(saveAsCopy = false) {
    const c = fabricCanvas.current;
    if (!c || !baseImage.current) return;
    const b = baseImage.current.getBoundingRect();
    const dataUrl = c.toDataURL({
      format: "png",
      quality: 1,
      multiplier: 1 / imageScale.current,
      left: b.left,
      top: b.top,
      width: b.width,
      height: b.height,
    });
    await window.betterSnip.saveAnnotation(dataUrl, saveAsCopy);
    window.betterSnip.closeWindow();
  }

  return (
    <section className="min-h-0 flex-1 flex flex-col bg-slate-50">
      <div className="shrink-0 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3">
        <label className="flex items-center gap-2 text-sm">
          Color{" "}
          <input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            type="color"
            className="h-8 w-10 rounded bg-transparent"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Thickness{" "}
          <input
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            type="range"
            min="2"
            max="40"
          />
          <span className="w-7">{width}</span>
        </label>
        <ToolbarButton onClick={undo}>
          <Icons.Undo />
          Undo
        </ToolbarButton>
        <ToolbarButton onClick={clear}>
          <Icons.Trash />
          Clear
        </ToolbarButton>
        <div className="grow" />
        <ToolbarButton onClick={() => window.betterSnip.closeWindow()}>
          <Icons.Close />
          Discard
        </ToolbarButton>
        <ToolbarButton onClick={() => save(true)} strong>
          <Icons.Copy />
          Save copy
        </ToolbarButton>
        <button
          onClick={() => save(false)}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-2 text-sm font-semibold"
        >
          <Icons.Save />
          Save
        </button>
      </div>
      <main
        ref={wrapRef}
        className="canvas-wrap min-h-0 flex-1 overflow-auto grid place-items-center p-5"
      >
        <canvas ref={canvasEl} />
      </main>
    </section>
  );
}
function ToolbarButton({
  children,
  onClick,
  strong,
}: {
  children: React.ReactNode;
  onClick: () => void;
  strong?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 px-4 py-2 text-sm ${strong ? "font-semibold" : "font-medium"}`}
    >
      {children}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(<AnnotateApp />);
