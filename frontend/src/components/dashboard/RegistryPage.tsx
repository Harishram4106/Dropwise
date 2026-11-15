"use client";

// Page 8, /registry: demo step 4. Public page, linked from the nav.
//   Hero: the signed Evidence Registry's version, hash, date and signature.
//   Light: every factor: value, what it counts, source, last verified, freshness, status, version. A row opens its drawer.
//   Light: figures a refresh found that wait for a person to accept them (GET /registry/candidates).
//   Dark: the stale-factor demo: "Check for newer sources" flags a 2016 figure as superseded by a 2024 report.
// Data: GET /registry (and /registry/:id for the drawer) and GET /demo/stale-factor on the intelligence API;
// the saved signed registry and the saved demo result in demo mode.

import { useEffect, useRef, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { Magnetic } from "@/components/Magnetic";
import { SectionHead, Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { type Candidate, type RegistryEntry, type ReviewGroup, shortHash, type StaleDemo } from "@/lib/dropwise";
import { delay, HeroSurface, Kind } from "./bits";
import { CitationProvider, FreshBar, useOpenCitation, useRegistry } from "./Citation";
import { useConnection } from "./connection";
import { Footer, Shell } from "./Shell";
import { fetchCandidates } from "./candidateData";
import { fetchStale } from "./staleData";

const COUNTS: Record<RegistryEntry["counts"], string> = {
  direct_only: "direct only",
  indirect_only: "indirect only",
  direct_plus_indirect: "direct + indirect",
  unclear: "unclear",
  not_applicable: "—",
};

const n = (x: number) => (Math.abs(x) < 10 ? String(Number(x.toPrecision(3))) : Math.round(x).toLocaleString("en-US"));
const value = (e: Pick<RegistryEntry, "range">) => (e.range.low === e.range.high ? n(e.range.low) : `${n(e.range.low)}–${n(e.range.high)}`);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "not published");

/* ---------------------------------------------------------------- hero */

function Hero() {
  const { registry, source } = useRegistry();
  const r = registry;
  const fresh = r.entries.length ? r.entries.reduce((t, e) => t + e.freshness_score, 0) / r.entries.length : 0;
  const newest = r.entries.map((e) => e.last_verified).sort().at(-1);
  return (
    <HeroSurface className="min-h-[92svh]">
      <div className="relative mx-auto max-w-[1320px] px-5 pb-20 pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Evidence registry</span>
          {source === "saved" && <Tag dark tone="stale">Saved registry copy</Tag>}
        </div>

        <div className="mt-7 grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:gap-16">
          <div>
            <h1 className="jelly text-[clamp(38px,5.2vw,82px)] font-medium leading-[0.98] tracking-[-0.058em]">
              <BlurText text="Every number" className="headline-grey block" start={0.2} />
              <BlurText text="has a source" className="block" start={0.5} />
            </h1>
            <p className="fade-up mt-5 max-w-[540px] text-[15.5px] leading-relaxed tracking-[-0.01em] text-white/75" style={delay(1.0)}>
              The figures behind every water estimate live in an open registry. Nothing is a magic constant: each factor says what it counts, where it came from
              and how fresh it is, and each receipt cites the exact version it used.
            </p>
          </div>

          <div className="fade-up border border-white/15 bg-white/[0.06] p-6 backdrop-blur-md sm:p-8" style={delay(0.8)} data-no-splash>
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">Registry {r.version ? `v${r.version}` : ""} · {r.entries.length} entries</p>
              <Kind kind="measured" dark />
            </div>
            <p className="mt-4 break-all font-mono text-[clamp(15px,1.5vw,19px)] leading-snug text-white" title={r.registry_hash}>
              {r.registry_hash.slice(0, 7 + 14)}…{r.registry_hash.slice(-8)}
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Tag dark tone="fresh">Signed · ed25519</Tag>
              {r.version && r.version > 1 && <Tag dark tone="blue">Hash-chained to v{r.version - 1}</Tag>}
            </div>
            <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-white/15 pt-5 text-[13px]">
              <div>
                <dt className="text-white/45">Published</dt>
                <dd className="mt-1 text-[16px] tracking-[-0.01em] text-white/90">{day(r.published_at)}</dd>
              </div>
              <div>
                <dt className="text-white/45">Last verified</dt>
                <dd className="mt-1 text-[16px] tracking-[-0.01em] text-white/90">{newest ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-white/45">Mean freshness</dt>
                <dd className="mt-1 text-[16px] tabular-nums tracking-[-0.01em] text-white/90">{fresh.toFixed(2)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </HeroSurface>
  );
}

/* --------------------------------------------------------------- table */

function Table() {
  const { registry } = useRegistry();
  const open = useOpenCitation();
  const [ref, inView] = useReveal<HTMLDivElement>(0.05);
  return (
    <section data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Every factor"
          line1="A source, a date"
          line2="and a score for each"
          body="Click a row for the evidence quote, the source and the exact version hash that receipts cite."
        />
        <div className={`reveal mt-14 overflow-x-auto border border-[#dfe2ec] bg-white ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          <div className="flex items-center justify-between gap-3 border-b border-[#e6e8f0] px-5 py-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7b7f90]">Registry entries · {registry.entries.length}</p>
            <Tag tone="fresh">Registry {registry.version ? `v${registry.version}` : ""} · {shortHash(registry.registry_hash)}</Tag>
          </div>
          <table className="w-full min-w-[1040px] text-left text-[13.5px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                <th className="px-5 py-3 font-normal">Factor</th>
                <th className="px-3 py-3 font-normal">Value</th>
                <th className="px-3 py-3 font-normal">Counts</th>
                <th className="px-3 py-3 font-normal">Source</th>
                <th className="px-3 py-3 font-normal">Verified</th>
                <th className="px-3 py-3 font-normal">Freshness</th>
                <th className="px-3 py-3 font-normal">Status</th>
                <th className="px-5 py-3 font-normal">Version</th>
              </tr>
            </thead>
            <tbody>
              {registry.entries.map((e) => (
                <tr
                  key={e.factor_id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${e.factor_id}`}
                  onClick={(ev) => {
                    if (!(ev.target as HTMLElement).closest("a")) open(e.factor_id);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      open(e.factor_id);
                    }
                  }}
                  className="cursor-pointer border-t border-[#eef0f5] align-top transition-colors hover:bg-[#f2f4fb] focus-visible:bg-[#eef1ff] focus-visible:outline-none"
                >
                  <td className="px-5 py-4">
                    <p className="font-mono text-[12.5px] text-[#1c1d23]">{e.factor_id}</p>
                    <p className="mt-1 max-w-[260px] text-[12px] leading-snug text-[#9a9eb0]">{e.label}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 tabular-nums text-[#1c1d23]">
                    {value(e)} <span className="text-[#9a9eb0]">{e.unit}</span>
                  </td>
                  <td className="px-3 py-4">{e.counts === "not_applicable" ? <span className="text-[#b0b4c4]">—</span> : <Tag>{COUNTS[e.counts]}</Tag>}</td>
                  <td className="max-w-[260px] px-3 py-4 text-[#5a5e6e]">
                    <a href={e.source_url} target="_blank" rel="noreferrer" className="underline decoration-[#c9cddc] underline-offset-2 hover:decoration-[#4b63ff]">
                      {e.source_title}
                    </a>
                    <span className="ml-1.5 whitespace-nowrap text-[12px] text-[#9a9eb0]">{e.source_date}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-[#5a5e6e]">
                    {e.last_verified}
                    <span className="block text-[11.5px] text-[#9a9eb0]">{e.verified_by === "tavily" ? "by Tavily" : "by hand"}</span>
                  </td>
                  <td className="px-3 py-4">
                    <FreshBar v={e.freshness_score} />
                  </td>
                  <td className="px-3 py-4">{e.status === "stale" ? <Tag tone="stale">stale</Tag> : <Tag tone={e.status === "verified" ? "fresh" : "plain"}>{e.status}</Tag>}</td>
                  <td className="whitespace-nowrap px-5 py-4 font-mono text-[12px] text-[#7b7f90]">{shortHash(e.version_hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------- waiting for review */

const dateTag = (c: Candidate) => (
  <>
    {c.source_date}
    {c.source_date_inferred === "url" && (
      <span className="ml-1.5 align-middle">
        <Tag tone="stale">date read from the link</Tag>
      </span>
    )}
  </>
);

function CandidateGroup({ g }: { g: ReviewGroup }) {
  return (
    <article className="border border-[#dfe2ec] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e8f0] px-5 py-3">
        <div>
          <p className="font-mono text-[12.5px] text-[#1c1d23]">{g.factor_id}</p>
          <p className="mt-0.5 text-[12px] text-[#9a9eb0]">{g.label}</p>
        </div>
        <Tag tone="stale">{g.current ? "Newer source found" : "New factor, no entry yet"}</Tag>
      </div>
      <div className="divide-y divide-[#eef0f5]">
        {g.items.map(({ candidate: c, accept_command }, i) => (
          <div key={`${c.source_url}-${i}`} className="grid gap-6 px-5 py-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.04em] text-[#9a9eb0]">In the signed registry</p>
                {g.current ? (
                  <>
                    <p className="mt-1.5 text-[22px] tracking-[-0.03em] text-[#1c1d23]">
                      {value(g.current)} <span className="text-[13px] text-[#9a9eb0]">{g.current.unit}</span>
                    </p>
                    <p className="mt-1 text-[12.5px] leading-snug text-[#5a5e6e]">
                      {g.current.source_title} · {g.current.source_date}
                    </p>
                  </>
                ) : (
                  <p className="mt-1.5 text-[13.5px] text-[#5a5e6e]">Nothing yet.</p>
                )}
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.04em] text-[#4b63ff]">Found by Tavily</p>
                <p className="mt-1.5 text-[22px] tracking-[-0.03em] text-[#1c1d23]">
                  {value(c)} <span className="text-[13px] text-[#9a9eb0]">{c.unit}</span>
                </p>
                <p className="mt-1 text-[12.5px] leading-snug text-[#5a5e6e]">
                  <a href={c.source_url} target="_blank" rel="noreferrer" className="underline decoration-[#c9cddc] underline-offset-2 hover:decoration-[#4b63ff]">
                    {c.source_title}
                  </a>
                  <span className="mt-1 block text-[#9a9eb0]">{dateTag(c)}</span>
                </p>
                <p className="mt-2 flex flex-wrap gap-1.5">
                  <Tag>{COUNTS[c.counts as RegistryEntry["counts"]] ?? c.counts}</Tag>
                  <Tag>found {day(c.found_at)}</Tag>
                </p>
              </div>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.04em] text-[#9a9eb0]">The sentence it came from, word for word</p>
              <blockquote className="mt-2 border-l-2 border-[#4b63ff] pl-4 text-[14px] leading-relaxed text-[#2a2c35]">{c.evidence}</blockquote>
              <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.04em] text-[#9a9eb0]">To accept it, on your machine</p>
              <pre className="mt-2 overflow-x-auto border border-[#e6e8f0] bg-[#f6f7fb] px-3 py-2.5 font-mono text-[12px] text-[#1c1d23]">
                {accept_command}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function Candidates() {
  const { status } = useConnection();
  const [ref, inView] = useReveal<HTMLDivElement>(0.08);
  const [data, setData] = useState<{ groups: ReviewGroup[]; source: "live" | "saved" } | null>(null);
  useEffect(() => {
    if (status === "connecting") return;
    let stopped = false;
    fetchCandidates(status === "live").then((d) => {
      if (!stopped) setData(d);
    });
    return () => {
      stopped = true;
    };
  }, [status]);

  const groups = data?.groups ?? [];
  return (
    <section data-nav="light" className="bg-white">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Waiting for review"
          line1="Found by search,"
          line2="accepted by a person"
          body="When a refresh finds a newer or new figure, it waits here with its source and its exact quote. Nothing enters the signed registry until someone accepts it and publishes a new version."
        />
        <div className={`reveal mt-14 space-y-5 ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          {data?.source === "saved" && (
            <p className="max-w-[760px] border-l-2 border-[#ffc46b] pl-3 text-[13px] text-[#8a5a00]">
              Sample from the saved demo. The live list appears here when the intelligence API is running.
            </p>
          )}
          {groups.map((g) => (
            <CandidateGroup key={g.factor_id} g={g} />
          ))}
          {data && groups.length === 0 && (
            <div className="border border-dashed border-[#cfd3e2] bg-[#fafbfe] px-6 py-10">
              <p className="text-[16px] tracking-[-0.01em] text-[#1c1d23]">Nothing is waiting for review.</p>
              <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-[#5a5e6e]">
                Candidates appear when a refresh finds a figure that is newer and disagrees, or a factor that has no entry yet. Run one on your machine:
              </p>
              <pre className="mt-4 inline-block border border-[#e6e8f0] bg-white px-3 py-2.5 font-mono text-[12px] text-[#1c1d23]">npm run registry -- refresh &lt;factor_id&gt;</pre>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- stale demo */

const STEPS = ["Searching authoritative sources", "Matching the unit (L per kWh)", "Comparing the figures", "Flagging the older one"];

function Card({ e, label, stale, note }: { e: RegistryEntry; label: string; stale?: boolean; note?: string }) {
  return (
    <div className={`border p-6 backdrop-blur sm:p-7 ${stale ? "border-[#ffc46b]/45 bg-[#ffc46b]/[0.06]" : "border-white/15 bg-white/[0.05]"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">{label}</p>
        <Tag dark tone={stale ? "stale" : "fresh"}>
          {e.status}
        </Tag>
      </div>
      <p className="mt-5 text-[clamp(38px,4vw,56px)] font-medium leading-none tracking-[-0.05em]">
        {value(e)}
        <span className="ml-2 text-[0.3em] tracking-normal text-white/50">{e.unit}</span>
      </p>
      <p className="mt-4 text-[13.5px] leading-snug text-white/80">{e.source_title}</p>
      <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">Published {e.source_date}</p>
      {note && <p className="mt-4 border-l-2 border-[#ffc46b]/70 pl-3 text-[12.5px] leading-snug text-[#ffd28f]">{note}</p>}
    </div>
  );
}

function StalePanel() {
  const { status } = useConnection();
  const [ref, inView] = useReveal<HTMLDivElement>(0.12);
  const [phase, setPhase] = useState<"idle" | "checking" | "done">("idle");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<{ demo: StaleDemo; source: "live" | "saved" } | null>(null);
  const run = useRef(0);

  const check = async () => {
    const mine = ++run.current;
    setPhase("checking");
    setStep(0);
    setResult(null);
    const data = fetchStale(status === "live");
    for (let i = 0; i < STEPS.length; i++) {
      setStep(i);
      await new Promise((r) => setTimeout(r, 650));
      if (mine !== run.current) return;
    }
    const got = await data;
    if (mine !== run.current) return;
    setResult(got);
    setPhase("done");
  };

  // The "before" side is the saved demo's own before entry, so the page can show it before anything is run.
  const shown = result?.demo;
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
          eyebrow="Stale-factor demo"
          line1="When a newer source"
          line2="disagrees, it says so"
          body="A figure is flagged stale only when a newer source in the same unit disagrees. Age alone never flags it. Here a 2016 electricity-water figure meets a 2024 report."
        />

        <div className={`reveal mt-12 ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          <Magnetic>
            <button onClick={check} disabled={phase === "checking"} className="group inline-flex h-12 items-stretch text-[15px] text-white disabled:opacity-70">
              <span className="flex items-center rounded-l-[5px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[filter] group-hover:brightness-110">
                {phase === "checking" ? "Checking…" : phase === "done" ? "Check again" : "Check for newer sources"}
              </span>
              <span className="ml-[2px] flex w-12 items-center justify-center rounded-r-[5px] bg-[#2f45ff] transition-[filter] group-hover:brightness-110">
                <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" aria-hidden>
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          </Magnetic>
          {phase === "checking" && (
            <ul className="mt-6 space-y-2 font-mono text-[11.5px] uppercase tracking-[0.04em] text-white/60" aria-live="polite">
              {STEPS.map((s, i) => (
                <li key={s} className={`flex items-center gap-2 transition-opacity duration-300 ${i <= step ? "opacity-100" : "opacity-25"}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${i < step ? "bg-[#7dfc9a]" : i === step ? "blink bg-[#8fb0ff]" : "bg-white/30"}`} />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {phase === "done" && shown && (
          <div className="mt-12" aria-live="polite">
            {shown.warning && <p className="mb-5 max-w-[720px] border-l-2 border-[#ffc46b]/70 pl-3 text-[13px] text-[#ffd28f]">{shown.warning}</p>}
            <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
              <div className="fade-up">
                <Card e={shown.before} label="Before · what the registry held" />
              </div>
              <div className="fade-up flex items-center justify-center text-[34px] font-light text-[#8fb0ff]" style={delay(0.2)} aria-hidden>
                →
              </div>
              <div className="fade-up" style={delay(0.35)}>
                <Card e={shown.after} label="After · flagged" stale note={`Superseded by ${shown.newer_source.source_title} (${shown.newer_source.source_date}): ${value(shown.newer_source)} ${shown.newer_source.unit}.`} />
              </div>
            </div>
            <div className="fade-up mt-6 max-w-[860px] border-l-2 border-[#8fb0ff] pl-5" style={delay(0.5)}>
              <p className="text-[15px] leading-relaxed text-white/85">{shown.explanation}</p>
              <blockquote className="mt-4 border-l-2 border-white/25 pl-4 text-[13.5px] leading-relaxed text-white/65">
                “{shown.newer_source.evidence}”
                {shown.newer_source.source_date_inferred === "url" && (
                  <span className="mt-2 block font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#ffd28f]">Date read from the source link: check it before accepting</span>
                )}
              </blockquote>
              <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/40">
                {shown.outcome.action.replace("_", " ")} · {shown.mode === "fixture" ? "captured result, no live search" : shown.mode} · {result?.source === "live" ? "from the API" : "saved result"}
              </p>
              <p className="mt-2 text-[13px] text-white/50">
                The registry keeps the old entry&apos;s hash ({shortHash(shown.before.version_hash)}) and the flagged one&apos;s ({shortHash(shown.after.version_hash)}) apart, so a receipt can always show
                which version it cited.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function RegistryPage() {
  return (
    <CitationProvider>
      <Shell scopeToggle={false}>
        <Hero />
        <Table />
        <Candidates />
        <StalePanel />
        <Footer />
      </Shell>
    </CitationProvider>
  );
}
