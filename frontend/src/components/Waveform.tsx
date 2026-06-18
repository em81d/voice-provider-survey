// frontend/src/components/Waveform.tsx
//
// Extracted from AIChat.tsx's useWaveform hook + canvas. Originally driven
// by an imperative setWaveState(...) call scattered through the WS
// handlers; here it just reacts to a `level` prop so VoiceCall.tsx can pass
// connectionState/waveLevel straight through without holding a ref to this
// component. Also drops the per-provider color theming — there's no
// provider to theme around anymore, so it's a single neutral accent.

import { useEffect, useRef } from "react";
import type { WaveLevel } from "../types/ws";

const ACCENT = "#4B5563"; // neutral slate — no provider identity to color against

interface WaveformProps {
  level: WaveLevel;
}

export function Waveform({ level }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef<WaveLevel>(level);
  const phaseRef = useRef(0);
  const ampRef = useRef(0.06);
  const targetRef = useRef(0.06);
  const rafRef = useRef<number | null>(null);

  // Keep the rAF loop reading current `level` without restarting the loop
  // on every prop change.
  useEffect(() => {
    levelRef.current = level;
    targetRef.current = level === "active" ? 0.52 : level === "loading" ? 0.16 : 0.06;
  }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      ctx.clearRect(0, 0, W, H);

      const active = levelRef.current !== "idle";
      ampRef.current += (targetRef.current - ampRef.current) * 0.055;
      phaseRef.current += active ? 0.07 : 0.02;

      const bars = 48;
      const barW = 3;
      const gap = (W - bars * barW) / (bars + 1);
      const midY = H / 2;

      for (let i = 0; i < bars; i++) {
        const x = gap + i * (barW + gap);
        const env = Math.sin((i / (bars - 1)) * Math.PI);
        const wave = active
          ? Math.sin(i * 0.55 + phaseRef.current) * 0.5 +
            Math.sin(i * 1.35 + phaseRef.current * 1.4) * 0.3 +
            Math.sin(i * 2.2 + phaseRef.current * 0.8) * 0.2
          : Math.sin(i * 0.38 + phaseRef.current) * 0.5;

        const h = Math.max(2, Math.abs(wave) * env * ampRef.current * H);
        const alpha = 0.18 + Math.abs(wave) * 0.7;

        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.roundRect(x, midY - h, barW, h * 2, barW / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: 30 }} />;
}