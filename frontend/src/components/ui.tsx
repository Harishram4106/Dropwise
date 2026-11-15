import type { CSSProperties, ReactNode } from "react";

/** Inline CSS delay for .reveal / .fade-up animations. */
export const dl = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

/** Eyebrow + two-tone headline + body, revealed when `inView` flips true. */
export function SectionHead({
  inView,
  eyebrow,
  line1,
  line2,
  body,
  dark = false,
  blue = false,
  className = "",
}: {
  inView: boolean;
  eyebrow: string;
  line1: ReactNode;
  line2: ReactNode;
  body?: ReactNode;
  dark?: boolean;
  blue?: boolean;
  className?: string;
}) {
  const rv = (x = "") => `reveal ${inView ? "is-in" : ""} ${x}`;
  return (
    <div className={className}>
      <p className={rv(`font-mono text-[11px] uppercase tracking-[0.04em] ${dark ? "text-[#8fb0ff]" : "text-[#7d8fe0]"}`)}>{eyebrow}</p>
      <h2
        className={`mt-5 text-[clamp(36px,4.8vw,64px)] font-medium leading-[1.03] tracking-[-0.055em] ${dark ? "text-white" : "text-[#25262c]"}`}
      >
        <span className={rv(`block ${dark ? "headline-grey" : ""}`)} style={dl(0.08)}>
          {line1}
        </span>
        <span className={rv(`block pb-1 ${dark ? "" : blue ? "headline-blue" : "text-[#a2a5b3]"}`)} style={dl(0.18)}>
          {line2}
        </span>
      </h2>
      {body && (
        <p className={rv(`mt-6 max-w-[560px] text-[16px] leading-relaxed ${dark ? "text-white/65" : "text-[#6b6f80]"}`)} style={dl(0.3)}>
          {body}
        </p>
      )}
    </div>
  );
}

type Tone = "plain" | "fresh" | "stale" | "blue" | "alert";

const darkTones: Record<Tone, string> = {
  plain: "border-white/15 text-white/60",
  fresh: "border-[#7dfc9a]/30 text-[#9dffb4]",
  stale: "border-[#ffc46b]/35 text-[#ffd28f]",
  blue: "border-[#8fb0ff]/40 bg-[#3d5bff]/25 text-[#cfdcff]",
  alert: "border-[#ff8a8a]/40 text-[#ffb3b3]",
};

const lightTones: Record<Tone, string> = {
  plain: "border-[#d6d9e6] text-[#6b6f80] bg-white/60",
  fresh: "border-[#9fdcb0] text-[#1f8a45] bg-[#effaf2]",
  stale: "border-[#f0cf94] text-[#a2650b] bg-[#fff7e8]",
  blue: "border-[#b9c6ff] text-[#3048e6] bg-[#eef1ff]",
  alert: "border-[#f3b4b4] text-[#c03a3a] bg-[#fff1f1]",
};

/** Small mono uppercase badge. */
export function Tag({ children, tone = "plain", dark = false }: { children: ReactNode; tone?: Tone; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.02em] ${
        (dark ? darkTones : lightTones)[tone]
      }`}
    >
      {children}
    </span>
  );
}

export function Arrow({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
