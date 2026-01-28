import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";

type FpsOverlayProps = {
  enabled?: boolean;
};

export function FpsOverlay({ enabled = true }: FpsOverlayProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef<number[]>([]);
  const framesRef = useRef(0);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.top = "38px";
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
    label.textContent = "FPS: -- | min -- | max --";
    label.style.marginBottom = "4px";
    el.appendChild(label);

    const canvas = document.createElement("canvas");
    canvas.width = 140;
    canvas.height = 40;
    canvas.style.display = "block";
    el.appendChild(canvas);

    document.body.appendChild(el);
    elRef.current = el;
    canvasRef.current = canvas;
    return () => {
      if (el.parentElement) el.parentElement.removeChild(el);
      elRef.current = null;
      canvasRef.current = null;
    };
  }, [enabled]);

  useFrame((_state, delta) => {
    if (!enabled || !elRef.current) return;
    framesRef.current += 1;
    elapsedRef.current += Math.max(0, delta);
    if (elapsedRef.current >= 0.1) {
      const fps = framesRef.current / Math.max(0.0001, elapsedRef.current);
      const label = elRef.current.firstElementChild as HTMLDivElement | null;
      const samples = samplesRef.current;
      samples.push(fps);
      const maxSamples = 60;
      if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);
      const minFps = Math.min(...samples);
      const maxFps = Math.max(...samples);
      if (label) {
        label.textContent = `FPS: ${fps.toFixed(1)} | min ${minFps.toFixed(1)} | max ${maxFps.toFixed(1)}`;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "rgba(255,255,255,0.1)";
          ctx.fillRect(0, 0, w, h);

          const maxFps = 120;
          ctx.strokeStyle = "rgba(0,255,120,0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < samples.length; i++) {
            const x = (i / Math.max(1, maxSamples - 1)) * (w - 2) + 1;
            const v = Math.min(maxFps, Math.max(0, samples[i]));
            const y = h - 1 - (v / maxFps) * (h - 2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      framesRef.current = 0;
      elapsedRef.current = 0;
    }
  });

  return null;
}
