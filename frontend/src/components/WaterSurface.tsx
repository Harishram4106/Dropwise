"use client";

import { useEffect, useRef, type RefObject } from "react";

type Drop = { x: number; y: number; vy: number };

/**
 * A springy 1-D water surface drawn on a canvas. Moving the cursor across the
 * host element stirs it; clicking drops a droplet that splashes in.
 */
export default function WaterSurface({ host, height = 240 }: { host: RefObject<HTMLElement | null>; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hostEl = host.current;
    if (!canvas || !hostEl) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const N = 140;
    const h = new Float32Array(N);
    const v = new Float32Array(N);
    const drops: Drop[] = [];
    let width = 0;
    let dpr = 1;
    let raf = 0;
    let running = false;
    let lastX: number | null = null;
    let t = 0;
    const REST = height * 0.42; // water line, from the top of the canvas

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const col = (x: number) => Math.max(0, Math.min(N - 1, Math.round((x / width) * (N - 1))));
    const poke = (x: number, force: number) => {
      const c = col(x);
      for (let k = -2; k <= 2; k++) {
        const i = c + k;
        if (i >= 0 && i < N) v[i] += force * (1 - Math.abs(k) * 0.3);
      }
    };

    const step = () => {
      t += 1;
      for (let i = 0; i < N; i++) {
        // gentle idle swell so the surface is never perfectly still
        const swell = Math.sin(t * 0.02 + i * 0.18) * 0.06;
        v[i] += -0.025 * h[i] - 0.03 * v[i] + swell;
      }
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < N; i++) {
          if (i > 0) v[i] += 0.12 * (h[i - 1] - h[i]);
          if (i < N - 1) v[i] += 0.12 * (h[i + 1] - h[i]);
        }
      }
      for (let i = 0; i < N; i++) h[i] += v[i];

      for (let d = drops.length - 1; d >= 0; d--) {
        const drop = drops[d];
        drop.vy += 0.5;
        drop.y += drop.vy;
        const surface = REST + h[col(drop.x)];
        if (drop.y >= surface) {
          poke(drop.x, 14);
          drops.splice(d, 1);
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const pts: [number, number][] = [];
      for (let i = 0; i < N; i++) pts.push([(i / (N - 1)) * width, REST + h[i]]);

      // back layer for depth
      ctx.beginPath();
      ctx.moveTo(0, height);
      pts.forEach(([x, y], i) => ctx.lineTo(x, y + 10 - h[i] * 0.4 + Math.sin(t * 0.015 + i * 0.25) * 3));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = "rgba(160, 188, 255, 0.10)";
      ctx.fill();

      // main body
      const g = ctx.createLinearGradient(0, REST - 20, 0, height);
      g.addColorStop(0, "rgba(200, 216, 255, 0.28)");
      g.addColorStop(1, "rgba(120, 150, 255, 0.04)");
      ctx.beginPath();
      ctx.moveTo(0, height);
      pts.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();

      // crest line
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = "rgba(235, 242, 255, 0.75)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // droplets
      ctx.fillStyle = "#e6eeff";
      drops.forEach((d) => {
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, 3.2, 4.6, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const loop = () => {
      step();
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduce) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);
      if (lastX !== null && y > -200) {
        const speed = Math.max(-30, Math.min(30, x - lastX));
        poke(x, Math.abs(speed) * 0.35 * (y > REST - 60 ? 1 : 0.4));
      }
      lastX = x;
    };
    const onLeave = () => {
      lastX = null;
    };
    const onClick = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("a,button")) return;
      const { x, y } = local(e);
      drops.push({ x, y: Math.min(y, REST - 10), vy: 0 });
      if (drops.length > 12) drops.shift();
    };

    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()), { threshold: 0 });
    io.observe(canvas);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    hostEl.addEventListener("pointermove", onMove);
    hostEl.addEventListener("pointerleave", onLeave);
    hostEl.addEventListener("pointerdown", onClick);
    resize();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      hostEl.removeEventListener("pointermove", onMove);
      hostEl.removeEventListener("pointerleave", onLeave);
      hostEl.removeEventListener("pointerdown", onClick);
    };
  }, [host, height]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 w-full" style={{ height }} />;
}
