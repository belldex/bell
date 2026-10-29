"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLogo } from "./bell-mark";
import { getFeature, subscribeFeature, type FeatureId } from "./feature-state";
import { scrollToId } from "./smooth-scroll";

/* The public bar: three direct links to BELL's market-session story, risk policy and planned close, plus app access. */
const SECTIONS = [
  { id: "market-rhythm", label: "Market rhythm", desc: "Fees follow verified market sessions." },
  { id: "risk-policy", label: "Risk policy", desc: "Flow caps and clear halt conditions." },
  { id: "planned-close", label: "Planned close", desc: "A bounded path through scheduled closure." },
] as const;

type SectionId = FeatureId;

export function LandingNav({ appName }: { appName: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SectionId | null>(null);

  /* which introduction is on screen: written by the pinned story, and the only thing that marks a link */
  useEffect(() => {
    setActive(getFeature());
    return subscribeFeature(setActive);
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
          <div className="lp-launch">
            <Link
              className="lp-pill lp-pill--launch"
              href="/pools"
              aria-describedby="lp-launch-hint"
            >
              Open app
            </Link>
            <span
              className="lp-launch__hint"
              id="lp-launch-hint"
              role="tooltip"
            >
              <b>Opens the application</b>
              <span>Pool directory · risk policy · protocol status</span>
            </span>
          </div>
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
          <a href={`#${s.id}`} key={s.id} onClick={go(s.id)}>
            <span className="lp-menu__name">{s.label}</span>
            <span className="lp-menu__desc">{s.desc}</span>
          </a>
        ))}
        <Link
          className="lp-menu__launch"
          href="/pools"
          onClick={() => setOpen(false)}
        >
          Open app
        </Link>
        <p className="lp-menu__hint">
          Opens the BELL pool directory and available protocol tools.
        </p>
      </nav>
    </>
  );
}
