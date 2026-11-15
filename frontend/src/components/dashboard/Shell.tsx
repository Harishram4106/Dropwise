"use client";

// The dashboard frame: the landing page's floating glass nav (it turns light over light sections),
// a scroll progress line, and the landing footer. Pages fill it with full-bleed sections, each marked
// data-nav="dark" or data-nav="light" so the nav knows which theme to take.

import { motion, useScroll, useSpring } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { useNavHidden } from "../useNavHidden";
import { ScopeToggle } from "./bits";
import { useConnection } from "./connection";

/**
 * Dashboard pages. Flip `ready` as each page lands, so the nav never links to a 404 during the demo.
 * `receipt` is the receipt detail route the request rows link to.
 */
export const PAGES = {
  overview: { href: "/dashboard", label: "Overview", ready: true },
  requests: { href: "/dashboard/requests", label: "Requests", ready: true },
  budgets: { href: "/dashboard/budgets", label: "Budgets", ready: true },
  benchmark: { href: "/dashboard/benchmark", label: "Before / after", ready: true },
  routing: { href: "/dashboard/routing", label: "Routing & cache", ready: true },
  schedule: { href: "/dashboard/schedule", label: "Time shifting", ready: true },
  claims: { href: "/claims", label: "Claims", ready: true },
  registry: { href: "/registry", label: "Registry", ready: true },
  receipt: { href: "/dashboard/requests", label: "Receipt", ready: true },
} as const;

const LINKS = [PAGES.overview, PAGES.requests, PAGES.budgets, PAGES.benchmark, PAGES.routing, PAGES.schedule, PAGES.claims, PAGES.registry];

/** Which theme the nav takes: that of the section under its bottom edge, as on the landing page. */
function useNavTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let next: "dark" | "light" = "dark";
        document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top <= 40 && r.bottom > 40) next = el.dataset.nav === "light" ? "light" : "dark";
        });
        setTheme(next);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return theme;
}

function Status() {
  const { status, reason } = useConnection();
  const [label, dot, blink] =
    status === "live" ? ["Gateway live", "bg-[#7dfc9a]", true] : status === "demo" ? ["Demo data", "bg-[#ffc46b]", false] : ["Connecting", "bg-white/50", true];
  return (
    <span
      title={reason ?? undefined}
      className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.04em]"
      style={{ color: "var(--nav-text)" }}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 ${dot} ${blink ? "blink" : ""}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/** `scopeToggle={false}` hides the direct / indirect switch on pages whose numbers it can't change. */
export function Shell({ children, scopeToggle = true }: { children: ReactNode; scopeToggle?: boolean }) {
  const pathname = usePathname();
  const { scope, query } = useConnection();
  const theme = useNavTheme();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  const light = theme === "light";
  const hidden = useNavHidden();

  return (
    <div className="min-h-screen bg-black">
      <header
        className={`nav fixed inset-x-2 top-2 z-50 sm:inset-x-3 sm:top-3 ${light ? "nav-light" : ""} ${hidden ? "nav-hidden" : ""}`}
        style={{ ["--logo-cut" as string]: light ? "#e9ecf7" : "#08090d" }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div className="cell flex h-14 items-center gap-3 px-4 sm:px-5">
            <Link href="/" className="transition-colors duration-300" style={{ color: "var(--nav-strong)" }} aria-label="Dropwise home">
              <Logo />
            </Link>
            <span
              className="hidden rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] sm:inline"
              style={{ borderColor: "var(--nav-line)", color: "var(--nav-text)" }}
            >
              Dashboard
            </span>
          </div>
          <nav
            aria-label="Dashboard"
            className="cell order-3 col-span-2 flex h-12 items-center gap-6 overflow-x-auto px-5 text-[13.5px] lg:order-none lg:col-span-1 lg:h-14 lg:px-8"
          >
            {LINKS.map((p) =>
              p.ready ? (
                <Link
                  key={p.href}
                  href={`${p.href}${query}`}
                  aria-current={pathname === p.href ? "page" : undefined}
                  className="nav-link dash-link relative whitespace-nowrap"
                >
                  {p.label}
                  {pathname === p.href && (
                    <motion.span layoutId="dash-active" className="absolute -bottom-[17px] left-0 right-0 h-[2px] bg-[#5b78ff] max-lg:-bottom-[13px]" />
                  )}
                </Link>
              ) : (
                <span key={p.href} className="whitespace-nowrap opacity-40" style={{ color: "var(--nav-text)" }} title="Coming soon">
                  {p.label}
                </span>
              ),
            )}
          </nav>
          <div className="cell flex h-14 items-center justify-end gap-3 px-2 sm:gap-4 sm:px-3">
            <Status />
            {scopeToggle && <ScopeToggle scope={scope} />}
          </div>
        </div>
        <motion.div
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-[2px] origin-left bg-gradient-to-r from-[#8fb0ff] to-[#2f45ff]"
          style={{ scaleX: progress }}
        />
      </header>

      <main>{children}</main>
    </div>
  );
}

/** The landing page's footer line, on the flipped hero gradient. */
export function Footer() {
  return (
    <footer data-nav="dark" className="relative isolate overflow-hidden text-white">
      <div aria-hidden className="hero-bg absolute inset-0 -z-20 [transform:scaleY(-1)]" />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-5 py-14 text-[13px] text-white/70 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-14">
        <div className="flex items-center gap-4 text-white" style={{ ["--logo-cut" as string]: "#5b78ff" }}>
          <Link href="/" aria-label="Dropwise home">
            <Logo />
          </Link>
          <span className="text-white/65">Open-source sidecar for the Bifrost AI gateway</span>
        </div>
        <p className="max-w-[440px] sm:text-right">Water figures are estimates, shown as ranges with what is counted and a cited source.</p>
      </div>
    </footer>
  );
}
