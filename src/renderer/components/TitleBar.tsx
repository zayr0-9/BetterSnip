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
        className="grid h-8 w-10 place-items-center rounded-lg hover:bg-neutral-200/50"
      >
        <Icons.Minimize />
      </button>
      <button
        onClick={() => window.betterSnip.maximizeWindow()}
        title="Maximize"
        className="grid h-8 w-10 place-items-center rounded-lg hover:bg-neutral-200/50"
      >
        <Icons.Maximize />
      </button>
      <button
        onClick={() => window.betterSnip.closeWindow()}
        title="Close"
        className="grid h-8 w-10 place-items-center rounded-lg hover:bg-red-500 hover:text-white"
      >
        <Icons.Close />
      </button>
    </div>
  );
}
