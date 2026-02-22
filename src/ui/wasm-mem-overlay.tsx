import { useEffect, useRef } from "react";
import type { ZenKit } from "@kolarz3/zenkit";

type WasmMemOverlayProps = {
  enabled?: boolean;
  zenKit: ZenKit | null;
};

export function WasmMemOverlay({ enabled = true, zenKit }: WasmMemOverlayProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef<number[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.top = "90px";
    el.style.right = "8px";
    el.style.padding = "6px 8px";
    el.style.background = "rgba(0,0,0,0.65)";
    el.style.color = "#fff";
    el.style.fontFamily = "monospace";
    el.style.fontSize = "12px";
    el.style.borderRadius = "4px";
    el.style.pointerEvents = "none";
    el.style.zIndex = "1001";

    const label = document.createElement("div");
    label.textContent = "WASM heap: -- MB";
    label.style.marginBottom = "4px";
    el.appendChild(label);

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 40;
    canvas.style.display = "block";
    el.appendChild(canvas);

    document.body.appendChild(el);
    elRef.current = el;
    canvasRef.current = canvas;

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (el.parentElement) el.parentElement.removeChild(el);
      elRef.current = null;
      canvasRef.current = null;
      samplesRef.current = [];
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !elRef.current) return;
    const maxSamples = 90;
    const label = elRef.current.firstElementChild as HTMLDivElement | null;

    const tick = () => {
      const wasmHeapBytes = (zenKit as any)?.HEAPU8?.buffer?.byteLength;
      const mb = typeof wasmHeapBytes === "number" ? wasmHeapBytes / 1024 / 1024 : NaN;
      if (!Number.isFinite(mb)) {
        if (label) label.textContent = "WASM heap: unavailable";
        return;
      }

      const samples = samplesRef.current;
      samples.push(mb);
      if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);

      const minMb = Math.min(...samples);
      const maxMb = Math.max(...samples);
      if (label) {
        label.textContent = `WASM heap: ${mb.toFixed(1)} MB | min ${minMb.toFixed(1)} | max ${maxMb.toFixed(1)}`;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(0, 0, w, h);

      const top = Math.max(256, Math.ceil(maxMb / 256) * 256);
      ctx.strokeStyle = "rgba(80,200,255,0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = (i / Math.max(1, maxSamples - 1)) * (w - 2) + 1;
        const v = Math.min(top, Math.max(0, samples[i]));
        const y = h - 1 - (v / top) * (h - 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    tick();
    timerRef.current = window.setInterval(tick, 500);
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, zenKit]);

  return null;
}
