"use client";

// The Overview hero's water: the landing page's springy surface, fed by the gateway.
// Every new request falls in as a droplet sized by its estimated water. A request the cache answered
// never lands: it evaporates at the dashed line, which marks where the water would sit without Dropwise.
// The cursor stirs the surface and a click drops a droplet, as on the landing page.

import { type RefObject, useEffect, useRef } from "react";

export type DropKind = "call" | "small" | "hit" | "bypass";
export interface WaterDrop {
  id: string;
  /** 0..1 across the width. */
  x: number;
  /** Estimated water (high end, mL), for the droplet's size. */
  ml: number;
  kind: DropKind;
}

const COLORS: Record<DropKind, string> = {
  call: "#e6eeff",
  small: "#b9c8ff",
  hit: "#9dffb4",
  bypass: "#ffd28f",
};

type Falling = { x: number; y: number; vy: number; r: number; kind: DropKind };
type Puff = { x: number; y: number; t: number; color: string };

export default function LiveWater({
  host,
  drops,
  level,
  ghost,
  height = 300,
}: {
  host: RefObject<HTMLElement | null>;
  drops: WaterDrop[];
  /** How full the water is, 0..1 of the canvas height. */
  level: number;
  /** Where it would be without Dropwise (0..1), drawn as a dashed line; null hides it. */
  ghost: number | null;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const queue = useRef<Falling[]>([]);
  const target = useRef({ level, ghost });
  const seen = useRef<Set<string> | null>(null);
  const widthRef = useRef(0);

  useEffect(() => {
    target.current = { level, ghost };
  }, [level, ghost]);

  // New requests become droplets. The first batch (what was already there on load) only seeds the
  // water level, apart from the newest few, so the page opens with a little rain rather than a flood.
  useEffect(() => {
    const fresh = drops.filter((d) => !seen.current?.has(d.id));
    const first = seen.current === null;
    seen.current = new Set(drops.map((d) => d.id));
    const batch = first ? fresh.slice(0, 3) : fresh;
    batch.forEach((d, i) => {
      const w = widthRef.current || 1000;
      queue.current.push({
        x: (0.06 + d.x * 0.88) * w,
        y: -20 - i * 70,
        vy: 0,
        r: Math.min(7.5, 2.6 + Math.sqrt(Math.max(0, d.ml)) * 1.5),
        kind: d.kind,
      });
    });
    if (queue.current.length > 24) queue.current.splice(0, queue.current.length - 24);
  }, [drops]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hostEl = host.current;
    if (!canvas || !hostEl) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const N = 160;
    const h = new Float32Array(N);
    const v = new Float32Array(N);
    const puffs: Puff[] = [];
    let width = 0;
    let raf = 0;
    let running = false;
    let lastX: number | null = null;
    let t = 0;
    let lvl = target.current.level;
    let gh = target.current.ghost ?? lvl;

    const restY = () => height * (1 - lvl);
    const ghostY = () => height * (1 - gh);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      widthRef.current = width;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const col = (x: number) => Math.max(0, Math.min(N - 1, Math.round((x / width) * (N - 1))));
    const poke = (x: number, force: number) => {
      const c = col(x);
      for (let k = -3; k <= 3; k++) {
        const i = c + k;
        if (i >= 0 && i < N) v[i] += force * (1 - Math.abs(k) * 0.22);
      }
    };

    const step = () => {
      t += 1;
      // Ease the water toward its target level, so a cache hit visibly keeps it lower.
      lvl += (target.current.level - lvl) * 0.03;
      const g = target.current.ghost;
      gh += ((g ?? lvl) - gh) * 0.03;

      for (let i = 0; i < N; i++) {
        const swell = Math.sin(t * 0.02 + i * 0.16) * 0.06;
        v[i] += -0.025 * h[i] - 0.03 * v[i] + swell;
      }
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < N; i++) {
          if (i > 0) v[i] += 0.12 * (h[i - 1] - h[i]);
          if (i < N - 1) v[i] += 0.12 * (h[i + 1] - h[i]);
        }
      }
      for (let i = 0; i < N; i++) h[i] += v[i];

      const q = queue.current;
      for (let d = q.length - 1; d >= 0; d--) {
        const drop = q[d];
        drop.vy += 0.42;
        drop.y += drop.vy;
        if (drop.kind === "hit" && drop.y >= ghostY() - 6) {
          puffs.push({ x: drop.x, y: ghostY() - 6, t: 0, color: COLORS.hit });
          q.splice(d, 1);
          continue;
        }
        if (drop.y >= restY() + h[col(drop.x)]) {
          poke(drop.x, 5 + drop.r * 2.2);
          q.splice(d, 1);
        }
      }
      for (let p = puffs.length - 1; p >= 0; p--) {
        puffs[p].t += 1;
        if (puffs[p].t > 70) puffs.splice(p, 1);
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const rest = restY();
      const pts: [number, number][] = [];
      for (let i = 0; i < N; i++) pts.push([(i / (N - 1)) * width, rest + h[i]]);

      ctx.beginPath();
      ctx.moveTo(0, height);
      pts.forEach(([x, y], i) => ctx.lineTo(x, y + 12 - h[i] * 0.4 + Math.sin(t * 0.015 + i * 0.22) * 3));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = "rgba(160, 188, 255, 0.10)";
      ctx.fill();

      const grad = ctx.createLinearGradient(0, rest - 20, 0, height);
      grad.addColorStop(0, "rgba(200, 216, 255, 0.30)");
      grad.addColorStop(1, "rgba(120, 150, 255, 0.05)");
      ctx.beginPath();
      ctx.moveTo(0, height);
      pts.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = "rgba(235, 242, 255, 0.8)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Where the water would be without Dropwise.
      if (target.current.ghost !== null && gh - lvl > 0.004) {
        const y = ghostY();
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.restore();
        ctx.font = "10.5px var(--font-geist-mono), ui-monospace, monospace";
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.textAlign = "right";
        ctx.fillText("WITHOUT DROPWISE", width - 16, y - 8);
        // The gap the cache kept out of the water.
        ctx.fillStyle = "rgba(157, 255, 180, 0.07)";
        ctx.fillRect(0, y, width, Math.max(0, rest - y));
      }

      queue.current.forEach((d) => {
        ctx.beginPath();
        ctx.fillStyle = COLORS[d.kind];
        // A droplet: round bottom, pointed top.
        ctx.moveTo(d.x, d.y - d.r * 1.9);
        ctx.bezierCurveTo(d.x + d.r * 0.25, d.y - d.r * 1.1, d.x + d.r, d.y - d.r * 0.4, d.x + d.r, d.y + d.r * 0.1);
        ctx.arc(d.x, d.y + d.r * 0.1, d.r, 0, Math.PI);
        ctx.bezierCurveTo(d.x - d.r, d.y - d.r * 0.4, d.x - d.r * 0.25, d.y - d.r * 1.1, d.x, d.y - d.r * 1.9);
        ctx.fill();
      });

      // Cache hits: a small ring that rises and fades, the request that never reached the water.
      puffs.forEach((p) => {
        const k = p.t / 70;
        ctx.beginPath();
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 1.3;
        ctx.ellipse(p.x, p.y - k * 18, 4 + k * 22, 2 + k * 7, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    };

    const loop = () => {
      step();
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      if (reduce) {
        lvl = target.current.level;
        draw();
        return;
      }
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
      if (lastX !== null && y > -260) {
        const speed = Math.max(-30, Math.min(30, x - lastX));
        poke(x, Math.abs(speed) * 0.3 * (y > restY() - 60 ? 1 : 0.35));
      }
      lastX = x;
    };
    const onLeave = () => {
      lastX = null;
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("a,button,input,[data-no-splash]")) return;
      const { x, y } = local(e);
      if (y < -260) return;
      queue.current.push({ x, y: Math.min(y, restY() - 10), vy: 0, r: 4, kind: "call" });
    };

    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()), { threshold: 0 });
    io.observe(canvas);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    hostEl.addEventListener("pointermove", onMove);
    hostEl.addEventListener("pointerleave", onLeave);
    hostEl.addEventListener("pointerdown", onDown);
    resize();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      hostEl.removeEventListener("pointermove", onMove);
      hostEl.removeEventListener("pointerleave", onLeave);
      hostEl.removeEventListener("pointerdown", onDown);
    };
  }, [host, height]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 w-full" style={{ height }} />;
}

/** A stable 0..1 position for a request, so the same request always falls in the same place. */
export function spot(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
