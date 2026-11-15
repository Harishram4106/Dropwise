"use client";

// Citation badges and the citation drawer (a shared piece every page with factors uses).
// A badge shows a factor id and its freshness; clicking it opens a drawer with that factor from
// GET /registry/:factor_id: value, what it counts, source link and date, the evidence quote, last verified,
// version hash, and a Stale tag with the newer source when the entry is stale.
// Live: the intelligence API. Demo, or when the API can't be reached: the saved copy of the signed registry.

import { AnimatePresence, motion } from "framer-motion";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import savedRegistry from "@/fixtures/registry.json";
import { Tag } from "@/components/ui";
import { freshnessTone, INTELLIGENCE_URL, type Registry, type RegistryEntry, shortHash } from "@/lib/dropwise";
import { useConnection } from "./connection";

const SAVED = savedRegistry as unknown as Registry;

export interface RegistryState {
  registry: Registry;
  byId: Map<string, RegistryEntry>;
  /** live: from the intelligence API; saved: the copy bundled with the dashboard. */
  source: "live" | "saved";
}

const savedState: RegistryState = { registry: SAVED, byId: new Map(SAVED.entries.map((e) => [e.factor_id, e])), source: "saved" };

/** The registry, from the intelligence API when live, otherwise the saved copy. */
export function useRegistry(): RegistryState {
  const { status } = useConnection();
  const [live, setLive] = useState<RegistryState | null>(null);
  useEffect(() => {
    if (status !== "live") return;
    let stopped = false;
    fetch(`${INTELLIGENCE_URL}/registry`, { cache: "no-store", signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? (r.json() as Promise<Registry>) : Promise.reject(new Error(String(r.status)))))
      .then((registry) => {
        if (!stopped) setLive({ registry, byId: new Map(registry.entries.map((e) => [e.factor_id, e])), source: "live" });
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [status]);
  return status === "live" && live ? live : savedState;
}

const DOT = { fresh: "bg-[#2fb862]", amber: "bg-[#e6a23c]", old: "bg-[#e07a3c]" } as const;
const BAR = DOT;

export function FreshBar({ v }: { v: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-[#e3e6f0]">
        <div className={`h-full rounded-full ${BAR[freshnessTone(v)]}`} style={{ width: `${Math.max(4, v * 100)}%` }} />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[#5a5e6e]">{v.toFixed(2)}</span>
    </div>
  );
}

/* ------------------------------------------------------------- context */

interface Open {
  id: string;
  /** The version the receipt cited, to compare with the registry's current one. */
  cited?: string;
}

const Ctx = createContext<{ open: (o: Open) => void; registry: RegistryState } | null>(null);

export function CitationProvider({ children }: { children: ReactNode }) {
  const registry = useRegistry();
  const [current, setCurrent] = useState<Open | null>(null);
  const open = useCallback((o: Open) => setCurrent(o), []);
  const value = useMemo(() => ({ open, registry }), [open, registry]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Drawer current={current} registry={registry} onClose={() => setCurrent(null)} />
    </Ctx.Provider>
  );
}

/** Opens the citation drawer for a factor (rows and buttons that aren't badges). */
export function useOpenCitation(): (id: string, cited?: string) => void {
  const { open } = useCitations();
  return (id, cited) => open({ id, cited });
}

function useCitations() {
  const c = useContext(Ctx);
  if (!c) throw new Error("Citation badges must be inside <CitationProvider>");
  return c;
}

/** A factor id with its freshness. `dark` for the hero sections. */
export function CitationBadge({ id, cited, dark = false }: { id: string; cited?: string; dark?: boolean }) {
  const { open, registry } = useCitations();
  const entry = registry.byId.get(id);
  const tone = entry ? freshnessTone(entry.freshness_score) : null;
  const stale = entry?.status === "stale";
  return (
    <button
      onClick={() => open({ id, cited })}
      title={entry ? `${entry.label} · freshness ${entry.freshness_score.toFixed(2)}` : id}
      className={`group inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.02em] transition-all duration-300 hover:-translate-y-0.5 ${
        dark
          ? "border-[#8fb0ff]/40 bg-[#3d5bff]/20 text-[#cfdcff] hover:border-[#cfdcff]"
          : "border-[#b9c6ff] bg-[#eef1ff] text-[#3048e6] hover:border-[#3048e6] hover:shadow-[0_6px_20px_rgba(75,99,255,0.18)]"
      }`}
    >
      {tone && <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "bg-[#e6a23c]" : DOT[tone]}`} />}
      {id}
      <span aria-hidden className="opacity-50 transition-transform group-hover:translate-x-0.5">
        ↗
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- drawer */

const COUNTS: Record<RegistryEntry["counts"], string> = {
  direct_only: "Direct only: on-site cooling water",
  indirect_only: "Indirect only: water behind the electricity",
  direct_plus_indirect: "Direct + indirect",
  unclear: "Unclear: the source doesn't say",
  not_applicable: "Not a water figure",
};

function fmtValue(e: RegistryEntry) {
  const n = (x: number) => (Math.abs(x) < 10 ? String(Number(x.toPrecision(3))) : Math.round(x).toLocaleString("en-US"));
  return e.range.low === e.range.high ? n(e.range.low) : `${n(e.range.low)}–${n(e.range.high)}`;
}

function Drawer({ current, registry, onClose }: { current: Open | null; registry: RegistryState; onClose: () => void }) {
  const { status } = useConnection();
  const [fetched, setFetched] = useState<{ id: string; entry: RegistryEntry } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const id = current?.id;

  // Live: read the factor itself (GET /registry/:factor_id), so the drawer shows the freshest copy.
  useEffect(() => {
    if (!id || status !== "live") return;
    let stopped = false;
    fetch(`${INTELLIGENCE_URL}/registry/${id}`, { cache: "no-store", signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? (r.json() as Promise<RegistryEntry>) : Promise.reject(new Error(String(r.status)))))
      .then((entry) => !stopped && setFetched({ id, entry }))
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [id, status]);

  useEffect(() => {
    if (!current) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, onClose]);

  const entry = id ? (fetched?.id === id ? fetched.entry : registry.byId.get(id)) : undefined;
  const fromLive = Boolean(id && fetched?.id === id) || registry.source === "live";
  const changed = entry && current?.cited && current.cited !== entry.version_hash;

  return (
    <AnimatePresence>
      {current && (
        <motion.div className="fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          <button aria-label="Close" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-[#0c0d12]/45 backdrop-blur-[3px]" />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={entry ? entry.label : `Factor ${id}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 32 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col overflow-y-auto bg-[#f6f7fb] text-[#1c1d23] shadow-[-30px_0_80px_rgba(12,13,18,0.35)]"
          >
            <div className="relative overflow-hidden bg-[linear-gradient(180deg,#a6c0ff_0%,#d3ddfb_45%,#f6f7fb_100%)] px-7 pb-8 pt-6">
              <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#8fb0ff] opacity-60 blur-[80px]" />
              <div className="relative flex items-center justify-between gap-3">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#4b63ff]">
                  Evidence registry{registry.registry.version ? ` · v${registry.registry.version}` : ""}
                </p>
                <button
                  ref={closeRef}
                  onClick={onClose}
                  className="rounded-[3px] border border-[#1c1d23]/15 bg-white/60 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#5a5e6e] hover:bg-white"
                >
                  Close · Esc
                </button>
              </div>
              <p className="relative mt-5 font-mono text-[12px] text-[#5a5e6e]">{id}</p>
              {entry ? (
                <>
                  <h2 className="relative mt-2 text-[24px] font-medium leading-[1.15] tracking-[-0.03em]">{entry.label}</h2>
                  <p className="relative mt-6 text-[54px] font-medium leading-none tracking-[-0.05em]">
                    {fmtValue(entry)}
                    <span className="ml-2 text-[18px] tracking-[-0.01em] text-[#5a5e6e]">{entry.unit}</span>
                  </p>
                  <div className="relative mt-4 flex flex-wrap gap-1.5">
                    {entry.status === "stale" ? <Tag tone="stale">Stale</Tag> : <Tag tone="fresh">{entry.status}</Tag>}
                    <Tag>{COUNTS[entry.counts]}</Tag>
                    {!fromLive && <Tag tone="stale">Saved registry copy</Tag>}
                  </div>
                </>
              ) : (
                <p className="relative mt-4 text-[15px] text-[#5a5e6e]">This factor isn&apos;t in the registry copy the dashboard has.</p>
              )}
            </div>

            {entry && (
              <div className="flex-1 space-y-7 px-7 py-7">
                {entry.status === "stale" && entry.superseded_by && (
                  <div className="border border-[#f0cf94] bg-[#fff7e8] p-4 text-[13.5px] leading-relaxed text-[#7a4a06]">
                    A newer source disagrees with this figure.{" "}
                    <a href={entry.superseded_by} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      See the newer source
                    </a>
                    .
                  </div>
                )}
                <section>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">What the source says</p>
                  <blockquote className="mt-3 border-l-2 border-[#4b63ff] pl-4 text-[15px] leading-relaxed text-[#2c2e36]">{entry.evidence}</blockquote>
                </section>
                <section>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Source</p>
                  <a
                    href={entry.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block text-[15px] leading-snug text-[#1c1d23] underline decoration-[#c9cddc] underline-offset-[3px] hover:decoration-[#4b63ff]"
                  >
                    {entry.source_title}
                  </a>
                  <p className="mt-1 text-[13px] text-[#7b7f90]">Published {entry.source_date}</p>
                </section>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[#e3e6ef] pt-6 text-[13.5px]">
                  <div>
                    <dt className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Freshness</dt>
                    <dd className="mt-2">
                      <FreshBar v={entry.freshness_score} />
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Last verified</dt>
                    <dd className="mt-2 text-[#1c1d23]">
                      {entry.last_verified} <span className="text-[#9a9eb0]">· {entry.verified_by === "tavily" ? "by Tavily" : "by hand"}</span>
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#9a9eb0]">Version</dt>
                    <dd className="mt-2 break-all font-mono text-[12px] text-[#5a5e6e]" title={entry.version_hash}>
                      {entry.version_hash}
                    </dd>
                    {current?.cited && (
                      <p className={`mt-2 text-[12.5px] ${changed ? "text-[#a2650b]" : "text-[#1f8a45]"}`}>
                        {changed
                          ? `This receipt cites an earlier version (${shortHash(current.cited)}); the registry has changed since.`
                          : "This receipt cites exactly this version."}
                      </p>
                    )}
                  </div>
                </dl>
                <p className="border-t border-[#e3e6ef] pt-5 text-[12px] leading-relaxed text-[#9a9eb0]">
                  Registry {shortHash(registry.registry.registry_hash)} · signed with ed25519 and hash-chained to the version before. Freshness falls
                  with the source&apos;s age; an entry turns stale only when a newer source disagrees.
                </p>
              </div>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
