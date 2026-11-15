"use client";

// Page 5, /dashboard/benchmark: demo step 2, the same workload on plain Bifrost and then with Dropwise on.
//   Hero: two beakers, the estimated water before and after, with a dashed line where the water would sit without
//         Dropwise; the calls avoided, tokens saved and Dropwise's added time beside them.
//   Light: Before | After | Change for every number, each marked Measured or Estimated, and the run's assumptions.
//   Dark: what happened to each kind of prompt (easy, hard, time-sensitive).
//   Light: answer quality after right-sizing, from GET /eval/quality (or "not run yet").
// Data: the gateway's GET /benchmark/latest and the intelligence API's GET /eval/quality (./benchData).

import { type CSSProperties, type ReactNode, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { SectionHead, Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { type BenchReport, fmtInt, fmtMl, modelName, type PromptCategory, type QualityReport, type Range, SCOPE_LABEL, type Scope, type Stats, shortHash } from "@/lib/dropwise";
import { type Loaded, useBenchmark, useQuality } from "./benchData";
import { Count, delay, HeroSurface, Kind, Wave, WaterRange } from "./bits";
import { useConnection } from "./connection";
import { Footer, Shell } from "./Shell";

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(/\.0$/, "")}%`;
const ms = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString("en-US"));
const usd = (x: number | null) => (x === null ? "n/a" : x < 10 ? `$${x.toFixed(2)}` : `$${Math.round(x).toLocaleString("en-US")}`);
const signed = (n: number, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtInt(Math.abs(n))}${unit}`;

/* -------------------------------------------------------------- beaker */

function Beaker({ label, caption, range, level, ghost, tone, d, unit }: { label: string; caption: string; range: Range; level: number; ghost?: number; tone: "before" | "after"; d: number; unit: string }) {
  const [top, bottom] = tone === "before" ? ["#cfd9ff", "#7d8fe0"] : ["#9db4ff", "#3d5bff"];
  return (
    <div className="fade-up min-w-0" style={delay(d)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13.5px] text-white/80">{label}</p>
        <Kind kind="estimated" dark />
      </div>
      <div className="relative mt-4 h-[270px] overflow-hidden rounded-[6px] border border-white/25 bg-white/[0.04] backdrop-blur-sm">
        <div className="absolute inset-x-0 bottom-0 transition-[height] duration-[1500ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]" style={{ height: `${Math.max(2, level * 100)}%` }}>
          <Wave color={top} className="svg-wave-b -top-[12px] opacity-40" style={{ left: -37 }} />
          <Wave color={top} className="svg-wave-a -top-[11px]" />
          <div className="absolute inset-0 top-[2px] opacity-90" style={{ background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)` }} />
          {[0, 1, 2].map((i) => (
            <span key={i} aria-hidden className="bubble absolute bottom-2 h-1.5 w-1.5 rounded-full bg-white/60" style={{ left: `${20 + i * 30}%`, ...delay(i * 1.1) }} />
          ))}
        </div>
        {ghost !== undefined && (
          <>
            <div aria-hidden className="absolute inset-x-0 border-t border-dashed border-white/65" style={{ bottom: `${ghost * 100}%` }} />
            <span className="absolute right-2 font-mono text-[9.5px] uppercase tracking-[0.05em] text-white/75" style={{ bottom: `calc(${ghost * 100}% + 4px)` }}>
              Without Dropwise
            </span>
          </>
        )}
        <p className="absolute inset-x-0 bottom-3 px-2 text-center text-[clamp(24px,2.5vw,34px)] font-medium leading-none tracking-[-0.045em] text-white [text-shadow:0_2px_24px_rgba(5,8,30,0.6)]">
          <WaterRange range={range} animate />
        </p>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-white/50">
        {caption} · {unit}
      </p>
    </div>
  );
}

function Metric({ label, kind, children, note, d }: { label: string; kind: "measured" | "estimated"; children: ReactNode; note: ReactNode; d: number }) {
  return (
    <div className="fade-up border-t border-white/20 pt-4" style={delay(d)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-white/75">{label}</p>
        <Kind kind={kind} dark />
      </div>
      <p className="mt-3 text-[clamp(38px,4vw,58px)] font-medium leading-none tracking-[-0.055em]">{children}</p>
      <p className="mt-3 text-[13px] leading-relaxed text-white/55">{note}</p>
    </div>
  );
}

function Hero({ result, scope, onUseSaved }: { result: Loaded<BenchReport>; scope: Scope; onUseSaved: () => void }) {
  const r = result.state === "ok" ? result.report : null;
  const w = r?.estimated.water_ml[scope];
  const LEVEL = 0.84;
  const ratio = w && w.without_dropwise.high > 0 ? w.with_dropwise.high / w.without_dropwise.high : 1;
  const demo = result.state === "ok" && result.demo;

  return (
    <HeroSurface className="min-h-[100svh]">
      <div className="relative mx-auto flex min-h-[100svh] max-w-[1320px] flex-col px-5 pb-14 pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">
            Before / after{r ? ` · ${fmtInt(r.workload.requests)} requests` : ""}
          </span>
          {r && <span className="rounded-[2px] border border-white/15 px-2 py-1 text-white/55">Workload {shortHash(r.workload.hash)} · seed {r.workload.seed}</span>}
          {demo && !r?.setup.replay && (
            <span title="This run used a stand-in model, so token counts and latency are synthetic. Cache, routing and water logic are the real gateway's.">
              <Tag dark tone="stale">Demo data · stand-in model</Tag>
            </span>
          )}
          {r?.setup.replay && (
            <span title="Each prompt was answered once by the recording model; both runs got that same answer. Routing, caching and the water estimate ran for real.">
              <Tag dark tone="blue">
                Replayed answers · {modelName(r.setup.replay.model)} · recorded {r.setup.replay.recorded_at.slice(0, 10)}
              </Tag>
            </span>
          )}
          {r && !r.clean && <Tag dark tone="alert">Not clean: some requests failed</Tag>}
        </div>

        <div className="mt-7 grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div>
            <h1 className="jelly text-[clamp(36px,4.5vw,72px)] font-medium leading-[0.98] tracking-[-0.058em]">
              <BlurText text="The same prompts," className="headline-grey block" start={0.2} />
              <BlurText text="with and without Dropwise" className="block" start={0.55} />
            </h1>
            <p className="fade-up mt-5 max-w-[520px] text-[15.5px] leading-relaxed tracking-[-0.01em] text-white/75" style={delay(1.2)}>
              {r
                ? `One workload of ${fmtInt(r.workload.requests)} requests (${fmtInt(r.workload.unique_prompts)} unique prompts, ${fmtInt(r.workload.repeats)} of them asked twice), sent straight to Bifrost and then through the Dropwise gateway.`
                : "The same workload, sent straight to Bifrost and then through the Dropwise gateway."}
            </p>

            {r && (
              <div className="mt-9 grid grid-cols-2 gap-6 sm:gap-8">
                <Metric label="Calls avoided" kind="measured" d={1.3} note={`of ${fmtInt(r.workload.requests)} requests · ${pct(r.measured.calls_avoided_share)} fewer model calls`}>
                  <Count value={r.measured.calls_avoided} />
                </Metric>
                <Metric label="Tokens saved" kind="measured" d={1.45} note={`${pct(r.measured.tokens_saved_share)} fewer tokens in and out`}>
                  <Count value={r.measured.tokens_saved} />
                </Metric>
              </div>
            )}
            {r && (
              <p className="fade-up mt-7 max-w-[520px] text-[13.5px] leading-relaxed text-white/60" style={delay(1.6)}>
                <span className="mr-2 inline-block align-middle">
                  <Kind kind="measured" dark />
                </span>
                Dropwise added <span className="tabular-nums text-white/90">{ms(r.measured.gateway_overhead_ms.p50)} ms</span> at the median and{" "}
                <span className="tabular-nums text-white/90">{ms(r.measured.gateway_overhead_ms.p95)} ms</span> at p95 per model call.
              </p>
            )}
          </div>

          {r && w ? (
            <div className="grid grid-cols-2 gap-5 sm:gap-8">
              <Beaker label="Without Dropwise" caption="Every request to the model" range={w.without_dropwise} level={LEVEL} tone="before" d={0.9} unit={SCOPE_LABEL[scope].toLowerCase()} />
              <Beaker
                label="With Dropwise"
                caption={`Kept out: ${fmtMl(w.avoided.low)}–${fmtMl(w.avoided.high)} mL`}
                range={w.with_dropwise}
                level={LEVEL * ratio}
                ghost={LEVEL}
                tone="after"
                d={1.1}
                unit={SCOPE_LABEL[scope].toLowerCase()}
              />
            </div>
          ) : (
            <div className="fade-up self-end border border-white/15 bg-white/[0.06] p-6 backdrop-blur-md sm:p-8" style={delay(0.9)} data-no-splash>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">{result.state === "loading" ? "Loading" : "No benchmark run yet"}</p>
              {result.state === "none" && (
                <>
                  <p className="mt-4 text-[17px] leading-snug text-white/90">Run the workload once and this page fills in. The first command only plans it, with no model calls and no cost.</p>
                  <pre className="mt-5 overflow-x-auto border border-white/15 bg-black/40 p-4 font-mono text-[12.5px] leading-relaxed text-white/85">
                    {`cd gateway\nnpm run bench              # plan only, free\nnpm run bench -- --yes     # runs it, spends API credit`}
                  </pre>
                  <button
                    onClick={onUseSaved}
                    className="mt-6 inline-flex h-11 items-center rounded-[4px] border border-white/25 bg-white/5 px-4 text-[14px] backdrop-blur transition-colors hover:bg-white/10"
                  >
                    View the saved demo run
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="fade-up mt-auto pt-12 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45" style={delay(1.8)}>
          {r ? `Water is an estimate, shown as a range · ${SCOPE_LABEL[scope]} · switch it in the nav` : ""}
        </div>
      </div>
    </HeroSurface>
  );
}

/* --------------------------------------------------------------- table */

interface Row {
  label: string;
  kind: "measured" | "estimated";
  before: ReactNode;
  after: ReactNode;
  change: ReactNode;
  /** Proportional bars for before and after, 0..1 of the larger. */
  bars?: [number, number];
  good?: boolean;
}

const statPair = (s: Stats) => `${ms(s.p50)} / ${ms(s.p95)} ms`;

function rowsOf(r: BenchReport, scope: Scope): Row[] {
  const A = r.runs.without_dropwise;
  const B = r.runs.with_dropwise;
  const w = r.estimated.water_ml[scope];
  const water = (x: Range) => <WaterRange range={x} />;
  const cost = r.estimated.cost_usd;
  const calls = A.model_calls - B.model_calls;
  const overhead = B.gateway_overhead_ms;
  return [
    { label: "Model calls", kind: "measured", before: fmtInt(A.model_calls), after: fmtInt(B.model_calls), change: `${signed(-calls)} · ${pct(r.measured.calls_avoided_share)} fewer`, bars: [1, B.model_calls / Math.max(1, A.model_calls)], good: true },
    { label: "Cache hits", kind: "measured", before: "0", after: `${fmtInt(B.cache_hits ?? 0)}`, change: `${pct(r.measured.cache_hit_share)} of requests answered from the cache` },
    { label: "Time-sensitive, cache bypassed", kind: "measured", before: "–", after: fmtInt(B.cache_bypassed ?? 0), change: "never answered from a stored reply" },
    { label: "Routed to the small model", kind: "measured", before: "0", after: fmtInt(B.routed_small ?? 0), change: `${pct(B.routed_small_share ?? 0)} of model calls` },
    { label: "Tokens in + out", kind: "measured", before: fmtInt(A.tokens_total), after: fmtInt(B.tokens_total), change: `${signed(-r.measured.tokens_saved)} · ${pct(r.measured.tokens_saved_share)} fewer`, bars: [1, B.tokens_total / Math.max(1, A.tokens_total)], good: true },
    { label: "Request latency, p50 / p95", kind: "measured", before: statPair(A.latency_ms), after: statPair(B.latency_ms), change: "includes the model's time; cache hits answer at once" },
    { label: "Added by Dropwise, p50 / p95", kind: "measured", before: "–", after: overhead ? statPair(overhead) : "–", change: overhead ? `+${ms(overhead.p50)} ms at the median per model call` : "" },
    { label: "Errors · retries · cut off", kind: "measured", before: `${A.errors} · ${A.retries} · ${A.truncated}`, after: `${B.errors} · ${B.retries} · ${B.truncated}`, change: r.clean ? "clean run" : "see the warning at the top" },
    {
      label: `Water, ${SCOPE_LABEL[scope].toLowerCase()}`,
      kind: "estimated",
      before: water(w.without_dropwise),
      after: water(w.with_dropwise),
      change: (
        <>
          avoided <WaterRange range={w.avoided} className="text-[#1f8a45]" />
        </>
      ),
      bars: [1, w.without_dropwise.high > 0 ? w.with_dropwise.high / w.without_dropwise.high : 1],
      good: true,
    },
    {
      label: r.setup.replay ? "Cost at list prices (what-if)" : "Cost at list prices",
      kind: "estimated",
      before: usd(cost.without_dropwise),
      after: usd(cost.with_dropwise),
      change:
        cost.saved === null
          ? "price unknown for a model"
          : r.setup.replay
            ? `${usd(cost.saved)} saved if the large model's answers were this long (${cost.prices_as_of} prices)`
            : `${usd(cost.saved)} saved (${cost.prices_as_of} prices)`,
    },
  ];
}

function Bar({ v, tone, inView }: { v: number; tone: "before" | "after"; inView: boolean }) {
  const style: CSSProperties = { width: `${Math.max(2, v * 100)}%`, transformOrigin: "left", animation: inView ? "grow 1.2s var(--ease-out) 0.3s both" : undefined };
  return (
    <div className="mt-2 h-1.5 w-full max-w-[220px] rounded-full bg-[#e3e6f0]">
      <div className={`h-full rounded-full ${tone === "before" ? "bg-[#9a9eb0]" : "bg-[#3d5bff]"}`} style={style} />
    </div>
  );
}

function Compare({ r, scope }: { r: BenchReport; scope: Scope }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.08);
  const rows = rowsOf(r, scope);
  return (
    <section data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Every number, before and after"
          line1="Counted, timed"
          line2="and estimated"
          body="Counts, tokens and timings are measured as the requests ran. Water and cost are estimates worked out from those measurements, so they are labelled and the water is always a range."
        />
        <div className={`reveal mt-14 overflow-x-auto border border-[#dfe2ec] bg-white ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          <table className="w-full min-w-[860px] text-left text-[13.5px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                <th className="px-5 py-3 font-normal">&nbsp;</th>
                <th className="px-3 py-3 font-normal">Without Dropwise</th>
                <th className="px-3 py-3 font-normal">With Dropwise</th>
                <th className="px-5 py-3 font-normal">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-[#eef0f5] align-top transition-colors hover:bg-[#f7f8fc]">
                  <td className="whitespace-nowrap px-5 py-4 text-[#1c1d23]">
                    {row.label}
                    <div className="mt-1">
                      <Kind kind={row.kind} />
                    </div>
                  </td>
                  <td className="px-3 py-4 tabular-nums text-[#5a5e6e]">
                    {row.before}
                    {row.bars && <Bar v={row.bars[0]} tone="before" inView={inView} />}
                  </td>
                  <td className="px-3 py-4 tabular-nums text-[#1c1d23]">
                    {row.after}
                    {row.bars && <Bar v={row.bars[1]} tone="after" inView={inView} />}
                  </td>
                  <td className={`px-5 py-4 ${row.good ? "text-[#1f8a45]" : "text-[#5a5e6e]"}`}>{row.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={`reveal mt-12 grid gap-10 lg:grid-cols-[0.8fr_1.2fr] ${inView ? "is-in" : ""}`} style={delay(0.45)}>
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7b7f90]">How to read it</p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[#5a5e6e]">
              Registry {shortHash(r.setup.registry_hash)}
              {r.setup.registry_version ? ` (v${r.setup.registry_version})` : ""} · classifier {r.setup.classifier_version ?? "n/a"} · asked for{" "}
              {r.setup.model.split("/").pop()} with up to {fmtInt(r.setup.max_tokens)} tokens · {r.setup.concurrency} requests in flight.
            </p>
          </div>
          <ul className="space-y-3 border-l-2 border-[#4b63ff] pl-5">
            {r.notes.map((n) => (
              <li key={n} className="text-[13.5px] leading-relaxed text-[#4a4e5e]">
                {n}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- by prompt */

const CATEGORIES: { key: PromptCategory; title: string; blurb: string }[] = [
  { key: "easy", title: "Easy prompts", blurb: "Lookups, conversions, rewrites, extraction, chat." },
  { key: "hard", title: "Hard prompts", blurb: "Code, maths, analysis, long-form, high-stakes advice." },
  { key: "time_sensitive", title: "Time-sensitive", blurb: "Anything that needs current information." },
];

function Categories({ r }: { r: BenchReport }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.12);
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
          eyebrow="By kind of prompt"
          line1="What happened to"
          line2="each kind of prompt"
          body="The categories are the team's own labels for the workload. The gateway never sees them; it decides from the prompt alone."
        />
        <div className="mt-14 grid gap-px border border-white/10 bg-white/10 lg:grid-cols-3">
          {CATEGORIES.map((c, i) => {
            const s = r.by_category[c.key];
            const hard = c.key === "hard";
            const time = c.key === "time_sensitive";
            const headline = time ? s.cache_bypassed : s.routed_small;
            const calls = s.model_calls_without_dropwise - s.model_calls_with_dropwise;
            return (
              <article key={c.key} className={`reveal bg-[#07080d]/80 p-7 backdrop-blur sm:p-8 ${inView ? "is-in" : ""}`} style={delay(0.25 + i * 0.12)}>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#8fb0ff]">{c.title}</p>
                <p className="mt-2 text-[13px] text-white/50">{c.blurb}</p>
                <p className="mt-8 text-[clamp(44px,4.4vw,64px)] font-medium leading-none tracking-[-0.055em]">
                  <Count value={headline} />
                  <span className="ml-2 text-[0.38em] tracking-normal text-white/45">of {fmtInt(s.requests)}</span>
                </p>
                <p className="mt-3 text-[14px] text-white/80">{time ? "skipped the cache, on purpose" : "sent to the small model"}</p>
                <div className="mt-5">
                  {time ? (
                    s.cache_hits === 0 && s.cache_bypassed === s.requests ? (
                      <Tag dark tone="fresh">None answered from the cache</Tag>
                    ) : (
                      <Tag dark tone="alert">{s.cache_hits} answered from the cache</Tag>
                    )
                  ) : hard ? (
                    s.routed_small === 0 ? (
                      <Tag dark tone="fresh">All stayed on the large model</Tag>
                    ) : (
                      <Tag dark tone="stale">Quality risk: see the check below</Tag>
                    )
                  ) : (
                    <Tag dark tone="blue">Right-sized where the classifier was sure</Tag>
                  )}
                </div>
                <dl className="mt-7 grid grid-cols-2 gap-y-3 border-t border-white/10 pt-5 text-[13px]">
                  <dt className="text-white/45">Model calls</dt>
                  <dd className="text-right tabular-nums text-white/85">
                    {fmtInt(s.model_calls_without_dropwise)} → {fmtInt(s.model_calls_with_dropwise)}
                  </dd>
                  <dt className="text-white/45">Cache hits</dt>
                  <dd className="text-right tabular-nums text-white/85">{fmtInt(s.cache_hits)}</dd>
                  {!time && (
                    <>
                      <dt className="text-white/45">Calls avoided</dt>
                      <dd className="text-right tabular-nums text-[#9dffb4]">{signed(-calls)}</dd>
                    </>
                  )}
                  {time && (
                    <>
                      <dt className="text-white/45">Routed small</dt>
                      <dd className="text-right tabular-nums text-white/85">{fmtInt(s.routed_small)}</dd>
                    </>
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- quality */

function PassBar({ label, v, tone, inView, d }: { label: string; v: number; tone: "large" | "routed" | "small"; inView: boolean; d: number }) {
  const color = { large: "#1c1d23", routed: "#3d5bff", small: "#e6a23c" }[tone];
  return (
    <div className={`reveal ${inView ? "is-in" : ""}`} style={delay(d)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] text-[#2c2e36]">{label}</p>
        <p className="text-[26px] font-medium tracking-[-0.04em] tabular-nums text-[#1c1d23]">{pct(v, 0)}</p>
      </div>
      <div className="mt-2 h-2.5 rounded-full bg-[#e3e6f0]">
        <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: color, transformOrigin: "left", animation: inView ? "grow 1.2s var(--ease-out) 0.4s both" : undefined }} />
      </div>
    </div>
  );
}

function Quality({ q }: { q: Loaded<QualityReport> }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.12);
  const r = q.state === "ok" ? q.report : null;
  return (
    <section data-nav="light" className="relative overflow-hidden bg-[linear-gradient(180deg,#eceef6_0%,#dfe6fb_70%,#c9d6ff_100%)]">
      <div aria-hidden className="pointer-events-none absolute -right-40 bottom-0 h-[420px] w-[620px] rounded-full bg-[#8fb0ff] opacity-40 blur-[110px]" />
      <div ref={ref} className="relative mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Answer quality"
          line1="Smaller models only help"
          line2="if the answers stay good"
          body="Right-sizing is checked, not assumed: the same eval set is answered by the large model, by the routed setup and by the small model, and the pass rates are compared."
        />

        {r ? (
          <div className="mt-14 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <div className="space-y-7">
              <PassBar label="Every prompt on the large model" v={r.pass_rate.all_large} tone="large" inView={inView} d={0.25} />
              <PassBar label="With Dropwise right-sizing" v={r.pass_rate.routed} tone="routed" inView={inView} d={0.35} />
              <PassBar label="Everything on the small model" v={r.pass_rate.all_small} tone="small" inView={inView} d={0.45} />
              <p className="text-[12.5px] leading-relaxed text-[#7b7f90]">
                {fmtInt(r.items_scored)} prompts scored · {pct(r.routed_small_share, 0)} of them routed small · eval set {shortHash(r.eval_set_hash)} · classifier{" "}
                {r.classifier_version}.
              </p>
            </div>
            <div className={`reveal border border-white/80 bg-white/70 p-7 backdrop-blur ${inView ? "is-in" : ""}`} style={delay(0.5)}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13.5px] text-[#5a5e6e]">Quality drop from right-sizing</p>
                <Kind kind="measured" />
              </div>
              <p className="mt-4 text-[clamp(44px,5vw,64px)] font-medium leading-none tracking-[-0.055em] text-[#1c1d23]">
                {r.quality_drop_pts > 0 ? "−" : ""}
                {Math.abs(r.quality_drop_pts).toFixed(1).replace(/\.0$/, "")}
                <span className="ml-1.5 text-[0.36em] tracking-normal text-[#7b7f90]">points</span>
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Tag tone={r.guard === "pass" ? "fresh" : "alert"}>{r.guard === "pass" ? `Guard passed · within ${r.max_drop_pts} points` : `Guard failed · over ${r.max_drop_pts} points`}</Tag>
              </div>
              <p className="mt-5 text-[14px] leading-relaxed text-[#2c2e36]">{r.recommendation}</p>
              {r.lost.length > 0 && (
                <p className="mt-4 font-mono text-[11.5px] leading-relaxed text-[#7b7f90]">
                  Passed on the large model, failed when routed: {r.lost.join(", ")}.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className={`reveal mt-14 max-w-[820px] border border-white/80 bg-white/70 p-7 backdrop-blur sm:p-9 ${inView ? "is-in" : ""}`} style={delay(0.3)}>
            <div className="flex flex-wrap items-center gap-3">
              <Tag tone="stale">{q.state === "loading" ? "Loading" : "Quality check not run yet"}</Tag>
            </div>
            {q.state === "none" && (
              <>
                <p className="mt-5 text-[19px] leading-snug tracking-[-0.02em] text-[#1c1d23]">
                  No answer-quality number is shown, because none has been measured. Nothing here is made up to fill the gap.
                </p>
                <p className="mt-4 text-[14px] leading-relaxed text-[#5a5e6e]">
                  The check answers the eval set with the large model, with Dropwise&apos;s routing and with the small model, then compares how many answers pass. If the routed
                  setup loses more than 5 points against the large model, the guard fails and the advice is to turn routing off and keep caching and budgets.
                </p>
                <pre className="mt-5 overflow-x-auto border border-[#dfe2ec] bg-[#f6f7fb] p-4 font-mono text-[12.5px] leading-relaxed text-[#2c2e36]">
                  {`cd intelligence\nnpm run eval -- quality    # needs Bifrost running; spends API credit`}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

export default function Benchmark() {
  const { scope } = useConnection();
  const [useSaved, setUseSaved] = useState(false);
  const bench = useBenchmark(useSaved);
  const quality = useQuality();
  const report = bench.state === "ok" ? bench.report : null;

  return (
    <Shell>
      <Hero result={bench} scope={scope} onUseSaved={() => setUseSaved(true)} />
      {report && <Compare r={report} scope={scope} />}
      {report && <Categories r={report} />}
      {report && <Quality q={quality} />}
      <Footer />
    </Shell>
  );
}
