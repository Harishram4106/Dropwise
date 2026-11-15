"use client";

import { useInView } from "framer-motion";
import { useRef } from "react";

/** Returns a ref plus whether the element has scrolled into view (once). */
export function useReveal<T extends Element>(amount = 0.35) {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { once: true, amount });
  return [ref, inView] as const;
}
