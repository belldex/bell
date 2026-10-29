"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Arrow } from "./arrow";
import { BrandLogo } from "./bell-mark";

/* The last section. A fixed footer sits under the opaque content (the curtain);
   a one-screen spacer after the content lets the curtain peel away and reveal it.
   While it is hidden behind the curtain it is inert, so keyboard focus and screen
   readers never land on something nobody can see. */

export function FinalReveal({ appName }: { appName: string }) {
  const spacerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const spacer = spacerRef.current;
    const footer = footerRef.current as
      | (HTMLElement & { inert: boolean })
      | null;
    if (!spacer || !footer) return;
    let spacerVisible = false;

    let curtain = getComputedStyle(footer).position === "fixed";
    const sync = () => {
      /* when the curtain is off (short windows, reduced motion) the footer is ordinary content */
      curtain = getComputedStyle(footer).position === "fixed";
      footer.inert = curtain ? !spacerVisible : false;
    };
    const io = new IntersectionObserver((entries) => {
      spacerVisible = entries[0]?.isIntersecting ?? false;
      sync();
    });
    io.observe(spacer);

    /* the footer rises into place as the curtain lifts: --fr runs 0 -> 1 across the spacer */
    let raf = 0;
    const rise = () => {
      raf = 0;
      if (!curtain) {
        footer.style.setProperty("--fr", "1");
        return;
      }
      const top = spacer.getBoundingClientRect().top;
      const fr = Math.min(
        1,
        Math.max(0, (window.innerHeight - top) / window.innerHeight),
      );
      footer.style.setProperty("--fr", fr.toFixed(3));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(rise);
    };
    const onResize = () => {
      sync();
      schedule();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    sync();
    rise();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <>
      <div className="lp-spacer" ref={spacerRef} aria-hidden="true" />
      <footer
        className="lp-final"
        ref={footerRef}
        aria-labelledby="final-title"
        inert
      >
        <div className="lp-final__main">
          <h2 className="lp-final__title" id="final-title">
            Know the session. <em>Respect the limits.</em>
          </h2>
          <p className="lp-final__lead">
            Browse tokenized-stock pools, inspect their policy class, and see how BELL handles sessions, swap limits and missing market data.
          </p>
          <div className="lp-actions">
            <Link className="lp-btn lp-btn--primary" href="/pools">
              Open app <Arrow />
            </Link>
            <Link className="lp-btn lp-btn--ghost" href="/protocol">
              Review risk policy
            </Link>
          </div>
        </div>

        <div className="lp-final__foot">
          <div className="lp-cols">
            <div className="lp-cols__brand">
              <Link
                className="lp-brand"
                href="/"
                aria-label={`${appName} home`}
              >
                <BrandLogo size={40} />
                <span>{appName}</span>
              </Link>
              <p>
                BELL is a Uniswap v4 hook and liquidity policy for tokenized-stock pools. It sets base LP fees and flow limits from verified market state. Current evidence is testnet-only; rehearsal assets are synthetic, and SESSION_ONLY does not promise independent counterasset price protection.
              </p>
              <div className="lp-ecosystem" aria-label="Built on Robinhood Chain and Uniswap v4">
                <span className="lp-ecosystem__item">
                  <span
                    className="lp-ecosystem__logo lp-ecosystem__logo--robinhood"
                    aria-hidden="true"
                    style={{ ["--logo-src" as string]: 'url("/landing/partners/robinhood.svg")' }}
                  />
                  <span className="lp-ecosystem__suffix">Chain</span>
                </span>
                <span className="lp-ecosystem__divider" aria-hidden="true" />
                <span className="lp-ecosystem__item">
                  <span
                    className="lp-ecosystem__logo lp-ecosystem__logo--uniswap"
                    aria-hidden="true"
                    style={{ ["--logo-src" as string]: 'url("/landing/partners/uniswap.svg")' }}
                  />
                  <span className="lp-ecosystem__suffix">v4</span>
                </span>
              </div>
            </div>
            <nav aria-label="Protocol">
              <h2>Protocol</h2>
              <ul>
                <li><Link href="/pools">Pool directory</Link></li>
                <li>
                  <Link href="/protocol">Protocol</Link>
                </li>
                <li>
                  <Link href="/protocol">Risk policy</Link>
                </li>
                <li>
                  <Link href="/pools">Pools</Link>
                </li>
              </ul>
            </nav>
            <nav aria-label="Transparency">
              <h2>Transparency</h2>
              <ul>
                <li>
                  <Link href="/protocol">Contracts</Link>
                </li>
                <li>
                  <Link href="/protocol">Docs</Link>
                </li>
              </ul>
            </nav>
            <nav aria-label="BELL policy">
              <h2>Market policy</h2>
              <ul>
                <li><Link href="/#market-rhythm">Market sessions</Link></li>
                <li><Link href="/#planned-close">Planned close</Link></li>
                <li><Link href="/protocol">Risk controls</Link></li>
              </ul>
            </nav>
          </div>
          <p className="lp-legal">
            <span>Unaudited · No mainnet deployment</span>
          </p>
          <span
            className="lp-word-out"
            aria-hidden="true"
            style={{ ["--chars" as string]: appName.length }}
          >
            {appName}
          </span>
        </div>
      </footer>
    </>
  );
}
