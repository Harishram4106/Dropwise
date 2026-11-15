"use client";

// Page 2, /dashboard/requests: every receipt, newest first, filterable by virtual key and cache result.
//   Hero: the landing gradient with a rainfall of requests, one droplet each, in a lane per key, sized by
//         estimated water. Cache hits float as rings (they never landed). Filters dim what doesn't match;
//         clicking a droplet jumps to its row.
//   Light: the receipts table, in the landing registry's style.
// Filters live in the URL (?key=team-search&cache=bypass) so a filtered view can be shared or reloaded.
// Data: the shared receipt stream (./receipts): GET /receipts?limit=500 plus GET /events live, saved receipts in demo.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { ago, type CacheOutcome, fmtInt, fmtMl, modelName, type Range, type Receipt, SCOPE_LABEL, type Scope } from "@/lib/dropwise";
import { CacheTag, delay, HeroSurface, Kind, WaterRange } from "./bits";
import { useConnection } from "./connection";
import { useNow, useReceipts } from "./receipts";
import { Footer, PAGES, Shell } from "./Shell";

const LIMIT = 500;
const PAGE = 50;
const RAIN = 90;

const CACHE_FILTERS: { value: CacheOutcome; label: string }[] = [
  { value: "hit", label: "Hit" },
  { value: "miss", label: "Miss" },
  { value: "bypass", label: "Bypassed" },
  { value: "skipped", label: "Not cacheable" },
  { value: "off", label: "Cache off" },
];

const COLORS = { call: "#e6eeff", small: "#b9c8ff", hit: "#9dffb4", bypass: "#ffd28f" } as const;
const kindOf = (r: Receipt): keyof typeof COLORS =>
  r.cache === "hit" ? "hit" : r.cache === "bypass" ? "bypass" : r.routed_to !== r.model ? "small" : "call";

/* ------------------------------------------------------------- filters */

function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-[3px] border px-3 py-1.5 text-[13px] backdrop-blur transition-all duration-300 ${
        active
          ? "border-white bg-white text-[#0c0d12] shadow-[0_8px_30px_rgba(120,150,255,0.35)]"
          : "border-white/20 bg-white/[0.06] text-white/75 hover:-translate-y-0.5 hover:border-white/45 hover:text-white"
      }`}
    >
      {children}
      <span className={`font-mono text-[10.5px] tabular-nums ${active ? "text-[#0c0d12]/50" : "text-white/40"}`}>{count}</span>
    </button>
  );
}

function FilterRow({ label, children, d }: { label: string; children: ReactNode; d: number }) {
  return (
    <div className="fade-up flex flex-wrap items-center gap-2" style={delay(d)}>
      <span className="w-[56px] shrink-0 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45">{label}</span>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- rain */

function Droplet({ r, color, hollow }: { r: number; color: string; hollow: boolean }) {
  const w = r * 2 + 2;
  const h = r * 3 + 2;
  const path = `M${w / 2} 1 C ${w / 2 + r * 0.3} ${r * 0.9}, ${w - 1} ${r * 1.4}, ${w - 1} ${h - r - 1} A ${r} ${r} 0 0 1 1 ${h - r - 1} C 1 ${r * 1.4}, ${w / 2 - r * 0.3} ${r * 0.9}, ${w / 2} 1 Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block overflow-visible">
      {hollow ? <ellipse cx={w / 2} cy={h - r - 1} rx={r} ry={r * 0.55} fill="none" stroke={color} strokeWidth={1.4} /> : <path d={path} fill={color} />}
    </svg>
  );
}

function Rain({
  receipts,
  keys,
  matches,
  scope,
  fresh,
  onPick,
}: {
  receipts: Receipt[];
  keys: string[];
  matches: (r: Receipt) => boolean;
  scope: Scope;
  fresh: Set<string>;
  onPick: (r: Receipt) => void;
}) {
  const [hover, setHover] = useState<{ r: Receipt; x: number; y: number } | null>(null);
  const shown = useMemo(() => receipts.slice(0, RAIN).reverse(), [receipts]);
  const LANE = 58;
  const lanes = keys.length || 1;
  const height = lanes * LANE + 20;

  return (
    <div className="fade-up relative mt-12" style={delay(1.1)} data-no-splash>
      <div className="relative" style={{ height }} onPointerLeave={() => setHover(null)}>
        {keys.map((k, i) => (
          <div key={k} className="absolute inset-x-0" style={{ top: i * LANE + LANE - 6 }}>
            <div className="h-px w-full bg-[linear-gradient(90deg,rgba(255,255,255,0.35)_50%,transparent_50%)] bg-[length:10px_1px]" />
            <span className="absolute -top-5 left-0 font-mono text-[10px] uppercase tracking-[0.04em] text-white/45">{k}</span>
          </div>
        ))}
        {shown.map((r, i) => {
          const lane = Math.max(0, keys.indexOf(r.virtual_key));
          const kind = kindOf(r);
          const ml = r.water_ml_by_scope?.[scope].high || r.avoided_ml_by_scope?.[scope].high || 1;
          const size = Math.min(10, 2.8 + Math.sqrt(ml) * 2);
          // Spread over what is there (at least 30 slots), so new drops push the older ones left.
          const left = `${9 + (i / Math.max(29, shown.length - 1)) * 89}%`;
          const hit = kind === "hit";
          const bottom = lane * LANE + LANE - 6 - (hit ? 16 : 0);
          return (
            <button
              key={r.request_id}
              onClick={() => onPick(r)}
              onPointerEnter={(e) => {
                const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const me = e.currentTarget.getBoundingClientRect();
                setHover({ r, x: me.left - box.left + me.width / 2, y: me.top - box.top });
              }}
              aria-label={`${r.prompt_preview ?? "Request"}, ${r.virtual_key}`}
              className={`absolute -translate-x-1/2 -translate-y-full transition-[opacity,transform,left] duration-700 hover:scale-150 ${matches(r) ? "opacity-100" : "opacity-[0.12]"}`}
              style={{ left, top: bottom }}
            >
              <span className={`block ${fresh.has(r.request_id) ? "drop-in" : ""}`}>
                <Droplet r={size} color={COLORS[kind]} hollow={hit} />
              </span>
            </button>
          );
        })}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-[280px] -translate-x-1/2 -translate-y-full border border-white/20 bg-[#0b0d18]/90 p-3.5 text-left shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-md"
            style={{ left: `clamp(140px, ${hover.x}px, calc(100% - 140px))`, top: hover.y - 10 }}
          >
            <p className="line-clamp-2 text-[13px] leading-snug text-white">{hover.r.prompt_preview ?? "Prompt not kept"}</p>
            <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/50">
              {hover.r.virtual_key} · {hover.r.cache_hit ? "cache hit" : modelName(hover.r.routed_to)}
            </p>
            <p className="mt-1.5 text-[13px] text-white/85">
              <WaterRange range={hover.r.water_ml_by_scope?.[scope] ?? null} />
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.04em] text-white/40">estimated</span>
            </p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">
        <span>← older · newest {Math.min(RAIN, receipts.length)} requests · newer →</span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <Legend color={COLORS.call}>Large model</Legend>
          <Legend color={COLORS.small}>Small model</Legend>
          <Legend color={COLORS.bypass}>Time-sensitive</Legend>
          <Legend color={COLORS.hit} ring>
            Cache hit
          </Legend>
        </span>
      </div>
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

/* --------------------------------------------------------------- table */

function Models({ r }: { r: Receipt }) {
  const title = r.route ? r.route.reasons.join("\n") : r.route_note;
  if (r.cache_hit) {
    return (
      <span title={title} className="whitespace-nowrap text-[#7b7f90]">
        {modelName(r.model)} <span className="text-[#a2a5b3]">· not called</span>
      </span>
    );
  }
  if (r.routed_to !== r.model) {
    return (
      <span title={title} className="whitespace-nowrap">
        <span className="text-[#a2a5b3] line-through decoration-[#c9cddc]">{modelName(r.model)}</span>
        <span className="mx-1.5 text-[#4b63ff]">→</span>
        <span className="text-[#1c1d23]">{modelName(r.routed_to)}</span>
      </span>
    );
  }
  return (
    <span title={title} className="whitespace-nowrap text-[#1c1d23]">
      {modelName(r.model)}
    </span>
  );
}

function Tokens({ r }: { r: Receipt }) {
  if (r.cache_hit) return <span className="text-[#1f8a45]" title="Tokens the cache saved">−{fmtInt(r.tokens_saved)} saved</span>;
  return (
    <span title={r.tokens_estimated ? "The provider sent no usage; estimated from characters ÷ 4" : undefined}>
      {fmtInt(r.tokens_in)} <span className="text-[#c0c3d0]">/</span> {fmtInt(r.tokens_out)}
      {r.tokens_estimated && <span className="text-[#a2a5b3]">*</span>}
    </span>
  );
}

function Row({ r, scope, now, isFresh, focused, query }: { r: Receipt; scope: Scope; now: number; isFresh: boolean; focused: boolean; query: string }) {
  const router = useRouter();
  const when = now ? ago(r.created_at, now) : "";
  const link = PAGES.receipt.ready ? `${PAGES.receipt.href}/${r.request_id}${query}` : null;
  const prompt = r.prompt_preview ?? <span className="text-[#a2a5b3]">Prompt not kept</span>;
  return (
    <tr
      id={`req-${r.request_id}`}
      // The whole row opens the receipt; the prompt stays a real link for keyboards and new tabs.
      onClick={(e) => {
        if (link && !(e.target as HTMLElement).closest("a")) router.push(link);
      }}
      className={`group scroll-mt-40 border-t border-[#eef0f5] align-middle transition-colors duration-700 hover:bg-[#f2f4fb] ${link ? "cursor-pointer" : ""} ${isFresh ? "row-in-light" : ""} ${
        focused ? "bg-[#eef1ff]" : ""
      }`}
    >
      <td className="hidden whitespace-nowrap py-3.5 pl-5 pr-3 font-mono text-[11px] text-[#9a9eb0] sm:table-cell sm:pl-6" title={r.created_at}>
        {when}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-3.5 font-mono text-[12px] text-[#5a5e6e] lg:table-cell">{r.virtual_key}</td>
      <td className="max-w-0 py-3.5 pl-5 pr-3 sm:pl-3">
        <span className="block truncate text-[13.5px] text-[#1c1d23]">
          {link ? (
            <Link href={link} className="decoration-[#4b63ff] underline-offset-2 group-hover:underline">
              {prompt}
            </Link>
          ) : (
            prompt
          )}
        </span>
        <span className="mt-0.5 block font-mono text-[10.5px] text-[#9a9eb0] lg:hidden">
          {r.virtual_key}
          <span className="sm:hidden"> · {when}</span>
        </span>
      </td>
      <td className="hidden px-3 py-3.5 text-[13px] md:table-cell">
        <Models r={r} />
      </td>
      <td className="hidden whitespace-nowrap px-3 py-3.5 text-right text-[12.5px] tabular-nums text-[#5a5e6e] xl:table-cell">
        <Tokens r={r} />
      </td>
      <td className="hidden whitespace-nowrap px-3 py-3.5 sm:table-cell" title={r.route?.time_sensitive ? r.route.reasons.filter((x) => x.startsWith("Time-sensitive")).join("\n") : undefined}>
        <CacheTag cache={r.cache} />
      </td>
      <td className="whitespace-nowrap py-3.5 pl-3 pr-5 text-right text-[13.5px] text-[#1c1d23] sm:pr-6">
        <WaterRange range={r.water_ml_by_scope?.[scope] ?? null} />
      </td>
    </tr>
  );
}

const sumWater = (rs: Receipt[], scope: Scope): Range =>
  rs.reduce((t, r) => (r.water_ml_by_scope ? { low: t.low + r.water_ml_by_scope[scope].low, high: t.high + r.water_ml_by_scope[scope].high } : t), {
    low: 0,
    high: 0,
  });

export default function Requests() {
  const { status, scope, query } = useConnection();
  const { receipts, fresh, loaded } = useReceipts(LIMIT);
  const now = useNow();
  const params = useSearchParams();
  const pathname = usePathname();
  const key = params.get("key");
  const cache = params.get("cache") as CacheOutcome | null;
  const [shown, setShown] = useState(PAGE);
  const [focus, setFocus] = useState<string | null>(null);
  const [tableRef, tableIn] = useReveal<HTMLDivElement>(0.05);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFilter = (name: "key" | "cache" | "both", value: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (name === "both") {
      q.delete("key");
      q.delete("cache");
    } else if (value) q.set(name, value);
    else q.delete(name);
    const s = q.toString();
    window.history.replaceState(null, "", `${pathname}${s ? `?${s}` : ""}`);
    setShown(PAGE);
  };

  const keys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of receipts) counts.set(r.virtual_key, (counts.get(r.virtual_key) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [receipts]);

  // Cache counts follow the key filter, so each chip says how many rows it would show.
  const byKey = useMemo(() => (key ? receipts.filter((r) => r.virtual_key === key) : receipts), [receipts, key]);
  const cacheCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byKey) counts.set(r.cache, (counts.get(r.cache) ?? 0) + 1);
    return counts;
  }, [byKey]);
  const rows = useMemo(() => (cache ? byKey.filter((r) => r.cache === cache) : byKey), [byKey, cache]);
  const total = useMemo(() => sumWater(rows, scope), [rows, scope]);
  const filtered = Boolean(key || cache);
  const matches = (r: Receipt) => (!key || r.virtual_key === key) && (!cache || r.cache === cache);

  // A droplet click: show its row (widening the page if it's further down), scroll to it and light it up.
  const pick = (r: Receipt) => {
    if (!matches(r)) setFilter("both", null);
    const index = (matches(r) ? rows : receipts).findIndex((x) => x.request_id === r.request_id);
    if (index >= shown) setShown(Math.ceil((index + 1) / PAGE) * PAGE);
    setFocus(r.request_id);
  };
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => document.getElementById(`req-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocus(null), 2600);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <Shell>
      <HeroSurface flip className="min-h-[92svh]">
        <div className="relative mx-auto max-w-[1320px] px-5 pb-16 pt-36 sm:px-8 sm:pt-40 lg:px-14">
          <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
            <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Requests · {fmtInt(receipts.length)} receipts</span>
            <span className="flex items-center gap-1.5 rounded-[2px] border border-white/15 px-2 py-1 text-white/55">
              <span className={`inline-block h-1.5 w-1.5 ${status === "live" ? "blink bg-[#7dfc9a]" : "bg-[#ffc46b]"}`} />
              {status === "live" ? "Live from the gateway" : "Replaying saved receipts"}
            </span>
          </div>

          <div className="mt-7 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
            <h1 className="jelly text-[clamp(44px,6vw,92px)] font-medium leading-[0.98] tracking-[-0.058em]">
              <BlurText text="Every request," className="headline-grey block" start={0.2} />
              <BlurText text="with its receipt" className="block" start={0.55} />
            </h1>
            <div className="space-y-3">
              <FilterRow label="Key" d={0.8}>
                <Chip active={!key} onClick={() => setFilter("key", null)} count={receipts.length}>
                  All keys
                </Chip>
                {keys.map(([k, n]) => (
                  <Chip key={k} active={key === k} onClick={() => setFilter("key", key === k ? null : k)} count={n}>
                    <span className="font-mono text-[12px]">{k}</span>
                  </Chip>
                ))}
              </FilterRow>
              <FilterRow label="Cache" d={0.95}>
                <Chip active={!cache} onClick={() => setFilter("cache", null)} count={byKey.length}>
                  Any
                </Chip>
                {CACHE_FILTERS.filter((c) => cacheCounts.has(c.value) || cache === c.value).map((c) => (
                  <Chip key={c.value} active={cache === c.value} onClick={() => setFilter("cache", cache === c.value ? null : c.value)} count={cacheCounts.get(c.value) ?? 0}>
                    {c.label}
                  </Chip>
                ))}
              </FilterRow>
            </div>
          </div>

          <Rain receipts={receipts} keys={keys.map(([k]) => k)} matches={matches} scope={scope} fresh={fresh} onPick={pick} />
        </div>
      </HeroSurface>

      <section data-nav="light" className="bg-[#f6f7fb]">
        <div ref={tableRef} className="mx-auto max-w-[1320px] px-5 py-20 sm:px-8 lg:px-14 lg:py-24">
          <div className={`reveal border border-[#dfe2ec] bg-white ${tableIn ? "is-in" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[#e6e8f0] px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-3 text-[13px] text-[#5a5e6e]">
                <span>
                  <span className="tabular-nums text-[#1c1d23]">{fmtInt(rows.length)}</span> {filtered ? `of ${fmtInt(receipts.length)} ` : ""}requests
                </span>
                {key && <Tag tone="blue">{key}</Tag>}
                {cache && <Tag tone="blue">{CACHE_FILTERS.find((c) => c.value === cache)?.label ?? cache}</Tag>}
                {filtered && (
                  <button onClick={() => setFilter("both", null)} className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#4b63ff] hover:text-[#1c1d23]">
                    Clear filters
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 text-[13px] text-[#5a5e6e]">
                <span>
                  Water for these: <WaterRange range={total} className="text-[#1c1d23]" />
                </span>
                <Kind kind="estimated" />
              </div>
            </div>

            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col className="hidden w-[88px] sm:table-column" />
                <col className="hidden w-[130px] lg:table-column" />
                <col />
                <col className="hidden w-[190px] md:table-column" />
                <col className="hidden w-[130px] xl:table-column" />
                <col className="hidden w-[200px] sm:table-column" />
                <col className="w-[112px] sm:w-[124px]" />
              </colgroup>
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                  <th scope="col" className="hidden py-3 pl-5 pr-3 font-normal sm:table-cell sm:pl-6">When</th>
                  <th scope="col" className="hidden px-3 py-3 font-normal lg:table-cell">Key</th>
                  <th scope="col" className="py-3 pl-5 pr-3 font-normal sm:pl-3">Prompt</th>
                  <th scope="col" className="hidden px-3 py-3 font-normal md:table-cell">Asked → ran on</th>
                  <th scope="col" className="hidden px-3 py-3 text-right font-normal xl:table-cell">Tokens in / out</th>
                  <th scope="col" className="hidden px-3 py-3 font-normal sm:table-cell">Cache</th>
                  <th scope="col" className="py-3 pl-3 pr-5 text-right font-normal sm:pr-6">
                    Water · {scope === "direct_only" ? "direct" : "all"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => (
                  <Row key={r.request_id} r={r} scope={scope} now={now} isFresh={fresh.has(r.request_id)} focused={focus === r.request_id} query={query} />
                ))}
              </tbody>
            </table>

            {!loaded && <p className="border-t border-[#eef0f5] px-6 py-14 text-center text-[13.5px] text-[#7b7f90]">Loading…</p>}
            {loaded && !rows.length && (
              <p className="border-t border-[#eef0f5] px-6 py-14 text-center text-[13.5px] text-[#7b7f90]">
                {filtered ? "No requests match these filters." : "No requests yet. Send one through the gateway and it appears here."}
              </p>
            )}
            {rows.length > shown && (
              <div className="border-t border-[#eef0f5] px-6 py-4 text-center">
                <button onClick={() => setShown((n) => n + PAGE)} className="text-[13px] text-[#4b63ff] hover:text-[#1c1d23]">
                  Show {Math.min(PAGE, rows.length - shown)} more of {fmtInt(rows.length - shown)}
                </button>
              </div>
            )}
          </div>

          <p className="mt-6 max-w-[780px] text-[12.5px] leading-relaxed text-[#7b7f90]">
            Counts and tokens are measured by the gateway. Water is estimated per request as a low–high range and counts{" "}
            {SCOPE_LABEL[scope].toLowerCase()} water; switch it in the nav. A bypassed request was time-sensitive, so the cache was skipped on purpose.
            Hover a model to see why it was routed; click a row for its full receipt.
            {status === "live" ? ` Showing up to the latest ${LIMIT}, plus new ones as they arrive.` : ""}
            {total.high > 0 && rows.length > 1 ? ` Average ${fmtMl(total.low / rows.length)}–${fmtMl(total.high / rows.length)} mL per request.` : ""}
          </p>
        </div>
      </section>
      <Footer />
    </Shell>
  );
}
