import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureInfo } from "../../../types";
import { GalleryThumb } from "./GalleryThumb";

const GRID_HEIGHT = 420;
const MIN_CARD_WIDTH = 170;
const GAP = 16;
const GRID_PADDING = 8;
const TEXT_HEIGHT = 16;
const TEXT_GAP = 8;
const OVERSCAN_ROWS = 2;

export function VirtualGalleryGrid({
  gallery,
  currentIndex,
  onOpen,
}: {
  gallery: CaptureInfo[];
  currentIndex: number;
  onOpen: (index: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const updateWidth = () => setWidth(el.clientWidth);
    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  const layout = useMemo(() => {
    const availableWidth = Math.max(1, width - GRID_PADDING * 2);
    const columns = Math.max(
      1,
      Math.floor((availableWidth + GAP) / (MIN_CARD_WIDTH + GAP)),
    );
    const cardWidth = Math.floor(
      (availableWidth - GAP * (columns - 1)) / columns,
    );
    const thumbHeight = Math.round((cardWidth * 9) / 16);
    const cardHeight = thumbHeight + TEXT_GAP + TEXT_HEIGHT;
    const rowHeight = cardHeight + GAP;
    const rowCount = Math.ceil(gallery.length / columns);

    return { columns, cardWidth, thumbHeight, cardHeight, rowHeight, rowCount };
  }, [gallery.length, width]);

  const onScroll = useCallback(() => {
    if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      setScrollTop(scrollerRef.current?.scrollTop ?? 0);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  const visible = useMemo(() => {
    const firstRow = Math.max(
      0,
      Math.floor(scrollTop / layout.rowHeight) - OVERSCAN_ROWS,
    );
    const lastRow = Math.min(
      layout.rowCount - 1,
      Math.ceil((scrollTop + GRID_HEIGHT) / layout.rowHeight) + OVERSCAN_ROWS,
    );
    const start = firstRow * layout.columns;
    const end = Math.min(gallery.length, (lastRow + 1) * layout.columns);
    return gallery.slice(start, end).map((item, offset) => {
      const index = start + offset;
      const row = Math.floor(index / layout.columns);
      const column = index % layout.columns;
      return {
        item,
        index,
        top: GRID_PADDING + row * layout.rowHeight,
        left: GRID_PADDING + column * (layout.cardWidth + GAP),
      };
    });
  }, [gallery, layout, scrollTop]);

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="gallery-scroll max-h-[420px] overflow-y-auto pr-1"
      style={{ height: gallery.length ? GRID_HEIGHT : undefined }}
    >
      <div
        className="relative"
        style={{ height: Math.max(0, layout.rowCount * layout.rowHeight - GAP + GRID_PADDING * 2) }}
      >
        {visible.map(({ item, index, top, left }) => (
          <div
            key={item.path}
            className="absolute min-w-0 space-y-2"
            style={{
              top,
              left,
              width: layout.cardWidth,
              height: layout.cardHeight,
            }}
          >
            <GalleryThumb
              item={item}
              active={index === currentIndex}
              size="grid"
              onClick={() => onOpen(index)}
            />
            <p className="truncate text-xs leading-4 text-slate-500" title={item.name}>
              {item.name}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
