"use client";

// Page 9, /dashboard/schedule: time shifting.
//   Hero: the 24-hour profile as bars (lower is better), a marker for now, and every deferred job on the hour it will
//         run (or ran). A profile marked illustrative says so right there.
//   Light: the jobs: status, when, why that hour, what the profile's index was then and at the run, "Run now".
//   Dark: how to defer a request, and what it does and doesn't claim.
// Data: the gateway's GET /jobs and /jobs/profile (./jobData); a saved snapshot in demo mode.

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { SectionHead, Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { fmtInt, type HourlyProfile, type Job, type JobStatus, zonedClock, zonedLabel } from "@/lib/dropwise";
import { delay, HeroSurface, Kind } from "./bits";
import { useConnection } from "./connection";
import { useJobs } from "./jobData";
import { Footer, PAGES, Shell } from "./Shell";

const STATUS: Record<JobStatus, { label: string; tone: "blue" | "stale" | "fresh" | "alert" }> = {
  scheduled: { label: "Scheduled", tone: "blue" },
  running: { label: "Running", tone: "stale" },
  done: { label: "Done", tone: "fresh" },
  failed: { label: "Failed", tone: "alert" },
};

const hh = (h: number) => String(h).padStart(2, "0");

/* --------------------------------------------------------------- chart */

function HourChart({ profile, jobs, now, live }: { profile: HourlyProfile; jobs: Job[]; now: number; live: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const idx = profile.relative_index;
  const max = Math.max(...idx);
  const min = Math.min(...idx);
  const clock = zonedClock(now, profile.timezone);
  const here = clock.hour + clock.minute / 60;

  // Jobs by the local hour they run (or ran) in.
  const byHour = useMemo(() => {
    const m = new Map<number, { waiting: Job[]; done: Job[] }>();
    for (const j of jobs) {
      const iso = j.status === "done" && j.deferred.ran_at ? j.deferred.ran_at : j.deferred.scheduled_for;
      const h = zonedClock(Date.parse(iso), profile.timezone).hour;
      const e = m.get(h) ?? { waiting: [], done: [] };
      (j.status === "done" || j.status === "failed" ? e.done : e.waiting).push(j);
      m.set(h, e);
    }
    return m;
  }, [jobs, profile.timezone]);

  return (
    <div className="fade-up border border-white/15 bg-white/[0.06] p-5 backdrop-blur-md sm:p-7" style={delay(0.9)} data-no-splash>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-white/80">Relative impact by hour · {profile.timezone}</p>
        <div className="flex items-center gap-3">
          {profile.illustrative && (
            <span title={profile.source}>
              <Tag dark tone="stale">Illustrative · not measured</Tag>
            </span>
          )}
          <Kind kind="estimated" dark />
        </div>
      </div>

      <div className="relative mt-8">
        <div className="relative flex h-[190px] items-end gap-[3px] sm:gap-1.5" onPointerLeave={() => setHover(null)}>
          {idx.map((v, h) => {
            const lowest = v <= min + 1e-9;
            const jobsHere = byHour.get(h);
            const height = 24 + ((v - min) / Math.max(1e-9, max - min)) * 76;
            return (
              <div key={h} className="relative flex h-full flex-1 flex-col justify-end" onPointerEnter={() => setHover(h)}>
                <div className="absolute inset-x-0 flex flex-col-reverse items-center gap-1" style={{ bottom: `calc(${height}% + 8px)` }}>
                  {jobsHere?.waiting.map((j) => (
                    <span key={j.id} title={`${j.prompt_preview ?? j.id} runs at ${zonedLabel(j.deferred.scheduled_for, profile.timezone)}`} className="block h-2.5 w-2.5 rounded-full bg-[#e6eeff] shadow-[0_0_12px_rgba(200,216,255,0.9)]" />
                  ))}
                  {jobsHere?.done.map((j) => (
                    <span key={j.id} title={`${j.prompt_preview ?? j.id} ran`} className="block h-2.5 w-2.5 rounded-full border border-[#9dffb4]" />
                  ))}
                </div>
                <div
                  className={`w-full rounded-t-[2px] transition-[height,opacity] duration-700 ${hover === h ? "opacity-100" : "opacity-85"}`}
                  style={{ height: `${height}%`, background: lowest ? "linear-gradient(180deg,#9dffb4,#2fb862)" : "linear-gradient(180deg,#b9c8ff,#3d5bff)" }}
                />
              </div>
            );
          })}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-[-18px] w-px bg-white/70 transition-[left] duration-1000"
            style={{ left: `${(here / 24) * 100}%` }}
          >
            <span className="absolute -top-0.5 left-1 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.05em] text-white/80">{live ? "Now" : "Snapshot"}</span>
          </div>
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-white/45">
          {[0, 6, 12, 18, 23].map((h) => (
            <span key={h}>{hh(h)}:00</span>
          ))}
        </div>
        <p className="mt-3 h-5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">
          {hover !== null ? `${hh(hover)}:00 · relative index ${idx[hover]}${idx[hover] <= min + 1e-9 ? " · lowest" : ""}` : "Hover an hour · 1.0 is an average hour, lower is better"}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#e6eeff]" /> Waiting for this hour
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-[#9dffb4]" /> Already ran
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 bg-[#2fb862]" /> Lowest hour
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hero */

function Metric({ label, value, note, d }: { label: string; value: ReactNode; note: ReactNode; d: number }) {
  return (
    <div className="fade-up border-t border-white/20 pt-4" style={delay(d)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-white/75">{label}</p>
        <Kind kind="measured" dark />
      </div>
      <p className="mt-3 text-[clamp(38px,4vw,58px)] font-medium leading-none tracking-[-0.055em]">{value}</p>
      <p className="mt-3 text-[13px] leading-relaxed text-white/55">{note}</p>
    </div>
  );
}

function Hero({ jobs, profile, now, live, profileError, loaded }: { jobs: Job[]; profile: HourlyProfile | null; now: number; live: boolean; profileError: string | null; loaded: boolean }) {
  const { status } = useConnection();
  const waiting = jobs.filter((j) => j.status === "scheduled" || j.status === "running");
  const done = jobs.filter((j) => j.status === "done");
  const next = [...waiting].sort((a, b) => a.deferred.scheduled_for.localeCompare(b.deferred.scheduled_for))[0];

  return (
    <HeroSurface className="min-h-[100svh]">
      <div className="relative mx-auto flex min-h-[100svh] max-w-[1320px] flex-col px-5 pb-16 pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Time shifting</span>
          <span className="flex items-center gap-1.5 rounded-[2px] border border-white/15 px-2 py-1 text-white/55">
            <span className={`inline-block h-1.5 w-1.5 ${status === "live" ? "blink bg-[#7dfc9a]" : "bg-[#ffc46b]"}`} />
            {status === "live" ? "Live from the gateway" : "Saved snapshot"}
          </span>
        </div>

        <div className="mt-7 grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
          <div>
            <h1 className="jelly text-[clamp(38px,5vw,80px)] font-medium leading-[0.98] tracking-[-0.058em]">
              <BlurText text="Not everything" className="headline-grey block" start={0.2} />
              <BlurText text="has to run now" className="block" start={0.55} />
            </h1>
            <p className="fade-up mt-5 max-w-[520px] text-[15.5px] leading-relaxed tracking-[-0.01em] text-white/75" style={delay(1.1)}>
              Send a batch job with a deadline and Dropwise queues it for the lowest-impact hour before then. Interactive requests are never delayed, and every
              deferred one still gets a receipt.
            </p>
            <div className="mt-9 grid grid-cols-2 gap-6 sm:gap-8">
              <Metric label="Waiting" d={1.3} value={fmtInt(waiting.length)} note="jobs queued for a lower-impact hour" />
              <Metric
                label="Next run"
                d={1.45}
                value={next && profile ? zonedLabel(next.deferred.scheduled_for, profile.timezone).split(" ").pop() : "–"}
                note={next && profile ? `${zonedLabel(next.deferred.scheduled_for, profile.timezone)} ${profile.timezone}` : `${fmtInt(done.length)} already ran`}
              />
            </div>
          </div>

          {profile ? (
            <HourChart profile={profile} jobs={jobs} now={now} live={live} />
          ) : (
            <div className="fade-up self-start border border-white/15 bg-white/[0.06] p-6 backdrop-blur-md sm:p-8" style={delay(0.9)} data-no-splash>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">{loaded ? "No hourly profile" : "Loading"}</p>
              {loaded && (
                <>
                  <p className="mt-4 text-[17px] leading-snug text-white/90">
                    {profileError ?? "With no hourly profile there is no lower-impact hour to wait for, so deferred requests run straight away."}
                  </p>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-white/60">
                    Add <code className="font-mono text-white/80">data/hourly-profile.json</code> to the gateway: 24 relative values, a time zone and where the numbers come from.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </HeroSurface>
  );
}

/* ---------------------------------------------------------------- jobs */

function JobRow({ j, tz, now, runNow, query }: { j: Job; tz: string; now: number; runNow: JobsRun; query: string }) {
  const [busy, setBusy] = useState(false);
  const s = STATUS[j.status];
  const d = j.deferred;
  const ri = d.relative_index;
  const pending = j.status === "scheduled";
  const left = Date.parse(d.scheduled_for) - now;
  const when = left <= 0 ? "due" : left < 3600_000 ? `in ${Math.max(1, Math.round(left / 60_000))} min` : `in ${Math.round(left / 360_000) / 10} h`;
  return (
    <tr className="border-t border-[#eef0f5] align-top transition-colors hover:bg-[#f7f8fc]">
      <td className="px-5 py-4">
        <Tag tone={s.tone}>{s.label}</Tag>
      </td>
      <td className="max-w-[280px] px-3 py-4">
        <p className="truncate text-[13.5px] text-[#1c1d23]">{j.prompt_preview ?? j.id}</p>
        <p className="mt-0.5 font-mono text-[10.5px] text-[#9a9eb0]">
          {j.virtual_key} · {j.id}
        </p>
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-[13px] text-[#5a5e6e]">
        <span className="text-[#1c1d23]">{zonedLabel(d.scheduled_for, tz)}</span>
        <span className="block text-[11.5px] text-[#9a9eb0]">{pending ? when : j.status === "done" && d.ran_at ? `ran ${zonedLabel(d.ran_at, tz)}${d.run_early ? " (early)" : ""}` : ""}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-[13px] text-[#5a5e6e]">{zonedLabel(d.deadline, tz)}</td>
      <td className="whitespace-nowrap px-3 py-4 font-mono text-[12px] tabular-nums text-[#5a5e6e]">
        {ri ? (
          <>
            {ri.at_request} <span className="text-[#c0c3d0]">→</span> <span className={ri.at_run < ri.at_request ? "text-[#1f8a45]" : "text-[#5a5e6e]"}>{ri.at_run}</span>
          </>
        ) : (
          "–"
        )}
      </td>
      <td className="max-w-[340px] px-3 py-4 text-[12.5px] leading-snug text-[#7b7f90]">{j.error ?? d.reason}</td>
      <td className="whitespace-nowrap px-5 py-4 text-right">
        {pending && runNow && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await runNow(j.id);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-[3px] border border-[#d6d9e6] bg-white px-2.5 py-1 font-mono text-[11px] text-[#4a4e5e] transition-all hover:-translate-y-0.5 hover:border-[#3d5bff] hover:text-[#2f45ff] disabled:opacity-50"
          >
            {busy ? "Running…" : "Run now"}
          </button>
        )}
        {j.status === "done" && j.receipt_id && (
          <Link href={`${PAGES.receipt.href}/${j.receipt_id}${query}`} className="font-mono text-[11px] text-[#3048e6] underline decoration-[#b9c6ff] underline-offset-2">
            Receipt →
          </Link>
        )}
      </td>
    </tr>
  );
}

type JobsRun = ((id: string) => Promise<void>) | null;

function JobsTable({ jobs, profile, now, runNow }: { jobs: Job[]; profile: HourlyProfile | null; now: number; runNow: JobsRun }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.1);
  const { query } = useConnection();
  const tz = profile?.timezone ?? "UTC";
  return (
    <section data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14 lg:py-28">
        <SectionHead
          blue
          inView={inView}
          eyebrow="Deferred requests"
          line1="Each one waits for"
          line2="the best hour it can"
          body="A job runs at the lowest-impact hour before its deadline, or now if now is already the best. Times are in the profile's time zone. The index is the profile's relative number for that hour, not a water figure."
        />
        <div className={`reveal mt-14 overflow-x-auto border border-[#dfe2ec] bg-white ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e8f0] px-5 py-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7b7f90]">Jobs · {jobs.length} · times in {tz}</p>
            {profile?.illustrative && <Tag tone="stale">Illustrative profile · not measured</Tag>}
          </div>
          <table className="w-full min-w-[980px] text-left text-[13.5px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                <th className="px-5 py-3 font-normal">Status</th>
                <th className="px-3 py-3 font-normal">Request</th>
                <th className="px-3 py-3 font-normal">Runs at</th>
                <th className="px-3 py-3 font-normal">Deadline</th>
                <th className="px-3 py-3 font-normal">Index then → at run</th>
                <th className="px-3 py-3 font-normal">Why</th>
                <th className="px-5 py-3 font-normal">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <JobRow key={j.id} j={j} tz={tz} now={now} runNow={runNow} query={query} />
              ))}
              {!jobs.length && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-[#7b7f90]">
                    No deferred requests yet. Send one with the <code className="font-mono">x-dropwise-defer</code> header and it appears here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!runNow && jobs.length > 0 && <p className="mt-4 text-[12.5px] text-[#7b7f90]">This is a saved snapshot, so “Run now” is off. With a live gateway it runs a scheduled job at once.</p>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ how to */

function HowTo() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.12);
  const cards: { n: string; title: string; body: string }[] = [
    {
      n: "01",
      title: "Interactive stays instant",
      body: "Only a request that carries the header is deferred. Everything else is answered at once, exactly as before. A deferred request can't stream, and it can wait at most 48 hours.",
    },
    {
      n: "02",
      title: "Same estimate, honest record",
      body: "The registry has no hourly water factor, so a request's water estimate is the same whatever hour it runs. Dropwise records the hour, the profile and its index on the receipt, and claims no water saving from shifting.",
    },
    {
      n: "03",
      title: "Your hours, your source",
      body: "The profile is a file you supply: 24 relative values, a time zone, and where the numbers come from. The shipped one is an illustration and says so wherever it appears. Swap in real hourly figures for your region.",
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
          eyebrow="How to defer a request"
          line1="One header,"
          line2="and an answer to collect"
          body="Add x-dropwise-defer with a window (6h, 90m) or an ISO deadline. You get a job back at once, and fetch the answer from /jobs/:id when it has run."
        />
        <pre className={`reveal mt-12 overflow-x-auto border border-white/15 bg-white/[0.05] p-5 font-mono text-[12.5px] leading-relaxed text-white/85 backdrop-blur sm:p-7 ${inView ? "is-in" : ""}`} style={delay(0.3)}>
          {`curl localhost:8088/v1/chat/completions \\
  -H 'content-type: application/json' -H 'x-dropwise-key: team-batch' \\
  -H 'x-dropwise-defer: 6h' \\
  -d '{"model":"anthropic/claude-opus-5-5","messages":[{"role":"user","content":"Summarize last week's tickets"}]}'

# 202: { "job_id": "job_…", "scheduled_for": "…", "reason": "Waits for 02:00 …", "poll": "/jobs/job_…" }
curl localhost:8088/jobs/job_…            # the answer is in "result" once it has run`}
        </pre>
        <div className="mt-px grid gap-px border border-white/10 bg-white/10 md:grid-cols-3">
          {cards.map((c, i) => (
            <div key={c.n} className={`reveal bg-[#07080d]/80 p-7 backdrop-blur sm:p-8 ${inView ? "is-in" : ""}`} style={delay(0.4 + i * 0.1)}>
              <span className="font-mono text-[11px] text-[#8fb0ff]">{c.n}</span>
              <p className="mt-4 text-[19px] tracking-[-0.02em] text-white">{c.title}</p>
              <p className="mt-3 text-[14px] leading-[1.55] text-white/60">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Schedule() {
  const { jobs, profile, profileError, loaded, now, live, runNow } = useJobs();
  return (
    <Shell scopeToggle={false}>
      <Hero jobs={jobs} profile={profile} now={now} live={live} profileError={profileError} loaded={loaded} />
      <JobsTable jobs={jobs} profile={profile} now={now} runNow={runNow} />
      <HowTo />
      <Footer />
    </Shell>
  );
}
