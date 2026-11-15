"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useReveal } from "./useReveal";
import { SectionHead, Tag, dl } from "./ui";

type Cache = "hit" | "miss" | "bypass";
type Seed = {
  key: string;
  prompt: string;
  model: string;
  routed?: string;
  tokens: number;
  cache: Cache;
  low: number;
  high: number;
};

// Seeded demo traffic, the same every time (like the deterministic demo mode).
const SEEDS: Seed[] = [
  { key: "team-search", prompt: "Summarize this support ticket thread", model: "large-model", routed: "small-model", tokens: 760, cache: "miss", low: 0.4, high: 2.6 },
  { key: "team-support", prompt: "How do I reset my password?", model: "large-model", tokens: 0, cache: "hit", low: 0, high: 0 },
  { key: "team-research", prompt: "Compare three papers on data-center cooling", model: "large-model", tokens: 2480, cache: "miss", low: 1.6, high: 11.2 },
  { key: "team-search", prompt: "What changed in the news this morning?", model: "large-model", tokens: 1120, cache: "bypass", low: 0.8, high: 5.4 },
  { key: "team-support", prompt: "Translate this reply into Tamil", model: "large-model", routed: "small-model", tokens: 420, cache: "miss", low: 0.2, high: 1.4 },
  { key: "team-research", prompt: "Explain how evaporative cooling works", model: "large-model", tokens: 0, cache: "hit", low: 0, high: 0 },
  { key: "team-search", prompt: "Fix the grammar in this paragraph", model: "large-model", routed: "small-model", tokens: 310, cache: "miss", low: 0.1, high: 0.9 },
  { key: "team-support", prompt: "Draft a refund policy summary", model: "large-model", tokens: 980, cache: "miss", low: 0.7, high: 4.6 },
];

const DIRECT_SHARE = 0.28; // illustrative share when only on-site water is counted
const INITIAL = 4;
const VISIBLE = 6;

const fmt = (v: number) => (v === 0 ? "0" : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US"));

function totals(n: number) {
  let hits = 0;
  let routed = 0;
  let low = 0;
  let high = 0;
  for (let i = 0; i < n; i++) {
    const s = SEEDS[i % SEEDS.length];
    if (s.cache === "hit") hits++;
    if (s.routed) routed++;
    low += s.low;
    high += s.high;
  }
  return { hits, routed, low, high };
}

const scenario = [
  { label: "Model calls", before: 200, after: 142, max: 200, unit: "", kind: "measured" },
  { label: "Tokens", before: 182, after: 121, max: 182, unit: "k", kind: "measured" },
  { label: "Routed to smaller models", before: 0, after: 46, max: 100, unit: "%", kind: "measured" },
] as const;

function CacheTag({ c }: { c: Cache }) {
  if (c === "hit") return <Tag dark tone="fresh">Cache hit</Tag>;
  if (c === "bypass") return <Tag dark tone="stale">Bypassed</Tag>;
  return <Tag dark>Miss</Tag>;
}

type Row = Seed & { id: number; mine?: boolean };
type Feed = { rows: Row[]; count: number; hits: number; routed: number; low: number; high: number; next: number };

const FRESH_WORDS = /\b(now|today|tonight|latest|news|current|weather|price|score|live)\b/i;
const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");

function add(f: Feed, row: Row): Feed {
  return {
    ...f,
    rows: [row, ...f.rows].slice(0, VISIBLE),
    count: f.count + 1,
    hits: f.hits + (row.cache === "hit" ? 1 : 0),
    routed: f.routed + (row.routed ? 1 : 0),
    low: f.low + row.low,
    high: f.high + row.high,
  };
}

function initialFeed(): Feed {
  const t = totals(INITIAL);
  const rows = Array.from({ length: INITIAL }, (_, i) => ({ id: INITIAL - 1 - i, ...SEEDS[INITIAL - 1 - i] }));
  return { rows, count: INITIAL, ...t, next: INITIAL };
}

/** Turns a visitor's own prompt into a demo receipt row. */
function fromPrompt(text: string, id: number, seen: Set<string>): Row {
  const tokens = Math.ceil(text.length / 4) + 220;
  const fresh = FRESH_WORDS.test(text);
  const key = norm(text);
  const cache: Cache = fresh ? "bypass" : seen.has(key) ? "hit" : "miss";
  seen.add(key);
  const routed = cache !== "hit" && tokens < 400 ? "small-model" : undefined;
  const wh = (tokens / 1000) * (routed ? 0.6 : 3.9);
  return {
    id,
    mine: true,
    key: "you",
    prompt: text,
    model: "large-model",
    routed,
    tokens: cache === "hit" ? 0 : tokens,
    cache,
    low: cache === "hit" ? 0 : wh * 3.5 * 0.6,
    high: cache === "hit" ? 0 : wh * 3.5 * 1.6,
  };
}

export default function LiveMeter() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.25);
  const [direct, setDirect] = useState(false);
  const [paused, setPaused] = useState(false);
  const [feed, setFeed] = useState<Feed>(initialFeed);
  const [draft, setDraft] = useState("");
  const [bump, setBump] = useState(0);
  const seen = useRef(new Set<string>());
  const uid = useRef(10_000);

  useEffect(() => {
    if (!inView || paused) return;
    const t = setInterval(
      () => setFeed((f) => ({ ...add(f, { id: f.next, ...SEEDS[f.next % SEEDS.length] }), next: f.next + 1 })),
      2400,
    );
    return () => clearInterval(t);
  }, [inView, paused]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const row = fromPrompt(text, uid.current++, seen.current);
    setFeed((f) => add(f, row));
    setBump((b) => b + 1);
  };

  const k = direct ? DIRECT_SHARE : 1;
  const rows = feed.rows;
  const rv = (x = "") => `reveal ${inView ? "is-in" : ""} ${x}`;

  const stats = [
    { label: "Requests", value: String(feed.count), kind: "measured" },
    { label: "Cache hits", value: String(feed.hits), kind: "measured" },
    { label: "Routed smaller", value: String(feed.routed), kind: "measured" },
    { label: "Est. water", value: `${fmt(feed.low * k)}–${fmt(feed.high * k)}`, unit: "mL", kind: "estimated" },
  ];

  return (
    <section id="meter" data-nav="dark" className="relative isolate overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_0%_100%,rgba(61,91,255,0.8)_0%,rgba(36,54,240,0)_70%),radial-gradient(40%_35%_at_100%_0%,rgba(47,69,255,0.35)_0%,transparent_70%)]"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />

      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <SectionHead
          dark
          inView={inView}
          eyebrow="Live meter"
          line1="Watch every request"
          line2="get its water estimate"
          body="Send prompts through the gateway and each one appears with its estimated range. Flip what is counted and every number moves with it."
        />

        <div className={rv("mt-16 grid gap-px border border-white/10 bg-white/10 lg:grid-cols-[1.4fr_1fr]")} style={dl(0.35)}>
          {/* Live feed */}
          <div className="bg-[#07080d]/75 p-5 backdrop-blur sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.04em] text-white/70">
                  <span className="blink inline-block h-1.5 w-1.5 rounded-full bg-[#7dfc9a]" /> Live meter
                </span>
                <Tag dark>Demo mode · seeded data</Tag>
                <button
                  onClick={() => setPaused((p) => !p)}
                  className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45 transition-colors hover:text-white"
                >
                  {paused ? "▶ Resume" : "❚❚ Pause"}
                </button>
              </div>
              <div role="radiogroup" aria-label="What is counted" className="flex rounded-[3px] border border-white/15 p-0.5 text-[12px]">
                {[
                  { v: true, l: "Direct" },
                  { v: false, l: "Direct + indirect" },
                ].map((o) => (
                  <button
                    key={o.l}
                    role="radio"
                    aria-checked={direct === o.v}
                    onClick={() => setDirect(o.v)}
                    className={`rounded-[2px] px-2.5 py-1 transition-colors ${direct === o.v ? "bg-white text-[#0c0d12]" : "text-white/60 hover:text-white"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-px border border-white/[0.08] bg-white/[0.08] sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="bg-[#0a0b11] px-4 py-3.5">
                  <dt className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.03em] text-white/40">
                    {s.label}
                    <span className={s.kind === "measured" ? "text-white/30" : "text-[#8fb0ff]"}>{s.kind === "measured" ? "M" : "E"}</span>
                  </dt>
                  <dd key={`${s.value}-${bump}`} className="pop mt-1.5 origin-left text-[22px] font-medium tracking-[-0.04em] tabular-nums">
                    {s.value}
                    {s.unit && <span className="ml-1 text-[13px] text-white/45">{s.unit}</span>}
                  </dd>
                </div>
              ))}
            </dl>

            <form onSubmit={send} className="mt-5 flex items-stretch gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={160}
                aria-label="Send your own prompt through the demo gateway"
                placeholder="Type your own prompt and send it through…"
                className="min-w-0 flex-1 rounded-[4px] border border-white/15 bg-white/[0.04] px-3.5 py-2.5 text-[14px] text-white outline-none transition-colors placeholder:text-white/30 focus:border-[#8fb0ff]/60"
              />
              <button
                type="submit"
                className="rounded-[4px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-4 text-[13px] text-white transition-[filter,transform] hover:brightness-110 active:scale-95"
              >
                Send
              </button>
            </form>
            <p className="mt-2 text-[12px] text-white/35">
              Tip: send the same prompt twice to hit the cache, or ask about “today” to see it skip the cache.
            </p>

            <div className="mt-5 hidden grid-cols-[minmax(0,1fr)_150px_84px_104px] gap-3 px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.03em] text-white/35 sm:grid">
              <span>Prompt · key</span>
              <span>Model</span>
              <span>Cache</span>
              <span className="text-right">Water</span>
            </div>
            <ul className="min-h-[372px] sm:mt-0">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className={`fade-up grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-white/[0.07] py-3 sm:grid-cols-[minmax(0,1fr)_150px_84px_104px] ${
                    r.mine ? "-mx-2 border-l-2 border-l-[#8fb0ff] bg-[#3d5bff]/10 px-2" : "px-1"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] text-white/90">{r.prompt}</p>
                    <p className="font-mono text-[10.5px] text-white/35">
                      req_{String(1000 + r.id)} · {r.key}
                    </p>
                  </div>
                  <p className="order-3 col-span-2 text-[12.5px] text-white/60 sm:order-none sm:col-span-1">
                    {r.cache === "hit" ? (
                      <span className="text-white/35">no model call</span>
                    ) : r.routed ? (
                      <>
                        <span className="text-white/35 line-through decoration-white/25">large</span> → {r.routed}
                      </>
                    ) : (
                      r.model
                    )}
                  </p>
                  <div className="order-4 col-span-2 sm:order-none sm:col-span-1">
                    <CacheTag c={r.cache} />
                  </div>
                  <p className="text-right text-[14px] tabular-nums text-white">
                    {r.cache === "hit" ? "≈ 0" : `${fmt(r.low * k)}–${fmt(r.high * k)}`}
                    <span className="ml-1 text-[11px] text-white/40">mL</span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.03em] text-white/35">
              M = measured from gateway logs · E = estimated, always a range
            </p>
          </div>

          {/* Before / after */}
          <div className="flex flex-col bg-[#07080d]/75 p-5 backdrop-blur sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/70">Before and after</p>
              <Tag dark tone="stale">Illustrative scenario</Tag>
            </div>
            <p className="mt-4 text-[15px] leading-snug text-white/80">
              The same 200-prompt workload, replayed on plain Bifrost and then with Dropwise switched on.
            </p>

            <div className="mt-6 space-y-6">
              {scenario.map((s) => (
                <div key={s.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13.5px] text-white/75">{s.label}</p>
                    <p className="text-[13px] tabular-nums text-white/45">
                      {s.before}
                      {s.unit} <span className="text-white/25">→</span>{" "}
                      <span className="text-[16px] text-white">
                        {s.after}
                        {s.unit}
                      </span>
                    </p>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-white/30" style={{ width: `${(s.before / s.max) * 100}%` }} />
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#9db4ff] to-[#3d5bff] shadow-[0_0_14px_rgba(90,120,255,0.7)] transition-[width] duration-[1.4s] ease-[cubic-bezier(.2,.7,.2,1)]"
                        style={{ width: inView ? `${(s.after / s.max) * 100}%` : "0%" }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-px border border-white/[0.08] bg-white/[0.08]">
              <div className="bg-[#0a0b11] p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.03em] text-white/40">Plain Bifrost · est.</p>
                <p className="mt-1.5 text-[20px] tracking-[-0.03em] text-white/70 tabular-nums">
                  {direct ? "50–360" : "180–1,280"}
                  <span className="ml-1 text-[12px] text-white/40">mL</span>
                </p>
              </div>
              <div className="bg-[#0a0b11] p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#8fb0ff]">With Dropwise · est.</p>
                <p className="mt-1.5 text-[20px] tracking-[-0.03em] text-white tabular-nums">
                  {direct ? "27–193" : "96–690"}
                  <span className="ml-1 text-[12px] text-white/40">mL</span>
                </p>
              </div>
            </div>
            <p className="mt-auto pt-6 text-[12.5px] leading-snug text-white/45">
              Placeholder figures that show the format only. The real before/after numbers come from the benchmark harness,
              with calls, tokens and routing measured and water estimated.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
