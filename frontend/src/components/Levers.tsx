"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useReveal } from "./useReveal";
import { SectionHead, Tag, dl } from "./ui";

type Tone = "fresh" | "stale" | "blue" | "plain" | "alert";

function Counter({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="border border-white bg-white/70 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.04em] text-[#9a9eb0]">{label}</p>
      <p key={value} className={`pop mt-1 origin-left text-[26px] font-medium leading-none tracking-[-0.04em] tabular-nums ${accent ? "text-[#2f45ff]" : "text-[#1c1d23]"}`}>
        {value}
      </p>
    </div>
  );
}

/* ---------- 01 · Caching: send prompts, watch the cache earn its keep ---------- */

const CACHE_PROMPTS = [
  { text: "Explain how evaporative cooling works", fresh: false, group: "cooling" },
  { text: "Explain evaporative cooling in simple words", fresh: false, group: "cooling" },
  { text: "What's the weather in Chennai right now?", fresh: true, group: "weather" },
];

type LogItem = { id: number; text: string; result: string; tone: Tone; detail: string };

function CachePanel() {
  const [cached, setCached] = useState<string[]>([]);
  const [log, setLog] = useState<LogItem[]>([]);
  const [calls, setCalls] = useState(0);
  const [saved, setSaved] = useState(0);
  const id = useRef(0);

  const send = (p: (typeof CACHE_PROMPTS)[number]) => {
    let item: Omit<LogItem, "id">;
    if (p.fresh) {
      item = { text: p.text, result: "Cache bypassed", tone: "blue", detail: "Time-sensitive: fresh answer from the model" };
      setCalls((c) => c + 1);
    } else if (cached.includes(p.group)) {
      item = { text: p.text, result: "Served from cache", tone: "fresh", detail: "Same prompt asked before: no model call, no new tokens" };
      setSaved((s) => s + 1);
    } else {
      item = { text: p.text, result: "Miss · now cached", tone: "plain", detail: "Answered by the model and stored for next time" };
      setCalls((c) => c + 1);
      setCached((c) => [...c, p.group]);
    }
    setLog((l) => [{ id: id.current++, ...item }, ...l].slice(0, 4));
  };
  const reset = () => {
    setCached([]);
    setLog([]);
    setCalls(0);
    setSaved(0);
  };

  return (
    <div>
      <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Click a prompt to send it</p>
      <div className="grid gap-2">
        {CACHE_PROMPTS.map((p) => (
          <button
            key={p.text}
            onClick={() => send(p)}
            className="group flex items-center justify-between gap-3 border border-white bg-white/70 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-[#b9c6ff] hover:shadow-[0_10px_30px_-18px_rgba(47,69,255,0.6)] active:translate-y-0 active:scale-[0.99]"
          >
            <span className="text-[14px] text-[#1c1d23]">&ldquo;{p.text}&rdquo;</span>
            <span className="flex shrink-0 items-center gap-2">
              {p.fresh && <Tag tone="stale">Time-sensitive</Tag>}
              <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0] transition-transform group-hover:translate-x-0.5">Send ↵</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Counter label="Model calls" value={calls} />
        <Counter label="Calls saved by cache" value={saved} accent />
      </div>

      <ul className="mt-4 min-h-[150px] space-y-1.5">
        {log.length === 0 && <li className="text-[13px] text-[#9a9eb0]">Nothing sent yet. Try the first prompt twice.</li>}
        {log.map((l) => (
          <li key={l.id} className="fade-up flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <Tag tone={l.tone}>{l.result}</Tag>
            <span className="text-[#7b7f90]">{l.detail}</span>
          </li>
        ))}
      </ul>
      {log.length > 0 && (
        <button onClick={reset} className="font-mono text-[11px] uppercase tracking-[0.04em] text-[#4b63ff] hover:underline">
          ↺ Clear cache
        </button>
      )}
    </div>
  );
}

/* ---------- 02 · Right-sizing: pick a prompt, watch it get routed ---------- */

// Lanes, signals and confidence are the real classifier's output (POST /route/classify, rules-1).
const ROUTE_PROMPTS = [
  { text: "Fix the typo in this sentence", lane: "small" as const, why: "transform · confidence 0.8" },
  { text: "What's 15% of 240?", lane: "small" as const, why: "lookup + conversion · confidence 0.9" },
  { text: "Translate this short reply into Tamil", lane: "small" as const, why: "transform · confidence 0.8" },
  { text: "Draft a migration plan for our billing database", lane: "large" as const, why: "analysis · confidence 0.8" },
];

function RoutePanel() {
  const [picked, setPicked] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "thinking" | "done">("idle");
  const [tally, setTally] = useState({ small: 0, large: 0 });

  useEffect(() => {
    if (phase !== "thinking" || picked === null) return;
    const t = setTimeout(() => {
      setPhase("done");
      setTally((x) => ({ ...x, [ROUTE_PROMPTS[picked].lane]: x[ROUTE_PROMPTS[picked].lane] + 1 }));
    }, 750);
    return () => clearTimeout(t);
  }, [phase, picked]);

  const lane = picked !== null && phase === "done" ? ROUTE_PROMPTS[picked].lane : null;

  return (
    <div>
      <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Pick a prompt</p>
      <div className="flex flex-wrap gap-2">
        {ROUTE_PROMPTS.map((p, i) => (
          <button
            key={p.text}
            disabled={phase === "thinking"}
            onClick={() => {
              setPicked(i);
              setPhase("thinking");
            }}
            className={`rounded-full border px-3.5 py-2 text-[13px] transition-all hover:-translate-y-0.5 disabled:opacity-60 ${
              picked === i ? "border-[#3d5bff] bg-[#eef1ff] text-[#1c1d23]" : "border-[#d6d9e6] bg-white/70 text-[#4a4e5e] hover:border-[#b9c6ff]"
            }`}
          >
            {p.text}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3 border border-white bg-white/70 px-4 py-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Classifier</span>
        <span className="text-[13.5px] text-[#1c1d23]">
          {phase === "idle" && "waiting for a prompt…"}
          {phase === "thinking" && (
            <span className="inline-flex items-center gap-2">
              <span className="blink inline-block h-1.5 w-1.5 bg-[#3d5bff]" /> sizing it up
            </span>
          )}
          {phase === "done" && lane && (
            <span className="fade-up inline-flex items-center gap-2">
              {lane === "small" ? <Tag tone="plain">Easy</Tag> : <Tag tone="stale">Complex</Tag>}
              {lane === "small" ? "a small model is enough" : "this one needs the large model"}
              <span className="font-mono text-[11px] text-[#9a9eb0]">{picked !== null && ROUTE_PROMPTS[picked].why}</span>
            </span>
          )}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["small", "large"] as const).map((l) => (
          <div
            key={l}
            className={`relative overflow-hidden border p-4 transition-all duration-500 ${
              lane === l ? "border-[#3d5bff] bg-[#eef1ff] shadow-[0_12px_36px_-18px_rgba(47,69,255,0.7)]" : "border-white bg-white/70"
            }`}
          >
            {lane === l && <span className="absolute inset-x-0 top-0 h-[2px] origin-left animate-[grow_0.6s_ease-out] bg-[#3d5bff]" />}
            <p className="text-[15px] tracking-[-0.01em] text-[#1c1d23]">{l === "small" ? "small-model" : "large-model"}</p>
            <p className="mt-0.5 text-[12.5px] text-[#7b7f90]">{l === "small" ? "lookups, conversions, rewrites, chat" : "code, math, analysis, long context"}</p>
            <p key={tally[l]} className="pop mt-3 origin-left font-mono text-[12px] text-[#4b63ff]">
              {tally[l]} routed here
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] leading-snug text-[#6b6f80]">
        A quality guard checks answers against an evaluation set. If right-sizing hurts quality, Dropwise falls back to caching
        and budgets only.
      </p>
    </div>
  );
}

/* ---------- 03 · Time shifting: drag the job ---------- */

const IMPACT = [0.42, 0.38, 0.35, 0.33, 0.34, 0.4, 0.52, 0.66, 0.78, 0.86, 0.92, 0.97, 1, 0.98, 0.95, 0.9, 0.84, 0.8, 0.74, 0.68, 0.6, 0.54, 0.5, 0.46];
const SPAN = 3;
const windowAvg = (s: number) => IMPACT.slice(s, s + SPAN).reduce((a, b) => a + b, 0) / SPAN;
const BEST = Array.from({ length: 24 - SPAN + 1 }, (_, s) => s).reduce((b, s) => (windowAvg(s) < windowAvg(b) ? s : b), 0);
const WORST = Math.max(...Array.from({ length: 24 - SPAN + 1 }, (_, s) => windowAvg(s)));

function ShiftPanel() {
  const [start, setStart] = useState(12);
  const [dragging, setDragging] = useState(false);
  const chart = useRef<HTMLDivElement>(null);

  const fromX = (clientX: number) => {
    const el = chart.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.round(((clientX - r.left) / r.width) * 24 - SPAN / 2);
    setStart(Math.max(0, Math.min(24 - SPAN, h)));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    fromX(e.clientX);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") setStart((s) => Math.max(0, s - 1));
    if (e.key === "ArrowRight") setStart((s) => Math.min(24 - SPAN, s + 1));
  };

  const avg = windowAvg(start);
  const lower = Math.round((1 - avg / WORST) * 100);
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <div className="border border-white bg-white/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] text-[#1c1d23]">Nightly embedding job · deferrable · drag it</p>
        <Tag tone="stale">Illustrative impact curve</Tag>
      </div>
      <div
        ref={chart}
        onPointerDown={onDown}
        onPointerMove={(e) => dragging && fromX(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className="relative mt-6 h-44 cursor-ew-resize touch-none select-none"
      >
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {IMPACT.map((v, h) => {
            const inJob = h >= start && h < start + SPAN;
            return (
              <div
                key={h}
                className={`flex-1 rounded-t-[2px] transition-colors duration-300 ${inJob ? "bg-[#3d5bff]" : v < 0.45 ? "bg-[#b9c9ff]" : "bg-[#d5d9e8]"}`}
                style={{ height: `${v * 100}%` }}
              />
            );
          })}
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Job start hour"
          aria-valuemin={0}
          aria-valuemax={24 - SPAN}
          aria-valuenow={start}
          aria-valuetext={`${hh(start)} to ${hh(start + SPAN)}`}
          onKeyDown={onKey}
          className={`absolute -top-1 flex h-8 items-center justify-center rounded-[3px] bg-[#1c1d23] font-mono text-[10px] uppercase tracking-[0.03em] text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] outline-none ring-[#8fb0ff] focus-visible:ring-2 ${
            dragging ? "scale-105 transition-transform" : "transition-[left,transform] duration-500 ease-[cubic-bezier(.3,1.3,.5,1)]"
          }`}
          style={{ left: `${(start / 24) * 100}%`, width: `${(SPAN / 24) * 100}%` }}
        >
          ⇠ job ⇢
        </div>
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-[#9a9eb0]">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[14px] text-[#1c1d23]">
          {hh(start)}–{hh(start + SPAN)} ·{" "}
          <span key={lower} className={`pop inline-block font-medium ${lower > 40 ? "text-[#1f8a45]" : lower > 10 ? "text-[#a2650b]" : "text-[#c03a3a]"}`}>
            {lower}% lower impact
          </span>{" "}
          <span className="text-[#9a9eb0]">than the peak window</span>
        </p>
        <button
          onClick={() => setStart(BEST)}
          className="rounded-[4px] bg-[#1c1d23] px-3.5 py-2 text-[12.5px] text-white transition-colors hover:bg-[#2f45ff]"
        >
          Find the best window
        </button>
      </div>
    </div>
  );
}

/* ---------- 04 · Budgets: spend water, trigger alerts ---------- */

const START = [62, 74, 91];
const TEAMS = ["team-search", "team-support", "team-research"];
type Toast = { id: number; text: string; tone: Tone };

function BudgetPanel() {
  const [used, setUsed] = useState(START);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(0);

  const spend = (i: number) => {
    const before = used[i];
    const after = before + 7;
    setUsed((u) => u.map((v, j) => (j === i ? after : v)));
    const msgs: Omit<Toast, "id">[] = [];
    if (before < 80 && after >= 80) msgs.push({ text: `${TEAMS[i]} crossed 80% · alert sent`, tone: "stale" });
    if (before < 100 && after >= 100) msgs.push({ text: `${TEAMS[i]} hit its soft limit · team notified`, tone: "alert" });
    msgs.forEach((m) => {
      const t = { id: id.current++, ...m };
      setToasts((x) => [...x, t]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 3200);
    });
  };

  return (
    <div className="relative">
      <div className="space-y-2.5">
        {TEAMS.map((team, i) => {
          const u = used[i];
          const status = u >= 100 ? { l: "Soft limit reached", t: "alert" as const } : u >= 80 ? { l: "Alert sent", t: "stale" as const } : { l: "On track", t: "fresh" as const };
          return (
            <div key={team} className="border border-white bg-white/70 p-4" style={dl(i * 0.1)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[12.5px] text-[#1c1d23]">{team}</p>
                <div className="flex items-center gap-2">
                  <Tag tone={status.t}>{status.l}</Tag>
                  <button
                    onClick={() => spend(i)}
                    className="rounded-[3px] border border-[#d6d9e6] bg-white px-2.5 py-1 font-mono text-[11px] text-[#4a4e5e] transition-all hover:-translate-y-0.5 hover:border-[#3d5bff] hover:text-[#2f45ff] active:scale-95"
                  >
                    + 10 prompts
                  </button>
                </div>
              </div>
              <div className="relative mt-3 h-2 rounded-full bg-[#e3e6f0]">
                <div
                  className={`h-full rounded-full transition-[width,background-color] duration-500 ease-[cubic-bezier(.3,1.3,.5,1)] ${
                    u >= 100 ? "bg-[#e05555]" : u >= 80 ? "bg-[#e6a23c]" : "bg-[#3d5bff]"
                  }`}
                  style={{ width: `${Math.min(u, 100)}%` }}
                />
                <div className="absolute -top-1 h-4 w-px bg-[#1c1d23]/40" style={{ left: "80%" }} title="Alert at 80%" />
              </div>
              <p className="mt-2 text-[12.5px] text-[#7b7f90]">
                <span key={u} className="pop inline-block tabular-nums text-[#1c1d23]">
                  {u}%
                </span>{" "}
                of this month&apos;s estimated water budget
              </p>
            </div>
          );
        })}
      </div>
      <button
        onClick={() => setUsed(START)}
        className="mt-3 font-mono text-[11px] uppercase tracking-[0.04em] text-[#4b63ff] hover:underline"
      >
        ↺ New month
      </button>

      <div className="pointer-events-none absolute -top-3 right-0 z-10 flex flex-col items-end gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="fade-up shadow-[0_12px_30px_-12px_rgba(0,0,0,0.35)]">
            <Tag tone={t.tone}>{t.text}</Tag>
          </div>
        ))}
      </div>
    </div>
  );
}

const levers: { title: string; short: string; body: string; panel: () => ReactNode }[] = [
  {
    title: "Freshness-aware caching",
    short: "Repeat prompts, answered once",
    body: "An exact-match cache answers a repeat prompt without a new model call, for the same key within the hour. Prompts that need fresh information, like the weather or today's news, are flagged by a time-sensitivity check and skip the cache.",
    panel: CachePanel,
  },
  {
    title: "Right-sizing",
    short: "Small model when it's enough",
    body: "A classifier sends easy prompts to smaller models and keeps hard ones where they belong.",
    panel: RoutePanel,
  },
  {
    title: "Time shifting",
    short: "Batch jobs at lower-impact hours",
    body: "Send a batch job with a deadline (the x-dropwise-defer header) and it runs at the lowest-impact hour before then, using an hourly profile you supply; the one that ships is illustrative, not measured. Interactive prompts are never delayed, and the water estimate itself doesn't change with the hour.",
    panel: ShiftPanel,
  },
  {
    title: "Water budgets",
    short: "Per team, with alerts",
    body: "Each virtual key gets a water budget, with alerts and soft limits so teams see their footprint before it grows.",
    panel: BudgetPanel,
  },
];

export default function Levers() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.2);
  const [active, setActive] = useState(0);
  const L = levers[active];
  const Panel = L.panel;

  return (
    <section id="reduce" data-nav="light" className="relative overflow-hidden bg-[linear-gradient(180deg,#a9c2ff_0%,#d6dffb_10%,#eceef6_26%)]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Reduce · try each one"
          line1="Four levers the gateway"
          line2="already controls"
          body="Dropwise doesn't ask your team to change how they work. It uses switches that already sit in the request path. Go on, play with them."
        />

        <div className={`reveal mt-14 grid gap-px border border-white bg-white lg:grid-cols-[340px_minmax(0,1fr)] ${inView ? "is-in" : ""}`} style={dl(0.35)}>
          <div role="tablist" aria-label="Levers" className="grid bg-[#eceef6] sm:grid-cols-2 lg:grid-cols-1">
            {levers.map((l, i) => (
              <button
                key={l.title}
                role="tab"
                aria-selected={active === i}
                onClick={() => setActive(i)}
                className={`group relative border-b border-white px-6 py-5 text-left transition-colors last:border-b-0 ${
                  active === i ? "bg-white/80" : "hover:bg-white/40"
                }`}
              >
                <span
                  className={`absolute inset-y-0 left-0 w-[2px] transition-colors ${active === i ? "bg-[#3d5bff]" : "bg-transparent"}`}
                  aria-hidden
                />
                <span className="font-mono text-[10.5px] text-[#7d8fe0]">0{i + 1}</span>
                <span
                  className={`mt-1 block text-[16px] tracking-[-0.02em] transition-transform duration-300 group-hover:translate-x-1 ${
                    active === i ? "text-[#1c1d23]" : "text-[#5a5e6e]"
                  }`}
                >
                  {l.title}
                </span>
                <span className="mt-0.5 block text-[13px] text-[#8a8ea0]">{l.short}</span>
              </button>
            ))}
          </div>

          <div role="tabpanel" className="min-h-[520px] bg-[#f1f3fa] p-5 sm:p-8">
            <div key={active} className="fade-up">
              <p className="max-w-[560px] text-[15px] leading-relaxed text-[#4a4e5e]">{L.body}</p>
              <div className="mt-6">
                <Panel />
              </div>
              <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.03em] text-[#a2a5b3]">Examples use demo data</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
