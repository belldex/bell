import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { EXPECTED_BELL_FLAGS, PERMISSION_BITS, checkHook } from "@/lib/hook-flags";
import proof from "@/content/exit-proof.json";

/* The proof, drawn once: the last 14 bits of a real BELL hook address, each bit a bar. The three bars a withdraw would
   have to pass through are marked EXIT and stand empty. Everything here is computed from the committed list. */

const BITS = [...PERMISSION_BITS].sort((a, b) => b.bit - a.bit);
const SAMPLE = proof.hooks[0].hook;
const TAIL = 4;

export function ProofHero() {
  const checks = proof.hooks.map((h) => checkHook(h.hook));
  const passes = checks.filter((c) => c.pass).length;
  const exitSet = checks.reduce((n, c) => n + c.exitSet.length, 0);
  const withdraws = proof.receipts.filter((r) => r.status === "DONE").length;
  const stats: [string, string][] = [
    [String(checks.length), "hooks checked"],
    [String(passes), "pass"],
    [String(exitSet), "exit bits set"],
    [String(withdraws), "mainnet withdraw on record"],
  ];
  const bin16 = parseInt(SAMPLE.slice(-TAIL), 16).toString(2).padStart(16, "0");

  return (
    <section className="pf-hero lp-wrap" aria-label="The proof in one picture">
      <div className="pf-hero__card" data-lp-reveal>
        <p className="pf-hero__addr" aria-label={`Hook address ${SAMPLE}`}>
          <span className="pf-hero__dim">{SAMPLE.slice(0, SAMPLE.length - TAIL)}</span>
          <span className="pf-hero__tail">{SAMPLE.slice(-TAIL)}</span>
        </p>
        <p className="pf-hero__bin" aria-hidden="true">
          <span className="pf-hero__skip">{bin16.slice(0, 2)}</span> {bin16.slice(2, 4)} {bin16.slice(4, 8)} {bin16.slice(8, 12)} {bin16.slice(12)}
        </p>

        <ol className="pf-strip" aria-label="The fourteen permission bits of this hook">
          {BITS.map((p, i) => {
            const on = ((EXPECTED_BELL_FLAGS >> p.bit) & 1) === 1;
            return (
              <li
                key={p.bit}
                className="pf-cell"
                data-on={on ? "1" : "0"}
                data-exit={p.exit ? "1" : "0"}
                style={{ ["--i" as string]: i }}
                title={`${p.name}: ${on ? "set" : "clear"}`}
              >
                <span className="pf-cell__tag">{p.exit ? "exit" : ""}</span>
                <span className="pf-cell__bar" aria-hidden="true" />
                <span className="pf-cell__n">{p.bit}</span>
                <span className="pf-sr">{p.name}, bit {p.bit}, {on ? "set" : "clear"}{p.exit ? ", exit bit" : ""}</span>
              </li>
            );
          })}
        </ol>

        <p className="pf-hero__cap">
          The lowest 14 bits of the address are the hook&apos;s permissions. The two bits before them are part of the address and mean nothing. A filled bar means the hook is called at that step. The three marked <b>exit</b> are the ones that would touch a withdraw, and they are empty.
        </p>
      </div>

      <dl className="pf-stats">
        {stats.map(([n, label], i) => (
          <div key={label} data-lp-reveal style={{ ["--i" as string]: i + 1 }}>
            <dt>{label}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>

      <div className="pf-hero__cta" data-lp-reveal>
        <Link className="pf-btn pf-btn--solid" href="#any">Check a hook yourself <ArrowDown size={15} aria-hidden="true" /></Link>
        <Link className="pf-btn" href="#receipts">See the withdraw <ArrowDown size={15} aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
