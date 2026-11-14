"use client";

import { useId, useState } from "react";
import { REJECTION_PROOFS, SPENT_LEAVES, TESTNET_GAS, mainnetTx, testnetTx } from "./einstein-data";

/* HybridAuth, as a switchboard. The order of the checks and the error names are the contract's own: ECDSA is recovered first,
   then the SHRINCS signature is verified, then the key registry consumes the leaf and refuses one that is out of order.
   A failed check spends neither the nonce nor the leaf (tests: testRejectsInvalidECDSAWithoutConsumingPQLeaf and
   testRejectsInvalidPQEvenWhenECDSAIsValid). The liquidity exit is drawn on its own lane because it never meets the gate. */

type Ecdsa = "valid" | "forged";
type Pq = "valid" | "forged" | "reused";

function judge(ecdsa: Ecdsa, pq: Pq) {
  if (ecdsa === "forged") {
    return {
      ok: false,
      title: "Rejected with InvalidECDSA",
      body: "The ECDSA signature is checked first. The change reverts, and neither the nonce nor a leaf is spent.",
      proof: { text: "A real rejected transaction on Elysium testnet", href: testnetTx(REJECTION_PROOFS.forgedEcdsa) },
    };
  }
  if (pq === "forged") {
    return {
      ok: false,
      title: "Rejected with InvalidPQSignature",
      body: "ECDSA passes, but the SHRINCS signature does not verify. The change reverts, and neither the nonce nor a leaf is spent.",
      proof: { text: "A real rejected transaction on Elysium testnet", href: testnetTx(REJECTION_PROOFS.forgedPq) },
    };
  }
  if (pq === "reused") {
    return {
      ok: false,
      title: "Rejected with LeafOutOfOrder",
      body: "A leaf that is already spent, or one skipped ahead, is refused by the key registry. That refusal is what keeps a one-time key one-time.",
      proof: { text: "A real rejected transaction on Elysium testnet", href: testnetTx(REJECTION_PROOFS.reusedLeaf) },
    };
  }
  return {
    ok: true,
    title: "Accepted",
    body: "Both checks pass, so the change is queued and one leaf is spent. The AAPL, NVDA and TSLA calendar roots went through exactly this on mainnet.",
    proof: { text: "The AAPL calendar root on mainnet", href: mainnetTx(SPENT_LEAVES[0].tx) },
    second: { text: `The same path on testnet, ${TESTNET_GAS[0].gas.toLocaleString("en-US")} gas`, href: testnetTx(TESTNET_GAS[0].tx) },
  };
}

export function SignatureGate() {
  const name = useId();
  const [ecdsa, setEcdsa] = useState<Ecdsa>("valid");
  const [pq, setPq] = useState<Pq>("valid");
  const verdict = judge(ecdsa, pq);
  const ecdsaBad = ecdsa === "forged";
  const pqBad = ecdsa === "valid" && pq !== "valid"; // when ECDSA already failed, the second check is never reached
  const pqSkipped = ecdsaBad;

  return (
    <div className="ein-gate" data-state={verdict.ok ? "accepted" : "rejected"}>
      <div className="ein-gate__scroll">
      <svg className="ein-gate__art" viewBox="0 0 760 320" role="img" aria-label="Two signatures enter a gate and, if both are valid, the calendar root is queued. A separate lane lets liquidity leave without passing the gate.">
        <text className="ein-svg-lane" x="0" y="14">Change a rule</text>

        <g className="ein-svg-node">
          <rect x="0" y="34" width="170" height="54" />
          <text x="14" y="58" className="ein-svg-name">ECDSA signature</text>
          <text x="14" y="76" className="ein-svg-sub">the role&apos;s wallet key</text>
        </g>
        <g className="ein-svg-node">
          <rect x="0" y="116" width="170" height="54" />
          <text x="14" y="140" className="ein-svg-name">SHRINCS signature</text>
          <text x="14" y="158" className="ein-svg-sub">one hash-based leaf</text>
        </g>

        <path className={`ein-wire ${ecdsaBad ? "ein-wire--bad" : "ein-wire--ok"}`} d="M170 61 C 262 61, 262 103, 346 103" />
        <path className={`ein-wire ${pqSkipped ? "ein-wire--idle" : pqBad ? "ein-wire--bad" : "ein-wire--ok"}`} d="M170 143 C 262 143, 262 121, 346 121" />
        {ecdsaBad && <path className="ein-cut" d="M244 72 l14 14 M258 72 l-14 14" />}
        {pqBad && <path className="ein-cut" d="M244 128 l14 14 M258 128 l-14 14" />}

        <rect className="ein-svg-gate" x="346" y="84" width="10" height="56" />
        <text className="ein-svg-sub" x="351" y="160" textAnchor="middle">HybridAuth</text>

        <path className={`ein-wire ein-wire--out ${verdict.ok ? "ein-wire--ok" : "ein-wire--idle"}`} d="M356 112 L 520 112" />
        <g className={`ein-svg-node ein-svg-node--out ${verdict.ok ? "is-lit" : ""}`}>
          <rect x="520" y="84" width="240" height="56" />
          <text x="534" y="108" className="ein-svg-name">Calendar root</text>
          <text x="534" y="126" className="ein-svg-sub">{verdict.ok ? "queued, one leaf spent" : "unchanged"}</text>
        </g>

        <text className="ein-svg-lane" x="0" y="214">Leave the pool</text>
        <g className="ein-svg-node">
          <rect x="0" y="234" width="170" height="54" />
          <text x="14" y="258" className="ein-svg-name">Withdraw liquidity</text>
          <text x="14" y="276" className="ein-svg-sub">PositionManager</text>
        </g>
        <path className="ein-wire ein-wire--ok ein-wire--exit" d="M170 261 L 590 261" />
        <text className="ein-svg-sub" x="380" y="246" textAnchor="middle">no gate on this lane</text>
        <g className="ein-svg-node">
          <rect x="590" y="234" width="170" height="54" />
          <text x="604" y="258" className="ein-svg-name">Your tokens</text>
          <text x="604" y="276" className="ein-svg-sub">both sides, in kind</text>
        </g>
      </svg>
      </div>

      <div className="ein-gate__controls">
        <fieldset className="ein-seg">
          <legend>ECDSA signature</legend>
          {([["valid", "Valid"], ["forged", "Forged"]] as const).map(([value, text]) => (
            <label key={value} className={ecdsa === value ? "is-on" : ""}>
              <input type="radio" name={`${name}-ecdsa`} value={value} checked={ecdsa === value} onChange={() => setEcdsa(value)} />
              <span>{text}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ein-seg">
          <legend>Post-quantum signature</legend>
          {([["valid", "Valid"], ["forged", "Forged"], ["reused", "Leaf already spent"]] as const).map(([value, text]) => (
            <label key={value} className={pq === value ? "is-on" : ""}>
              <input type="radio" name={`${name}-pq`} value={value} checked={pq === value} onChange={() => setPq(value)} />
              <span>{text}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="ein-gate__verdict" aria-live="polite">
        <p className="ein-gate__title">{verdict.title}</p>
        <p>{verdict.body}</p>
        <p className="ein-gate__links">
          <a href={verdict.proof.href} target="_blank" rel="noopener noreferrer">{verdict.proof.text}</a>
          {"second" in verdict && verdict.second && (
            <a href={verdict.second.href} target="_blank" rel="noopener noreferrer">{verdict.second.text}</a>
          )}
        </p>
      </div>
    </div>
  );
}
