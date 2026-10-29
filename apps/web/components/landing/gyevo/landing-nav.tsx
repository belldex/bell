"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "./bell-mark";
import { getFeature, subscribeFeature } from "./feature-state";
import { scrollToId } from "./smooth-scroll";

/* Every primary landing chapter is directly reachable; app access remains its own action. */
const SECTIONS = [
  { id: "idea", label: "Why BELL", desc: "The market problem BELL is built around." },
  { id: "how", label: "How it works", desc: "The checks every swap must pass." },
  { id: "market-rhythm", label: "Market rhythm", desc: "Fees follow verified market sessions." },
  { id: "risk-policy", label: "Risk policy", desc: "Flow caps and clear halt conditions." },
  { id: "planned-close", label: "Planned close", desc: "A bounded path through scheduled closure." },
  { id: "sessions", label: "Fees & sessions", desc: "Base fees across supported market hours." },
  { id: "roadmap", label: "Readiness", desc: "What has been rehearsed and what remains." },
  { id: "facts-title", label: "Testnet status", desc: "Deployment and rehearsal snapshot; not live-updating." },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function LandingNav({ appName }: { appName: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SectionId | null>(null);

  /* Sync the active chapter with both the pinned story and the regular content sections. */
  useEffect(() => {
    setActive(getFeature());
    const unsubscribe = subscribeFeature(setActive);
    const sectionIds = ["how", "sessions", "roadmap"] as const;
    const sections: Element[] = [
      ...sectionIds.map((id) => document.getElementById(id)).filter((section): section is HTMLElement => !!section),
    ];
    const facts = document.querySelector(".lp-facts");
    if (facts) sections.push(facts);
    const observer = new IntersectionObserver(
      (entries) => {
        const current = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (current) setActive((current.target as HTMLElement).id === "" ? "facts-title" : (current.target as HTMLElement).id as SectionId);
      },
      { rootMargin: "-28% 0px -58% 0px", threshold: [0, 0.15, 0.3, 0.5] },
    );
    sections.forEach((section) => { if (section) observer.observe(section); });
    return () => {
      unsubscribe();
      observer.disconnect();
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
          <BrandLogo size={40} priority />
          <span>{appName}</span>
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
