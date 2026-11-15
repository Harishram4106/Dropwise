"use client";

import { motion, useScroll, useSpring } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { REPO_URL, VIDEO_URL } from "@/lib/links";
import { Logo } from "./Logo";
import { Magnetic } from "./Magnetic";
import { useNavHidden } from "./useNavHidden";

const links = [
  { href: "#product", label: "Product" },
  { href: "#playground", label: "Playground" },
  { href: "#reduce", label: "Levers" },
  { href: "#meter", label: "Live meter" },
  { href: "#registry", label: "Registry" },
  { href: "#developers", label: "Developers" },
  { href: "#faq", label: "FAQ" },
];

// The app: pages beyond the landing page.
const app = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/claims", label: "Claims" },
];

export default function Nav() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const probe = 40;
        let next: "dark" | "light" = "dark";
        document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top <= probe && r.bottom > probe) next = el.dataset.nav === "light" ? "light" : "dark";
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

  const light = theme === "light";
  const hidden = useNavHidden();

  return (
    <header
      className={`nav fixed inset-x-2 top-2 z-50 sm:inset-x-3 sm:top-3 ${light ? "nav-light" : ""} ${hidden ? "nav-hidden" : ""}`}
      style={{ ["--logo-cut" as string]: light ? "#e9ecf7" : "#08090d" }}
    >
      <div className="grid h-14 grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="cell flex items-center px-4 sm:px-5">
          <a href="#top" className="transition-colors duration-300" style={{ color: "var(--nav-strong)" }}>
            <Logo />
          </a>
        </div>
        <nav aria-label="Main" className="cell hidden items-center gap-6 px-6 text-[14px] xl:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="nav-link">
              {l.label}
            </a>
          ))}
          <span aria-hidden className="h-4 w-px" style={{ background: "var(--nav-line)" }} />
          {app.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link font-medium" style={{ color: "var(--nav-strong)" }}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="cell flex items-center justify-end gap-1.5 px-1.5">
          {REPO_URL && (
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center rounded-[3px] bg-[#232328] px-4 text-[13px] text-white transition-colors hover:bg-[#33333a]"
            >
              GitHub
            </a>
          )}
          <Magnetic strength={0.2}>
            {VIDEO_URL ? (
              <a
                href={VIDEO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-[3px] bg-white px-4 text-[13px] text-[#16171c] shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-colors hover:bg-[#f1f2f7]"
              >
                Watch demo
              </a>
            ) : (
              <Link
                href="/dashboard"
                className="inline-flex h-10 items-center rounded-[3px] bg-white px-4 text-[13px] text-[#16171c] shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-colors hover:bg-[#f1f2f7]"
              >
                Open the app
              </Link>
            )}
          </Magnetic>
        </div>
      </div>
      <motion.div
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-[2px] origin-left bg-gradient-to-r from-[#8fb0ff] to-[#2f45ff]"
        style={{ scaleX: progress }}
      />
    </header>
  );
}
