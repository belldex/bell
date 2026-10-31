"use client";

import Link from "next/link";
import { FaXTwitter } from "react-icons/fa6";
import { useEffect, useState } from "react";
import { BrandLogo } from "./bell-mark";
import { BellWordmark } from "@/components/ui/Logo";
import { getFeature, subscribeFeature } from "./feature-state";
import { scrollToId } from "./smooth-scroll";

/* Every primary landing chapter is directly reachable; app access remains its own action. */
const SECTIONS = [
  { id: "idea", label: "Why BELL", desc: "The market problem BELL is built around." },
  { id: "how", label: "How it works", desc: "The checks every swap must pass." },
  { id: "product", label: "Use BELL", desc: "Pools, creation, swaps, and wallet positions." },
  { id: "policy-overview", label: "Market hours", desc: "Why each verified session changes the rules." },
  { id: "operating-policy", label: "Operating policy", desc: "Session fees, swap limits and planned closes." },
  { id: "sessions", label: "Fees & sessions", desc: "Base fees across supported market hours." },
  { id: "roadmap", label: "Readiness", desc: "What has been rehearsed and what remains." },
  { id: "facts", label: "Mainnet status", desc: "Static deployment and pool snapshot; not live-updating." },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];
const SCROLL_SECTIONS = ["idea", "how", "product", "policy-overview", "operating-policy", "sessions", "roadmap", "facts"] as const;

function sectionAtReadingLine(): SectionId | null {
  const line = window.innerHeight * 0.4;
  let current: SectionId | null = null;
  for (const id of SCROLL_SECTIONS) {
    const section = document.getElementById(id);
    if (section && section.getBoundingClientRect().top <= line) current = id;
    else if (section) break;
  }
  return current;
}

export function LandingNav({ appName }: { appName: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SectionId | null>(null);

  /* Sync the active chapter with both the pinned story and the regular content sections. */
  useEffect(() => {
    let raf = 0;
    const syncFromScroll = () => {
      raf = 0;
      if (!getFeature()) setActive(sectionAtReadingLine());
    };
    const scheduleSync = () => {
      if (!raf) raf = requestAnimationFrame(syncFromScroll);
    };
    const feature = getFeature();
    setActive(feature ? "operating-policy" : sectionAtReadingLine());
    const unsubscribe = subscribeFeature((feature) => setActive(feature ? "operating-policy" : sectionAtReadingLine()));
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsubscribe();
      window.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
    };
  }, []);

  /* arriving with a hash (from another page, or back/forward): put the introduction in view once the page has laid out */
  useEffect(() => {
    const jump = () => {
      const id = window.location.hash.slice(1);
      if (!id || !SECTIONS.some((s) => s.id === id)) return;
      window.setTimeout(
        () =>
          document
            .getElementById(id)
            ?.scrollIntoView({ behavior: "auto", block: "start" }),
        350,
      );
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 1120) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const go =
    (id: SectionId) => (event: React.MouseEvent<HTMLAnchorElement>) => {
      setOpen(false);
      setActive(id);
      if (scrollToId(id)) {
        event.preventDefault();
        window.history.replaceState(null, "", `#${id}`);
      }
    };

  return (
    <>
      <header className="lp-nav" data-open={open}>
        <Link className="lp-brand" href="/" aria-label={`${appName} home`}>
          <BrandLogo size={48} priority />
          <BellWordmark>{appName}</BellWordmark>
        </Link>

        <nav className="lp-nav__links" aria-label="Main navigation">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              data-active={active === s.id ? "true" : "false"}
              aria-current={active === s.id ? "location" : undefined}
              onClick={go(s.id)}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="lp-nav__right">
          <a className="lp-social-link" href="https://x.com/BELLdexFi" target="_blank" rel="noopener noreferrer" aria-label="BELL on X">
            <FaXTwitter aria-hidden="true" />
          </a>
          <Link className="lp-pill lp-pill--launch" href="/pools">
            <span>Open app</span>
            <span className="lp-launch__arrow" aria-hidden="true">↗</span>
          </Link>
          <button
            type="button"
            className="lp-menu-btn"
            aria-expanded={open}
            aria-controls="lp-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
          </button>
        </div>
      </header>

      <nav
        className="lp-menu"
        id="lp-menu"
        data-open={open}
        aria-label="Mobile navigation"
        hidden={!open}
      >
        <p className="lp-menu__label">Explore</p>
        {SECTIONS.map((s) => (
          <a
            href={`#${s.id}`}
            key={s.id}
            data-active={active === s.id ? "true" : "false"}
            aria-current={active === s.id ? "location" : undefined}
            onClick={go(s.id)}
          >
            <span className="lp-menu__name">{s.label}</span>
            <span className="lp-menu__desc">{s.desc}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
