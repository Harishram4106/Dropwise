"use client";

import type { CSSProperties, ReactNode } from "react";
import { useReveal } from "./useReveal";

function Node({ title, body, className = "" }: { title: string; body: string; className?: string }) {
  return (
    <div className={`border border-[#dcdfeb] bg-white/70 px-4 py-3.5 ${className}`}>
      <p className="text-[14.5px] tracking-[-0.01em] text-[#1c1d23]">{title}</p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-[#7b7f90]">{body}</p>
    </div>
  );
}

function Arrow({ label, vertical = false, flip = false }: { label?: string; vertical?: boolean; flip?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 ${vertical ? "flex-row py-1" : "flex-row py-2 lg:py-0"}`}>
      <svg
        viewBox="0 0 40 12"
        className={`h-3 w-10 text-[#9aa3c7] ${vertical ? (flip ? "-rotate-90" : "rotate-90") : "rotate-90 lg:rotate-0"}`}
        fill="none"
        aria-hidden
      >
        <path d="M1 6h36M32 2l5 4-5 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label && <span className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#9aa0b8]">{label}</span>}
    </div>
  );
}

const steps: { n: string; title: string; body: ReactNode }[] = [
  { n: "01", title: "Check freshness", body: "Time-sensitive prompts are flagged so they never get a stale cached answer." },
  { n: "02", title: "Cache or route", body: "Repeat prompts hit the exact-match cache; easy ones go to a right-sized model." },
  { n: "03", title: "Write the receipt", body: "The estimator records a low–high range and updates the team's water budget." },
  { n: "04", title: "Show the sources", body: "The dashboard shows every figure with its citation and freshness badge." },
];

export default function HowItWorks() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.25);
  const r = (n: number) => ({ "--d": `${n}s` }) as CSSProperties;
  const cls = (extra = "") => `reveal ${inView ? "is-in" : ""} ${extra}`;

  return (
    <section id="how" data-nav="light" className="relative overflow-hidden bg-[linear-gradient(180deg,#eceef6_0%,#e4e8f8_100%)]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <p className={cls("font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0]")}>How it works</p>
        <h2 className="mt-5 text-[clamp(36px,4.8vw,64px)] font-medium leading-[1.03] tracking-[-0.055em] text-[#25262c]">
          <span className={cls("block")} style={r(0.08)}>Lives inside the gateway.</span>
          <span className={cls("headline-blue block pb-1")} style={r(0.18)}>
            Keeps its numbers honest.
          </span>
        </h2>

        <div className={cls("mt-16")} style={r(0.3)}>
          <div className="grid items-center gap-0 lg:grid-cols-[170px_56px_minmax(0,1fr)_56px_190px]">
            <Node title="Your app" body="sends requests as usual" />
            <Arrow />
            <div className="rounded-[6px] border-[1.5px] border-[#4b63ff] bg-[#dfe6ff]/70 p-4 shadow-[0_20px_60px_-30px_rgba(61,91,255,0.6)] sm:p-5">
              <p className="mb-3 text-[14px] tracking-[-0.01em] text-[#1c1d23]">
                Dropwise sidecar <span className="text-[#7b7f90]">in front of the</span> Bifrost gateway
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Node title="Freshness check" body="time-sensitive prompts skip the cache" className="bg-white/60" />
                <Node title="Footprint estimator" body="low–high water range per request" className="bg-white/60" />
                <Node title="Routing and cache" body="small model if enough, repeats cached" className="bg-white/60" />
                <Node title="Water budgets" body="per key, with alerts and soft limits" className="bg-white/60" />
              </div>
            </div>
            <Arrow />
            <div className="grid gap-2.5">
              <Node title="LLM providers" body="routed calls" />
              <Node title="Dashboard" body="receipts, budgets, citations, claims" />
            </div>
          </div>

          <div className="grid lg:grid-cols-[170px_56px_minmax(0,1fr)_56px_190px]">
            <div className="lg:col-start-3">
              <Arrow vertical flip label="factors and freshness" />
              <div className="grid items-center gap-0 sm:grid-cols-[1fr_48px_1fr]">
                <Node title="Evidence Registry" body="sourced, dated factors built with Tavily" />
                <div className="flex justify-center">
                  <svg viewBox="0 0 40 12" className="h-3 w-10 rotate-90 text-[#9aa3c7] sm:rotate-180" fill="none" aria-hidden>
                    <path d="M1 6h36M32 2l5 4-5 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <Node title="Claim checker" body="atomic claims, verdicts, live citations" />
              </div>
            </div>
          </div>
        </div>

        <ol className="mt-20 grid gap-px border-y border-white bg-white sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.n} className={cls("bg-[#e8ebf7] px-6 py-7")} style={r(0.4 + i * 0.1)}>
              <span className="font-mono text-[11px] text-[#7d8fe0]">{s.n}</span>
              <p className="mt-4 text-[17px] tracking-[-0.02em] text-[#1c1d23]">{s.title}</p>
              <p className="mt-2 text-[13.5px] leading-[1.45] text-[#7b7f90]">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
