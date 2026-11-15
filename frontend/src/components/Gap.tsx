"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Magnetic } from "./Magnetic";
import { useReveal } from "./useReveal";

const MIN = -1; // 0.1 mL
const MAX = 3; // 1,000 mL
const pos = (v: number) => ((Math.log10(v) - MIN) / (MAX - MIN)) * 100;
const valAt = (p: number) => 10 ** (MIN + (p / 100) * (MAX - MIN));
const ticks = [0.1, 1, 10, 100, 1000];

const scopes = {
  // Bands are the published per-prompt figures for each scope, from registry v2.
  direct: { label: "Direct only", low: 0.26, high: 0.32, note: "On-site cooling water at the data center: Google 0.26 mL; OpenAI's 0.32 mL doesn't say what it counts." },
  indirect: { label: "Direct + indirect", low: 10, high: 50, note: "Adds the water behind the electricity: UC Riverside 10–50 mL, Mistral 45 mL." },
} as const;
type Scope = keyof typeof scopes;

const figures = [
  { value: "0.26", unit: "mL", label: "Google's reported figure for a median Gemini prompt" },
  { value: "45", unit: "mL", label: "Mistral's estimate per 400-token response" },
  { value: "170×", unit: "", label: "the gap between them, mostly from what each one counts" },
];

const markers = [
  { v: 0.26, l: "0.26 mL · Google", tone: "#4b63ff" },
  { v: 45, l: "45 mL · Mistral", tone: "#4b63ff" },
  { v: 500, l: "500 mL · the viral “bottle” claim", tone: "#c97a12" },
];

const fmtMl = (v: number) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US"));

function verdict(g: number) {
  if (g < 0.26)
    return { title: "Lower than every published figure.", body: "Even the smallest published estimate is above your guess. Small per prompt still adds up at scale." };
  if (g <= 45)
    return {
      title: "Right inside the published spread!",
      body: "Then again, the spread itself is 170× wide. That uncertainty is exactly why Dropwise always shows a range.",
    };
  if (g < 300)
    return { title: "Higher than both published figures.", body: "Some estimates count far more than others, but none of the published ones go this high per prompt." };
  return { title: "Bottle territory.", body: "That's where the viral “one question = one bottle” claim lands. Our claim checker rates it overstated." };
}

export default function Gap() {
  const [scope, setScope] = useState<Scope>("indirect");
  const [guess, setGuess] = useState(pos(5));
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [ref, inView] = useReveal<HTMLDivElement>(0.3);
  const s = scopes[scope];
  const r = (n: number) => ({ "--d": `${n}s` }) as CSSProperties;
  const g = valAt(guess);
  const v = verdict(g);

  const setFromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setGuess(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (revealed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFromPointer(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) setFromPointer(e.clientX);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (revealed) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") setGuess((p) => Math.max(0, p - 2));
    if (e.key === "ArrowRight" || e.key === "ArrowUp") setGuess((p) => Math.min(100, p + 2));
    if (e.key === "Enter") setRevealed(true);
  };

  return (
    <section data-nav="light" className="relative bg-[#eceef6]">
      <div ref={ref} className="mx-auto max-w-[1320px] border-t border-white px-5 py-24 sm:px-8 lg:px-14 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          <div>
            <p className={`reveal font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0] ${inView ? "is-in" : ""}`}>The problem</p>
            <h2 className="mt-5 text-[clamp(36px,4.6vw,62px)] font-medium leading-[1.03] tracking-[-0.05em] text-[#25262c]">
              <span className={`reveal block ${inView ? "is-in" : ""}`} style={r(0.08)}>Nobody can see what</span>
              <span className={`reveal block text-[#a2a5b3] ${inView ? "is-in" : ""}`} style={r(0.18)}>
                their AI costs in water
              </span>
            </h2>
            <p className={`reveal mt-6 max-w-[500px] text-[16px] leading-relaxed text-[#6b6f80] ${inView ? "is-in" : ""}`} style={r(0.3)}>
              AI data centers use water for cooling, and the power plants that feed them use water too. The published
              figures disagree wildly, and most of the gap comes from what each one counts.
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-px self-end border border-white bg-white sm:grid-cols-3 lg:grid-cols-1">
            {figures.map((f, i) => (
              <div
                key={f.label}
                className={`reveal group flex items-baseline gap-5 bg-[#eceef6] px-6 py-5 transition-colors hover:bg-[#f4f5fb] sm:flex-col sm:gap-2 lg:flex-row lg:gap-6 ${inView ? "is-in" : ""}`}
                style={r(0.25 + i * 0.12)}
              >
                <dt className="min-w-[132px] text-[44px] font-medium leading-none tracking-[-0.05em] text-[#1c1d23] transition-colors group-hover:text-[#2f45ff]">
                  {f.value}
                  {f.unit && <span className="ml-1 text-[20px] tracking-[-0.02em] text-[#8a8ea0]">{f.unit}</span>}
                </dt>
                <dd className="text-[14px] leading-snug text-[#6b6f80]">{f.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Guessing game */}
        <div className={`reveal mt-16 border border-white bg-white/45 p-6 sm:p-8 ${inView ? "is-in" : ""}`} style={r(0.5)}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7d8fe0]">Quick game</p>
              <p className="mt-1 text-[19px] tracking-[-0.02em] text-[#1c1d23]">
                {revealed ? "Here's what has actually been published" : "How much water does one AI prompt use? Take a guess."}
              </p>
              <p className="mt-1 text-[13.5px] text-[#7b7f90]">
                {revealed ? s.note : "Drag the drop along the scale, then reveal the published figures."}
              </p>
            </div>
            {revealed ? (
              <div role="radiogroup" aria-label="What is counted" className="flex rounded-[4px] border border-[#d8dbe8] bg-white p-0.5 text-[13px]">
                {(Object.keys(scopes) as Scope[]).map((k) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={scope === k}
                    onClick={() => setScope(k)}
                    className={`rounded-[3px] px-3 py-1.5 transition-colors ${scope === k ? "bg-[#1c1d23] text-white" : "text-[#5a5e6e] hover:text-[#1c1d23]"}`}
                  >
                    {scopes[k].label}
                  </button>
                ))}
              </div>
            ) : (
              <Magnetic>
                <button
                  onClick={() => setRevealed(true)}
                  className="h-10 rounded-[4px] bg-[#1c1d23] px-4 text-[13.5px] text-white transition-colors hover:bg-[#2f45ff]"
                >
                  Reveal the answer
                </button>
              </Magnetic>
            )}
          </div>

          <div
            ref={trackRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            className={`relative mt-16 h-28 touch-none select-none ${revealed ? "" : "cursor-grab active:cursor-grabbing"}`}
          >
            <div className="absolute inset-x-0 top-12 h-px bg-[#cfd3e2]" />
            {ticks.map((t) => (
              <div key={t} className="absolute top-12 -translate-x-1/2" style={{ left: `${pos(t)}%` }}>
                <div className="mx-auto h-2 w-px bg-[#b9bdcd]" />
                <p className="mt-2 whitespace-nowrap font-mono text-[10.5px] text-[#9a9eb0]">{t.toLocaleString("en-US")} mL</p>
              </div>
            ))}

            {revealed && (
              <>
                <div
                  className="absolute top-[42px] h-3 rounded-full bg-gradient-to-r from-[#9db4ff] to-[#3d5bff] shadow-[0_0_24px_rgba(61,91,255,0.45)] transition-all duration-700 ease-[cubic-bezier(.2,.7,.2,1)]"
                  style={{ left: `${pos(s.low)}%`, width: `${pos(s.high) - pos(s.low)}%` }}
                />
                {markers.map((m, i) => (
                  <div
                    key={m.v}
                    className="fade-up absolute top-0 -translate-x-1/2 text-center"
                    style={{ left: `${pos(m.v)}%`, ...r(0.15 + i * 0.2) }}
                  >
                    <p className="whitespace-nowrap font-mono text-[10px] uppercase sm:text-[10.5px]" style={{ color: m.tone }}>
                      {m.l}
                    </p>
                    <div className="mx-auto mt-1 h-8 w-px" style={{ background: m.tone }} />
                    <div className="mx-auto -mt-px h-2 w-2 rounded-full border bg-white" style={{ borderColor: m.tone }} />
                  </div>
                ))}
              </>
            )}

            {/* The draggable drop */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Your guess, in millilitres"
              aria-valuemin={0.1}
              aria-valuemax={1000}
              aria-valuenow={Number(g.toFixed(2))}
              aria-valuetext={`${fmtMl(g)} mL`}
              onKeyDown={onKey}
              className={`absolute top-[64px] -translate-x-1/2 outline-none transition-[left] ${dragging ? "duration-0" : "duration-200"}`}
              style={{ left: `${guess}%` }}
            >
              <svg
                viewBox="0 0 24 30"
                className={`mx-auto h-9 w-8 drop-shadow-[0_6px_10px_rgba(47,69,255,0.35)] transition-transform ${dragging ? "scale-110" : ""}`}
                aria-hidden
              >
                <path d="M12 1.5C11.6 2 3 11.6 3 17.5a9 9 0 0 0 18 0C21 11.6 12.4 2 12 1.5Z" fill="#2f45ff" />
                <path d="M8 18.5a4.2 4.2 0 0 0 3.6 4" stroke="#cfdcff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              </svg>
              <p className="mt-1 whitespace-nowrap rounded-[3px] bg-[#1c1d23] px-1.5 py-0.5 text-center font-mono text-[10.5px] text-white">
                you: {fmtMl(g)} mL
              </p>
            </div>
          </div>

          <div className="mt-10 min-h-[64px]">
            {revealed ? (
              <div key="r" className="fade-up flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[17px] tracking-[-0.02em] text-[#1c1d23]">{v.title}</p>
                  <p className="mt-1 max-w-[640px] text-[14px] leading-snug text-[#6b6f80]">{v.body}</p>
                </div>
                <button
                  onClick={() => setRevealed(false)}
                  className="font-mono text-[11px] uppercase tracking-[0.04em] text-[#4b63ff] underline-offset-4 hover:underline"
                >
                  ↺ Guess again
                </button>
              </div>
            ) : (
              <p className="font-mono text-[10.5px] uppercase tracking-[0.03em] text-[#9a9eb0]">Log scale · use arrow keys too</p>
            )}
            {revealed && (
              <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                Log scale · blue band spans the published figures for this scope, from registry v2
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
