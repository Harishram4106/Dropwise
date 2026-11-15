"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { BlurText } from "./BlurText";
import HeroPlatform from "./HeroPlatform";
import { Magnetic } from "./Magnetic";

const d = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

const stack = ["Bifrost", "Tavily", "WRI Aqueduct"];
const statuses = ["Estimating", "Routing", "Caching", "Verifying", "Budgeting"];

type Splash = { id: number; x: number; y: number };

export default function Hero() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const textY = useTransform(scrollY, [0, 700], [0, reduce ? 0 : -150]);
  const textO = useTransform(scrollY, [0, 560], [1, 0]);
  const artY = useTransform(scrollY, [0, 700], [0, reduce ? 0 : -70]);

  const sectionRef = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const nextId = useRef(1);
  const [splashes, setSplashes] = useState<Splash[]>([]);
  const [pulse, setPulse] = useState(0);
  const [status, setStatus] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStatus((s) => (s + 1) % statuses.length), 2400);
    return () => clearInterval(t);
  }, []);

  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const el = sectionRef.current;
    if (!el) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", (((clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      el.style.setProperty("--my", (((clientY - r.top) / r.height) * 2 - 1).toFixed(3));
      el.style.setProperty("--gx", `${clientX - r.left}px`);
      el.style.setProperty("--gy", `${clientY - r.top}px`);
    });
  };

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const el = sectionRef.current;
    if (!el || (e.target as HTMLElement).closest("a,button")) return;
    const r = el.getBoundingClientRect();
    const id = nextId.current++;
    setSplashes((s) => [...s.slice(-5), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    setPulse((p) => p + 1);
    setTimeout(() => setSplashes((s) => s.filter((x) => x.id !== id)), 1900);
  };

  return (
    <section
      ref={sectionRef}
      id="top"
      data-nav="dark"
      onPointerMove={onMove}
      onClick={onClick}
      className="drop-cursor relative isolate min-h-[100svh] overflow-hidden text-white"
    >
      <div aria-hidden className="hero-bg absolute inset-0 -z-20" />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      {/* soft glow that follows the cursor */}
      <div
        aria-hidden
        className="pointer-events-none absolute -z-10 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(120,150,255,0.28)_0%,transparent_65%)] transition-[left,top] duration-500 ease-out"
        style={{ left: "var(--gx, 70%)", top: "var(--gy, 40%)" }}
      />

      {splashes.map((s) => (
        <div key={s.id} aria-hidden className="pointer-events-none absolute z-20" style={{ left: s.x, top: s.y }}>
          <span className="drip" style={{ left: 0, top: 0 }} />
          {[0.25, 0.42, 0.6].map((dl) => (
            <span key={dl} className="ripple" style={{ left: 0, top: 0, ...d(dl) }} />
          ))}
        </div>
      ))}

      <div className="relative mx-auto flex min-h-[100svh] max-w-[1320px] flex-col px-5 pb-10 pt-32 sm:px-8 sm:pt-40 lg:px-14 lg:pb-14">
        <motion.div style={{ y: textY, opacity: textO }} className="relative z-10 max-w-[860px]">
          <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={d(0.1)}>
            <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Open source · Bifrost sidecar</span>
            <span className="flex items-center gap-1.5 rounded-[2px] border border-white/15 px-2 py-1 text-white/45">
              Status:
              <span className="blink inline-block h-1.5 w-1.5 bg-[#7dfc9a]" />
              <span key={status} className="fade-up inline-block min-w-[78px] text-white/90">
                {statuses[status]}
              </span>
            </span>
          </div>

          <h1 className="jelly mt-7 text-[clamp(44px,6.4vw,98px)] font-medium leading-[0.98] tracking-[-0.058em]">
            <BlurText text="Every prompt has" className="headline-grey block" start={0.25} />
            <BlurText text="a water footprint" className="block" start={0.7} />
          </h1>

          <p className="fade-up mt-6 max-w-[520px] text-[16px] leading-relaxed tracking-[-0.01em] text-white/75 sm:text-[17px]" style={d(1.35)}>
            Dropwise makes AI&apos;s water footprint measurable, sourced and controllable, right inside your AI gateway.
          </p>

          <div className="fade-up mt-9 flex flex-wrap items-center gap-5" style={d(1.55)}>
            <Magnetic>
              <a href="#playground" className="group inline-flex h-12 items-stretch text-[15px] tracking-[-0.01em] text-white">
                <span className="flex items-center rounded-l-[5px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[filter] group-hover:brightness-110">
                  Try the playground
                </span>
                <span className="ml-[2px] flex w-12 items-center justify-center rounded-r-[5px] bg-[#2f45ff] transition-[filter] group-hover:brightness-110">
                  <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:rotate-[-8deg]" fill="none" aria-hidden>
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </a>
            </Magnetic>
            <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40 sm:inline">
              psst · click anywhere for a splash
            </span>
          </div>
        </motion.div>

        <motion.div
          style={{ y: artY }}
          className="pointer-events-none relative mx-auto -mt-4 w-full max-w-[620px] lg:absolute lg:right-[-5%] lg:top-[12%] lg:mt-0 lg:w-[56%] lg:max-w-[840px]"
        >
          <HeroPlatform pulse={pulse} />
        </motion.div>

        <motion.div style={{ opacity: textO }} className="relative z-10 mt-auto pt-6">
          <div style={d(1.9)} className="fade-up">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/50">Built with</p>
            <ul className="mt-4 flex flex-wrap items-center gap-x-10 gap-y-3">
              {stack.map((name) => (
                <li
                  key={name}
                  className="cursor-default text-[22px] font-semibold tracking-[-0.04em] text-white/90 transition-all duration-300 hover:-translate-y-0.5 hover:text-white hover:[text-shadow:0_0_24px_rgba(160,190,255,0.9)] sm:text-[24px]"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
