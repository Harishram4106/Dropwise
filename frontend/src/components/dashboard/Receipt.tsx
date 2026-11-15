"use client";

// Page 3, /dashboard/requests/[id]: one receipt.
//   Hero: the prompt, the water range (big, Estimated, with what it counts) and the outcome in plain words,
//         beside the receipt itself, printed out of a slot.
//   Light: why it went this way (routing, cache, budget), with the classifier's reasons as written.
//   Lavender: how the water was estimated, rebuilt from the cited registry factors; every factor opens its
//             citation drawer. The arithmetic is shown only when it reproduces the receipt's own figures.
// Data: live, GET /receipts/:id from the gateway and GET /registry from the intelligence API;
// demo, the saved receipts and the saved registry.

import { motion } from "framer-motion";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import {
  ago,
  API_URL,
  fmtInt,
  modelName,
  type Range,
  type Receipt as ReceiptT,
  type RegistryEntry,
  SCOPE_LABEL,
  type Scope,
  shortHash,
  splitFactor,
  TIME_SIGNALS,
} from "@/lib/dropwise";
import { CacheTag, delay, HeroSurface, Kind, WaterRange } from "./bits";
import { CitationBadge, CitationProvider, useRegistry } from "./Citation";
import { useConnection } from "./connection";
import { SAVED, useNow, useReceipts } from "./receipts";
import { Footer, PAGES, Shell } from "./Shell";

/* ---------------------------------------------------------------- data */

type Loaded = { state: "loading" } | { state: "missing" } | { state: "ok"; receipt: ReceiptT };

/** The receipt: from the stream if it's there, otherwise GET /receipts/:id (live) or the saved copy (demo). */
function useReceipt(id: string, stream: ReceiptT[]): Loaded {
  const { status, fallBack } = useConnection();
  const inStream = stream.find((r) => r.request_id === id);
  const [fetched, setFetched] = useState<{ id: string; result: Loaded } | null>(null);

  useEffect(() => {
    if (status !== "live" || inStream) return;
    let stopped = false;
    fetch(`${API_URL}/receipts/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        if (stopped) return;
        if (res.status === 404) return setFetched({ id, result: { state: "missing" } });
        if (!res.ok) throw new Error(String(res.status));
        setFetched({ id, result: { state: "ok", receipt: await res.json() } });
      })
      .catch(() => fallBack("The gateway's receipt couldn't be loaded"));
    return () => {
      stopped = true;
    };
  }, [status, id, inStream, fallBack]);

  if (inStream) return { state: "ok", receipt: inStream };
  if (status === "demo") {
    // Replayed demo receipts carry a "-2" style suffix on later loops; the saved copy has the plain id.
    const base = id.replace(/-\d+$/, "");
    const saved = SAVED.find((r) => r.request_id === base);
    return saved ? { state: "ok", receipt: saved } : { state: "missing" };
  }
  if (fetched?.id === id) return fetched.result;
  return { state: "loading" };
}

/* ------------------------------------------------------- plain words */

const TIME_PREFIX = "Time-sensitive: ";

function routingLine(r: ReceiptT): { tone: "small" | "large" | "cache" | "none"; text: string } {
  if (r.cache_hit) return { tone: "cache", text: "Answered from the cache, so no model was called." };
  if (!r.route) return { tone: "none", text: r.route_note ?? "Not classified: the classifier was unavailable, so the requested model was kept." };
  const tierSignals = r.route.reasons.filter((x) => !x.startsWith(TIME_PREFIX));
  if (r.routed_to !== r.model) {
    const sig = r.route.signals.filter((s) => !TIME_SIGNALS.has(s));
    return {
      tone: "small",
      text: `Routed to the small model, ${modelName(r.routed_to)}: ${sig.join(", ") || "easy-task"} signal, confidence ${r.route.confidence}.`,
    };
  }
  const why = tierSignals[0]?.replace(/^Large model:\s*/i, "") ?? "it stays on the requested model.";
  return { tone: "large", text: `Stayed on ${modelName(r.model)}: ${why.charAt(0).toLowerCase()}${why.slice(1)}` };
}

function cacheLine(r: ReceiptT): string {
  switch (r.cache) {
    case "hit":
      return "Cache hit: this key asked the same prompt recently, so the stored answer was returned.";
    case "bypass": {
      const sig = r.route?.signals.filter((s) => TIME_SIGNALS.has(s)) ?? [];
      return `Cache bypassed: time-sensitive${sig.length ? ` (${sig.join(", ")})` : ""}, so a stored answer could be out of date.`;
    }
    case "miss":
      return "Cache miss: nothing stored for this prompt yet, so the answer was saved for next time.";
    case "skipped":
      return "Not cacheable: streaming or tool calls are passed through untouched.";
    default:
      return "The cache is turned off in the gateway.";
  }
}

/* ------------------------------------------------- water, rebuilt */

interface Rebuilt {
  energy: { range: Range; factors: { id: string; hash: string; e: RegistryEntry }[] };
  tokens: number;
  k: number;
  direct: { value: Range; factors: { id: string; hash: string; e: RegistryEntry }[] };
  indirect: { value: Range; factors: { id: string; hash: string; e: RegistryEntry }[] };
  result: Record<Scope, Range>;
}

/**
 * energy per prompt (Wh) × tokens ÷ 400 × water factor (L/kWh) = mL, as the gateway's estimator does.
 * Returns null unless it reproduces the receipt's own figures to within 2%, so the page never shows
 * arithmetic that disagrees with the receipt.
 */
function rebuild(r: ReceiptT, byId: Map<string, RegistryEntry>): Rebuilt | null {
  if (r.cache_hit || !r.water_ml_by_scope) return null;
  const facs = r.factor_versions.map((fv) => ({ ...splitFactor(fv), e: byId.get(splitFactor(fv).id) })).filter((f) => f.e) as Rebuilt["energy"]["factors"];
  const energy = facs.filter((f) => /\bWh\b/.test(f.e.unit));
  const perKwh = facs.filter((f) => /kWh/.test(f.e.unit));
  const direct = perKwh.filter((f) => f.e.counts === "direct_only");
  const indirect = perKwh.filter((f) => f.e.counts === "indirect_only");
  if (!energy.length || !direct.length) return null;
  const sum = (fs: typeof facs): Range => fs.reduce((t, f) => ({ low: t.low + f.e.range.low, high: t.high + f.e.range.high }), { low: 0, high: 0 });
  const E: Range = { low: Math.min(...energy.map((f) => f.e.range.low)), high: Math.max(...energy.map((f) => f.e.range.high)) };
  const tokens = r.tokens_in + r.tokens_out;
  const k = tokens / 400;
  const d = sum(direct);
  const i = sum(indirect);
  const result: Record<Scope, Range> = {
    direct_only: { low: k * E.low * d.low, high: k * E.high * d.high },
    direct_plus_indirect: { low: k * E.low * (d.low + i.low), high: k * E.high * (d.high + i.high) },
  };
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.0005, Math.abs(b) * 0.02);
  for (const s of ["direct_only", "direct_plus_indirect"] as const) {
    const want = r.water_ml_by_scope[s];
    if (!close(result[s].low, want.low) || !close(result[s].high, want.high)) return null;
  }
  return { energy: { range: E, factors: energy }, tokens, k, direct: { value: d, factors: direct }, indirect: { value: i, factors: indirect }, result };
}

const num = (x: number, p = 3) => String(Number(x.toPrecision(p)));
const rng = (r: Range, p = 3) => (r.low === r.high ? num(r.low, p) : `${num(r.low, p)}–${num(r.high, p)}`);

/* ------------------------------------------------------------- printed */

function Line({ k, v, strong = false }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <span className="shrink-0 text-[#7b7f90]">{k}</span>
      <span className={`min-w-0 text-right ${strong ? "font-medium text-[#0c0d12]" : "text-[#1c1d23]"}`}>{v}</span>
    </div>
  );
}

const Rule = () => <div aria-hidden className="my-3 border-t border-dashed border-[#c9cddc]" />;

const BUDGET_TONE = { ok: "fresh", alert: "stale", soft_limit: "alert" } as const;
const BUDGET_LABEL = { ok: "On track", alert: "Alert sent · 80%", soft_limit: "Soft limit reached" } as const;

function Printed({ r }: { r: ReceiptT }) {
  const scallop = "radial-gradient(circle 6px at 50% 0, #0000 97%, #000) top / 16px 51% repeat-x, radial-gradient(circle 6px at 50% 100%, #0000 97%, #000) bottom / 16px 51% repeat-x";
  const created = new Date(r.created_at);
  return (
    <div className="relative mx-auto w-full max-w-[420px]" data-no-splash>
      {/* the printer slot the receipt comes out of */}
      <div aria-hidden className="relative z-10 h-4 rounded-[4px] border border-white/20 bg-[#05060b] shadow-[inset_0_3px_6px_rgba(0,0,0,0.9),0_10px_30px_rgba(61,91,255,0.35)]" />
      <div className="relative -mt-2 overflow-hidden px-3 pb-8">
        <motion.div
          initial={{ y: "-104%" }}
          animate={{ y: 0 }}
          transition={{ duration: 1.7, delay: 0.5, ease: [0.25, 0.8, 0.25, 1] }}
          className="relative bg-[#f8f9fd] px-6 pb-8 pt-7 font-mono text-[11.5px] leading-[1.55] text-[#1c1d23] shadow-[0_30px_60px_rgba(5,8,30,0.45)]"
          style={{ WebkitMask: scallop, mask: scallop }}
        >
          <div className="text-center">
            <p className="text-[12.5px] font-semibold tracking-[0.12em]">DROPWISE · WATER RECEIPT</p>
            <p className="mt-1 text-[#7b7f90]" title={r.request_id}>
              {r.request_id}
            </p>
            <p className="text-[#7b7f90]">
              {created.toISOString().slice(0, 10)} {created.toISOString().slice(11, 19)} UTC
            </p>
          </div>
          <Rule />
          <Line k="KEY" v={r.virtual_key} />
          <Line k="MODEL ASKED" v={modelName(r.model)} />
          <Line k="RAN ON" v={r.cache_hit ? "cache · no model call" : modelName(r.routed_to)} strong={r.routed_to !== r.model} />
          <Line k="CACHE" v={r.cache.toUpperCase()} />
          <Line k="TOKENS IN / OUT" v={r.cache_hit ? "0 / 0" : `${fmtInt(r.tokens_in)} / ${fmtInt(r.tokens_out)}${r.tokens_estimated ? " *" : ""}`} />
          {r.cache_hit && <Line k="TOKENS SAVED" v={fmtInt(r.tokens_saved)} strong />}
          <Line k="LATENCY" v={`${fmtInt(r.latency_ms.total)} ms · Dropwise ${r.latency_ms.gateway} ms`} />
          {r.deferred && <Line k="DEFERRED" v={r.deferred.relative_index ? `index ${r.deferred.relative_index.at_request} → ${r.deferred.relative_index.at_run}${r.deferred.profile?.illustrative ? " *" : ""}` : "no profile"} />}
          <Line k="REGION" v={r.region === "unknown" ? "not disclosed · US avg." : r.region} />
          <Rule />
          <p className="text-[#7b7f90]">WATER · ESTIMATED RANGE</p>
          {r.water_ml_by_scope ? (
            <>
              <Line k="DIRECT ONLY" v={<WaterRange range={r.water_ml_by_scope.direct_only} />} />
              <Line k="DIRECT + INDIRECT" v={<WaterRange range={r.water_ml_by_scope.direct_plus_indirect} />} strong />
            </>
          ) : (
            <Line k="NOT ESTIMATED" v="—" />
          )}
          {r.avoided_ml_by_scope && <Line k="AVOIDED BY CACHE" v={<WaterRange range={r.avoided_ml_by_scope.direct_plus_indirect} />} strong />}
          {r.budget && (
            <>
              <Rule />
              <Line k="BUDGET" v={`${r.budget.used_pct}% of ${fmtInt(r.budget.limit_ml)} mL / day`} />
              <Line k="STATUS" v={BUDGET_LABEL[r.budget.status].toUpperCase()} strong={r.budget.status !== "ok"} />
            </>
          )}
          <Rule />
          <p className="text-[#7b7f90]">CITED FACTORS</p>
          {r.factor_versions.length ? (
            r.factor_versions.map((fv) => {
              const { id, hash } = splitFactor(fv);
              return <Line key={fv} k={id.length > 26 ? `${id.slice(0, 25)}…` : id} v={`@${shortHash(hash)}`} />;
            })
          ) : (
            <p>none: no model call, no inference water</p>
          )}
          <Rule />
          <p className="text-center text-[#7b7f90]">Every water figure is an estimate.</p>
          <p className="mt-2 text-center tracking-[0.4em] text-[#c0c3d0]" aria-hidden>
            ▮▯▮▮▯▮▯▯▮▮▮▯▮▯▮▮▯▮
          </p>
        </motion.div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */

function Outcome({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-t border-white/15 py-3 text-[14.5px] leading-snug text-white/85">
      <span aria-hidden className="mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <span>{children}</span>
    </li>
  );
}

function Hero({ r, scope }: { r: ReceiptT; scope: Scope }) {
  const now = useNow();
  const { query } = useConnection();
  const prompt = r.prompt_preview ? `“${r.prompt_preview}${r.prompt_preview.length >= 80 ? "…" : ""}”` : "Prompt not kept";
  const route = routingLine(r);
  const other: Scope = scope === "direct_only" ? "direct_plus_indirect" : "direct_only";
  const dot = { small: "#b9c8ff", large: "#e6eeff", cache: "#9dffb4", none: "#ffffff66" }[route.tone];

  return (
    <HeroSurface className="min-h-[100svh]">
      <div className="relative mx-auto max-w-[1320px] px-5 pb-20 pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.05)}>
          <Link
            href={`${PAGES.requests.href}${query}`}
            className="group inline-flex items-center gap-1.5 rounded-[2px] border border-white/15 px-2 py-1 text-white/70 transition-colors hover:border-white/40 hover:text-white"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">←</span> All requests
          </Link>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Receipt · {r.virtual_key}</span>
          <span className="rounded-[2px] border border-white/15 px-2 py-1 text-white/50">{now ? ago(r.created_at, now) : " "}</span>
        </div>

        <div className="mt-8 grid gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div>
            <h1 className="jelly max-w-[760px] text-[clamp(32px,3.9vw,58px)] font-medium leading-[1.04] tracking-[-0.048em]">
              <BlurText text={prompt} className="block" start={0.15} step={0.012} />
            </h1>

            <div className="fade-up mt-10 border border-white/15 bg-white/[0.06] p-6 backdrop-blur-md sm:p-7" style={delay(0.7)}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13.5px] text-white/75">Water for this request · {SCOPE_LABEL[scope].toLowerCase()}</p>
                <Kind kind="estimated" dark />
              </div>
              <p className="mt-4 text-[clamp(44px,5vw,76px)] font-medium leading-none tracking-[-0.055em] text-white [text-shadow:0_0_40px_rgba(160,190,255,0.55)]">
                <WaterRange range={r.water_ml_by_scope?.[scope] ?? null} animate />
              </p>
              <p className="mt-4 text-[13px] text-white/55">
                {r.cache_hit && r.avoided_ml_by_scope ? (
                  <>
                    No model call, so no inference water. The cache kept{" "}
                    <WaterRange range={r.avoided_ml_by_scope[scope]} className="text-[#9dffb4]" /> out of the water, what the original answer was estimated to use.
                  </>
                ) : r.water_ml_by_scope ? (
                  <>
                    {SCOPE_LABEL[other]}: <WaterRange range={r.water_ml_by_scope[other]} className="text-white/85" />. Switch what is counted in the nav.
                  </>
                ) : (
                  "This request has no water estimate."
                )}
              </p>
            </div>

            <ul className="fade-up mt-8" style={delay(0.95)}>
              <Outcome dot={dot}>{route.text}</Outcome>
              <Outcome dot={r.cache === "hit" ? "#9dffb4" : r.cache === "bypass" ? "#ffd28f" : "#e6eeff"}>{cacheLine(r)}</Outcome>
              {r.deferred && (
                <Outcome dot="#8fb0ff">
                  Deferred: {r.deferred.reason}
                  {r.deferred.run_early ? " An operator ran it early." : ""}
                </Outcome>
              )}
            </ul>
          </div>

          <Printed r={r} />
        </div>
      </div>
    </HeroSurface>
  );
}

/* ----------------------------------------------------------------- why */

function WhyCard({ log, title, children, d, inView }: { log: string; title: string; children: ReactNode; d: number; inView: boolean }) {
  return (
    <article className={`reveal flex flex-col bg-[#f6f7fb] px-7 pb-8 pt-6 ${inView ? "is-in" : ""}`} style={delay(d)}>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#a7b3e6]">{log}</span>
      <h3 className="mt-5 text-[22px] font-medium tracking-[-0.03em] text-[#1c1d23]">{title}</h3>
      <div className="mt-4 flex-1 text-[14px] leading-relaxed text-[#5a5e6e]">{children}</div>
    </article>
  );
}

function Why({ r }: { r: ReceiptT }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.2);
  const route = r.route;
  const b = r.budget;
  return (
    <section data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <p className={`reveal font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0] ${inView ? "is-in" : ""}`}>Why it went this way</p>
        <h2 className="mt-5 text-[clamp(34px,4.2vw,58px)] font-medium leading-[1.03] tracking-[-0.055em] text-[#25262c]">
          <span className={`reveal block ${inView ? "is-in" : ""}`} style={delay(0.08)}>
            Every decision,
          </span>
          <span className={`reveal headline-blue block pb-1 ${inView ? "is-in" : ""}`} style={delay(0.18)}>
            in the classifier&apos;s own words
          </span>
        </h2>

        <div className="mt-14 grid gap-px border-y border-[#e3e6ef] bg-[#e3e6ef] md:grid-cols-3">
          <WhyCard log="01 · Routing" title={r.cache_hit ? "No model needed" : r.routed_to !== r.model ? `Sent to ${modelName(r.routed_to)}` : `Stayed on ${modelName(r.model)}`} d={0.25} inView={inView}>
            {route ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Confidence</span>
                  <div className="h-1.5 w-28 rounded-full bg-[#e3e6f0]">
                    <div className="h-full rounded-full bg-[#4b63ff]" style={{ width: `${route.confidence * 100}%` }} />
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-[#1c1d23]">{route.confidence}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {route.signals.length ? route.signals.map((s) => <Tag key={s} tone={TIME_SIGNALS.has(s) ? "stale" : "blue"}>{s}</Tag>) : <Tag>no signal</Tag>}
                </div>
                <ul className="mt-5 space-y-2">
                  {route.reasons.map((x) => (
                    <li key={x} className="border-l-2 border-[#c9d2ff] pl-3 text-[#2c2e36]">
                      {x}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Classifier {route.classifier_version} · rules, no model call</p>
              </>
            ) : (
              <p>{r.route_note ?? "The classifier didn't run for this request, so the requested model was kept."}</p>
            )}
          </WhyCard>

          <WhyCard log="02 · Cache" title={{ hit: "Served from cache", miss: "Answered, then stored", bypass: "Cache skipped on purpose", skipped: "Not cacheable", off: "Cache off" }[r.cache]} d={0.35} inView={inView}>
            <CacheTag cache={r.cache} />
            <p className="mt-4 text-[#2c2e36]">{cacheLine(r)}</p>
            <p className="mt-4">
              The cache is an exact match on the normalised prompt, kept per key for an hour. Time-sensitive prompts never use it, so nobody gets a stale answer.
            </p>
            {r.cache_hit && <p className="mt-4 text-[#1f8a45]">Tokens saved: {fmtInt(r.tokens_saved)} (measured).</p>}
          </WhyCard>

          <WhyCard log="03 · Budget" title={b ? BUDGET_LABEL[b.status] : "No budget"} d={0.45} inView={inView}>
            {b ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[12px] text-[#1c1d23]">{b.virtual_key}</span>
                  <Tag tone={BUDGET_TONE[b.status]}>{b.status.replace("_", " ")}</Tag>
                </div>
                <div className="relative mt-4 h-2.5 overflow-hidden rounded-full bg-[#e3e6f0]">
                  <div
                    className={`h-full rounded-full ${b.status === "ok" ? "bg-[#4b63ff]" : b.status === "alert" ? "bg-[#e6a23c]" : "bg-[#e05a5a]"}`}
                    style={{ width: `${Math.min(100, b.used_pct)}%` }}
                  />
                  <span aria-hidden className="absolute inset-y-0 left-[80%] w-px bg-[#1c1d23]/30" title="Alert at 80%" />
                </div>
                <p className="mt-3 text-[#2c2e36]">
                  {b.used_pct}% of {fmtInt(b.limit_ml)} mL for {b.period}, after this request: <WaterRange range={b.used_ml} /> used (estimated, high end counts).
                </p>
                <p className="mt-4">Alerts go out at 80%. At 100% the limit is soft: requests are still served, and flagged.</p>
              </>
            ) : (
              <p>This key has no water budget.</p>
            )}
          </WhyCard>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- method */

function Tile({ label, kind, value, unit, children, d, inView, dim = false }: { label: string; kind: "measured" | "estimated"; value: string; unit: string; children?: ReactNode; d: number; inView: boolean; dim?: boolean }) {
  return (
    <div className={`reveal flex flex-col border border-white/80 bg-white/70 p-5 backdrop-blur ${inView ? "is-in" : ""} ${dim ? "opacity-45" : ""}`} style={delay(d)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-[#5a5e6e]">{label}</span>
        <Kind kind={kind} />
      </div>
      <p className="mt-4 text-[34px] font-medium leading-none tracking-[-0.045em] text-[#1c1d23]">
        {value}
        <span className="ml-1.5 text-[13px] tracking-normal text-[#7b7f90]">{unit}</span>
      </p>
      {children && <div className="mt-4 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

const Op = ({ children }: { children: ReactNode }) => (
  <span aria-hidden className="flex items-center justify-center text-[30px] font-light text-[#8fb0ff]">
    {children}
  </span>
);

function Method({ r, scope }: { r: ReceiptT; scope: Scope }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.2);
  const { byId } = useRegistry();
  const rb = useMemo(() => rebuild(r, byId), [r, byId]);
  const direct = scope === "direct_only";
  const factor = rb ? (direct ? rb.direct.value : { low: rb.direct.value.low + rb.indirect.value.low, high: rb.direct.value.high + rb.indirect.value.high }) : null;
  const method = r.method.charAt(0).toUpperCase() + r.method.slice(1);

  return (
    <section data-nav="light" className="relative overflow-hidden bg-[linear-gradient(180deg,#eceef6_0%,#dfe6fb_60%,#c9d6ff_100%)]">
      <div aria-hidden className="pointer-events-none absolute -right-40 bottom-0 h-[420px] w-[620px] rounded-full bg-[#8fb0ff] opacity-40 blur-[110px]" />
      <div ref={ref} className="relative mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <p className={`reveal font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0] ${inView ? "is-in" : ""}`}>How the water was estimated</p>
        <h2 className="mt-5 text-[clamp(34px,4.2vw,58px)] font-medium leading-[1.03] tracking-[-0.055em] text-[#25262c]">
          <span className={`reveal block ${inView ? "is-in" : ""}`} style={delay(0.08)}>
            {r.cache_hit ? "Nothing to estimate:" : "A range, worked out"}
          </span>
          <span className={`reveal block text-[#8d93ad] ${inView ? "is-in" : ""}`} style={delay(0.18)}>
            {r.cache_hit ? "the model was never called" : "from cited factors"}
          </span>
        </h2>

        {rb && factor ? (
          <div className="mt-14 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_0.8fr_auto_1fr_auto_0.9fr]">
            <Tile label="Energy per prompt" kind="estimated" value={rng(rb.energy.range)} unit="Wh" d={0.25} inView={inView}>
              {rb.energy.factors.map((f) => (
                <CitationBadge key={f.id} id={f.id} cited={f.hash} />
              ))}
            </Tile>
            <Op>×</Op>
            <Tile label="Tokens ÷ 400" kind="measured" value={num(rb.k)} unit={`(${fmtInt(rb.tokens)} tokens)`} d={0.35} inView={inView}>
              <span className="text-[12px] leading-snug text-[#7b7f90]">400 tokens is one reference prompt; assumed linear.</span>
            </Tile>
            <Op>×</Op>
            <Tile label={direct ? "Water factor · direct only" : "Water factor · direct + indirect"} kind="estimated" value={rng(factor)} unit="L / kWh" d={0.45} inView={inView}>
              {rb.direct.factors.map((f) => (
                <CitationBadge key={f.id} id={f.id} cited={f.hash} />
              ))}
              {rb.indirect.factors.map((f) => (
                <span key={f.id} className={direct ? "opacity-40" : ""} title={direct ? "Not counted in Direct only" : undefined}>
                  <CitationBadge id={f.id} cited={f.hash} />
                </span>
              ))}
            </Tile>
            <Op>=</Op>
            <div className={`reveal flex flex-col justify-between bg-[#0c0d12] p-5 text-white shadow-[0_30px_60px_rgba(47,69,255,0.25)] ${inView ? "is-in" : ""}`} style={delay(0.55)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] text-white/65">This request</span>
                <Kind kind="estimated" dark />
              </div>
              <p className="mt-4 text-[34px] font-medium leading-none tracking-[-0.045em]">
                <WaterRange range={rb.result[scope]} />
              </p>
              <p className="mt-3 text-[12px] text-white/50">matches the receipt · {SCOPE_LABEL[scope].toLowerCase()}</p>
            </div>
          </div>
        ) : (
          <div className={`reveal mt-12 max-w-[760px] ${inView ? "is-in" : ""}`} style={delay(0.25)}>
            {r.cache_hit && r.avoided_ml_by_scope && (
              <p className="text-[18px] leading-relaxed text-[#2c2e36]">
                The answer came from the cache, so this request used no inference water. The original answer was estimated at{" "}
                <WaterRange range={r.avoided_ml_by_scope[scope]} className="font-medium text-[#1c1d23]" /> ({SCOPE_LABEL[scope].toLowerCase()}), which this request avoided.
              </p>
            )}
            {r.factor_versions.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-1.5">
                {r.factor_versions.map((fv) => {
                  const { id, hash } = splitFactor(fv);
                  return <CitationBadge key={fv} id={id} cited={hash} />;
                })}
              </div>
            )}
          </div>
        )}

        <div className={`reveal mt-10 max-w-[820px] border-l-2 border-[#4b63ff] pl-5 ${inView ? "is-in" : ""}`} style={delay(0.65)}>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7b7f90]">Method, as the gateway wrote it</p>
          <p className="mt-2 text-[15px] leading-relaxed text-[#2c2e36]">{method}</p>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- neighbours */

function Neighbours({ older, newer }: { older?: ReceiptT; newer?: ReceiptT }) {
  const { query } = useConnection();
  const card = (r: ReceiptT | undefined, label: string, align: "left" | "right") =>
    r ? (
      <Link
        href={`${PAGES.receipt.href}/${r.request_id}${query}`}
        className={`group flex flex-col gap-2 bg-[#07080d]/75 p-6 backdrop-blur transition-colors hover:bg-[#10132a]/80 sm:p-8 ${align === "right" ? "items-end text-right" : ""}`}
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45">{label}</span>
        <span className="line-clamp-1 max-w-full text-[17px] tracking-[-0.02em] text-white/90 group-hover:text-white">{r.prompt_preview ?? "Prompt not kept"}</span>
        <span className="font-mono text-[10.5px] text-white/40">
          {r.virtual_key} · <WaterRange range={r.water_ml_by_scope?.direct_plus_indirect ?? null} />
        </span>
      </Link>
    ) : (
      <div className="bg-[#07080d]/75 p-6 sm:p-8">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/30">{label} · none</span>
      </div>
    );
  return (
    <section data-nav="dark" className="relative isolate overflow-hidden bg-black">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(55%_80%_at_0%_100%,rgba(61,91,255,0.7)_0%,transparent_70%)]" />
      <div className="mx-auto max-w-[1320px] px-5 py-16 sm:px-8 lg:px-14">
        <div className="grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2">
          {card(older, "← Older request", "left")}
          {card(newer, "Newer request →", "right")}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

function Missing({ id, loading }: { id: string; loading: boolean }) {
  const { query, status } = useConnection();
  return (
    <HeroSurface className="min-h-[100svh]">
      <div className="mx-auto max-w-[1320px] px-5 pb-20 pt-40 sm:px-8 lg:px-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/55">{loading ? "Loading receipt" : "Receipt not found"}</p>
        <h1 className="mt-6 text-[clamp(40px,5vw,72px)] font-medium leading-[1] tracking-[-0.055em]">
          {loading ? <span className="headline-grey">Fetching {id}…</span> : <>No receipt called {id}</>}
        </h1>
        {!loading && (
          <p className="mt-6 max-w-[520px] text-[16px] leading-relaxed text-white/70">
            {status === "demo"
              ? "The dashboard is showing saved demo receipts, and this id isn't one of them."
              : "The gateway keeps receipts in data/receipts.jsonl; this id isn't there."}
          </p>
        )}
        <Link href={`${PAGES.requests.href}${query}`} className="mt-10 inline-flex items-center gap-2 text-[15px] text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
          ← All requests
        </Link>
      </div>
    </HeroSurface>
  );
}

export default function Receipt() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  const { scope } = useConnection();
  const { receipts } = useReceipts(500);
  const loaded = useReceipt(id, receipts);

  const at = receipts.findIndex((r) => r.request_id === id);
  const older = at >= 0 ? receipts[at + 1] : undefined;
  const newer = at > 0 ? receipts[at - 1] : undefined;

  return (
    <Shell>
      <CitationProvider>
        {loaded.state === "ok" ? (
          <>
            <Hero key={loaded.receipt.request_id} r={loaded.receipt} scope={scope} />
            <Why r={loaded.receipt} />
            <Method r={loaded.receipt} scope={scope} />
            <Neighbours older={older} newer={newer} />
          </>
        ) : (
          <Missing id={id} loading={loaded.state === "loading"} />
        )}
        <Footer />
      </CitationProvider>
    </Shell>
  );
}
