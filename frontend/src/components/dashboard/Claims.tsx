"use client";

// Page 7, /claims: demo step 3, the myth-buster. Public page, linked from the nav.
//   Hero: paste a claim (or pick a sample) and check it.
//   Light: one card per atomic claim: the verdict, what it counts, the figure claimed, the explanation as written
//          and its sources as citation badges (each opens the registry drawer).
// Data: POST /claims/check on the intelligence API (offline: rules split + signed registry); saved copies in demo mode.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { BlurText } from "@/components/BlurText";
import { Magnetic } from "@/components/Magnetic";
import { Tag } from "@/components/ui";
import { useReveal } from "@/components/useReveal";
import { type AtomicClaim, type ClaimResult, fmtMl, shortHash, type Verdict } from "@/lib/dropwise";
import { CitationBadge, CitationProvider, useRegistry } from "./Citation";
import { type Checked, checkClaim, NotCheckable, SAMPLES } from "./claimsData";
import { delay, HeroSurface } from "./bits";
import { useConnection } from "./connection";
import { Footer, Shell } from "./Shell";

const MAX_CHARS = 1500;

const VERDICT: Record<Verdict, { label: string; tone: "fresh" | "stale" | "alert" | "blue"; line: string }> = {
  supported: { label: "Supported", tone: "fresh", line: "A current source agrees, within 1.5×." },
  overstated: { label: "Overstated", tone: "stale", line: "Above the highest published figure by more than 1.5×." },
  understated: { label: "Understated", tone: "blue", line: "Below the lowest published figure by more than 1.5×." },
  unsupported: { label: "Unsupported", tone: "alert", line: "Nothing to check it against: no figure, or none of the sources agree." },
  outdated: { label: "Outdated", tone: "stale", line: "Only superseded sources agree." },
};
const BAR: Record<Verdict, string> = { supported: "#2fb862", overstated: "#e6a23c", understated: "#4b63ff", unsupported: "#e05555", outdated: "#e6a23c" };

const COUNTS: Record<AtomicClaim["counts"], string> = {
  direct_only: "Counts direct water only",
  indirect_only: "Counts indirect water only",
  direct_plus_indirect: "Counts direct + indirect",
  unclear: "Doesn't say what it counts",
  not_applicable: "Not a water figure",
};

const num = (x: number) => (x >= 10 ? fmtMl(x) : String(Number(x.toPrecision(3))));
const claimed = (a: AtomicClaim) => (a.claimed ? (a.claimed.low === a.claimed.high ? num(a.claimed.low) : `${num(a.claimed.low)}–${num(a.claimed.high)}`) : null);
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/* ---------------------------------------------------------------- hero */

type State =
  | { kind: "idle" }
  | { kind: "loading"; claim: string }
  | { kind: "ok"; claim: string; checked: Checked }
  | { kind: "error"; claim: string; message: string };

function Hero({ state, onCheck }: { state: State; onCheck: (claim: string) => void }) {
  const [text, setText] = useState(SAMPLES[0].claim);
  const current = state.kind === "idle" ? null : state.claim;
  const submit = (claim: string) => {
    setText(claim);
    onCheck(claim);
  };
  return (
    <HeroSurface className="min-h-[88svh]">
      <div className="relative mx-auto max-w-[1320px] px-5 pb-20 pt-32 sm:px-8 sm:pt-36 lg:px-14">
        <div className="fade-up flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.02em]" style={delay(0.1)}>
          <span className="rounded-[2px] border border-white/10 bg-white/10 px-2 py-1 text-white/90">Claim checker · myth-buster</span>
          <span className="rounded-[2px] border border-white/15 px-2 py-1 text-white/55">Checked against the signed registry</span>
        </div>

        <h1 className="jelly mt-7 max-w-[980px] text-[clamp(38px,5.4vw,84px)] font-medium leading-[0.98] tracking-[-0.058em]">
          <BlurText text="Paste a claim about" className="headline-grey block" start={0.2} />
          <BlurText text="AI and water" className="block" start={0.55} />
        </h1>
        <p className="fade-up mt-5 max-w-[560px] text-[15.5px] leading-relaxed tracking-[-0.01em] text-white/75" style={delay(1.0)}>
          The checker splits it into atomic claims, finds the figure in each, and compares it with the published sources in the registry. Every verdict says
          why, and cites its sources.
        </p>

        <form
          className="fade-up mt-9 max-w-[820px]"
          style={delay(1.15)}
          data-no-splash
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <label htmlFor="claim-text" className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/55">
            The claim
          </label>
          <textarea
            id="claim-text"
            value={text}
            maxLength={MAX_CHARS}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit(text);
              }
            }}
            placeholder="Paste a water claim, for example: One ChatGPT question equals a bottle of water."
            className="mt-2 w-full resize-none border border-white/20 bg-white/[0.06] p-4 text-[16px] leading-relaxed text-white backdrop-blur-md transition-colors placeholder:text-white/35 focus:border-[#8fb0ff] focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Magnetic>
              <button type="submit" disabled={!text.trim() || state.kind === "loading"} className="group inline-flex h-12 items-stretch text-[15px] text-white disabled:opacity-60">
                <span className="flex items-center rounded-l-[5px] bg-gradient-to-b from-[#86a3ff] to-[#4b69ff] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-[filter] group-hover:brightness-110">
                  {state.kind === "loading" ? "Checking…" : "Check this claim"}
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

        <div className="fade-up mt-8 max-w-[980px]" style={delay(1.3)} data-no-splash>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-white/45">Try one</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s.claim}
                onClick={() => submit(s.claim)}
                aria-pressed={current === s.claim}
                className={`max-w-full rounded-[3px] border px-3 py-1.5 text-left text-[12.5px] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 ${
                  current === s.claim ? "border-white bg-white text-[#0c0d12]" : "border-white/20 bg-white/[0.06] text-white/75 hover:border-white/45 hover:text-white"
                }`}
              >
                <span className="line-clamp-1">{s.claim}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </HeroSurface>
  );
}

/* ------------------------------------------------------------- verdicts */

function Atom({ a, i, inView }: { a: AtomicClaim; i: number; inView: boolean }) {
  const v = VERDICT[a.verdict];
  const { byId } = useRegistry();
  const figure = claimed(a);
  // Sources that are in the registry get a badge; the rest are plain links.
  const known = new Set(a.registry_factors.map((id) => byId.get(id)?.source_url));
  const extra = a.sources.filter((u) => !known.has(u));
  return (
    <article className={`reveal relative bg-white p-6 sm:p-8 ${inView ? "is-in" : ""}`} style={delay(0.15 + i * 0.1)}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: BAR[a.verdict] }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Atomic claim {i + 1}</p>
        <Tag tone="plain">{COUNTS[a.counts]}</Tag>
      </div>
      <blockquote className="mt-4 text-[clamp(20px,2.1vw,28px)] font-medium leading-[1.2] tracking-[-0.03em] text-[#1c1d23]">&ldquo;{a.text}&rdquo;</blockquote>

      <div className="mt-6 grid gap-6 lg:grid-cols-[auto_1fr] lg:gap-10">
        <div className="flex min-w-[210px] flex-col gap-3">
          <div>
            <Tag tone={v.tone}>{v.label}</Tag>
            <p className="mt-2 max-w-[230px] text-[12.5px] leading-snug text-[#7b7f90]">{v.line}</p>
          </div>
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Figure in the claim</p>
            <p className="mt-1 text-[26px] font-medium leading-none tracking-[-0.04em] text-[#1c1d23]">
              {figure ? (
                <>
                  {figure}
                  <span className="ml-1.5 text-[13px] tracking-normal text-[#7b7f90]">{a.claimed?.unit}</span>
                </>
              ) : (
                <span className="text-[#b0b4c4]">none</span>
              )}
            </p>
          </div>
        </div>
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Why</p>
          <p className="mt-2 text-[14.5px] leading-relaxed text-[#2c2e36]">{a.explanation}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Sources</span>
            {a.registry_factors.length === 0 && extra.length === 0 && <span className="text-[13px] text-[#9a9eb0]">none, because there is no figure to check</span>}
            {a.registry_factors.map((id) => (
              <CitationBadge key={id} id={id} />
            ))}
            {extra.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="font-mono text-[10.5px] uppercase text-[#3048e6] underline decoration-[#b9c6ff] underline-offset-2">
                {host(u)}
              </a>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function Footnote({ r, source }: { r: ClaimResult; source: "live" | "saved" }) {
  return (
    <p className="mt-6 max-w-[860px] font-mono text-[11px] uppercase leading-relaxed tracking-[0.03em] text-[#7b7f90]">
      Checked against registry {r.registry_hash ? shortHash(r.registry_hash) : "n/a"} · split by {r.decomposition === "model" ? "a model" : "rules"} · sources:{" "}
      {r.evidence === "registry_and_live" ? "registry plus live results found just now" : "registry only"} · {source === "live" ? "live" : "saved result"}
    </p>
  );
}

function Verdicts({ state }: { state: State }) {
  const [ref, inView] = useReveal<HTMLDivElement>(0.05);
  const r = state.kind === "ok" ? state.checked.result : null;
  return (
    <section data-nav="light" id="verdicts" className="relative overflow-hidden bg-[linear-gradient(180deg,#eceef6_0%,#dfe6fb_100%)]">
      <div ref={ref} className="mx-auto max-w-[1320px] scroll-mt-24 px-5 py-20 sm:px-8 lg:px-14 lg:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-[#7d8fe0]">
          {r ? `${r.atomic_claims.length} atomic claim${r.atomic_claims.length === 1 ? "" : "s"}` : "Verdicts"}
        </p>
        {state.kind === "ok" && r && (
          <>
            <h2 className="mt-4 max-w-[900px] text-[clamp(26px,3vw,42px)] font-medium leading-[1.1] tracking-[-0.045em] text-[#25262c]">
              <span className="text-[#a2a5b3]">The claim: </span>&ldquo;{r.claim}&rdquo;
            </h2>
            <div className="mt-10 grid gap-px border border-[#dfe2ec] bg-[#dfe2ec]" aria-live="polite">
              {r.atomic_claims.map((a, i) => (
                <Atom key={`${state.claim}-${i}`} a={a} i={i} inView={inView} />
              ))}
            </div>
            <Footnote r={r} source={state.checked.source} />
          </>
        )}
        {state.kind === "loading" && <p className="mt-6 text-[17px] text-[#5a5e6e]">Splitting the claim and matching it to the registry…</p>}
        {state.kind === "error" && <p className="mt-6 max-w-[680px] border-l-2 border-[#e6a23c] pl-4 text-[15px] leading-relaxed text-[#4a4e5e]">{state.message}</p>}
        {state.kind === "idle" && <p className="mt-6 text-[17px] text-[#5a5e6e]">Check a claim above and each part of it gets its own verdict here.</p>}
      </div>
    </section>
  );
}

function VerdictGuide() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.15);
  const items: { v: Verdict; what: string }[] = [
    { v: "supported", what: "A current source agrees within 1.5×." },
    { v: "overstated", what: "Above the highest published figure by more than 1.5×." },
    { v: "understated", what: "Below the lowest published figure by more than 1.5×." },
    { v: "outdated", what: "Only superseded sources agree." },
    { v: "unsupported", what: "No figure to check, not a per-prompt figure, or the sources disagree with it." },
  ];
  return (
    <section data-nav="dark" className="relative isolate overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(55%_45%_at_0%_100%,rgba(61,91,255,0.8)_0%,rgba(36,54,240,0)_70%),radial-gradient(40%_35%_at_100%_0%,rgba(47,69,255,0.35)_0%,transparent_70%)]"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-24 sm:px-8 lg:px-14">
        <p className={`reveal font-mono text-[11px] uppercase tracking-[0.04em] text-[#8fb0ff] ${inView ? "is-in" : ""}`}>What the verdicts mean</p>
        <ul className="mt-8 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((it, i) => (
            <li key={it.v} className={`reveal bg-[#07080d]/80 p-6 backdrop-blur ${inView ? "is-in" : ""}`} style={delay(0.1 + i * 0.08)}>
              <Tag dark tone={VERDICT[it.v].tone}>
                {VERDICT[it.v].label}
              </Tag>
              <p className="mt-4 text-[13.5px] leading-relaxed text-white/65">{it.what}</p>
            </li>
          ))}
        </ul>
        <p className={`reveal mt-8 max-w-[760px] text-[13px] leading-relaxed text-white/45 ${inView ? "is-in" : ""}`} style={delay(0.5)}>
          A verdict compares a claimed figure with published sources; it is not a measurement of any particular system. Water figures differ by what they count
          (on-site cooling, or also the water behind the electricity), so every explanation says what each source counts.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

function Inner() {
  const { status } = useConnection();
  const [state, setState] = useState<State>({ kind: "idle" });
  const seq = useRef(0);
  const started = useRef(false);

  const run = async (claim: string) => {
    const c = claim.trim();
    if (!c) return;
    const mine = ++seq.current;
    setState({ kind: "loading", claim: c });
    try {
      const checked = await checkClaim(c, status === "live");
      if (mine !== seq.current) return;
      setState({ kind: "ok", claim: c, checked });
    } catch (err) {
      if (mine !== seq.current) return;
      setState({ kind: "error", claim: c, message: err instanceof NotCheckable ? err.message : "The claim checker couldn't be reached." });
    }
  };

  // Open with a first verdict showing, so the page isn't empty.
  useEffect(() => {
    if (status === "connecting" || started.current) return;
    const t = setTimeout(() => {
      started.current = true;
      void run(SAMPLES[0].claim);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const onCheck = (claim: string) => {
    void run(claim);
    setTimeout(() => document.getElementById("verdicts")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  };

  return (
    <Shell scopeToggle={false}>
      <Hero state={state} onCheck={onCheck} />
      <Verdicts state={state} />
      <VerdictGuide />
      <Footer />
    </Shell>
  );
}

export default function Claims(): ReactNode {
  return (
    <CitationProvider>
      <Inner />
    </CitationProvider>
  );
}
