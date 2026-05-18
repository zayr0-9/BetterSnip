import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CaptureInfo } from "../../../types";
import { Icons } from "../Icons";
import { GalleryThumbRail } from "./GalleryThumbRail";

export function GalleryLightbox({
  open,
  gallery,
  currentIndex,
  deleteConfirmOpen,
  skipDeleteConfirm,
  onClose,
  onIndexChange,
  onMove,
  onEdit,
  onCopy,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onSkipDeleteConfirmChange,
}: {
  open: boolean;
  gallery: CaptureInfo[];
  currentIndex: number;
  deleteConfirmOpen: boolean;
  skipDeleteConfirm: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onMove: (delta: number) => void;
  onEdit: (item: CaptureInfo) => void | Promise<void>;
  onCopy: (item: CaptureInfo) => void | Promise<void>;
  onRequestDelete: () => void;
  onConfirmDelete: () => void | Promise<void>;
  onCancelDelete: () => void;
  onSkipDeleteConfirmChange: (skip: boolean) => void;
}) {
  const [swipeX, setSwipeX] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const modalThumbsRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const item = gallery[currentIndex];

  const centerModalThumb = useCallback(
    (index = currentIndex) => {
      const rail = modalThumbsRef.current;
      const thumb = rail?.children[index] as HTMLElement | undefined;
      if (!rail || !thumb) return;

      rail.scrollLeft =
        thumb.offsetLeft - (rail.clientWidth - thumb.offsetWidth) / 2;
    },
    [currentIndex],
  );

  const moveAndCenter = useCallback(
    (delta: number) => {
      if (!gallery.length) return;
      onMove(delta);
      const next = (currentIndex + delta + gallery.length) % gallery.length;
      requestAnimationFrame(() => centerModalThumb(next));
    },
    [centerModalThumb, currentIndex, gallery.length, onMove],
  );

  useLayoutEffect(() => {
    if (open) centerModalThumb();
  }, [open, currentIndex, centerModalThumb]);

  useEffect(() => {
    if (!open || !item || item.type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.src = item.url;
    v.load();
    v.play().catch(() => {});
  }, [open, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        if (infoOpen) setInfoOpen(false);
        else onClose();
      }
      if (infoOpen) return;
      if (e.key === "ArrowLeft") moveAndCenter(-1);
      if (e.key === "ArrowRight") moveAndCenter(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoOpen, moveAndCenter, onClose, open]);

  useEffect(() => {
    if (!open) setInfoOpen(false);
  }, [open]);

  const formatBytes = (bytes?: number) => {
    if (!Number.isFinite(bytes || NaN) || !bytes) return "Unknown";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024)),
    );
    const value = bytes / 1024 ** index;
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  };

  const formatDate = (mtime?: number) =>
    mtime
      ? new Date(mtime).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "medium",
        })
      : "Unknown";

  const extension = item?.name.includes(".")
    ? item.name.split(".").pop()?.toUpperCase()
    : undefined;
  const metadataRows = item
    ? [
        ["Name", item.name],
        ["Type", item.type === "video" ? "Video" : "Image"],
        ["Format", extension || "Unknown"],
        ["Size", formatBytes(item.size)],
        ["Modified", formatDate(item.mtime)],
        ["Path", item.path],
      ]
    : [];

  if (!open || !item) return null;

  return (
    <div className="no-drag fixed inset-0 z-50 bg-black/95 text-white">
      <button
        onClick={() => {
          videoRef.current?.pause();
          onClose();
        }}
        className="no-drag absolute right-4 top-4 z-40 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-slate-950/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition-transform hover:bg-slate-950/55 hover:scale-105"
        title="Close"
      >
        <Icons.Close className="h-5 w-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
      </button>
      <button
        onClick={() => void onEdit(item)}
        className="no-drag absolute right-16 top-4 z-40 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-slate-950/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition-transform hover:bg-slate-950/55 hover:scale-105"
        title="Edit"
      >
        <Icons.Edit className="h-5 w-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
      </button>
      <button
        onClick={async () => {
          await onCopy(item);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        className="no-drag absolute right-28 top-4 z-40 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-slate-950/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition-transform hover:bg-slate-950/55 hover:scale-105"
        title={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? (
          <Icons.Check className="h-5 w-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
        ) : (
          <Icons.Copy className="h-5 w-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
        )}
      </button>
      <button
        onClick={() => setInfoOpen(true)}
        className="no-drag absolute right-40 top-4 z-40 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-slate-950/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition-transform hover:bg-slate-950/55 hover:scale-105"
        title="File info"
      >
        <Icons.Info className="h-5 w-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
      </button>
      <button
        onClick={onRequestDelete}
        className="no-drag absolute right-52 top-4 z-40 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-slate-950/35 text-red-100 shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition-transform hover:bg-red-500/35 hover:scale-105"
        title="Delete"
      >
        <Icons.Trash className="h-5 w-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
      </button>
      {infoOpen && (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-black/25 px-4 backdrop-blur-md"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="relative w-full max-w-lg rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setInfoOpen(false)}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
              title="Close file info"
            >
              <Icons.Close className="h-4 w-4" />
            </button>
            <div className="pr-12">
              <h3 className="text-xl font-semibold">File info</h3>
              <p className="mt-1 truncate text-sm text-slate-300">{item.name}</p>
            </div>
            <div className="mt-6 space-y-3">
              {metadataRows.map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[92px_1fr] gap-4 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm"
                >
                  <div className="font-medium text-slate-300">{label}</div>
                  <div className="break-words text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {deleteConfirmOpen && (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-black/25 px-4 backdrop-blur-md"
          onClick={onCancelDelete}
        >
          <div
            className="delete-confirm-card relative w-full max-w-md rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onCancelDelete}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
              title="Cancel delete"
            >
              <Icons.Close className="h-4 w-4" />
            </button>
            <div className="pr-12">
              <h3 className="text-xl font-semibold">Delete this capture?</h3>
              <p className="mt-2 break-words text-sm text-slate-300">
                This will permanently delete {item.name}.
              </p>
            </div>
            <label className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={skipDeleteConfirm}
                onChange={(e) => onSkipDeleteConfirmChange(e.target.checked)}
                className="h-4 w-4 rounded accent-red-500"
              />
              <span>Don't ask me again this session</span>
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onCancelDelete}
                className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={() => void onConfirmDelete()}
                className="rounded-xl border border-red-300/30 bg-red-500/80 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => moveAndCenter(-1)}
        className="no-drag absolute left-4 top-1/2 z-40 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition-transform hover:bg-slate-950/55 hover:scale-105"
        title="Previous"
      >
        <Icons.ChevronLeft className="h-8 w-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
      </button>
      <button
        onClick={() => moveAndCenter(1)}
        className="no-drag absolute right-4 top-1/2 z-40 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/35 text-white shadow-2xl shadow-black/40 backdrop-blur-xl ring-1 ring-black/20 transition-transform hover:bg-slate-950/55 hover:scale-105"
        title="Next"
      >
        <Icons.ChevronRight className="h-8 w-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]" />
      </button>
      <div
        onPointerDown={(e) => setSwipeX(e.clientX)}
        onPointerUp={(e) => {
          if (swipeX !== null && Math.abs(e.clientX - swipeX) > 50)
            onMove(e.clientX < swipeX ? 1 : -1);
          setSwipeX(null);
        }}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY))
            onMove(e.deltaX > 0 ? 1 : -1);
        }}
        className="relative z-10 flex h-full flex-col"
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
            {currentIndex + 1} / {gallery.length} — {item.name}
          </p>
          <GalleryThumbRail
            gallery={gallery}
            currentIndex={currentIndex}
            onOpen={onIndexChange}
            containerRef={modalThumbsRef}
            size="small"
            className="gap-3 px-[45%]"
            scrollBehavior="auto"
          />
        </div>
      </div>
    </div>
  );
}
