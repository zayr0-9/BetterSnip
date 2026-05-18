import React from "react";
import type { CaptureInfo } from "../../../types";
import { GalleryThumb, type GalleryThumbSize } from "./GalleryThumb";

export function GalleryThumbRail({
  gallery,
  currentIndex,
  onOpen,
  containerRef,
  size = "small",
  className = "",
  onScroll,
  stopWheelPropagation = true,
  scrollBehavior,
}: {
  gallery: CaptureInfo[];
  currentIndex: number;
  onOpen: (index: number) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  size?: GalleryThumbSize;
  className?: string;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  stopWheelPropagation?: boolean;
  scrollBehavior?: React.CSSProperties["scrollBehavior"];
}) {
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      onWheel={stopWheelPropagation ? (e) => e.stopPropagation() : undefined}
      style={scrollBehavior ? { scrollBehavior } : undefined}
      className={`gallery-scroll flex overflow-x-auto overscroll-contain pt-2 pb-4 ${className}`}
    >
      {gallery.map((item, index) => (
        <GalleryThumb
          key={item.path}
          item={item}
          active={index === currentIndex}
          size={size}
          onClick={() => onOpen(index)}
        />
      ))}
    </div>
  );
}
