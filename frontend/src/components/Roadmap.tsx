"use client";

import { useReveal } from "./useReveal";
import { SectionHead, Tag, dl } from "./ui";

const adds = [
  ["A working gateway sidecar", "Not a simulation: it sits in the real request path."],
  ["A verified, open factor registry", "Every factor sourced, dated, scored and signed."],
  ["A claim checker", "Tests viral water claims against live sources."],
  ["Freshness-aware caching", "Saves repeat calls without serving stale answers."],
];

const stages = [
  {
    name: "Prototype",
    tag: { label: "Building now", tone: "blue" as const },
    items: [
      "Footprint estimator",
      "Water receipts",
      "Water budgets",
      "Routing rules",
      "Freshness-aware caching",
      "Evidence Registry",
      "Claim checker",
      "Dashboard",
      "Benchmark and quality check",
      "One-command setup",
    ],
  },
  {
    name: "Stretch",
    tag: { label: "If time allows", tone: "plain" as const },
    items: [
      "Water vs. carbon view: minimizing carbon alone can raise water use",
      "Stress-weighted water, using WRI Aqueduct as a prioritization aid",
      "What-if control: change region or time and watch the range move",
    ],
  },
  {
    name: "Roadmap",
    tag: { label: "Later", tone: "plain" as const },
    items: [
      "Testnet anchoring of the registry hash",
      "Standalone proxy beyond Bifrost",
      "Multi-language UI",
      "Open registry governance",
    ],
  },
];

export default function Roadmap() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.2);
  const rv = (x = "") => `reveal ${inView ? "is-in" : ""} ${x}`;

  return (
    <section id="roadmap" data-nav="light" className="relative overflow-hidden bg-[linear-gradient(180deg,#eceef6_0%,#e3e8f9_100%)]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <SectionHead
            blue
            inView={inView}
            eyebrow="What's new"
            line1="Water-aware routing exists"
            line2="in papers. Now it ships."
            body="Water-aware routing has been studied in research, mostly as simulations. Dropwise builds on that work and adds four things that run in a real gateway."
          />
          <ul className="grid gap-px self-end border border-white bg-white sm:grid-cols-2">
            {adds.map(([t, b], i) => (
              <li key={t} className={rv("bg-[#eceef6] p-5")} style={dl(0.3 + i * 0.08)}>
                <span className="font-mono text-[10.5px] text-[#7d8fe0]">+ 0{i + 1}</span>
                <p className="mt-2 text-[15.5px] tracking-[-0.01em] text-[#1c1d23]">{t}</p>
                <p className="mt-1 text-[13px] leading-snug text-[#7b7f90]">{b}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-24">
          <div aria-hidden className="absolute left-0 right-0 top-[7px] hidden h-px bg-[linear-gradient(90deg,#3d5bff_0%,#8fb0ff_40%,#c9d3f5_100%)] md:block" />
          <div className="grid gap-12 md:grid-cols-3 md:gap-8">
            {stages.map((s, i) => (
              <div key={s.name} className={rv()} style={dl(0.4 + i * 0.15)}>
                <span
                  aria-hidden
                  className={`relative z-10 hidden h-[15px] w-[15px] rotate-45 border md:block ${
                    i === 0 ? "border-[#3d5bff] bg-[#3d5bff] shadow-[0_0_0_5px_rgba(61,91,255,0.15)]" : "border-[#9aa8e0] bg-[#eceef6]"
                  }`}
                />
                <div className="mt-6 flex items-center gap-3">
                  <p className="text-[22px] font-medium tracking-[-0.04em] text-[#1c1d23]">{s.name}</p>
                  <Tag tone={s.tag.tone}>{s.tag.label}</Tag>
                </div>
                <ul className="mt-4">
                  {s.items.map((it) => (
                    <li key={it} className="flex gap-3 border-t border-white py-2.5 text-[14px] leading-snug text-[#4a4e5e]">
                      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 ${i === 0 ? "bg-[#3d5bff]" : "border border-[#9aa8e0]"}`} aria-hidden />
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
