"use client";

import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { CacheIllustration, RegistryIllustration, RouteIllustration, StackIllustration } from "./FeatureIllustrations";
import { useReveal } from "./useReveal";

const cards: { title: string; body: string; art: ReactNode }[] = [
  {
    title: "Every request, a receipt",
    body: "Tokens × model class × region gives a low–high water range per call, never a single number.",
    art: <StackIllustration />,
  },
  {
    title: "Routed, not wasted",
    body: "Easy prompts go to right-sized models, and deferrable jobs can wait for a lower-impact hour.",
    art: <RouteIllustration />,
  },
  {
    title: "From many calls to fewer",
    body: "An exact-match cache answers repeat prompts, per key. Time-sensitive prompts skip the cache automatically.",
    art: <CacheIllustration />,
  },
  {
    title: "Every number has a source",
    body: "Each factor carries a source link, a date and a freshness score, re-verified by Tavily.",
    art: <RegistryIllustration />,
  },
];

function Card({ i, title, body, art }: { i: number; title: string; body: string; art: ReactNode }) {
  const [ref, inView] = useReveal<HTMLElement>(0.35);
  const tilt = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(x * 14).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-y * 10).toFixed(2)}deg`);
  };
  const reset = (e: PointerEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty("--rx", "0deg");
    e.currentTarget.style.setProperty("--ry", "0deg");
  };
  return (
    <article
      ref={ref}
      onPointerMove={tilt}
      onPointerLeave={reset}
      className={`fcard flex min-h-[430px] flex-col bg-[#eceef6] px-7 pb-10 pt-6 ${inView ? "is-in" : ""}`}
      style={{ "--i": i } as CSSProperties}
    >
      <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#a7b3e6]">Log 0{i + 1}</span>
      <div className="ill flex flex-1 items-center justify-center py-8">{art}</div>
      <h3 className="card-title text-[17px] tracking-[-0.02em] text-[#1c1d23]">{title}</h3>
      <p className="card-desc mt-3 max-w-[250px] text-[13.5px] leading-[1.45] text-[#7b7f90]">{body}</p>
    </article>
  );
}

export default function Features() {
  const [headRef, headIn] = useReveal<HTMLDivElement>(0.5);
  return (
    <section
      id="product"
      data-nav="light"
      className="relative overflow-hidden bg-[linear-gradient(180deg,#a6c0ff_0%,#d3ddfb_14%,#e6e9f6_26%,#eceef6_40%)]"
    >
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[420px] w-[620px] rounded-full bg-[#8fb0ff] opacity-50 blur-[110px]" />
      <div className="relative mx-auto max-w-[1320px] px-5 pt-36 sm:px-8 lg:px-14">
        <div ref={headRef}>
          <h2 className="text-[clamp(40px,5.4vw,72px)] font-medium leading-[1.02] tracking-[-0.055em] text-[#25262c]">
            <span className={`reveal block ${headIn ? "is-in" : ""}`}>Built for the numbers</span>
            <span className={`reveal headline-blue block pb-1 ${headIn ? "is-in" : ""}`} style={{ "--d": "0.15s" } as CSSProperties}>
              that actually hold up
            </span>
          </h2>
          <p
            className={`reveal mt-6 max-w-[520px] text-[16px] leading-relaxed tracking-[-0.01em] text-[#6b6f80] ${headIn ? "is-in" : ""}`}
            style={{ "--d": "0.3s" } as CSSProperties}
          >
            Measure what every request costs in water, reduce the waste your gateway can control, and prove each figure
            with a source.
          </p>
        </div>
      </div>

      <div className="relative mx-auto mt-16 max-w-[1320px] px-2 sm:px-3">
        <div className="grid gap-px border-y border-white/80 bg-white/80 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c, i) => (
            <Card key={c.title} i={i} {...c} />
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-[1320px] px-5 pb-20 pt-10 sm:px-8 lg:px-14">
        <a href="#how" className="group inline-flex items-center gap-2 text-[15px] tracking-[-0.01em] text-[#1c1d23]">
          Learn more
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" fill="none" aria-hidden>
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </section>
  );
}
