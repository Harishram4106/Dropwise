"use client";

// Page 1, /dashboard: the live meter.
//   Hero: calls avoided, tokens saved and water without → with Dropwise over a live water surface,
//         where every request falls in as a droplet and cache hits evaporate before they land.
//   Light: where the savings came from (cache, routing, receipts, sources), as the landing page's cards.
//   Dark: the latest requests as they arrive. Light: how the water is estimated.
// Data: the shared receipt stream (./receipts) plus the gateway's GET /summary when live.

import Link from "next/link";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { CacheIllustration, RegistryIllustration, RouteIllustration, StackIllustration } from "@/components/FeatureIllustrations";
import { Magnetic } from "@/components/Magnetic";
import { SectionHead, Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { ago, API_URL, fmtInt, modelName, type Receipt, SCOPE_LABEL, type Scope, type Summary, summarize } from "@/lib/dropwise";
import { CacheTag, Count, delay, HeroSurface, Kind, tilt, WaterRange } from "./bits";
import { useConnection } from "./connection";
import LiveWater, { spot, type WaterDrop } from "./LiveWater";
import { useNow, useReceipts } from "./receipts";
import { Footer, PAGES, Shell } from "./Shell";

const FEED = 10;
const STATUSES = ["Estimating", "Routing", "Caching", "Citing", "Budgeting"];

/**
 * The headline numbers. Demo: computed from the replayed receipts. Live: the gateway's GET /summary,
 * re-read 400 ms after each new receipt, on a scope change, and every 10 s as a backstop.
 */
function useSummary(receipts: Receipt[], newest: string | undefined, scope: Scope): Summary | null {
  const { status, fallBack } = useConnection();
  const [live, setLive] = useState<Summary | null>(null);
  const demo = useMemo(() => (status === "demo" && receipts.length ? summarize(receipts, scope) : null), [status, receipts, scope]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/summary?scope=${scope}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`summary ${res.status}`);
      setLive(await res.json());
    } catch {
      fallBack("The gateway's summary couldn't be loaded");
    }
  }, [scope, fallBack]);

  useEffect(() => {
    if (status !== "live") return;
    const t = setTimeout(load, newest ? 400 : 0);
    return () => clearTimeout(t);
  }, [status, load, newest]);

  useEffect(() => {
    if (status !== "live") return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [status, load]);

  return status === "live" ? live : demo;
}

function useTicker(items: string[], ms = 2400) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % items.length), ms);
    return () => clearInterval(t);
  }, [items.length, ms]);
  return items[i];
}

const kindOf = (r: Receipt): WaterDrop["kind"] =>
  r.cache === "hit" ? "hit" : r.cache === "bypass" ? "bypass" : r.routed_to !== r.model ? "small" : "call";

/* ------------------------------------------------------------------ hero */

function Metric({ label, kind, children, note, d }: { label: string; kind: "measured" | "estimated"; children: ReactNode; note: ReactNode; d: number }) {
  return (
    <div className="fade-up border-t border-white/20 pt-4" style={delay(d)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-white/75">{label}</p>
        <Kind kind={kind} dark />
      </div>
      <p className="mt-3 text-[clamp(40px,4.4vw,64px)] font-medium leading-none tracking-[-0.055em]">{children}</p>
      <p className="mt-3 text-[13px] leading-relaxed text-white/55">{note}</p>
    </div>
  );
}

function Legend({ color, ring = false, children }: { color: string; ring?: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={ring ? { border: `1.3px solid ${color}` } : { background: color }} />
      {children}
    </span>
  );
}

function Skeleton() {
  return <span className="inline-block h-[0.8em] w-28 animate-pulse rounded-[2px] bg-white/15 align-middle" />;
}

function Hero({ summary, receipts, scope }: { summary: Summary | null; receipts: Receipt[]; scope: Scope }) {
  const hostRef = useRef<HTMLElement>(null);
  const word = useTicker(STATUSES);
  const { status } = useConnection();
  const m = summary?.measured;
  const e = summary?.estimated;
  const used = m ? m.tokens_in + m.tokens_out : 0;
  const savedShare = m && used + m.tokens_saved > 0 ? m.tokens_saved / (used + m.tokens_saved) : 0;

  const drops = useMemo<WaterDrop[]>(
    () =>
      receipts.slice(0, 60).map((r) => ({
        id: r.request_id,
        x: spot(r.request_id),
        ml: r.water_ml_by_scope?.[scope].high || r.avoided_ml_by_scope?.[scope].high || 1,
        kind: kindOf(r),
      })),
    [receipts, scope],
  );
  // The water sits below the dashed "without" line by exactly the share the cache avoided.
  const without = e?.water_ml_without_dropwise.high ?? 0;
  const ratio = without > 0 ? (e?.water_ml_with_dropwise.high ?? 0) / without : 1;
  const GHOST = 0.42;

  return (
    <HeroSurface
      hostRef={hostRef}
      className="min-h-[100svh]"
      art={<LiveWater host={hostRef} drops={drops} level={e ? GHOST * ratio : 0.3} ghost={e && without > 0 ? GHOST : null} height={290} />}
    >
      <div className="relative mx-auto flex min-h-[100svh] max-w-[1320px] flex-col px-5 pb-[150px] pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Live meter · {SCOPE_LABEL[scope]}</span>
          <span className="flex items-center gap-1.5 rounded-[2px] border border-white/15 px-2 py-1 text-white/45">
            {status === "demo" ? "Replaying saved receipts" : "Status:"}
            <span className={`inline-block h-1.5 w-1.5 ${status === "demo" ? "bg-[#ffc46b]" : "blink bg-[#7dfc9a]"}`} />
            <span key={word} className="fade-up inline-block min-w-[74px] text-white/90">
              {word}
            </span>
          </span>
        </div>

        <div className="mt-7 grid gap-10 lg:grid-cols-[1.12fr_0.88fr] lg:items-end lg:gap-14">
          <div>
            <h1 className="jelly text-[clamp(44px,5.4vw,84px)] font-medium leading-[0.98] tracking-[-0.058em]">
              <BlurText text="Every request," className="headline-grey block" start={0.2} />
              <BlurText text="measured as it lands" className="block" start={0.55} />
            </h1>
            <p className="fade-up mt-5 max-w-[500px] text-[15.5px] leading-relaxed tracking-[-0.01em] text-white/75" style={delay(1.2)}>
              Each drop below is a request through your gateway, sized by its estimated water. The ones the cache answered never reach the
              water.
            </p>
            <div className="mt-9 grid grid-cols-2 gap-6 sm:gap-8">
              <Metric label="Calls avoided" kind="measured" d={1.35} note={m ? `of ${fmtInt(m.requests)} requests, answered from the cache` : "Requests answered from the cache"}>
                {m ? <Count value={m.calls_avoided} /> : <Skeleton />}
              </Metric>
              <Metric label="Tokens saved" kind="measured" d={1.5} note={m ? `${Math.round(savedShare * 100)}% of what they would have used` : "Tokens the cache didn't spend"}>
                {m ? <Count value={m.tokens_saved} /> : <Skeleton />}
              </Metric>
            </div>
          </div>

          <div className="fade-up border border-white/15 bg-white/[0.06] p-6 backdrop-blur-md sm:p-7" style={delay(0.9)}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13.5px] text-white/75">Water, with Dropwise</p>
              <Kind kind="estimated" dark />
            </div>
            <p className="mt-4 text-[clamp(40px,4.4vw,64px)] font-medium leading-none tracking-[-0.055em]">
              {e ? <WaterRange range={e.water_ml_with_dropwise} animate className="text-white [text-shadow:0_0_40px_rgba(160,190,255,0.55)]" /> : <Skeleton />}
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/15 pt-4 text-[13px]">
              <div>
                <dt className="text-white/50">Without Dropwise</dt>
                <dd className="mt-1 text-[19px] tracking-[-0.02em] text-white/85">{e ? <WaterRange range={e.water_ml_without_dropwise} animate /> : "–"}</dd>
              </div>
              <div>
                <dt className="text-white/50">Kept out by the cache</dt>
                <dd className="mt-1 text-[19px] tracking-[-0.02em] text-[#9dffb4]">{e ? <WaterRange range={e.water_ml_avoided} animate /> : "–"}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="fade-up mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-8 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/60" style={delay(1.8)}>
          <Legend color="#e6eeff">Request</Legend>
          <Legend color="#b9c8ff">Sent to the small model</Legend>
          <Legend color="#ffd28f">Time-sensitive</Legend>
          <Legend color="#9dffb4" ring>
            Answered by the cache
          </Legend>
          <span className="text-white/40">· stir the water · click to drop one in</span>
        </div>
      </div>
    </HeroSurface>
  );
}

/* ------------------------------------------------------------- savings */

function Card({
  i,
  log,
  title,
  art,
  value,
  note,
  extra,
}: {
  i: number;
  log: string;
  title: string;
  art: ReactNode;
  value: ReactNode;
  note: ReactNode;
  extra?: ReactNode;
}) {
  const [ref, inView] = useReveal<HTMLElement>(0.3);
  return (
    <article ref={ref} {...tilt} className={`fcard flex flex-col bg-[#eceef6] px-7 pb-9 pt-6 ${inView ? "is-in" : ""}`} style={{ "--i": i } as CSSProperties}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#a7b3e6]">{log}</span>
        <Kind kind="measured" />
      </div>
      <div className="ill flex h-[250px] items-center justify-center">{art}</div>
      <h3 className="card-title text-[15px] tracking-[-0.02em] text-[#5a5e6e]">{title}</h3>
      <p className="card-title mt-2 text-[46px] font-medium leading-none tracking-[-0.05em] text-[#1c1d23]">{value}</p>
      <p className="card-desc mt-3 text-[13.5px] leading-[1.45] text-[#7b7f90]">{note}</p>
      {extra && <div className="card-desc mt-4">{extra}</div>}
    </article>
  );
}

function Savings({ summary, small, factors }: { summary: Summary | null; small: string; factors: number }) {
  const [headRef, headIn] = useReveal<HTMLDivElement>(0.5);
  const m = summary?.measured;
  const dash = <span className="text-[#b0b4c4]">–</span>;
  return (
    <section data-nav="light" className="relative overflow-hidden bg-[linear-gradient(180deg,#a6c0ff_0%,#d3ddfb_14%,#e6e9f6_26%,#eceef6_40%)]">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[420px] w-[620px] rounded-full bg-[#8fb0ff] opacity-50 blur-[110px]" />
      <div className="relative mx-auto max-w-[1320px] px-5 pt-32 sm:px-8 lg:px-14">
        <div ref={headRef}>
          <h2 className="text-[clamp(40px,5.4vw,72px)] font-medium leading-[1.02] tracking-[-0.055em] text-[#25262c]">
            <span className={`reveal block ${headIn ? "is-in" : ""}`}>Where the savings</span>
            <span className={`reveal headline-blue block pb-1 ${headIn ? "is-in" : ""}`} style={delay(0.15)}>
              came from
            </span>
          </h2>
          <p className={`reveal mt-6 max-w-[540px] text-[16px] leading-relaxed tracking-[-0.01em] text-[#6b6f80] ${headIn ? "is-in" : ""}`} style={delay(0.3)}>
            Every number here is counted by the gateway as requests pass through. Water only ever appears as an estimated range.
          </p>
        </div>
      </div>
      <div className="relative mx-auto mt-16 max-w-[1320px] px-2 pb-24 sm:px-3">
        <div className="grid gap-px border-y border-white/80 bg-white/80 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            i={0}
            log="Log 01 · Cache"
            title="Calls the cache answered"
            art={<CacheIllustration />}
            value={m ? <Count value={m.calls_avoided} /> : dash}
            note={
              m
                ? `${Math.round((m.calls_avoided / Math.max(1, m.requests)) * 100)}% of ${fmtInt(m.requests)} requests never reached a model.`
                : "Repeat prompts answered without a model call."
            }
            extra={m ? <Tag tone="stale">{fmtInt(m.cache_bypassed)} time-sensitive skipped it</Tag> : null}
          />
          <Card
            i={1}
            log="Log 02 · Routing"
            title={`Sent to ${small}`}
            art={<RouteIllustration />}
            value={m ? <Count value={m.routed_small} /> : dash}
            note={
              m
                ? `${Math.round(m.routed_small_share * 100)}% of ${fmtInt(m.model_calls)} model calls were easy enough for the small model.`
                : "Easy prompts sent to the right-sized model."
            }
            extra={<Tag tone="blue">Hard prompts stay large</Tag>}
          />
          <Card
            i={2}
            log="Log 03 · Receipts"
            title="Receipts written"
            art={<StackIllustration />}
            value={m ? <Count value={m.requests} /> : dash}
            note={
              m
                ? `One per request. Dropwise added ${m.gateway_latency_ms.p50} ms at the median and ${m.gateway_latency_ms.p95} ms at p95.`
                : "One per request, with tokens, route and water."
            }
          />
          <Card
            i={3}
            log="Log 04 · Sources"
            title="Cited factors per estimate"
            art={<RegistryIllustration />}
            value={factors ? <Count value={factors} /> : dash}
            note="Each receipt cites its energy and water factors by version, from the signed Evidence Registry."
            extra={<Tag tone="fresh">Signed · ed25519</Tag>}
          />
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- feed */

function Route({ r }: { r: Receipt }) {
  if (r.cache_hit) return <span className="text-white/45">{modelName(r.model)} · not called</span>;
  if (r.routed_to !== r.model) {
    return (
      <span className="whitespace-nowrap">
        <span className="text-white/40 line-through decoration-white/25">{modelName(r.model)}</span>
        <span className="mx-1.5 text-[#8fb0ff]">→</span>
        <span className="text-white">{modelName(r.routed_to)}</span>
      </span>
    );
  }
  return <span className="text-white/80">{modelName(r.model)}</span>;
}

function FeedRow({ r, scope, now, isFresh, query }: { r: Receipt; scope: Scope; now: number; isFresh: boolean; query: string }) {
  const when = now ? ago(r.created_at, now) : "";
  const cells = (
    <>
      <span className="hidden w-[72px] shrink-0 font-mono text-[11px] text-white/40 sm:block">{when}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-white/90">{r.prompt_preview ?? <span className="text-white/35">Prompt not kept</span>}</span>
        <span className="mt-0.5 block font-mono text-[10.5px] text-white/40">
          {r.virtual_key}
          <span className="sm:hidden"> · {when}</span>
        </span>
      </span>
      <span className="hidden w-[170px] shrink-0 text-[13px] md:block">
        <Route r={r} />
      </span>
      <span className="hidden w-[180px] shrink-0 sm:block">
        <CacheTag cache={r.cache} dark />
      </span>
      <span className="w-[104px] shrink-0 text-right text-[14px] sm:w-[118px]">
        <WaterRange range={r.water_ml_by_scope?.[scope] ?? null} />
      </span>
    </>
  );
  const cls = "flex items-center gap-4 px-5 py-4 sm:px-7";
  return (
    <li className={`border-t border-white/[0.07] first:border-t-0 ${isFresh ? "row-in" : ""}`}>
      {PAGES.receipt.ready ? (
        <Link href={`${PAGES.receipt.href}/${r.request_id}${query}`} className={`group ${cls} transition-colors hover:bg-white/[0.05]`}>
          {cells}
        </Link>
      ) : (
        <div className={cls}>{cells}</div>
      )}
    </li>
  );
}

function Feed({ feed, scope, fresh }: { feed: Receipt[]; scope: Scope; fresh: Set<string> }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.15);
  const now = useNow();
  const { status, query } = useConnection();
  return (
    <section data-nav="dark" className="relative isolate overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_0%_100%,rgba(61,91,255,0.8)_0%,rgba(36,54,240,0)_70%),radial-gradient(40%_35%_at_100%_0%,rgba(47,69,255,0.35)_0%,transparent_70%)]"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-32">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <SectionHead
            dark
            inView={inView}
            eyebrow="Latest requests"
            line1="Watch them land,"
            line2="receipt by receipt"
            body="The ten newest requests through the gateway. New ones slide in at the top as they arrive."
          />
          <div className={`reveal ${inView ? "is-in" : ""}`} style={delay(0.35)}>
            <Magnetic>
              <Link href={`${PAGES.requests.href}${query}`} className="group inline-flex h-12 items-stretch text-[15px] text-white">
                <span className="flex items-center rounded-l-[5px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[filter] group-hover:brightness-110">
                  Every request
                </span>
                <span className="ml-[2px] flex w-12 items-center justify-center rounded-r-[5px] bg-[#2f45ff] transition-[filter] group-hover:brightness-110">
                  <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" aria-hidden>
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </Link>
            </Magnetic>
          </div>
        </div>

        <div className={`reveal mt-14 border border-white/10 bg-[#07080d]/75 backdrop-blur ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-7">
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.04em] text-white/70">
              <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${status === "live" ? "blink bg-[#7dfc9a]" : "bg-[#ffc46b]"}`} />
              {status === "live" ? "Live from the gateway" : "Demo mode · saved receipts"}
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">Water · {SCOPE_LABEL[scope]} · estimated</span>
          </div>
          {feed.length ? (
            <ul aria-live="polite">
              {feed.map((r) => (
                <FeedRow key={r.request_id} r={r} scope={scope} now={now} isFresh={fresh.has(r.request_id)} query={query} />
              ))}
            </ul>
          ) : (
            <p className="px-6 py-16 text-center text-[14px] text-white/50">
              {status === "live" ? (
                <>
                  No requests yet. Point an app at <code className="font-mono text-white/75">{API_URL}/v1/chat/completions</code> and they land here.
                </>
              ) : (
                "Loading…"
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- method */

function Method({ receipt }: { receipt: Receipt | undefined }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.3);
  const rv = (x = "") => `reveal ${inView ? "is-in" : ""} ${x}`;
  return (
    <section data-nav="light" className="bg-[#f4f5fa]">
      <div ref={ref} className="mx-auto grid max-w-[1320px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_1.15fr] lg:gap-24 lg:px-14 lg:py-28">
        <div>
          <p className={rv("font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0]")}>How water is estimated</p>
          <h2 className="mt-5 text-[clamp(32px,3.8vw,52px)] font-medium leading-[1.04] tracking-[-0.055em] text-[#25262c]">
            <span className={rv("block")} style={delay(0.08)}>
              A range, a method
            </span>
            <span className={rv("block text-[#a2a5b3]")} style={delay(0.18)}>
              and a source for each factor
            </span>
          </h2>
        </div>
        <div className={rv()} style={delay(0.3)}>
          <div className="border-l-2 border-[#4b63ff] pl-5">
            <p className="text-[15px] leading-relaxed text-[#4a4e5e]">{receipt ? receipt.method.charAt(0).toUpperCase() + receipt.method.slice(1) : "Loading the method from the latest receipt…"}</p>
          </div>
          {receipt && (
            <div className="mt-6 flex flex-wrap gap-1.5">
              {receipt.factor_versions.map((f) => (
                <span key={f} title={f}>
                  <Tag tone="blue">
                    {f.split("@")[0]} <span className="opacity-60">@{f.split("@")[1]?.slice(7, 13)}</span>
                  </Tag>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Overview() {
  const { scope, health } = useConnection();
  const { receipts, fresh } = useReceipts(60);
  const summary = useSummary(receipts, receipts[0]?.request_id, scope);
  const feed = useMemo(() => receipts.slice(0, FEED), [receipts]);
  const cited = feed.find((r) => r.factor_versions.length);

  return (
    <Shell>
      <Hero summary={summary} receipts={receipts} scope={scope} />
      <Savings summary={summary} small={health ? modelName(health.small_model) : "the small model"} factors={cited?.factor_versions.length ?? 0} />
      <Feed feed={feed} scope={scope} fresh={fresh} />
      <Method receipt={cited} />
      <Footer />
    </Shell>
  );
}
