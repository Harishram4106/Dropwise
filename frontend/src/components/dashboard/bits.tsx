"use client";

// Small pieces every dashboard page uses, so the honesty rules look the same everywhere:
// water is always a low–high range marked Estimated with what it counts; counts are marked Measured.
// Each piece works on the dark hero sections (`dark`) and on the light lavender sections (default).

import { motion, useSpring, useTransform } from "framer-motion";
import { usePathname, useSearchParams } from "next/navigation";
import { type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Tag } from "@/components/ui";
import { type CacheOutcome, fmtInt, fmtMl, type Range, SCOPE_LABEL, type Scope } from "@/lib/dropwise";

export const delay = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

/** Measured: a square, as on the landing page's Honesty section. Estimated: a ring. */
export function Kind({ kind, dark = false }: { kind: "measured" | "estimated"; dark?: boolean }) {
  const mark =
    kind === "measured"
      ? dark
        ? "bg-white/70"
        : "bg-[#1c1d23]"
      : `rounded-full border ${dark ? "border-[#8fb0ff]" : "border-[#4b63ff]"}`;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] ${dark ? "text-white/55" : "text-[#7b7f90]"}`}>
      <span aria-hidden className={`inline-block h-[7px] w-[7px] ${mark}`} />
      {kind}
    </span>
  );
}

/** A number that springs to its new value, like the landing page's counters. */
export function Count({ value, format = fmtInt, className = "" }: { value: number; format?: (n: number) => string; className?: string }) {
  const spring = useSpring(0, { stiffness: 70, damping: 18, mass: 0.8 });
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  const text = useTransform(spring, (v) => format(v));
  return <motion.span className={`tabular-nums ${className}`}>{text}</motion.span>;
}

/** "1.2–1.7 mL". Never a single number: a range of zero (a cache hit) still reads "0 mL". */
export function WaterRange({ range, animate = false, className = "" }: { range: Range | null | undefined; animate?: boolean; className?: string }) {
  if (!range) return <span className={`opacity-40 ${className}`}>—</span>;
  const unit = <span className="ml-[0.18em] text-[0.62em] font-normal tracking-normal opacity-55">mL</span>;
  if (range.low === 0 && range.high === 0) {
    return (
      <span className={`tabular-nums ${className}`}>
        0{unit}
      </span>
    );
  }
  if (animate) {
    return (
      <span className={`whitespace-nowrap ${className}`}>
        <Count value={range.low} format={fmtMl} />–<Count value={range.high} format={fmtMl} />
        {unit}
      </span>
    );
  }
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      {fmtMl(range.low)}–{fmtMl(range.high)}
      {unit}
    </span>
  );
}

export function CacheTag({ cache, dark = false }: { cache: CacheOutcome; dark?: boolean }) {
  if (cache === "hit") return <Tag dark={dark} tone="fresh">Cache hit</Tag>;
  if (cache === "bypass") return <Tag dark={dark} tone="stale">Bypassed · time-sensitive</Tag>;
  if (cache === "miss") return <Tag dark={dark}>Miss</Tag>;
  return <Tag dark={dark}>{cache === "off" ? "Cache off" : "Not cacheable"}</Tag>;
}

/** Direct only / Direct + indirect, kept in the URL as ?scope=direct. Sits in the glass nav and follows its theme. */
export function ScopeToggle({ scope }: { scope: Scope }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (next: Scope) => {
    const q = new URLSearchParams(params.toString());
    if (next === "direct_only") q.set("scope", "direct");
    else q.delete("scope");
    const s = q.toString();
    // The native history API updates useSearchParams without a server round trip, so the switch is instant.
    window.history.replaceState(null, "", `${pathname}${s ? `?${s}` : ""}`);
  };
  return (
    <div
      role="radiogroup"
      aria-label="What water is counted"
      className="flex rounded-[3px] border p-0.5 text-[12px]"
      style={{ borderColor: "var(--nav-line)" }}
    >
      {(["direct_only", "direct_plus_indirect"] as const).map((s) => (
        <button
          key={s}
          role="radio"
          aria-checked={scope === s}
          onClick={() => set(s)}
          className="whitespace-nowrap rounded-[2px] px-2.5 py-1 transition-colors duration-300"
          style={scope === s ? { background: "var(--nav-strong)", color: "var(--nav-inverse)" } : { color: "var(--nav-text)" }}
        >
          {s === "direct_only" ? "Direct" : SCOPE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`font-mono text-[11px] uppercase tracking-[0.04em] ${dark ? "text-[#8fb0ff]" : "text-[#7d8fe0]"}`}>{children}</p>;
}

type Splash = { id: number; x: number; y: number };

/**
 * The landing hero's surface: the breathing blue gradient, grain, a glow that follows the cursor,
 * and a splash wherever you click. Children sit on top; `art` is drawn behind them (a water canvas, say).
 */
export function HeroSurface({
  children,
  art,
  flip = false,
  className = "",
  hostRef,
}: {
  children: ReactNode;
  art?: ReactNode;
  flip?: boolean;
  className?: string;
  hostRef?: React.RefObject<HTMLElement | null>;
}) {
  const own = useRef<HTMLElement>(null);
  const ref = hostRef ?? own;
  const frame = useRef(0);
  const nextId = useRef(1);
  const [splashes, setSplashes] = useState<Splash[]>([]);

  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--gx", `${clientX - r.left}px`);
      el.style.setProperty("--gy", `${clientY - r.top}px`);
    });
  };
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || (e.target as HTMLElement).closest("a,button,input,[data-no-splash]")) return;
    const r = el.getBoundingClientRect();
    const id = nextId.current++;
    setSplashes((s) => [...s.slice(-5), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    setTimeout(() => setSplashes((s) => s.filter((x) => x.id !== id)), 1900);
  };

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      data-nav="dark"
      onPointerMove={onMove}
      onClick={onClick}
      className={`drop-cursor relative isolate overflow-hidden text-white ${className}`}
    >
      <div aria-hidden className={`hero-bg absolute inset-0 -z-20 ${flip ? "[transform:scaleX(-1)]" : ""}`} />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="pointer-events-none absolute -z-10 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(120,150,255,0.28)_0%,transparent_65%)] transition-[left,top] duration-500 ease-out"
        style={{ left: "var(--gx, 72%)", top: "var(--gy, 30%)" }}
      />
      {art}
      {splashes.map((s) => (
        <div key={s.id} aria-hidden className="pointer-events-none absolute z-20" style={{ left: s.x, top: s.y }}>
          <span className="drip" style={{ left: 0, top: 0 }} />
          {[0.25, 0.42, 0.6].map((d) => (
            <span key={d} className="ripple" style={{ left: 0, top: 0, ...delay(d) }} />
          ))}
        </div>
      ))}
      {children}
    </section>
  );
}

/** Card tilt from the landing page's feature cards: drives --rx/--ry, which .fcard .ill reads. */
export const tilt = {
  onPointerMove: (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ry", `${(((e.clientX - r.left) / r.width - 0.5) * 14).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-((e.clientY - r.top) / r.height - 0.5) * 10).toFixed(2)}deg`);
  },
  onPointerLeave: (e: PointerEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty("--rx", "0deg");
    e.currentTarget.style.setProperty("--ry", "0deg");
  },
};

/** A seamless wave (period 100px): animate it with .svg-wave-a / .svg-wave-b, which shift it by exactly one period. */
const WAVE = "M0 7 Q25 0 50 7 T100 7 T150 7 T200 7 T250 7 T300 7 T350 7 T400 7 V14 H0 Z";

export function Wave({ color, className, style }: { color: string; className: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden viewBox="0 0 400 14" preserveAspectRatio="none" className={`absolute left-0 h-[14px] w-[400px] max-w-none ${className}`} style={style}>
      <path d={WAVE} fill={color} />
    </svg>
  );
}

