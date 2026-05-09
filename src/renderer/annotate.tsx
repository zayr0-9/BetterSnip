import React, { useEffect, useRef, useState } from "react";
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
  return (
    <section className="min-h-0 flex-1 flex flex-col bg-neutral-50">
      <div className="shrink-0 flex items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 py-3">
        {/* <div className="text-sm font-semibold">Video preview</div> */}
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
