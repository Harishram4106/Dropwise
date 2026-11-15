import type { CSSProperties } from "react";

/** Reveals text letter by letter, each sliding out of a blur (CSS only). */
export function BlurText({
  text,
  start = 0,
  step = 0.028,
  className = "",
}: {
  text: string;
  start?: number;
  step?: number;
  className?: string;
}) {
  const words = text.split(" ");
  let i = 0;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((word, wi) => (
          <span key={wi}>
            <span className="inline-block whitespace-nowrap">
              {Array.from(word).map((ch, ci) => {
                const d = start + i++ * step;
                return (
                  <span key={ci} className="blur-char" style={{ "--d": `${d.toFixed(3)}s` } as CSSProperties}>
                    {ch}
                  </span>
                );
              })}
            </span>
            {wi < words.length - 1 ? " " : null}
          </span>
        ))}
      </span>
    </span>
  );
}
