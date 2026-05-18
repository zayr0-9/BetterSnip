import React from "react";
import type { CaptureInfo } from "../../../types";
import { Icons } from "../Icons";

export type GalleryThumbSize = "small" | "medium" | "grid";

const sizeClasses: Record<GalleryThumbSize, string> = {
  small: "h-16 w-24",
  medium: "h-[96px] w-[136px]",
  grid: "aspect-video w-full",
};

export function GalleryThumb({
  item,
  active,
  size = "medium",
  onClick,
}: {
  item: CaptureInfo;
  active: boolean;
  size?: GalleryThumbSize;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.name}
      className={`${sizeClasses[size]} shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm ${active ? "thumb-current" : ""}`}
    >
      {item.type === "video" ? (
        <VideoThumb item={item} />
      ) : (
        <img
          src={item.thumbUrl || item.url}
          className="h-full w-full object-cover"
          alt={item.name}
          loading="lazy"
          decoding="async"
        />
      )}
    </button>
  );
}

function VideoThumb({ item }: { item: CaptureInfo }) {
  return (
    <div className="relative h-full w-full bg-slate-900 text-white">
      {item.thumbUrl ? (
        <img
          src={item.thumbUrl}
          className="h-full w-full object-cover"
          alt={item.name}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-slate-800 to-slate-950">
          <Icons.Image className="h-8 w-8 text-slate-500" />
        </div>
      )}
      <div className="absolute inset-0 grid place-items-center bg-black/20">
        <Icons.Play className="h-7 w-7 drop-shadow" />
      </div>
      <div className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px]">
        {item.name}
      </div>
    </div>
  );
}
