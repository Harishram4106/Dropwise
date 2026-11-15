"use client";

// Page 4, /dashboard/budgets: a water budget per virtual key.
//   Hero: one glass tank per key, filling with its estimated water. A dashed line marks the 80% alert; the
//         water turns amber at 80% and red at 100% (a soft limit: requests are still served).
//   Light: the keys as a table, each with its used range against the limit.
//   Dark: alerts as they are raised. Light: how budgets count.
// Data: the gateway's GET /budgets (./budgets), or the replayed receipts in demo mode.
// Same colours as the landing page's budget demo: blue on track, amber alert, red soft limit.

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { SectionHead, Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { ago, ALERT_PCT, type BudgetAlert, type BudgetState, type BudgetStatus, fmtMl, SCOPE_LABEL } from "@/lib/dropwise";
import { useBudgets } from "./budgetData";
import { Count, delay, HeroSurface, Kind, Wave, WaterRange } from "./bits";
import { useConnection } from "./connection";
import { useNow, useReceipts } from "./receipts";
import { Footer, PAGES, Shell } from "./Shell";

const LABEL: Record<BudgetStatus, string> = { ok: "On track", alert: "Alert sent · 80%", soft_limit: "Soft limit reached" };
const TONE = { ok: "fresh", alert: "stale", soft_limit: "alert" } as const;
const BAR = { ok: "#3d5bff", alert: "#e6a23c", soft_limit: "#e05555" } as const;
/** Water colours in the tank: top of the water, bottom of the water. */
const WATER = {
  ok: ["#9db4ff", "#3d5bff"],
  alert: ["#ffd28f", "#e6a23c"],
  soft_limit: ["#ff9f9f", "#e05555"],
} as const;

const period = (p: string | null) => (!p ? "" : p.length === 7 ? `${p} · monthly` : `${p} · daily`);
const periodWord = (p: string | null) => (p && p.length === 7 ? "this month" : "today");
const mlLimit = (n: number) => `${Number.isInteger(n) ? n : fmtMl(n)} mL`;
/** The Requests page filtered to one key, keeping ?scope and ?demo. */
const keyLink = (key: string, query: string) => `${PAGES.requests.href}?key=${encodeURIComponent(key)}${query.replace("?", "&")}`;
const alertText = (a: BudgetAlert) => (a.status === "soft_limit" ? "hit its soft limit" : "crossed 80%");

/* ---------------------------------------------------------------- tank */

function Tank({ b, d }: { b: BudgetState; d: number }) {
  const { query } = useConnection();
  const pct = Math.min(100, b.used_pct);
  const [top, bottom] = WATER[b.status];
  const over = b.used_pct > 100;
  return (
    <Link
      href={keyLink(b.virtual_key, query)}
      className="fade-up group block"
      style={delay(d)}
      title={`${b.virtual_key}: see its requests`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[12.5px] text-white/85">{b.virtual_key}</p>
        <Tag dark tone={TONE[b.status]}>
          {LABEL[b.status]}
        </Tag>
      </div>

      <div
        className={`relative mt-4 h-[250px] overflow-hidden rounded-[6px] border bg-white/[0.04] backdrop-blur-sm transition-[border-color,box-shadow] duration-700 group-hover:border-white/50 ${
          b.status === "soft_limit" ? "border-[#ff8a8a]/60 shadow-[0_0_50px_rgba(224,85,85,0.35)]" : b.status === "alert" ? "border-[#ffc46b]/50 shadow-[0_0_40px_rgba(230,162,60,0.22)]" : "border-white/25"
        }`}
      >
        {/* the water */}
        <div className="absolute inset-x-0 bottom-0 transition-[height] duration-[1400ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]" style={{ height: `${pct}%` }}>
          <Wave color={top} className="svg-wave-b -top-[12px] opacity-40" style={{ left: -37 }} />
          <Wave color={top} className="svg-wave-a -top-[11px]" />
          <div className="absolute inset-0 top-[2px]" style={{ background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`, opacity: 0.92 }} />
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="bubble absolute bottom-2 h-1.5 w-1.5 rounded-full bg-white/60"
              style={{ left: `${22 + i * 28}%`, ...delay(i * 1.1) }}
            />
          ))}
        </div>

        {/* the 80% alert line, and the top of the tank at 100% */}
        <div aria-hidden className="absolute inset-x-0 border-t border-dashed border-white/55" style={{ bottom: `${ALERT_PCT}%` }} />
        <span className="absolute right-2 font-mono text-[9.5px] uppercase tracking-[0.05em] text-white/70" style={{ bottom: `calc(${ALERT_PCT}% + 4px)` }}>
          Alert 80%
        </span>
        <span className="absolute left-2 top-1.5 font-mono text-[9.5px] uppercase tracking-[0.05em] text-white/45">Soft limit 100%</span>

        <p className="absolute inset-x-0 bottom-3 text-center text-[clamp(34px,3.4vw,46px)] font-medium leading-none tracking-[-0.05em] text-white [text-shadow:0_2px_24px_rgba(5,8,30,0.55)]">
          <Count value={b.used_pct} format={(n) => `${n.toFixed(1)}%`} />
        </p>
      </div>

      <p className="mt-4 text-[14.5px] text-white/85">
        <WaterRange range={b.used_ml} animate /> <span className="text-white/45">of {mlLimit(b.limit_ml)}</span>
      </p>
      <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45">
        {over ? `Over by ${fmtMl(b.used_ml.high - b.limit_ml)} mL · still served` : `${fmtMl(Math.max(0, b.limit_ml - b.used_ml.high))} mL left at the high estimate`}
      </p>
    </Link>
  );
}

function Hero({ budgets, alerts, loaded, periodText }: { budgets: BudgetState[]; alerts: BudgetAlert[]; loaded: boolean; periodText: string | null }) {
  const { status } = useConnection();
  const now = useNow();
  const [mountedAt] = useState(() => Date.now());
  // New alerts show as a toast for a few seconds, like the landing page's budget demo.
  const toasts = alerts.filter((a) => now && Date.parse(a.at) >= mountedAt - 500 && now - Date.parse(a.at) < 6500).slice(0, 3);

  return (
    <HeroSurface className="min-h-[100svh]">
      <div className="relative mx-auto flex min-h-[100svh] max-w-[1320px] flex-col px-5 pb-16 pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Budgets{periodText ? ` · ${periodText}` : ""}</span>
          <span className="flex items-center gap-1.5 rounded-[2px] border border-white/15 px-2 py-1 text-white/55">
            <span className={`inline-block h-1.5 w-1.5 ${status === "live" ? "blink bg-[#7dfc9a]" : "bg-[#ffc46b]"}`} />
            {status === "live" ? "Live from the gateway" : "Replaying saved receipts"}
          </span>
        </div>

        <div className="mt-7 flex flex-wrap items-end justify-between gap-8">
          <div>
            <h1 className="jelly text-[clamp(44px,6vw,92px)] font-medium leading-[0.98] tracking-[-0.058em]">
              <BlurText text="A water budget" className="headline-grey block" start={0.2} />
              <BlurText text="for every key" className="block" start={0.55} />
            </h1>
            <p className="fade-up mt-5 max-w-[520px] text-[15.5px] leading-relaxed tracking-[-0.01em] text-white/75" style={delay(1.15)}>
              Each tank is a virtual key&apos;s estimated water {periodWord(periodText)}, counted at the high end so a budget is never under-counted. It turns
              amber at 80% and red at 100%, and the requests keep flowing.
            </p>
          </div>
          <div className="relative" aria-live="polite">
            <div className="flex flex-col items-end gap-2">
              {toasts.map((a) => (
                <div key={`${a.at}-${a.virtual_key}-${a.status}`} className="fade-up shadow-[0_12px_30px_-12px_rgba(0,0,0,0.5)]">
                  <Tag dark tone={a.status === "soft_limit" ? "alert" : "stale"}>
                    {a.virtual_key} {alertText(a)} · {a.status === "soft_limit" ? "team notified" : "alert sent"}
                  </Tag>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(230px,1fr))] lg:gap-10">
          {budgets.map((b, i) => (
            <Tank key={b.virtual_key} b={b} d={1.1 + i * 0.15} />
          ))}
        </div>
        {loaded && !budgets.length && (
          <p className="mt-10 max-w-[560px] text-[15px] leading-relaxed text-white/70">
            No budgets yet. Add a limit per key in the gateway&apos;s <code className="font-mono text-white/90">data/budgets.json</code> and each key gets a tank here.
          </p>
        )}
        {!loaded && <p className="mt-10 text-[14px] text-white/50">Loading budgets…</p>}

        <div className="fade-up mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-12 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/60" style={delay(1.8)}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#3d5bff]" /> On track
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#e6a23c]" /> Alert at 80%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#e05555]" /> Soft limit at 100%
          </span>
          <span className="text-white/40">· click a tank for that key&apos;s requests</span>
        </div>
      </div>
    </HeroSurface>
  );
}

/* --------------------------------------------------------------- table */

/** Used range against the limit: solid up to the low estimate, lighter up to the high estimate. */
function RangeBar({ b }: { b: BudgetState }) {
  const low = Math.min(100, (b.used_ml.low / b.limit_ml) * 100);
  const high = Math.min(100, b.used_pct);
  return (
    <div className="relative h-2 w-full min-w-[120px] rounded-full bg-[#e3e6f0]">
      <div className="absolute inset-y-0 left-0 rounded-full opacity-35 transition-[width] duration-700" style={{ width: `${high}%`, background: BAR[b.status] }} />
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700" style={{ width: `${low}%`, background: BAR[b.status] }} />
      <div className="absolute -top-1 h-4 w-px bg-[#1c1d23]/40" style={{ left: `${ALERT_PCT}%` }} title="Alert at 80%" />
    </div>
  );
}

function Table({ budgets, periodText }: { budgets: BudgetState[]; periodText: string | null }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.1);
  const { query } = useConnection();
  return (
    <section data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Per key"
          line1="Used against the limit,"
          line2="as a range"
          body="Water is an estimate, so each key's use is a low–high range: the solid bar is the low end, the lighter one the high end, and the high end is what counts toward the limit."
        />
        <div className={`reveal mt-14 overflow-x-auto border border-[#dfe2ec] bg-white ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e8f0] px-5 py-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7b7f90]">Budgets{periodText ? ` · ${period(periodText)}` : ""}</p>
            <Kind kind="estimated" />
          </div>
          <table className="w-full min-w-[820px] text-left text-[13.5px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                <th className="px-5 py-3 font-normal">Key</th>
                <th className="px-3 py-3 font-normal">Used</th>
                <th className="w-[26%] px-3 py-3 font-normal">Against the limit</th>
                <th className="px-3 py-3 font-normal">Headroom</th>
                <th className="px-3 py-3 font-normal">Counts</th>
                <th className="px-5 py-3 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={b.virtual_key} className="group border-t border-[#eef0f5] transition-colors hover:bg-[#f7f8fc]">
                  <td className="px-5 py-4 font-mono text-[12.5px] text-[#1c1d23]">
                    <Link href={keyLink(b.virtual_key, query)} className="underline decoration-[#c9cddc] underline-offset-2 hover:decoration-[#4b63ff]">
                      {b.virtual_key}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-[#1c1d23]">
                    <WaterRange range={b.used_ml} /> <span className="text-[#9a9eb0]">of {mlLimit(b.limit_ml)}</span>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-3">
                      <RangeBar b={b} />
                      <span className="w-[52px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-[#5a5e6e]">{b.used_pct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-[#5a5e6e]">
                    {b.used_pct > 100 ? <span className="text-[#c03a3a]">over by {fmtMl(b.used_ml.high - b.limit_ml)} mL</span> : `${fmtMl(Math.max(0, b.limit_ml - b.used_ml.high))} mL`}
                  </td>
                  <td className="px-3 py-4">
                    <Tag>{SCOPE_LABEL[b.scope]}</Tag>
                  </td>
                  <td className="px-5 py-4">
                    <Tag tone={TONE[b.status]}>{LABEL[b.status]}</Tag>
                  </td>
                </tr>
              ))}
              {!budgets.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[#7b7f90]">
                    No budgets configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- alerts */

function AlertRow({ a, now, isFresh, limits }: { a: BudgetAlert; now: number; isFresh: boolean; limits: Map<string, number> }) {
  const { query } = useConnection();
  const limit = limits.get(a.virtual_key);
  return (
    <li className={`border-t border-white/[0.07] first:border-t-0 ${isFresh ? "row-in" : ""}`}>
      <Link
        href={keyLink(a.virtual_key, query)}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-white/[0.04] sm:px-7"
      >
        <span className="w-[160px] shrink-0">
          <Tag dark tone={a.status === "soft_limit" ? "alert" : "stale"}>
            {a.status === "soft_limit" ? "Soft limit · 100%" : "Alert · 80%"}
          </Tag>
        </span>
        <span className="min-w-0 flex-1 text-[14px] text-white/90">
          <span className="font-mono text-[12.5px]">{a.virtual_key}</span> {alertText(a)}
          <span className="text-white/50">
            {" "}
            at {a.used_pct.toFixed(1)}%{limit ? ` of ${mlLimit(limit)}` : ""}
          </span>
        </span>
        <span className="font-mono text-[11px] text-white/40">{now ? ago(a.at, now) : ""}</span>
      </Link>
    </li>
  );
}

function Alerts({ alerts, budgets }: { alerts: BudgetAlert[]; budgets: BudgetState[] }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.15);
  const now = useNow();
  const [mountedAt] = useState(() => Date.now());
  const limits = useMemo(() => new Map(budgets.map((b) => [b.virtual_key, b.limit_ml])), [budgets]);
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
          eyebrow="Alerts"
          line1="Teams hear about it"
          line2="before it grows"
          body="Each key raises an alert once when it crosses 80% and once more at 100%. Past the limit, requests are still served and flagged, never blocked."
        />
        <div className={`reveal mt-14 border border-white/10 bg-[#07080d]/75 backdrop-blur ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-7">
            <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/70">Alerts raised · {alerts.length}</span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">Newest first</span>
          </div>
          {alerts.length ? (
            <ul aria-live="polite">
              {alerts.slice(0, 20).map((a) => (
                <AlertRow key={`${a.at}-${a.virtual_key}-${a.status}`} a={a} now={now} isFresh={Date.parse(a.at) >= mountedAt - 500} limits={limits} />
              ))}
            </ul>
          ) : (
            <p className="px-6 py-14 text-center text-[14px] text-white/50">No alerts yet: every key is under 80% of its budget.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- rules */

function Rules({ budgets }: { budgets: BudgetState[] }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.2);
  const scope = budgets[0] ? SCOPE_LABEL[budgets[0].scope].toLowerCase() : "direct + indirect";
  const steps: { n: string; title: string; body: ReactNode }[] = [
    {
      n: "01",
      title: "Counted at the high end",
      body: `Every request adds the high end of its estimated range, in ${scope} water, to its key's total for the period. A budget is never under-counted, and a cache hit adds nothing.`,
    },
    {
      n: "02",
      title: "An alert at 80%",
      body: "When a key's total first reaches 80% of its limit, the gateway raises one alert, so the team sees its footprint while there's still room.",
    },
    {
      n: "03",
      title: "A soft limit at 100%",
      body: "At 100% a second alert goes out. The limit is soft: requests are still served and flagged, because a budget should inform people, not break their product.",
    },
  ];
  return (
    <section data-nav="light" className="bg-[#f4f5fa]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <p className={`reveal font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0] ${inView ? "is-in" : ""}`}>How budgets count</p>
        <h2 className="mt-5 text-[clamp(32px,3.8vw,52px)] font-medium leading-[1.04] tracking-[-0.055em] text-[#25262c]">
          <span className={`reveal block ${inView ? "is-in" : ""}`} style={delay(0.08)}>
            Estimated water, counted
          </span>
          <span className={`reveal block text-[#a2a5b3] ${inView ? "is-in" : ""}`} style={delay(0.18)}>
            the same way every time
          </span>
        </h2>
        <ol className="mt-12 grid gap-px border-y border-[#e3e6ef] bg-[#e3e6ef] md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.n} className={`reveal bg-[#f4f5fa] px-1 py-7 md:px-6 ${inView ? "is-in" : ""}`} style={delay(0.3 + i * 0.1)}>
              <span className="font-mono text-[11px] text-[#7d8fe0]">{s.n}</span>
              <p className="mt-3 text-[17px] tracking-[-0.02em] text-[#1c1d23]">{s.title}</p>
              <p className="mt-2 text-[13.5px] leading-[1.5] text-[#7b7f90]">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className={`reveal mt-8 max-w-[760px] text-[12.5px] leading-relaxed text-[#7b7f90] ${inView ? "is-in" : ""}`} style={delay(0.6)}>
          Limits and the counting scope are set per key in the gateway&apos;s <code className="font-mono text-[#5a5e6e]">data/budgets.json</code>, so the
          direct / indirect switch in the nav doesn&apos;t change a budget. All water figures here are estimates.
        </p>
      </div>
    </section>
  );
}

export default function Budgets() {
  const { receipts } = useReceipts(60);
  const { period: p, budgets, alerts, loaded } = useBudgets(receipts);
  return (
    <Shell scopeToggle={false}>
      <Hero budgets={budgets} alerts={alerts} loaded={loaded} periodText={p} />
      <Table budgets={budgets} periodText={p} />
      <Alerts alerts={alerts} budgets={budgets} />
      <Rules budgets={budgets} />
      <Footer />
    </Shell>
  );
}
