import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const params = new URLSearchParams(location.search);
const view = params.get("view") || "controls";

function RecordingBorder() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent pointer-events-none select-none">
      <div className="absolute inset-0 border-2 border-dashed border-red-500 pointer-events-none" />
    </div>
  );
}

function RecordingControls() {
  const [elapsed, setElapsed] = useState(0);
  const stopped = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const stopHandler = () => stop();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.betterSnip.onRecordingStop(stopHandler);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  function stop() {
    if (stopped.current) return;
    stopped.current = true;
    window.betterSnip.stopRecording();
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent select-none">
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex items-center gap-2 rounded-full bg-zinc-950/90 px-3 py-2 text-white shadow-lg">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <button
            onClick={stop}
            title="Stop"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/15"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
          <span className="min-w-12 text-xs font-semibold">
            {mm}:{ss}
          </span>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  view === "border" ? <RecordingBorder /> : <RecordingControls />,
);
