import React from "react";

export function Icon({
  children,
  className = "h-4 w-4",
  viewBox = "0 0 24 24",
  fill = "none",
}: {
  children: React.ReactNode;
  className?: string;
  viewBox?: string;
  fill?: string;
}) {
  return (
    <svg
      className={`pointer-events-none ${className}`}
      viewBox={viewBox}
      fill={fill}
      stroke={fill === "none" ? "currentColor" : undefined}
      strokeWidth={fill === "none" ? 2 : undefined}
      strokeLinecap={fill === "none" ? "round" : undefined}
      strokeLinejoin={fill === "none" ? "round" : undefined}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  Minimize: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M5 12h14" />
    </Icon>
  ),
  Maximize: (p: { className?: string }) => (
    <Icon {...p}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </Icon>
  ),
  Close: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  ),
  Scissors: (p: { className?: string }) => (
    <Icon {...p} viewBox="0 0 64 64" fill="none">
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#ff2f36" stroke="none" />
      <path d="M18 25v-4a4 4 0 0 1 4-4h6" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34 17h6" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <path d="M44 17a4 4 0 0 1 4 4v6" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 31v6" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <path d="M18 43a4 4 0 0 0 4 4h6" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34 47h6" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <path d="M48 33v4" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <path d="M48 39v14" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <path d="M41 46h14" stroke="white" strokeWidth="4" strokeLinecap="round" />
    </Icon>
  ),
  Folder: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Icon>
  ),
  Image: (p: { className?: string }) => (
    <Icon {...p}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </Icon>
  ),
  Refresh: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </Icon>
  ),
  ChevronLeft: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  ),
  ChevronRight: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  ),
  ChevronDown: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  ),
  Sparkle: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </Icon>
  ),
  Keyboard: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M10 8h.01" />
      <path d="M12 12h.01" />
      <path d="M14 8h.01" />
      <path d="M16 12h.01" />
      <path d="M18 8h.01" />
      <path d="M6 8h.01" />
      <path d="M7 16h10" />
      <rect width="20" height="16" x="2" y="4" rx="2" />
    </Icon>
  ),
  Save: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </Icon>
  ),
  Play: (p: { className?: string }) => (
    <Icon {...p}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </Icon>
  ),
  Edit: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  ),
  Undo: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  ),
  Trash: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </Icon>
  ),
  Copy: (p: { className?: string }) => (
    <Icon {...p}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Icon>
  ),
  External: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Icon>
  ),
  Check: (p: { className?: string }) => (
    <Icon {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  ),
};
