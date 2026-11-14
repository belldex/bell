"use client";

import { useRef, useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { CountUp } from "./count-up";
import {
  MAINNET_CONTRACTS, TESTNET_CONTRACTS, TESTNET_GAS, REJECTION_PROOFS,
  mainnetAddress, testnetAddress, testnetTx, type Deployed,
} from "./einstein-data";

function Row({ item, explorer }: { item: Deployed; explorer: (address: string) => string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.address);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the address is still on screen and in the explorer link */ }
  };
  return (
    <li className="ein-row">
      <div className="ein-row__what">
        <strong>{item.name}</strong>
        <span>{item.does}</span>
      </div>
      <code className="ein-row__addr">{item.address}</code>
      <div className="ein-row__act">
        <button type="button" onClick={copy} aria-label={`Copy the ${item.name} address`}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        <a href={explorer(item.address)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.name} in the explorer`}>
          <span>Explorer</span><ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}

export function EvidenceLedger() {
  const [tab, setTab] = useState<"mainnet" | "testnet">("mainnet");
  return (
    <div className="ein-ledger">
      <div className="ein-tabs" role="tablist" aria-label="Network">
        {([["mainnet", "Robinhood Chain mainnet"], ["testnet", "Elysium testnet"]] as const).map(([id, text]) => (
          <button key={id} type="button" role="tab" id={`ein-tab-${id}`} aria-selected={tab === id} aria-controls={`ein-panel-${id}`} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
            {text}
          </button>
        ))}
      </div>

      <div id="ein-panel-mainnet" role="tabpanel" aria-labelledby="ein-tab-mainnet" hidden={tab !== "mainnet"}>
        <p className="ein-ledger__lede">
          Fifteen contracts, deployed on 14 November 2026 in 21 transactions. Every address was read back from the chain afterwards,
          and the source of all fifteen is verified on Sourcify as a match.
        </p>
        <ul className="ein-rows">{MAINNET_CONTRACTS.map((item) => <Row key={item.address} item={item} explorer={mainnetAddress} />)}</ul>
      </div>

      <div id="ein-panel-testnet" role="tabpanel" aria-labelledby="ein-tab-testnet" hidden={tab !== "testnet"}>
        <p className="ein-ledger__lede">
          Where the signing path was first exercised, including every way of breaking it. The price value here is synthetic test data,
          not a live quote.
        </p>
        <ul className="ein-rows">{TESTNET_CONTRACTS.map((item) => <Row key={item.address} item={item} explorer={testnetAddress} />)}</ul>

        <div className="ein-gas">
          <h3>What one signed change costs</h3>
          <dl>
            {TESTNET_GAS.map((g) => (
              <div key={g.what}>
                <dt>{g.what}</dt>
                <dd><CountUp value={g.gas} /> <span>gas</span></dd>
                <a href={testnetTx(g.tx)} target="_blank" rel="noopener noreferrer">Transaction <ArrowUpRight size={13} aria-hidden="true" /></a>
              </div>
            ))}
          </dl>
        </div>

        <div className="ein-proofs">
          <h3>Rejected on the record</h3>
          <ul>
            <li><a href={testnetTx(REJECTION_PROOFS.forgedEcdsa)} target="_blank" rel="noopener noreferrer">A forged ECDSA signature next to a valid post-quantum one</a></li>
            <li><a href={testnetTx(REJECTION_PROOFS.forgedPq)} target="_blank" rel="noopener noreferrer">A valid ECDSA signature next to a forged post-quantum one</a></li>
            <li><a href={testnetTx(REJECTION_PROOFS.reusedLeaf)} target="_blank" rel="noopener noreferrer">A leaf that had already been spent</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
