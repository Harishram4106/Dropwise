"use client";

import { useState, type ReactNode } from "react";
import { useReveal } from "./useReveal";
import { SectionHead, dl } from "./ui";

// Shapes follow dropwise/contracts/*.schema.json. Registry and claim data are real (registry v2);
// the receipt applies the playground's formula to the four registry factors it cites.
const contracts = [
  {
    name: "Water receipt",
    who: "Produced by the gateway, shown by the dashboard",
    data: {
      request_id: "req_0412",
      virtual_key: "team-search",
      model: "large-model",
      routed_to: "small-model",
      region: "unknown",
      tokens_in: 812,
      tokens_out: 264,
      water_ml: { low: 3.09, high: 4.38 },
      scope: "direct_plus_indirect",
      method: "energy per prompt x (tokens / 400) x water factor",
      factor_versions: [
        "google-gemini-median-prompt-energy@sha256:761840584849886fda653540da54a940ac43130255b73c79c14b52284b17deb5",
        "openai-chatgpt-average-query-energy@sha256:381a95a9800dbec8a43010bf8b0c6b4a0d9b7a47f425b93137a7b2fb086da410",
        "datacenter-wue-onsite@sha256:14ad7f30c7fb22196d78444c5453995fed8e4c86b0ca3efc22954eef97166769",
        "electricity-water-intensity@sha256:688636e5454af5bee9f7b43aed318c7db85ef830a3ff7b446e13bab75b29b11f",
      ],
      cache_hit: false,
    },
  },
  {
    name: "Registry entry",
    who: "Built with Tavily, read by the gateway and dashboard",
    data: {
      factor_id: "electricity-water-intensity",
      label: "Water consumed per kWh of electricity generated (EWIF)",
      value: 4.52,
      range: { low: 4.52, high: 4.52 },
      unit: "L per kWh",
      counts: "indirect_only",
      source_url: "https://eta-publications.lbl.gov/sites/default/files/2024-12/lbnl-2024-united-states-data-center-energy-usage-report_1.pdf",
      source_title: "2024 United States Data Center Energy Usage Report (Lawrence Berkeley National Laboratory)",
      source_date: "2024-12",
      evidence:
        "In 2023, energy consumption by a data center translates to national average of 4.52 L/kWh of indirect water consumption, along with 0.34 kg/ kWh emissions.",
      freshness_score: 0.51,
      last_verified: "2026-11-10",
      verified_by: "tavily",
      status: "verified",
      version_hash: "sha256:688636e5454af5bee9f7b43aed318c7db85ef830a3ff7b446e13bab75b29b11f",
    },
  },
  {
    name: "Claim result",
    who: "Produced by the claim checker",
    data: {
      claim: "One ChatGPT question equals a bottle of water",
      checked_at: "2026-11-12T05:02:55.333Z",
      decomposition: "rules",
      evidence: "registry",
      registry_hash: "sha256:7ad523c8c127d340184b0fc6d386e3eca066a2847869d2947c8f84d91d662ac5",
      atomic_claims: [
        {
          text: "One ChatGPT question equals a bottle of water",
          counts: "unclear",
          claimed: { low: 500, high: 500, unit: "mL per response" },
          verdict: "overstated",
          explanation: "Claim: 500 mL per response. About 10x the highest published estimate, 10–50 mL per response (UC Riverside, Making AI Less Thirsty, on-site plus electricity water). Other published figures: 0.32 mL per query (OpenAI CEO statement, scope not stated).",
          freshness_score: 0.61,
          sources: [
            "https://www.datacenterdynamics.com/en/news/sam-altman-chatgpt-queries-consume-034-watt-hours-of-electricity-and-0000085-gallons-of-water/",
            "https://arxiv.org/abs/2304.03271",
          ],
          registry_factors: ["openai-chatgpt-average-query-water", "ucr-gpt3-medium-response-water"],
        },
      ],
    },
  },
];

function Json({ value }: { value: unknown }) {
  const code = JSON.stringify(value, null, 2);
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) {
      out.push(
        <span key={k++} className={m[2] ? "text-[#9db4ff]" : "text-[#a6f0bd]"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else {
      out.push(
        <span key={k++} className="text-[#ffd28f]">
          {m[0]}
        </span>,
      );
    }
    last = re.lastIndex;
  }
  out.push(code.slice(last));
  return (
    <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.65] text-white/55 sm:p-6">
      <code>{out}</code>
    </pre>
  );
}

const terminal: { text: string; tone?: "cmd" | "ok" | "note" }[] = [
  { text: "$ cp .env.example .env", tone: "cmd" },
  { text: "$ docker compose up", tone: "cmd" },
  { text: "✓ bifrost gateway ready", tone: "ok" },
  { text: "✓ dropwise gateway ready", tone: "ok" },
  { text: "✓ evidence registry synced", tone: "ok" },
  { text: "✓ dashboard ready", tone: "ok" },
  { text: "→ demo mode: seeded data, deterministic replies", tone: "note" },
];

const points = [
  ["Works for any app behind Bifrost", "Point your app at the gateway; nothing else changes."],
  ["A sidecar in front of Bifrost", "Point your app at Dropwise; it forwards to Bifrost, with routing, caching and budgets in between."],
  ["Open formats", "The receipt and registry shapes are open, so other tools can read them."],
  ["Safe by default", "Keys live in .env, never in git. Demo mode runs without any."],
];

export default function Developers() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.2);
  const [tab, setTab] = useState(0);
  const rv = (x = "") => `reveal ${inView ? "is-in" : ""} ${x}`;
  const c = contracts[tab];

  return (
    <section id="developers" data-nav="dark" className="relative isolate overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(50%_45%_at_100%_100%,rgba(61,91,255,0.7)_0%,rgba(36,54,240,0)_70%)]"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />

      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <SectionHead
          dark
          inView={inView}
          eyebrow="For developers"
          line1="Open formats."
          line2="One command to run."
          body="Three small data contracts hold everything together, and the whole stack comes up with a single command."
        />

        <div className={rv("mt-16 grid grid-cols-[minmax(0,1fr)] gap-px border border-white/10 bg-white/10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]")} style={dl(0.35)}>
          <div className="bg-[#07080d]/80 backdrop-blur">
            <div role="tablist" aria-label="Data contracts" className="flex overflow-x-auto border-b border-white/10">
              {contracts.map((ct, i) => (
                <button
                  key={ct.name}
                  role="tab"
                  aria-selected={tab === i}
                  onClick={() => setTab(i)}
                  className={`relative whitespace-nowrap px-5 py-3.5 text-[13px] transition-colors ${
                    tab === i ? "text-white" : "text-white/45 hover:text-white/75"
                  }`}
                >
                  {ct.name}
                  {tab === i && <span className="absolute inset-x-5 bottom-0 h-px bg-[#8fb0ff]" />}
                </button>
              ))}
            </div>
            <p className="px-5 pt-4 font-mono text-[10.5px] uppercase tracking-[0.03em] text-white/35 sm:px-6">{c.who}</p>
            <div key={tab} className="fade-up">
              <Json value={c.data} />
            </div>
          </div>

          <div className="flex flex-col bg-[#07080d]/80 backdrop-blur">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-5 py-3.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="ml-3 font-mono text-[11px] text-white/40">dropwise — zsh</span>
            </div>
            <div className="space-y-1.5 p-5 font-mono text-[12.5px] sm:p-6">
              {terminal.map((l, i) => (
                <p
                  key={l.text}
                  className={`${inView ? "fade-up" : "opacity-0"} ${
                    l.tone === "cmd" ? "text-white" : l.tone === "ok" ? "text-[#9dffb4]" : "text-[#9db4ff]"
                  }`}
                  style={dl(0.6 + i * 0.35)}
                >
                  {l.text}
                </p>
              ))}
              <p className={`${inView ? "fade-up" : "opacity-0"} text-white`} style={dl(0.6 + terminal.length * 0.35)}>
                $ <span className="blink inline-block h-3.5 w-2 translate-y-0.5 bg-white/80" />
              </p>
            </div>
            <ul className="mt-auto grid border-t border-white/10 sm:grid-cols-2">
              {points.map(([t, b], i) => (
                <li key={t} className={`border-white/10 p-5 ${i % 2 === 0 ? "sm:border-r" : ""} ${i < 2 ? "border-b" : "max-sm:border-b"}`}>
                  <p className="text-[14px] text-white/90">{t}</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-white/45">{b}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
