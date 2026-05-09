import React from "react";
import { Icons } from "./Icons";

export function TitleBar({ title }: { title: React.ReactNode }) {
  return (
    <header className="transparent-titlebar drag-region h-12 shrink-0 flex items-center justify-between border-b border-transparent bg-transparent px-4 shadow-none">
      <div className="flex items-center gap-2 font-semibold truncate">
        <span className="truncate">{title}</span>
      </div>
      <WindowButtons />
    </header>
  );
}

function WindowButtons() {
  return (
    <div className="no-drag flex items-center gap-1">
      <button
        onClick={() => window.betterSnip.minimizeWindow()}
        title="Minimize"
        className="grid h-8 w-8 place-items-center rounded-full shadow-[0_0_6px_rgba(0,0,0,0.12)] hover:bg-neutral-200/50"
      >
        <Icons.Minimize className="h-5 w-5" />
      </button>
      <button
        onClick={() => window.betterSnip.maximizeWindow()}
        title="Maximize"
        className="grid h-8 w-8 place-items-center rounded-full shadow-[0_0_6px_rgba(0,0,0,0.12)] hover:bg-neutral-200/50"
      >
        <Icons.Maximize className="h-5 w-5" />
      </button>
      <button
        onClick={() => window.betterSnip.closeWindow()}
        title="Close"
        className="grid h-8 w-8 place-items-center rounded-full shadow-[0_0_6px_rgba(0,0,0,0.12)] hover:bg-neutral-200/50"
      >
        <Icons.Close className="h-5 w-5" />
      </button>
    </div>
  );
}
