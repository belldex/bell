import Link from "next/link";
import type { ReactNode } from "react";
import { LANDING_SECTIONS, LandingNav } from "@/components/landing/gyevo/landing-nav";
import { LandingEffects } from "@/components/landing/gyevo/landing-effects";

/* Terms, privacy and cookies share one frame: the landing's own bar, the landing's type, and a table of
   contents beside the text. Every page states its date, so a reader knows which version they are reading. */

export type LegalSection = { id: string; title: string; body: ReactNode };

const OTHER: Record<string, [string, string][]> = {
  terms: [["Privacy policy", "/privacy/"], ["Cookies and local storage", "/cookies/"]],
  privacy: [["Terms of use", "/terms/"], ["Cookies and local storage", "/cookies/"]],
  cookies: [["Terms of use", "/terms/"], ["Privacy policy", "/privacy/"]],
};

export function LegalPage({
  slug,
  title,
  lead,
  updated,
  sections,
  children,
}: {
  slug: "terms" | "privacy" | "cookies";
  title: string;
  lead: string;
  updated: string;
  sections: LegalSection[];
  children?: ReactNode;
}) {
  return (
    <div className="lp lp--bell legal" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={LANDING_SECTIONS} base="/" />
      <main id="main" className="legal__main">
        <header className="legal__head lp-wrap">
          <p className="lp-eyebrow">Legal</p>
          <h1 className="legal__title">{title}</h1>
          <p className="legal__lead">{lead}</p>
          <p className="legal__date">Last updated {updated}</p>
        </header>

        <div className="legal__grid lp-wrap">
          <nav className="legal__toc" aria-label="On this page">
            <p>On this page</p>
            <ol>
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}><span>{String(i + 1).padStart(2, "0")}</span>{s.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="legal__body">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
                <h2 id={`${s.id}-h`}><span>{String(i + 1).padStart(2, "0")}</span>{s.title}</h2>
                {s.body}
              </section>
            ))}
            {children}
          </div>
        </div>
      </main>

      <footer className="legal__foot">
        <div className="lp-wrap">
          <p>
            BELL is an independent protocol, not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc. An independent security audit is not complete. Nothing on this site is investment advice.
          </p>
          <nav aria-label="Legal">
            {OTHER[slug].map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
            <Link href="/protocol/">Protocol</Link>
            <Link href="/">Home</Link>
          </nav>
        </div>
      </footer>
      <LandingEffects />
    </div>
  );
}
