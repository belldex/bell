import Link from 'next/link';
import { ArrowUpRight, Check, Clock3, X } from 'lucide-react';
import { LANDING_SECTIONS, LandingNav } from '@/components/landing/gyevo/landing-nav';
import { LandingEffects } from '@/components/landing/gyevo/landing-effects';
import verification from '@/content/mainnet-verification.json';
import { CONTRACT_GROUPS, EXPLORER } from '@/config/mainnet';
import '@/components/landing/gyevo/landing.css';
import '@/components/landing/gyevo/bell-control-room.css';
import '@/components/legal/legal.css';
import '@/components/proof/proof.css';
import './verify.css';

type PoolVerification = (typeof verification.pools)[number];
type RuleResult = {
  id: string;
  rule: string;
  poolId: string | null;
  status: string;
  expect?: string;
  actual?: string;
  error?: string | null;
  tx?: string | null;
  explorer?: string;
};

function Section({ id, number, title, children }: { id: string; number: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="verify__section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><span>{number}</span>{title}</h2>
      {children}
    </section>
  );
}

function EvidenceStatus({ status }: { status: string }) {
  const done = status === 'PASS';
  const pending = status === 'PENDING';
  return <span className="pf-badge" data-pass={done ? '1' : pending ? 'pending' : '0'}>
    {done ? <Check size={12} aria-hidden="true" /> : pending ? <Clock3 size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
    {status}
  </span>;
}

export function VerifyPage() {
  const pools = verification.pools as PoolVerification[];
  const ruleTests = verification.ruleTests as RuleResult[];
  const policyOracle = CONTRACT_GROUPS.flatMap((group) => group.rows).find((contract) => contract.name === 'BellPolicyOracle');
  const fees = pools.flatMap((pool) => (pool.latestSwapBySession ?? []).map((swap) => ({ ...swap, poolId: pool.poolId, hook: pool.hook })));

  return (
    <div className="lp lp--bell legal proof verify" data-phase="dark">
      <a className="lp-skip" href="#main">Skip to content</a>
      <LandingNav appName="BELL" sections={LANDING_SECTIONS} base="/" />
      <main id="main" className="legal__main">
        <header className="legal__head lp-wrap">
          <p className="lp-eyebrow">Public verification · Robinhood Chain</p>
          <h1 className="legal__title proof__title">Verify a BELL pool. <em>From the chain.</em></h1>
          <p className="legal__lead">Four checks anyone can repeat from a pool ID, hook address, and Blockscout. This page is a dated snapshot; open each transaction or run the public verifier to read fresh state.</p>
          <p className="legal__date">Chain {verification.chainId} · block {verification.observedBlock} · observed {new Date(verification.observedAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</p>
        </header>

        <div className="legal__grid lp-wrap">
          <nav className="legal__toc" aria-label="Verification steps">
            <p>Four checks</p>
            <ol>
              <li><a href="#pool"><span>01</span>Pool exists</a></li>
              <li><a href="#hook"><span>02</span>Exit permissions</a></li>
              <li><a href="#fee"><span>03</span>Session fee</a></li>
              <li><a href="#rules"><span>04</span>Rules enforced</a></li>
            </ol>
          </nav>

          <div className="legal__body">
            <Section id="pool" number="01" title="Pool exists in Uniswap v4">
              <p>Open the pool creation transaction and inspect the PoolManager <code>Initialize</code> event. Its <code>hooks</code> field is the hook address used by the pool; the pool ID is the event&apos;s indexed ID.</p>
              <ul className="verify__evidence">
                {pools.map((pool) => <li key={pool.poolId}>
                  <code>{pool.poolId}</code>
                  <span>hook {pool.hook.slice(0, 10)}…{pool.hook.slice(-6)}</span>
                  <a href={pool.initialization.explorer} target="_blank" rel="noreferrer">Open Initialize transaction <ArrowUpRight size={13} /></a>
                </li>)}
              </ul>
            </Section>

            <Section id="hook" number="02" title="LP exit permissions are clear">
              <p>Read the low fourteen bits of the hook address: <code>Number(BigInt(hook) &amp; 0x3fff)</code>. BELL expects <code>0x2CC0</code>; permission bits 9, 8, and 0 must all be zero.</p>
              <ul className="verify__evidence">
                {pools.map((pool) => <li key={pool.poolId}>
                  <code>{pool.hookFlags} · {pool.hook}</code>
                  <EvidenceStatus status={pool.permission} />
                  <a href={`${EXPLORER}/address/${pool.hook}?tab=contract`} target="_blank" rel="noreferrer">Read hook <ArrowUpRight size={13} /></a>
                </li>)}
              </ul>
            </Section>

            <Section id="fee" number="03" title="The PoolManager records the session fee">
              <p>Open a successful PoolManager <code>Swap</code> event and read its <code>fee</code> field in pips. The policy uses base fees of 500 pips for REGULAR and 10,000 for CLOSED; the actual fee can vary with pool conditions{policyOracle && <>. <a href={`${EXPLORER}/address/${policyOracle.address}?tab=contract`} target="_blank" rel="noreferrer">Read the verified policy contract</a></>}. The label below comes from the hook&apos;s policy at that event block, and the number is the fee recorded in the event.</p>
              {fees.length === 0 ? <p className="legal__note">No successful swap fee event is in this snapshot yet. Re-run <code>pnpm verify:bell</code> to refresh.</p> : (
                <div className="pf-scroll"><table className="legal__table pf-table verify__table">
                  <thead><tr><th>Pool</th><th>Session</th><th>Fee · pips</th><th>Block</th><th>Source</th></tr></thead>
                  <tbody>{fees.map((fee) => <tr key={`${fee.poolId}-${fee.session}`}>
                    <td><code>{fee.poolId.slice(0, 10)}…</code></td><td>{fee.session}</td><td>{fee.fee}</td><td>{fee.blockNumber}</td>
                    <td><a href={fee.explorer} target="_blank" rel="noreferrer">Swap receipt <ArrowUpRight size={13} /></a></td>
                  </tr>)}</tbody>
                </table></div>
              )}
            </Section>

            <Section id="rules" number="04" title="Limits and auction guards have receipts">
              <p>A receipt confirms whether a transaction reverted, but does not itself prove the error name. Error names are taken from the recorded test evidence. A pending row is not a pass. Expected errors include <code>TradeCapExceeded</code>, <code>AuctionActive</code>, and <code>PolicyBlocked</code>.</p>
              <ul className="verify__evidence">
                {ruleTests.map((rule) => <li key={rule.id}>
                  <span>{rule.rule}</span><EvidenceStatus status={rule.status} />
                  {rule.tx ? <a href={rule.explorer ?? `${EXPLORER}/tx/${rule.tx}`} target="_blank" rel="noreferrer">{rule.error ?? 'Open receipt'} <ArrowUpRight size={13} /></a> : <span className="pf-dim">Receipt not recorded</span>}
                </li>)}
              </ul>
              <p>Expected reverts include <code>TradeCapExceeded</code>, <code>AuctionActive</code>, and <code>PolicyBlocked</code>. A withdrawal receipt must show a successful position-manager transaction while swaps are blocked.</p>
            </Section>

            <div className="verify__footer">
              <a href="/integrations/verify-bell.ts" target="_blank" rel="noreferrer">Read the verifier source <ArrowUpRight size={14} /></a>
              <a href="/integrations/bell-verifier.zip">Download runnable verifier bundle <ArrowUpRight size={14} /></a>
              <Link href="/integrations/">Open the integration pack <ArrowUpRight size={14} /></Link>
            </div>
            <p>To run the bundle: unzip it, install Node.js 24, then run <code>npm install</code> and <code>npm run verify:bell</code>. Historical log access may require an RPC with a wider block range.</p>
          </div>
        </div>
      </main>
      <footer className="legal__foot"><div className="lp-wrap"><p>Every result above is a chain snapshot. Open its source transaction or run the verifier to check again.</p><nav aria-label="Related"><Link href="/pools/">Pools</Link><Link href="/integrations/">Integrations</Link><Link href="/proof/">Proof</Link><Link href="/">Home</Link></nav></div></footer>
      <LandingEffects />
    </div>
  );
}
