"use client";

import { useReveal } from "./useReveal";
import { SectionHead, Tag, dl } from "./ui";

type Counts = "direct_only" | "indirect_only" | "direct_plus_indirect" | "unclear" | "—";

type Entry = {
  id: string;
  value: string;
  counts: Counts;
  source: string;
  url: string;
  date: string;
  verified: string;
  fresh: number;
  hash: string;
  stale?: boolean;
};

// Registry v2 (signed). Values, sources, freshness and hashes are copied from intelligence/registry/entries.json.
const entries: Entry[] = [
  { id: "datacenter-wue-onsite", value: "0.27 L / kWh", counts: "direct_only", source: "Microsoft sustainability report", url: "https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/msc/documents/presentations/CSR/2026-Microsoft-Environmental-Sustainability-Report-PDF.pdf", date: "2026", verified: "Nov 10", fresh: 0.74, hash: "14ad…6769" },
  { id: "electricity-water-intensity", value: "4.52 L / kWh", counts: "indirect_only", source: "LBNL data center report", url: "https://eta-publications.lbl.gov/sites/default/files/2024-12/lbnl-2024-united-states-data-center-energy-usage-report_1.pdf", date: "2024-12", verified: "Nov 10", fresh: 0.51, hash: "6886…b11f" },
  { id: "google-gemini-median-prompt-energy", value: "0.24 Wh / prompt", counts: "—", source: "Google, AI at Google scale", url: "https://arxiv.org/abs/2508.15734", date: "2025-08", verified: "Nov 8", fresh: 0.65, hash: "7618…deb5" },
  { id: "google-gemini-median-prompt-water", value: "0.26 mL / prompt", counts: "direct_only", source: "Google, AI at Google scale", url: "https://arxiv.org/abs/2508.15734", date: "2025-08", verified: "Nov 8", fresh: 0.65, hash: "3a12…a77b" },
  { id: "mistral-le-chat-400-token-response-water", value: "45 mL / response", counts: "direct_plus_indirect", source: "Mistral environmental standard", url: "https://mistral.ai/news/our-contribution-to-a-global-environmental-standard-for-ai", date: "2025-07", verified: "Nov 8", fresh: 0.64, hash: "21e2…ec9f" },
  { id: "openai-chatgpt-average-query-energy", value: "0.34 Wh / query", counts: "—", source: "OpenAI CEO statement", url: "https://www.datacenterdynamics.com/en/news/sam-altman-chatgpt-queries-consume-034-watt-hours-of-electricity-and-0000085-gallons-of-water/", date: "2025-06", verified: "Nov 8", fresh: 0.61, hash: "381a…a410" },
  { id: "openai-chatgpt-average-query-water", value: "0.32 mL / query", counts: "unclear", source: "OpenAI CEO statement", url: "https://www.datacenterdynamics.com/en/news/sam-altman-chatgpt-queries-consume-034-watt-hours-of-electricity-and-0000085-gallons-of-water/", date: "2025-06", verified: "Nov 8", fresh: 0.61, hash: "4c6c…176b" },
  { id: "ucr-gpt3-medium-response-water", value: "10–50 mL / response", counts: "direct_plus_indirect", source: "UC Riverside, Making AI Less Thirsty", url: "https://arxiv.org/abs/2304.03271", date: "2025-03", verified: "Nov 8", fresh: 0.56, hash: "c6b9…6ac7" },
];

// The stale-factor demo (GET /demo/stale-factor): the 2016 LBNL figure, flagged stale by the 2024 report above.
const staleDemo: Entry = { id: "electricity-water-intensity (2016)", value: "7.6 L / kWh", counts: "indirect_only", source: "LBNL data center report", url: "https://eta-publications.lbl.gov/sites/default/files/lbnl-1005775_v2.pdf", date: "2016-06", verified: "Nov 10", fresh: 0.03, hash: "aa72…dc02", stale: true };

const steps = [
  { n: "01", title: "Found with Tavily", body: "Search with authoritative-domain filters and recent dates, then extract the figure and what it counts." },
  { n: "02", title: "Re-verified on a schedule", body: "Sources are checked again over time. When a newer source in the same unit disagrees, the entry is flagged stale. Age alone never flags it." },
  { n: "03", title: "Signed and versioned", body: "Every registry version is signed and hash-chained to the one before. Each receipt cites factor@version_hash." },
];

function FreshBar({ v }: { v: number }) {
  const color = v >= 0.75 ? "bg-[#2fb862]" : v >= 0.5 ? "bg-[#e6a23c]" : "bg-[#e07a3c]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-[#e3e6f0]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${v * 100}%` }} />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[#5a5e6e]">{v.toFixed(2)}</span>
    </div>
  );
}

export default function Registry() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.2);
  const rv = (x = "") => `reveal ${inView ? "is-in" : ""} ${x}`;

  return (
    <section id="registry" data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto max-w-[1320px] px-5 py-28 sm:px-8 lg:px-14 lg:py-36">
        <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <SectionHead
            blue
            inView={inView}
            eyebrow="Evidence registry"
            line1="Every factor has a source,"
            line2="a date and a score"
            body="The numbers behind each estimate live in an open registry. Nothing is a magic constant: every factor says what it counts, where it came from and how fresh it is."
          />
          <div className={rv("border border-[#dfe2ec] bg-white p-5 lg:w-[300px]")} style={dl(0.4)}>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7b7f90]">Registry v2 · 8 entries</p>
            <p className="mt-2 font-mono text-[13px] text-[#1c1d23]">sha256:7ad5…2ac5</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Tag tone="fresh">Signed · ed25519</Tag>
              <Tag tone="blue">Hash-chained to v1</Tag>
            </div>
          </div>
        </div>

        <div className={rv("mt-14 overflow-x-auto border border-[#dfe2ec] bg-white")} style={dl(0.3)}>
          <div className="flex items-center justify-between gap-3 border-b border-[#e6e8f0] px-5 py-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-[#7b7f90]">Registry entries</p>
            <Tag tone="fresh">Live registry v2 · last row is the stale-factor demo</Tag>
          </div>
          <table className="w-full min-w-[900px] text-left text-[13.5px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.03em] text-[#9a9eb0]">
                <th className="px-5 py-3 font-normal">Factor</th>
                <th className="px-3 py-3 font-normal">Value</th>
                <th className="px-3 py-3 font-normal">Counts</th>
                <th className="px-3 py-3 font-normal">Source</th>
                <th className="px-3 py-3 font-normal">Verified</th>
                <th className="px-3 py-3 font-normal">Freshness</th>
                <th className="px-5 py-3 font-normal">Version</th>
              </tr>
            </thead>
            <tbody>
              {[...entries, staleDemo].map((e) => (
                <tr key={e.id} className={`border-t border-[#eef0f5] ${e.stale ? "bg-[#fffaf0]" : ""}`}>
                  <td className="px-5 py-3.5 font-mono text-[12.5px] text-[#1c1d23]">{e.id}</td>
                  <td className="whitespace-nowrap px-3 py-3.5 tabular-nums text-[#1c1d23]">{e.value}</td>
                  <td className="px-3 py-3.5">{e.counts === "—" ? <span className="text-[#b0b4c4]">—</span> : <Tag>{e.counts}</Tag>}</td>
                  <td className="px-3 py-3.5 text-[#5a5e6e]">
                    <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-[#c9cddc] underline-offset-2 hover:decoration-[#4b63ff]">
                      {e.source}
                    </a>
                    <span className="ml-1.5 text-[12px] text-[#9a9eb0]">{e.date}</span>
                  </td>
                  <td className="px-3 py-3.5 text-[#5a5e6e]">{e.verified}</td>
                  <td className="px-3 py-3.5">
                    {e.stale ? (
                      <div className="flex items-center gap-2">
                        <FreshBar v={e.fresh} />
                        <Tag tone="stale">Stale · LBNL 2024 is newer</Tag>
                      </div>
                    ) : (
                      <FreshBar v={e.fresh} />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[12px] text-[#7b7f90]">{e.hash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ol className="mt-10 grid gap-px border-y border-[#e3e6ef] bg-[#e3e6ef] md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.n} className={rv("bg-[#f6f7fb] px-1 py-7 md:px-6")} style={dl(0.4 + i * 0.1)}>
              <span className="font-mono text-[11px] text-[#7d8fe0]">{s.n}</span>
              <p className="mt-3 text-[17px] tracking-[-0.02em] text-[#1c1d23]">{s.title}</p>
              <p className="mt-2 text-[13.5px] leading-[1.45] text-[#7b7f90]">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
