import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureInfo } from "../../../types";
import { Icons } from "../Icons";
import { GalleryThumbRail } from "./GalleryThumbRail";
import { VirtualGalleryGrid } from "./VirtualGalleryGrid";

export type GalleryViewMode = "strip" | "grid";

export function GallerySection({
  gallery,
  currentIndex,
  viewMode,
  onViewModeChange,
  onOpen,
  onRefresh,
  onBrowse,
}: {
  gallery: CaptureInfo[];
  currentIndex: number;
  viewMode: GalleryViewMode;
  onViewModeChange: (mode: GalleryViewMode) => void;
  onOpen: (index: number) => void;
  onRefresh: () => void;
  onBrowse: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const thumbMeasureRaf = useRef<number | null>(null);
  const [thumbPages, setThumbPages] = useState({ count: 0, current: 0 });

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
  }, [gallery.length, updateThumbPages, viewMode]);

  const scrollThumbnailsBy = useCallback((direction: number) => {
    const el = rowRef.current;
    if (!el) return;
    const thumb = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
    const step = thumb ? thumb.offsetWidth + gap : 160;
    const visibleSteps = Math.max(1, Math.floor(el.clientWidth / step) - 1);
    el.scrollBy({
      left: direction * step * visibleSteps,
      behavior: "smooth",
    });
  }, []);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-800">
            Recent gallery
          </h2>
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 text-base font-medium text-blue-600 hover:text-blue-700"
          >
            <Icons.Refresh className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-slate-200 bg-white/80 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => onViewModeChange("strip")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${viewMode === "strip" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Strip
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${viewMode === "grid" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Grid
            </button>
          </div>
          <button
            onClick={onBrowse}
            className="inline-flex items-center gap-2 text-base font-medium text-blue-600 hover:text-blue-700"
          >
            Browse Gallery <Icons.Image className="h-5 w-5" />
          </button>
        </div>
      </div>

      {viewMode === "strip" ? (
        <>
          <div className="relative px-14">
            <button
              onClick={() => scrollThumbnailsBy(-1)}
              className="absolute left-0 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-900 shadow-lg hover:bg-slate-50"
            >
              <Icons.ChevronLeft className="h-6 w-6" />
            </button>
            <div className="gallery-fade relative overflow-hidden">
              <GalleryThumbRail
                gallery={gallery.slice(0, 30)}
                currentIndex={currentIndex}
                onOpen={onOpen}
                containerRef={rowRef}
                size="medium"
                className="min-h-[118px] gap-5 px-2 pt-1"
                onScroll={updateThumbPages}
                stopWheelPropagation={false}
              />
            </div>
            <button
              onClick={() => scrollThumbnailsBy(1)}
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
        </>
      ) : (
        <VirtualGalleryGrid
          gallery={gallery}
          currentIndex={currentIndex}
          onOpen={onOpen}
        />
      )}

      {!gallery.length && (
        <p className="text-sm text-slate-500">No screenshots found yet.</p>
      )}
    </section>
  );
}
