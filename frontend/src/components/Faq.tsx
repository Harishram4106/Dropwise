"use client";

import { useReveal } from "./useReveal";
import { SectionHead, dl } from "./ui";

const faqs = [
  {
    q: "Can Dropwise tell me how many litres I saved?",
    a: "No, and it won't pretend to. Dropwise measures calls, tokens, cache hits and routing. Water is always shown as a labeled estimate with a range, and we never claim litres saved in the real world.",
  },
  {
    q: "Why a range instead of one number?",
    a: "The factors behind an estimate vary by model, region and what is counted. Published figures run from about 0.26 mL to 45 mL per prompt, so a single number would hide real uncertainty.",
  },
  {
    q: "What do “direct” and “indirect” mean?",
    a: "Direct is the water used on-site to cool the data center. Indirect adds the water behind the electricity that powers it. A toggle lets you switch between them, and every receipt records which one it used.",
  },
  {
    q: "What if my provider doesn't disclose its region?",
    a: "Then Dropwise assumes US-average factors and says so on the receipt, instead of presenting the estimate as if the region were known. The range doesn't get wider for it: the assumption is stated, and a known region's own figures would change the number.",
  },
  {
    q: "Does routing to smaller models hurt answer quality?",
    a: "It can, so the classifier is deliberately cautious: only clear easy-task prompts go to a smaller model. A quality check compares answers with and without right-sizing, and if the drop passes 5 points, the advice is to turn routing off and keep caching and budgets.",
  },
  {
    q: "Do I need Bifrost?",
    a: "Today, yes: Dropwise runs as a sidecar in front of the Bifrost AI gateway, and Bifrost makes the model calls. A standalone proxy is on the roadmap.",
  },
  {
    q: "Is cheaper per query the same as using less water?",
    a: "No. Cheaper per query can still mean more total use. Dropwise reduces waste per unit of work; total demand still matters.",
  },
  {
    q: "How does the claim checker decide a verdict?",
    a: "It splits a claim into atomic claims, works out what each one counts, checks each figure against the signed registry (plus live sources found with Tavily when available), and returns supported, overstated, understated, unsupported or outdated, with citations.",
  },
];

export default function Faq() {
  const [ref, inView] = useReveal<HTMLDivElement>(0.15);
  const rv = (x = "") => `reveal ${inView ? "is-in" : ""} ${x}`;

  return (
    <section id="faq" data-nav="light" className="bg-[#f6f7fb]">
      <div ref={ref} className="mx-auto grid max-w-[1320px] gap-12 px-5 py-28 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-14 lg:py-36">
        <SectionHead
          inView={inView}
          eyebrow="FAQ"
          line1="Questions,"
          line2="answered plainly"
          body="The short version: we measure what we can, estimate the rest as a range, and cite every source."
          className="lg:sticky lg:top-28 lg:self-start"
        />
        <div className="border-b border-[#e1e4ee]">
          {faqs.map((f, i) => (
            <details key={f.q} className={rv("group border-t border-[#e1e4ee]")} style={dl(0.2 + i * 0.05)}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16.5px] tracking-[-0.015em] text-[#1c1d23] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span
                  aria-hidden
                  className="relative h-3 w-3 shrink-0 text-[#7d8fe0] before:absolute before:left-0 before:top-1/2 before:h-px before:w-3 before:bg-current after:absolute after:left-1/2 after:top-0 after:h-3 after:w-px after:bg-current after:transition-transform group-open:after:scale-y-0"
                />
              </summary>
              <p className="max-w-[640px] pb-6 text-[14.5px] leading-relaxed text-[#6b6f80]">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
