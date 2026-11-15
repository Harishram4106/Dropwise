"use client";

import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import { REPO_URL, VIDEO_URL } from "@/lib/links";
import { Logo } from "./Logo";
import { Magnetic } from "./Magnetic";
import { useReveal } from "./useReveal";
import WaterSurface from "./WaterSurface";

function PrimaryLabel({ children }: { children: string }) {
  return (
    <>
      <span className="flex items-center rounded-l-[5px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[filter] group-hover:brightness-110">
        {children}
      </span>
      <span className="ml-[2px] flex w-12 items-center justify-center rounded-r-[5px] bg-[#2f45ff] transition-[filter] group-hover:brightness-110">
        <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" aria-hidden>
          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </>
  );
}

export default function Cta() {
  const sectionRef = useRef<HTMLElement>(null);
  const [ref, inView] = useReveal<HTMLDivElement>(0.35);
  const r = (n: number) => ({ "--d": `${n}s` }) as CSSProperties;
  const cls = (extra = "") => `reveal ${inView ? "is-in" : ""} ${extra}`;

  return (
    <section ref={sectionRef} id="cta" data-nav="dark" className="drop-cursor relative isolate overflow-hidden text-white">
      <div aria-hidden className="hero-bg absolute inset-0 -z-20 [transform:scaleY(-1)]" />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      <WaterSurface host={sectionRef} height={300} />

      <div ref={ref} className="mx-auto max-w-[1320px] px-5 pb-12 pt-32 sm:px-8 lg:px-14 lg:pt-44">
        <h2 className="max-w-[980px] text-[clamp(38px,5.6vw,84px)] font-medium leading-[1] tracking-[-0.058em]">
          <span className={cls("block")} style={r(0.05)}>Make AI&apos;s water footprint</span>
          <span className={cls("block text-white/55")} style={r(0.15)}>measurable, sourced and controllable.</span>
        </h2>
        <div className={cls("mt-10 flex flex-wrap items-center gap-3")} style={r(0.3)}>
          {/* The big button is GitHub once the repo is set, and the dashboard until then. */}
          <Magnetic>
            {REPO_URL ? (
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="group inline-flex h-12 items-stretch text-[15px] text-white">
                <PrimaryLabel>View on GitHub</PrimaryLabel>
              </a>
            ) : (
              <Link href="/dashboard" className="group inline-flex h-12 items-stretch text-[15px] text-white">
                <PrimaryLabel>Open the dashboard</PrimaryLabel>
              </Link>
            )}
          </Magnetic>
          {VIDEO_URL && (
            <Magnetic>
              <a
                href={VIDEO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center rounded-[5px] border border-white/25 bg-white/5 px-5 text-[15px] backdrop-blur transition-colors hover:bg-white/10"
              >
                Watch the demo
              </a>
            </Magnetic>
          )}
          {REPO_URL && (
            <Magnetic>
              <Link
                href="/dashboard"
                className="inline-flex h-12 items-center rounded-[5px] border border-white/25 bg-white/5 px-5 text-[15px] backdrop-blur transition-colors hover:bg-white/10"
              >
                Open the dashboard
              </Link>
            </Magnetic>
          )}
        </div>
        <p className={cls("mt-8 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45")} style={r(0.45)}>
          Stir the water with your cursor · click to drop a drop
        </p>

        <footer className="mt-44 flex flex-col gap-6 border-t border-white/20 pt-8 text-[13px] text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 text-white" style={{ ["--logo-cut" as string]: "#5b78ff" }}>
            <a href="#top" aria-label="Back to top">
              <Logo />
            </a>
            <span className="text-white/65">Open-source sidecar for the Bifrost AI gateway</span>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <p className="max-w-[420px] sm:text-right">Water figures are estimates, shown as ranges with what is counted and a cited source.</p>
            <a href="#top" className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em] text-white/60 hover:text-white">
              Back to the top
              <span className="inline-block transition-transform duration-300 group-hover:-translate-y-1">↑</span>
            </a>
          </div>
        </footer>
      </div>
    </section>
  );
}
