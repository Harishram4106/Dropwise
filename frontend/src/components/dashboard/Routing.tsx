"use client";

// Page 6, /dashboard/routing: demo step 5, plus proof the classifier is careful.
//   Hero: a prompt box. On submit the classifier decides (POST /route/classify) and a diagram shows where the
//         request would go: small or large model, and whether the cache may answer it. Sample prompt chips.
//   Light: how the classifier scores on its eval set (GET /eval/routing), with its mistakes listed.
//   Dark: what the cache does, and when it steps aside.
// Data: the intelligence API, offline and keyless (./routingData); saved copies in demo mode.

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { Magnetic } from "@/components/Magnetic";
import { SectionHead, Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { fmtInt, modelName, type RouteDecision, type RoutingEval, type RoutingMistake, TIME_SIGNALS } from "@/lib/dropwise";
import { delay, HeroSurface, Kind } from "./bits";
import { useConnection } from "./connection";
import { classifyPrompt, NotClassifiable, SAMPLES, useRoutingEval } from "./routingData";
import { Footer, PAGES, Shell } from "./Shell";

const MAX_CHARS = 2000;
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(/\.0$/, "")}%`;

/* ------------------------------------------------------------- diagram */

const MONO = { fontFamily: "var(--font-geist-mono), ui-monospace, monospace" };

function Node({ x, y, w, h, title, sub, active, dim }: { x: number; y: number; w: number; h: number; title: string; sub: string; active?: boolean; dim?: boolean }) {
  return (
    <g style={{ transition: "opacity 0.6s", opacity: dim ? 0.38 : 1 }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill={active ? "rgba(143,176,255,0.28)" : "rgba(255,255,255,0.06)"}
        stroke={active ? "#cfdcff" : "rgba(255,255,255,0.3)"}
        strokeWidth={active ? 1.6 : 1}
        style={{ transition: "fill 0.6s, stroke 0.6s", filter: active ? "drop-shadow(0 0 14px rgba(143,176,255,0.7))" : undefined }}
      />
      <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={500}>
        {title}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={9.5} style={MONO}>
        {sub}
      </text>
    </g>
  );
}

function Diagram({ tier, small, large, idle }: { tier: RouteDecision["tier"] | null; small: string; large: string; idle: boolean }) {
  const toSmall = "M280 130 C330 130 330 55 380 55";
  const toLarge = "M280 130 C330 130 330 205 380 205";
  const line = (d: string, on: boolean) => (
    <g>
      <path d={d} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1.2} strokeDasharray="3 5" />
      {on && <path d={d} pathLength={1} fill="none" stroke="#cfdcff" strokeWidth={2.2} strokeLinecap="round" className="route-flow" style={{ filter: "drop-shadow(0 0 6px rgba(160,190,255,0.9))" }} />}
    </g>
  );
  return (
    <svg viewBox="0 0 520 260" className="h-auto w-full" role="img" aria-label={tier ? `The prompt goes to the ${tier} model` : "Prompt, classifier, small and large model"}>
      <path d="M106 130 H170" stroke="rgba(255,255,255,0.45)" strokeWidth={1.4} fill="none" />
      {line(toSmall, tier === "small")}
      {line(toLarge, tier === "large")}
      <Node x={10} y={100} w={96} h={60} title="Prompt" sub="what you ask" />
      <Node x={170} y={90} w={110} h={80} title="Classifier" sub="rules · no model" active={!idle} />
      <Node x={380} y={20} w={130} h={70} title="Small" sub={small} active={tier === "small"} dim={tier === "large"} />
      <Node x={380} y={170} w={130} h={70} title="Large" sub={large} active={tier === "large"} dim={tier === "small"} />
    </svg>
  );
}

/* ---------------------------------------------------------------- hero */

type Outcome =
  | { kind: "idle" }
  | { kind: "loading"; prompt: string }
  | { kind: "ok"; prompt: string; decision: RouteDecision; source: "live" | "saved" }
  | { kind: "error"; prompt: string; message: string };

function Decision({ o, small, large, avgUs }: { o: Outcome; small: string; large: string; avgUs: number }) {
  const d = o.kind === "ok" ? o.decision : null;
  const bypass = d?.cache === "bypass";
  return (
    <div className="fade-up border border-white/15 bg-white/[0.06] p-5 backdrop-blur-md sm:p-7" style={delay(0.9)} data-no-splash>
      <Diagram tier={d?.tier ?? null} small={modelName(small)} large={modelName(large)} idle={!d} />

      {o.kind === "error" && <p className="mt-5 border-l-2 border-[#ffc46b] pl-4 text-[14px] leading-relaxed text-white/80">{o.message}</p>}
      {(o.kind === "idle" || o.kind === "loading") && <p className="mt-5 text-[14px] text-white/55">{o.kind === "loading" ? "Classifying…" : "Ask the classifier something to see where it would go."}</p>}

      {d && o.kind === "ok" && (
        <div className={o.kind === "ok" ? "" : "opacity-50"}>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-white/15 pt-5">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/50">Goes to</p>
              <p className="mt-1 text-[clamp(30px,3vw,42px)] font-medium leading-none tracking-[-0.045em]">
                {d.tier === "small" ? "Small" : "Large"} <span className="text-white/55">· {modelName(d.tier === "small" ? small : large)}</span>
              </p>
            </div>
            <Tag dark tone={bypass ? "stale" : "fresh"}>
              {bypass ? "Cache bypassed" : "Cache can answer"}
            </Tag>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/50">Confidence</span>
            <div className="h-1.5 w-32 rounded-full bg-white/15">
              <div className="h-full rounded-full bg-[#8fb0ff] transition-[width] duration-700" style={{ width: `${d.confidence * 100}%` }} />
            </div>
            <span className="font-mono text-[12px] tabular-nums text-white/85">{d.confidence}</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {d.signals.length ? (
              d.signals.map((s) => (
                <Tag key={s} dark tone={TIME_SIGNALS.has(s) ? "stale" : "blue"}>
                  {s}
                </Tag>
              ))
            ) : (
              <Tag dark>no signal</Tag>
            )}
          </div>

          <ul className="mt-5 space-y-2">
            {d.reasons.map((r) => (
              <li key={r} className="border-l-2 border-white/25 pl-3 text-[13.5px] leading-snug text-white/85">
                {r}
              </li>
            ))}
          </ul>

          <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">
            Classifier {d.classifier_version} · rules, no model call · about {avgUs} µs per prompt · {o.source === "live" ? "live" : "saved result"}
          </p>
        </div>
      )}
    </div>
  );
}

function Hero() {
  const { status, health } = useConnection();
  const { report } = useRoutingEval();
  const [text, setText] = useState(SAMPLES[0].prompt);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const seq = useRef(0);
  const small = health?.small_model ?? "anthropic/claude-haiku-5-5";
  const large = health?.large_model ?? "anthropic/claude-opus-5-5";

  const run = async (prompt: string) => {
    const p = prompt.trim();
    if (!p) return;
    const mine = ++seq.current;
    setOutcome({ kind: "loading", prompt: p });
    try {
      const r = await classifyPrompt(p, status === "live");
      if (mine === seq.current) setOutcome({ kind: "ok", prompt: p, decision: r.decision, source: r.source });
    } catch (err) {
      if (mine !== seq.current) return;
      setOutcome({ kind: "error", prompt: p, message: err instanceof NotClassifiable ? err.message : "The classifier couldn't be reached." });
    }
  };

  // Show a first answer straight away, so the page opens with something to look at.
  const started = useRef(false);
  useEffect(() => {
    if (status === "connecting" || started.current) return;
    // Mark it started only when the timer fires: React's dev double-run cancels the first timer.
    const t = setTimeout(() => {
      started.current = true;
      void run(SAMPLES[0].prompt);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const pick = (prompt: string) => {
    setText(prompt);
    void run(prompt);
  };

  return (
    <HeroSurface className="min-h-[100svh]">
      <div className="relative mx-auto flex min-h-[100svh] max-w-[1320px] flex-col px-5 pb-16 pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Routing &amp; cache</span>
          <span className="rounded-[2px] border border-white/15 px-2 py-1 text-white/55">Offline · no model call · no key</span>
        </div>

        <div className="mt-7 grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-14">
          <div>
            <h1 className="jelly text-[clamp(36px,4.8vw,76px)] font-medium leading-[0.98] tracking-[-0.058em]">
              <BlurText text="Ask the classifier," className="headline-grey block" start={0.2} />
              <BlurText text="see where it goes" className="block" start={0.55} />
            </h1>
            <p className="fade-up mt-5 max-w-[500px] text-[15.5px] leading-relaxed tracking-[-0.01em] text-white/75" style={delay(1.1)}>
              An easy prompt can go to the small model; anything unclear stays on the large one. A prompt whose answer changes over time never uses the cache.
            </p>

            <form
              className="fade-up mt-8"
              style={delay(1.25)}
              data-no-splash
              onSubmit={(e) => {
                e.preventDefault();
                void run(text);
              }}
            >
              <label htmlFor="route-prompt" className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">
                Your prompt
              </label>
              <textarea
                id="route-prompt"
                value={text}
                maxLength={MAX_CHARS}
                rows={3}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void run(text);
                  }
                }}
                placeholder="Type any prompt, for example: Convert 5 miles to kilometres"
                className="mt-2 w-full resize-none border border-white/20 bg-white/[0.06] p-4 text-[15px] leading-relaxed text-white backdrop-blur-md transition-colors placeholder:text-white/35 focus:border-[#8fb0ff] focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Magnetic>
                  <button type="submit" disabled={!text.trim()} className="group inline-flex h-12 items-stretch text-[15px] tracking-[-0.01em] text-white disabled:opacity-50">
                    <span className="flex items-center rounded-l-[5px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[filter] group-hover:brightness-110">
                      Classify
                    </span>
                    <span className="ml-[2px] flex w-12 items-center justify-center rounded-r-[5px] bg-[#2f45ff] transition-[filter] group-hover:brightness-110">
                      <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" aria-hidden>
                        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </Magnetic>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">⌘ Enter works too</span>
              </div>
            </form>

            <div className="fade-up mt-7" style={delay(1.4)} data-no-splash>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45">Try one</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SAMPLES.map((s) => (
                  <button
                    key={s.prompt}
                    onClick={() => pick(s.prompt)}
                    aria-pressed={outcome.kind !== "idle" && "prompt" in outcome && outcome.prompt === s.prompt}
                    className={`max-w-full rounded-[3px] border px-3 py-1.5 text-left text-[12.5px] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 ${
                      "prompt" in outcome && outcome.prompt === s.prompt
                        ? "border-white bg-white text-[#0c0d12]"
                        : "border-white/20 bg-white/[0.06] text-white/75 hover:border-white/45 hover:text-white"
                    }`}
                  >
                    <span className="line-clamp-1">{s.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Decision o={outcome} small={small} large={large} avgUs={Math.round(report.avg_classify_us)} />
        </div>
      </div>
    </HeroSurface>
  );
}

/* ---------------------------------------------------------------- eval */

function Stat({ label, value, note, tone = "plain", d, inView }: { label: string; value: ReactNode; note: ReactNode; tone?: "plain" | "good" | "warn"; d: number; inView: boolean }) {
  return (
    <div className={`reveal flex flex-col border border-white/80 bg-white/70 p-6 backdrop-blur ${inView ? "is-in" : ""}`} style={delay(d)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-[#5a5e6e]">{label}</span>
        <Kind kind="measured" />
      </div>
      <p className={`mt-5 text-[clamp(38px,3.8vw,54px)] font-medium leading-none tracking-[-0.05em] ${tone === "warn" ? "text-[#c03a3a]" : "text-[#1c1d23]"}`}>{value}</p>
      <p className="mt-4 text-[13px] leading-relaxed text-[#7b7f90]">{note}</p>
      {tone === "good" && (
        <div className="mt-4">
          <Tag tone="fresh">The number that matters</Tag>
        </div>
      )}
    </div>
  );
}

function MistakeList({ title, blurb, items, tone, d, inView }: { title: string; blurb: string; items: RoutingMistake[]; tone: "stale" | "alert"; d: number; inView: boolean }) {
  return (
    <div className={`reveal border border-[#dfe2ec] bg-white ${inView ? "is-in" : ""}`} style={delay(d)}>
      <div className="border-b border-[#e6e8f0] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] tracking-[-0.01em] text-[#1c1d23]">{title}</p>
          <Tag tone={items.length ? tone : "fresh"}>{items.length ? `${items.length}` : "none"}</Tag>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#7b7f90]">{blurb}</p>
      </div>
      {items.length ? (
        <ul>
          {items.map((m) => (
            <li key={m.id} className="border-t border-[#eef0f5] px-5 py-3.5 first:border-t-0">
              <p className="text-[13.5px] leading-snug text-[#1c1d23]">&ldquo;{m.prompt}&rdquo;</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                expected {m.expected} · got {m.got}
                {m.signals.map((s) => (
                  <Tag key={s}>{s}</Tag>
                ))}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-5 text-[13px] text-[#7b7f90]">Nothing on this list.</p>
      )}
    </div>
  );
}

function Scores({ r, source }: { r: RoutingEval; source: "live" | "saved" }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.1);
  const { query } = useConnection();
  const hard = r.hard_routed_small.length;
  return (
    <section data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Does it hold up?"
          line1="Careful by design,"
          line2="and scored in the open"
          body={`The classifier is graded on ${fmtInt(r.items)} labelled prompts: did it pick the right model, and did it spot the ones whose answers go out of date? Being wrong in the cautious direction costs savings; being wrong the other way risks answer quality.`}
        />

        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Tier accuracy" value={pct(r.tier_accuracy)} note={`Right model for ${fmtInt(Math.round(r.tier_accuracy * r.items))} of ${fmtInt(r.items)} prompts.`} d={0.25} inView={inView} />
          <Stat label="Routed small" value={pct(r.routed_small_share)} note="Share of the eval prompts it sent to the small model." d={0.33} inView={inView} />
          <Stat
            label="Hard prompts routed small"
            value={fmtInt(hard)}
            note="Hard prompts sent to the small model are the risk to answer quality. The goal is zero."
            tone={hard === 0 ? "good" : "warn"}
            d={0.41}
            inView={inView}
          />
          <Stat
            label="Time-sensitivity"
            value={
              <>
                {pct(r.time_sensitivity.precision, 0)}
                <span className="mx-1.5 text-[0.4em] tracking-normal text-[#9a9eb0]">precision</span>
              </>
            }
            note={
              <>
                Recall {pct(r.time_sensitivity.recall, 0)}: it caught {r.time_sensitivity.missed.length === 0 ? "every" : "most"} prompt that needs fresh information.
              </>
            }
            d={0.49}
            inView={inView}
          />
        </div>

        <div className="mt-10 grid gap-3 lg:grid-cols-3">
          <MistakeList title="Hard, routed small" blurb="Risks answer quality." items={r.hard_routed_small} tone="alert" d={0.55} inView={inView} />
          <MistakeList title="Easy, kept on the large model" blurb="Costs savings only." items={r.easy_kept_large} tone="stale" d={0.62} inView={inView} />
          <MistakeList
            title="Evergreen, flagged time-sensitive"
            blurb="Skips the cache needlessly; costs savings only."
            items={r.time_sensitivity.false_positives}
            tone="stale"
            d={0.69}
            inView={inView}
          />
        </div>

        <div className={`reveal mt-10 max-w-[860px] border-l-2 border-[#4b63ff] pl-5 ${inView ? "is-in" : ""}`} style={delay(0.75)}>
          <p className="text-[14px] leading-relaxed text-[#4a4e5e]">
            These {fmtInt(r.items)} prompts are the set the rules were tuned on, so treat this score as a floor on how well they fit, not a forecast. The{" "}
            <Link href={`${PAGES.benchmark.href}${query}`} className="text-[#3048e6] underline decoration-[#b9c6ff] underline-offset-2 hover:decoration-[#3048e6]">
              Before / after page
            </Link>{" "}
            runs 150 prompts the classifier has never seen, and shows what it did with each kind. Classifying takes about {Math.round(r.avg_classify_us)} µs per prompt
            on average ({source === "live" ? "measured just now by the live API" : "from the saved run"}).
          </p>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- cache */

function Cache() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.12);
  const steps: { n: string; title: string; body: string }[] = [
    {
      n: "01",
      title: "An exact match, per key",
      body: "A repeat prompt is answered from the cache only when it matches, word for word after tidying whitespace and case, and only for the same virtual key. Answers are kept for an hour.",
    },
    {
      n: "02",
      title: "Fresh information skips it",
      body: "When the classifier sees a relative time (now, today), recent news, an outage or a fast-changing topic, the cache is bypassed on purpose, so nobody gets a stale answer.",
    },
    {
      n: "03",
      title: "Unsure means safe",
      body: "If the classifier can't be reached, the cache is skipped and the model you asked for is used. Streaming and tool calls are passed through untouched.",
    },
  ];
  return (
    <section data-nav="dark" className="relative isolate overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_0%_100%,rgba(61,91,255,0.8)_0%,rgba(36,54,240,0)_70%),radial-gradient(40%_35%_at_100%_0%,rgba(47,69,255,0.35)_0%,transparent_70%)]"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-32">
        <SectionHead
          dark
          inView={inView}
          eyebrow="The cache"
          line1="Answer repeats once,"
          line2="never serve stale"
          body="Right-sizing picks the model; the cache decides whether a model is needed at all. Both read the same decision from the classifier."
        />
        <ol className="mt-14 grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.n} className={`reveal bg-[#07080d]/80 p-7 backdrop-blur sm:p-8 ${inView ? "is-in" : ""}`} style={delay(0.25 + i * 0.12)}>
              <span className="font-mono text-[11px] text-[#8fb0ff]">{s.n}</span>
              <p className="mt-4 text-[19px] tracking-[-0.02em] text-white">{s.title}</p>
              <p className="mt-3 text-[14px] leading-[1.55] text-white/60">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default function Routing() {
  const { report, source } = useRoutingEval();
  return (
    <Shell scopeToggle={false}>
      <Hero />
      <Scores r={report} source={source} />
      <Cache />
      <Footer />
    </Shell>
  );
}
