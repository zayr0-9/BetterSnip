import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function RecorderApp() {
  const previewRef = useRef<HTMLVideoElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const stopped = useRef(false);
  const resources = useRef<{
    media?: MediaStream;
    canvas?: MediaStream;
    recorder?: MediaRecorder;
    raf?: number;
    chunks: Blob[];
  }>({ chunks: [] });

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    start().catch(async (err) => {
      console.error(err);
      alert(err instanceof Error ? err.message : String(err));
      await window.betterSnip.cancelRecording?.();
    });
    const stopHandler = () => stop();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.betterSnip.onRecordingStop(stopHandler);
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", cleanup);
      cleanup();
    };
  }, []);

  function cleanup() {
    const r = resources.current;
    if (r.raf) cancelAnimationFrame(r.raf);
    r.media?.getTracks().forEach((t) => t.stop());
    r.canvas?.getTracks().forEach((t) => t.stop());
  }
  function stop() {
    const r = resources.current;
    if (stopped.current) return;
    stopped.current = true;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.recorder?.state === "recording") {
      r.recorder.requestData();
      r.recorder.stop();
    } else {
      cleanup();
      window.betterSnip.closeWindow();
    }
  }

  async function start() {
    const job = await window.betterSnip.getRecordingJob();
    if (!job) throw new Error("No recording job found.");
    const media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: job.sourceId,
          minFrameRate: 30,
          maxFrameRate: 30,
        },
      } as MediaTrackConstraints,
    });
    resources.current.media = media;
    const video = previewRef.current!;
    video.srcObject = media;
    video.muted = true;
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve();
      video.play().catch(() => resolve());
    });
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = job.crop.width;
    canvas.height = job.crop.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create recording canvas.");
    const draw = () => {
      ctx.drawImage(
        video,
        job.crop.x,
        job.crop.y,
        job.crop.width,
        job.crop.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      resources.current.raf = requestAnimationFrame(draw);
    };
    draw();
    const canvasStream = canvas.captureStream(30);
    resources.current.canvas = canvasStream;
    const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp8")
      ? "video/webm; codecs=vp8"
      : "video/webm";
    const recorder = new MediaRecorder(canvasStream, { mimeType });
    resources.current.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) resources.current.chunks.push(e.data);
    };
    recorder.onstop = async () => {
      cleanup();
      const blob = new Blob(resources.current.chunks, { type: "video/webm" });
      await window.betterSnip.saveRecording(await blob.arrayBuffer());
      window.betterSnip.closeWindow();
    };
    recorder.start(250);
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent select-none">
      <div className="absolute top-1 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-zinc-950/90 px-3 py-2 text-white shadow-lg">
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
      <video
        ref={previewRef}
        className="absolute -left-[10000px] -top-[10000px] h-px w-px opacity-0"
        muted
        autoPlay
      />
      <div className="absolute left-0 right-0 bottom-0 top-[52px] border-2 border-dashed border-red-500 pointer-events-none" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<RecorderApp />);
