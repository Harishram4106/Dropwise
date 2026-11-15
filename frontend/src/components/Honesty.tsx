"use client";

import type { CSSProperties } from "react";
import { useReveal } from "./useReveal";

const measured = [
  ["Calls avoided and cache hits", "gateway logs"],
  ["Tokens saved", "token counts"],
  ["Share routed to smaller models", "routing logs"],
  ["Added gateway latency", "timing with and without Dropwise"],
  ["Answer quality after right-sizing", "a stated evaluation set"],
];

const estimated = [
  ["Water per request and per workload", "receipt formula, low–high range, cited factors"],
  ["Stress-weighted water", "regional water-stress data, a prioritization aid"],
];

function List({ items, mark }: { items: string[][]; mark: "measured" | "estimated" }) {
  return (
    <ul>
      {items.map(([what, how]) => (
        <li key={what} className="flex items-start gap-3 border-t border-[#dfe2ec] py-3.5">
          <span
            className={`mt-1.5 inline-block h-2 w-2 shrink-0 ${mark === "measured" ? "bg-[#1c1d23]" : "rounded-full border border-[#4b63ff]"}`}
            aria-hidden
          />
          <span>
            <span className="text-[15px] tracking-[-0.01em] text-[#1c1d23]">{what}</span>
            <span className="block text-[13px] text-[#8a8ea0]">{how}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Honesty() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.25);
  const r = (n: number) => ({ "--d": `${n}s` }) as CSSProperties;
  const cls = (extra = "") => `reveal ${inView ? "is-in" : ""} ${extra}`;

  return (
    <section id="honesty" data-nav="light" className="bg-[#f4f5fa]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.15fr] lg:gap-24">
          <div>
            <p className={cls("font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0]")}>Honesty rules</p>
            <h2 className="mt-5 text-[clamp(36px,4.6vw,62px)] font-medium leading-[1.03] tracking-[-0.055em] text-[#25262c]">
              <span className={cls("block")} style={r(0.08)}>Honest numbers,</span>
              <span className={cls("block text-[#a2a5b3]")} style={r(0.18)}>labeled every time</span>
            </h2>
            <p className={cls("mt-6 max-w-[460px] text-[16px] leading-relaxed text-[#6b6f80]")} style={r(0.3)}>
              Every number is marked as measured or estimated. Water is always an estimate, always shown as a range,
              always with what is counted.
            </p>

            <div className={cls("mt-10 border-l-2 border-[#4b63ff] pl-5")} style={r(0.4)}>
              <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-[#4b63ff]">What we never claim</p>
              <p className="mt-2 max-w-[440px] text-[14.5px] leading-relaxed text-[#4a4e5e]">
                Litres saved in the real world, or that AI now uses less water worldwide. Cheaper per query can still
                mean more total use: Dropwise cuts waste per unit of work, and total demand still matters.
              </p>
            </div>
          </div>

          <div className="grid gap-10 sm:grid-cols-2 sm:gap-8">
            <div className={cls()} style={r(0.3)}>
              <p className="mb-4 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-[#5a5e6e]">
                Measured <span className="text-[#a2a5b3]">from the benchmark</span>
              </p>
              <List items={measured} mark="measured" />
            </div>
            <div className={cls()} style={r(0.42)}>
              <p className="mb-4 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-[#5a5e6e]">
                Estimated <span className="text-[#a2a5b3]">always a range</span>
              </p>
              <List items={estimated} mark="estimated" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
