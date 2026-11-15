"use client";

import { useEffect, useState } from "react";

/**
 * True while the nav should be tucked away: the visitor is scrolling down and has left the top of the page.
 * It comes back as soon as they scroll up, or reach the top. Shared by the landing nav and the dashboard nav,
 * so every page behaves the same.
 */
export function useNavHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = Math.max(0, window.scrollY);
        const delta = y - last;
        if (y < 60) setHidden(false);
        else if (delta > 6) setHidden(true);
        else if (delta < -6) setHidden(false);
        if (Math.abs(delta) > 6 || y < 60) last = y;
      });
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
  }, []);
  return hidden;
}
