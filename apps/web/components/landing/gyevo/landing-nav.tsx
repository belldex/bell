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
  { id: "auction", label: "Auction", desc: "One clearing price at the open, matched peer to peer." },
  { id: "roadmap", label: "Deployment", desc: "Every contract, verified onchain." },
  { id: "facts", label: "Mainnet status", desc: "Mainnet deployment and pool directory." },
] as const;

type NavSection = { id: string; label: string; desc: string };
type SectionId = string;
export const LANDING_SECTIONS: readonly NavSection[] = SECTIONS;

function sectionAtReadingLine(ids: readonly string[]): SectionId | null {
  const line = window.innerHeight * 0.4;
  let current: SectionId | null = null;
  for (const id of ids) {
    const section = document.getElementById(id);
    if (section && section.getBoundingClientRect().top <= line) current = id;
    else if (section) break;
  }
  return current;
}

/* The same bar serves the landing and the pages that sit beside it (/v4, terms, privacy, cookies).
   `sections` swaps the chapter list; `base="/"` makes every chapter link point back to the landing. */
export function LandingNav({ appName, sections = SECTIONS, base = "" }: { appName: string; sections?: readonly NavSection[]; base?: string }) {
  const isLanding = sections === SECTIONS;
  const ids = sections.map((s) => s.id);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SectionId | null>(null);

  /* Sync the active chapter with both the pinned story and the regular content sections. */
  useEffect(() => {
    let raf = 0;
    const syncFromScroll = () => {
      raf = 0;
      if (!isLanding || !getFeature()) setActive(sectionAtReadingLine(ids));
    };
    const scheduleSync = () => {
      if (!raf) raf = requestAnimationFrame(syncFromScroll);
    };
    const feature = isLanding ? getFeature() : null;
    setActive(feature ? "operating-policy" : base ? null : sectionAtReadingLine(ids));
    const unsubscribe = isLanding ? subscribeFeature((feature) => setActive(feature ? "operating-policy" : sectionAtReadingLine(ids))) : () => {};
    if (!base) {
      window.addEventListener("scroll", scheduleSync, { passive: true });
      window.addEventListener("resize", scheduleSync, { passive: true });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsubscribe();
      window.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* arriving with a hash (from another page, or back/forward): put the introduction in view once the page has laid out */
  useEffect(() => {
    const jump = () => {
      const id = window.location.hash.slice(1);
      if (base || !id || !sections.some((s) => s.id === id)) return;
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
      if (window.innerWidth >= 1280) setOpen(false);
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
      if (base) return;
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
          {sections.map((s) => (
            <a
              key={s.id}
              href={`${base}#${s.id}`}
              data-active={active === s.id ? "true" : "false"}
              aria-current={active === s.id ? "location" : undefined}
              onClick={go(s.id)}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="lp-nav__right">
          {isLanding && <Link className="lp-v4-link" href="/v4/" aria-label="BELL v4 and ecosystem">v4</Link>}
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
        {sections.map((s) => (
          <a
            href={`${base}#${s.id}`}
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
