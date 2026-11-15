"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Magnetic } from "./Magnetic";
import { useReveal } from "./useReveal";
import { SectionHead, Tag, dl } from "./ui";

/* ---------- Playground math (registry v2 factors) ---------- */

// Energy per prompt: Google's median Gemini prompt (0.24 Wh) to OpenAI's average ChatGPT query (0.34 Wh).
// The registry has no per-token or per-model energy figure yet, so both model sizes use this range.
const ENERGY_WH = [0.24, 0.34] as const;
// Assumption, labeled in the UI: energy scales with length, from a 400-token response (Mistral's reference length).
const REF_TOKENS = 400;
// Water factors, L per kWh (= mL per Wh): Microsoft on-site WUE (direct), LBNL 2024 US grid average (indirect).
const WATER = { direct: 0.27, indirect: 4.52 } as const;
const REGIONS = {
  us: { label: "US", note: "US grid average" },
  unknown: { label: "Not disclosed", note: "not disclosed · US average assumed" },
} as const;
type Model = "small" | "large";
type Region = keyof typeof REGIONS;

function estimate(tokens: number, indirect: boolean) {
  const scale = tokens / REF_TOKENS;
  const factor = WATER.direct + (indirect ? WATER.indirect : 0);
  const wh = [ENERGY_WH[0] * scale, ENERGY_WH[1] * scale] as const;
  // 1 Wh × 1 L/kWh = 1 mL
  return { wh, low: wh[0] * factor, high: wh[1] * factor };
}

const fmt = (v: number) => (v < 0.1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US"));

function compare(ml: number) {
  if (ml <= 0) return "not a single drop";
  if (ml < 1) return `about ${Math.max(1, Math.round(ml / 0.05))} drops`;
  if (ml < 15) return `about ${(ml / 5).toFixed(1)} teaspoons`;
  if (ml < 120) return `about ${(ml / 15).toFixed(1)} tablespoons`;
  return `about ${(ml / 240).toFixed(1)} cups`;
}

/* ---------- Small controls ---------- */

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { v: T; l: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full rounded-[4px] border border-white/15 p-0.5 text-[12.5px]">
      {options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`flex-1 rounded-[3px] px-2.5 py-1.5 transition-all ${
            value === o.v ? "bg-white text-[#0c0d12] shadow-[0_4px_16px_-6px_rgba(160,190,255,0.8)]" : "text-white/60 hover:text-white"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="group flex w-full items-center justify-between gap-4 rounded-[4px] border border-white/10 px-3 py-2.5 text-left transition-colors hover:border-white/25"
    >
      <span>
        <span className="block text-[13.5px] text-white/90">{label}</span>
        <span className="block text-[12px] text-white/40">{hint}</span>
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[#4b69ff]" : "bg-white/15"}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-300 ease-[cubic-bezier(.3,1.6,.5,1)] ${
            on ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">{children}</p>;
}

/* ---------- The glass ---------- */

function Glass({ level, empty }: { level: number; empty: boolean }) {
  // level: 0..1 of the glass height
  const top = 30;
  const bottom = 250;
  const y = bottom - (bottom - top) * level;
  // One wavelength per loop; 50 and 100 both divide the 100px scroll, so the loop is seamless.
  const wave = (amp: number, len: number) => {
    let d = "M 0 0";
    for (let x = 0; x < 400; x += len) d += ` q ${len / 4} ${-amp} ${len / 2} 0 t ${len / 2} 0`;
    return d + " V 300 H 0 Z";
  };
  return (
    <svg viewBox="0 0 200 270" className="h-auto w-full max-w-[220px]" aria-hidden>
      <defs>
        <clipPath id="glass-in">
          <path d="M 34 30 L 166 30 L 150 250 Q 149 258 141 258 L 59 258 Q 51 258 50 250 Z" />
        </clipPath>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fb0ff" />
          <stop offset="1" stopColor="#2f45ff" />
        </linearGradient>
      </defs>
      {/* tick marks */}
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1="150" x2="160" y1={bottom - (bottom - top) * t} y2={bottom - (bottom - top) * t} stroke="rgba(255,255,255,0.25)" />
      ))}
      <g clipPath="url(#glass-in)">
        <rect x="0" y="0" width="200" height="270" fill="rgba(255,255,255,0.03)" />
        <g style={{ transform: `translateY(${y.toFixed(1)}px)`, transition: "transform 1s cubic-bezier(.3,1.35,.5,1)" }}>
          <g className="svg-wave-b">
            <path d={wave(5, 100)} transform="translate(0 -3)" fill="#5b78ff" opacity={empty ? 0 : 0.45} style={{ transition: "opacity .4s" }} />
          </g>
          <g className="svg-wave-a">
            <path d={wave(4, 50)} fill="url(#water)" opacity={empty ? 0 : 0.95} style={{ transition: "opacity .4s" }} />
          </g>
        </g>
        {!empty &&
          [60, 92, 120, 140].map((x, i) => (
            <circle key={x} cx={x} cy={248} r={2 + (i % 2)} fill="rgba(255,255,255,0.55)" className="bubble" style={{ "--d": `${i * 0.8}s` } as CSSProperties} />
          ))}
      </g>
      <path
        d="M 34 30 L 166 30 L 150 250 Q 149 258 141 258 L 59 258 Q 51 258 50 250 Z"
        fill="none"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M 44 46 L 56 236" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Playground ---------- */

function Playground() {
  const [model, setModel] = useState<Model>("large");
  const [tokens, setTokens] = useState(900);
  const [region, setRegion] = useState<Region>("us");
  const [indirect, setIndirect] = useState(true);
  const [askedBefore, setAskedBefore] = useState(false);
  const [timeSensitive, setTimeSensitive] = useState(false);

  const cacheHit = askedBefore && !timeSensitive;
  const bypass = askedBefore && timeSensitive;
  const e = estimate(tokens, indirect);
  const low = cacheHit ? 0 : e.low;
  const high = cacheHit ? 0 : e.high;
  // map the upper estimate onto the glass on a log scale: 0.01 mL → empty-ish, 100 mL → full
  const level = cacheHit ? 0.02 : Math.min(0.94, Math.max(0.06, (Math.log10(high) + 2) / 4));
  const routeTip = model === "large" && tokens < 600 && !cacheHit;

  return (
    <div className="bg-[#07080d]/75 p-5 backdrop-blur sm:p-8 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/70">Playground · build a request</p>
        <Tag dark tone="fresh">Registry v2 factors · length scaling assumed</Tag>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_240px_1fr] lg:gap-12">
        {/* controls */}
        <div className="space-y-6">
          <div>
            <Label>Model</Label>
            <Segmented
              label="Model"
              value={model}
              onChange={setModel}
              options={[
                { v: "small", l: "Small model" },
                { v: "large", l: "Large model" },
              ]}
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <Label>Prompt + answer length</Label>
              <span className="font-mono text-[12px] tabular-nums text-white">{tokens.toLocaleString("en-US")} tokens</span>
            </div>
            <input
              type="range"
              min={50}
              max={4000}
              step={50}
              value={tokens}
              onChange={(ev) => setTokens(Number(ev.target.value))}
              aria-label="Prompt and answer length in tokens"
              className="w-full accent-[#6f8cff]"
            />
            <div className="flex justify-between font-mono text-[10px] text-white/30">
              <span>a quick question</span>
              <span>a long report</span>
            </div>
          </div>
          <div>
            <Label>Region</Label>
            <Segmented
              label="Region"
              value={region}
              onChange={setRegion}
              options={(Object.keys(REGIONS) as Region[]).map((k) => ({ v: k, l: REGIONS[k].label }))}
            />
          </div>
          <div>
            <Label>What is counted</Label>
            <Segmented
              label="What is counted"
              value={indirect ? "ind" : "dir"}
              onChange={(v) => setIndirect(v === "ind")}
              options={[
                { v: "dir", l: "Direct" },
                { v: "ind", l: "Direct + indirect" },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Switch on={askedBefore} onChange={setAskedBefore} label="Asked this before" hint="The same prompt is already cached" />
            <Switch on={timeSensitive} onChange={setTimeSensitive} label="Needs fresh info" hint="e.g. “what's the news right now?”" />
          </div>
        </div>

        {/* glass */}
        <div className="flex flex-col items-center justify-center text-center">
          <Glass level={level} empty={cacheHit} />
          <p className="mt-5 text-[40px] font-medium leading-none tracking-[-0.05em] text-white tabular-nums">
            {cacheHit ? "≈ 0" : `${fmt(low)}–${fmt(high)}`}
            <span className="ml-1.5 text-[16px] tracking-[-0.02em] text-white/50">mL</span>
          </p>
          <p className="mt-2 text-[13px] text-white/55">
            {cacheHit ? "Served from cache. No model call at all." : `Upper estimate is ${compare(high)}.`}
          </p>
        </div>

        {/* receipt */}
        <div>
          <Label>Live receipt</Label>
          <div className="divide-y divide-white/[0.07] border-y border-white/[0.07] text-[13px]">
            {[
              ["model", cacheHit ? "— (no call)" : model === "large" ? "large-model" : "small-model"],
              ["region", REGIONS[region].note],
              ["energy", cacheHit ? "0 Wh" : `${e.wh[0].toFixed(2)}–${e.wh[1].toFixed(2)} Wh`],
              ["scope", indirect ? "direct_plus_indirect" : "direct_only"],
              ["cache", cacheHit ? "hit" : bypass ? "bypassed (time-sensitive)" : "miss"],
            ].map(([k, val]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.03em] text-white/40">{k}</span>
                <span key={val} className="fade-up text-right text-white/85">
                  {val}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] leading-relaxed text-white/40">
            water = energy per prompt × (tokens ÷ 400) × water factor
            <br />
            0.24–0.34 Wh · 0.27 L/kWh direct · +4.52 L/kWh indirect
          </p>
          <div className="mt-5 min-h-[92px]">
            {routeTip && (
              <div className="fade-up rounded-[4px] border border-[#8fb0ff]/30 bg-[#3d5bff]/15 p-3.5">
                <p className="text-[13px] text-[#dbe4ff]">
                  This looks easy enough for a smaller model. Dropwise measures the tokens and cost saved; the registry has no
                  per-model energy figure yet, so the water range stays the same.
                </p>
                <button
                  onClick={() => setModel("small")}
                  className="mt-2 font-mono text-[11px] uppercase tracking-[0.04em] text-[#9db4ff] underline-offset-4 hover:underline"
                >
                  Route it to the small model →
                </button>
              </div>
            )}
            {bypass && (
              <div className="fade-up rounded-[4px] border border-[#ffc46b]/30 bg-[#ffc46b]/10 p-3.5 text-[13px] text-[#ffe2b0]">
                Cached answer skipped: this prompt needs fresh information, so Dropwise never serves a stale reply.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Claim checker ---------- */

type Atom = { text: string; verdict: string; tone: "fresh" | "stale" | "plain" | "alert"; why: string; sources: string[] };

// Real claim checker output (POST /claims/check, rules split, checked against signed registry v2).
const CLAIMS: { text: string; atoms: Atom[] }[] = [
  {
    text: "One ChatGPT question equals a bottle of water.",
    atoms: [
      {
        text: "One ChatGPT question equals a bottle of water",
        verdict: "Overstated",
        tone: "stale",
        why: "Claim: 500 mL per response. About 10x the highest published estimate, 10–50 mL per response (UC Riverside, Making AI Less Thirsty, on-site plus electricity water). Other published figures: 0.32 mL per query (OpenAI CEO statement, scope not stated).",
        sources: ["UC Riverside, Making AI Less Thirsty", "OpenAI CEO statement"],
      },
    ],
  },
  {
    text: "AI doesn't use any water at all.",
    atoms: [
      {
        text: "AI doesn't use any water at all",
        verdict: "Unsupported",
        tone: "alert",
        why: "The claim states no figure, so there is nothing to check against sources.",
        sources: [],
      },
    ],
  },
  {
    text: "Google says a median Gemini prompt uses about 0.26 mL.",
    atoms: [
      {
        text: "Google says a median Gemini prompt uses about 0.26 mL",
        verdict: "Supported",
        tone: "fresh",
        why: "Claim: 0.26 mL per response. Consistent with 0.26 mL per prompt (Google, on-site water only).",
        sources: ["Google, AI at Google scale"],
      },
    ],
  },
  {
    text: "Every AI company measures water the same way.",
    atoms: [
      {
        text: "Every AI company measures water the same way",
        verdict: "Unsupported",
        tone: "alert",
        why: "The claim states no figure, so there is nothing to check against sources.",
        sources: [],
      },
    ],
  },
];

const STEPS = ["Splitting into atomic claims", "Matching registry sources", "Scoring freshness", "Writing the verdict"];

function ClaimChecker() {
  const [input, setInput] = useState(CLAIMS[0].text);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Atom[] | "unknown" | null>(null);
  const [step, setStep] = useState(-1);
  const [ref, inView] = useReveal<HTMLDivElement>(0.5);
  const [autoRan, setAutoRan] = useState(false);

  const run = (text: string) => {
    setInput(text);
    setQuery(text);
    setResult(null);
    setStep(0);
  };

  useEffect(() => {
    if (step < 0) return;
    const t = setTimeout(() => {
      if (step + 1 < STEPS.length) {
        setStep(step + 1);
        return;
      }
      const norm = (s: string) => s.trim().toLowerCase().replace(/[.!?]/g, "");
      const found = CLAIMS.find((c) => norm(c.text) === norm(query));
      setResult(found ? found.atoms : "unknown");
      setStep(-1);
    }, 480);
    return () => clearTimeout(t);
  }, [step, query]);

  useEffect(() => {
    if (!inView || autoRan) return;
    const t = setTimeout(() => {
      setAutoRan(true);
      run(CLAIMS[0].text);
    }, 500);
    return () => clearTimeout(t);
  }, [inView, autoRan]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) run(input);
  };

  const checking = step >= 0;

  return (
    <div ref={ref} className="bg-[#07080d]/75 p-5 backdrop-blur sm:p-8 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/70">Claim checker · myth-buster</p>
        <Tag dark tone="fresh">Real checker output · registry v2</Tag>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-12">
        <div>
          <form onSubmit={onSubmit} className="flex items-stretch gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Claim to check"
              className="min-w-0 flex-1 rounded-[4px] border border-white/15 bg-white/[0.04] px-4 py-3 text-[15px] tracking-[-0.01em] text-white outline-none transition-colors placeholder:text-white/30 focus:border-[#8fb0ff]/60"
              placeholder="Paste a water claim…"
            />
            <Magnetic strength={0.15}>
              <button
                type="submit"
                disabled={checking}
                className="h-full rounded-[4px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-5 text-[13.5px] text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
              >
                Check
              </button>
            </Magnetic>
          </form>
          <p className="mb-3 mt-6 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">Or try one of these</p>
          <div className="flex flex-wrap gap-2">
            {CLAIMS.map((c) => (
              <button
                key={c.text}
                onClick={() => run(c.text)}
                disabled={checking}
                className={`rounded-full border px-3 py-1.5 text-left text-[12.5px] transition-all hover:-translate-y-0.5 disabled:opacity-50 ${
                  input === c.text ? "border-[#8fb0ff]/60 bg-[#3d5bff]/20 text-white" : "border-white/15 text-white/65 hover:border-white/35 hover:text-white"
                }`}
              >
                {c.text}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-[240px]" aria-live="polite">
          {checking && (
            <ul className="space-y-2.5">
              {STEPS.map((s, i) => (
                <li key={s} className={`flex items-center gap-2.5 font-mono text-[11.5px] uppercase tracking-[0.03em] transition-colors ${i < step ? "text-[#9dffb4]" : i === step ? "text-white" : "text-white/25"}`}>
                  <span className="w-3 text-center">{i < step ? "✓" : i === step ? <span className="blink inline-block h-1.5 w-1.5 bg-[#8fb0ff]" /> : "·"}</span>
                  {s}
                </li>
              ))}
            </ul>
          )}
          {!checking && result === "unknown" && (
            <div className="fade-up border-t border-white/[0.07] py-4">
              <Tag dark>Demo mode</Tag>
              <p className="mt-3 max-w-[460px] text-[14px] leading-relaxed text-white/70">
                This page shows saved results for the sample claims. The claim checker itself takes any claim through
                POST /claims/check: it splits it into atomic claims and checks each one against the registry, plus live
                Tavily sources when a key is set.
              </p>
            </div>
          )}
          {!checking &&
            Array.isArray(result) &&
            result.map((a, i) => (
              <div key={a.text} className="fade-up border-t border-white/[0.07] py-4" style={dl(i * 0.18)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[14.5px] text-white/90">{a.text}</p>
                  <span className="pop inline-block" style={{ animationDelay: `${0.25 + i * 0.18}s` }}>
                    <Tag dark tone={a.tone}>
                      {a.verdict}
                    </Tag>
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-snug text-white/50">{a.why}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {a.sources.map((s) => (
                    <Tag key={s} dark>
                      {s}
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

export default function ReceiptSection() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.4);
  return (
    <section id="playground" data-nav="dark" className="relative isolate overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_100%_100%,rgba(61,91,255,0.85)_0%,rgba(36,54,240,0)_70%),radial-gradient(45%_40%_at_0%_0%,rgba(47,69,255,0.45)_0%,transparent_70%)]"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <div ref={ref}>
          <SectionHead
            dark
            inView={inView}
            eyebrow="Playground"
            line1="Build a request."
            line2="Watch the glass fill."
            body="Every call gets a receipt with its range, scope and method. Turn the dials to see what moves the number, then try busting a water myth."
          />
        </div>

        <div className="mt-16 grid gap-px border border-white/10 bg-white/10 lg:grid-cols-2">
          <Playground />
          <ClaimChecker />
        </div>
      </div>
    </section>
  );
}
