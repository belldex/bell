"use client";

import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { CONTRACT_GROUPS, EXPLORER, HOOK_FLAGS, explorerAddress, type ContractRow } from "@/config/mainnet";
import { CopyAddress } from "./copy-address";
import { useLive } from "./live";

/* A ledger, not a card wall: name, full address with copy, what is proven about it, explorer link.
   On phones each row becomes its own block and the address is shortened. */

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

function Address({ address, name }: { address: string; name: string }) {
  return (
    <div className="v4-row__addr">
      <code title={address}>
        <span className="v4-addr-full">{address}</span>
        <span className="v4-addr-short">{short(address)}</span>
      </code>
      <CopyAddress address={address} label={name} />
    </div>
  );
}

function Row({ row }: { row: ContractRow }) {
  return (
    <li className="v4-row">
      <div className="v4-row__name">
        <b>{row.name}</b>
        <small>{row.detail}</small>
      </div>
      <Address address={row.address} name={row.name} />
      <div className="v4-row__meta">
        {row.external ? (
          <span className="v4-tag" data-kind="external">not BELL</span>
        ) : row.verified ? (
          <span className="v4-tag" data-kind="verified"><BadgeCheck size={13} aria-hidden="true" /> verified</span>
        ) : (
          <span className="v4-tag" data-kind="pending">unverified</span>
        )}
        <a className="v4-ext" href={explorerAddress(row.address)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${row.name} on the explorer`}>
          Explorer <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}

function HooksGroup() {
  const live = useLive();
  return (
    <section className="v4-group" aria-labelledby="g-hooks">
      <header>
        <h3 id="g-hooks">Pool hooks</h3>
        <p>One immutable hook per pool. Permission mask 0x2CC0: {HOOK_FLAGS.join(", ")}. No remove-liquidity flag, so exits cannot be blocked.</p>
      </header>
      <ul className="v4-rows">
        {live.pools.map((p) => (
          <li className="v4-row" key={p.hook}>
            <div className="v4-row__name">
              <b>{p.pair} hook</b>
              <small>
                {p.funded === null ? "Liquidity unknown" : p.funded ? "Has liquidity" : "No liquidity · withdrawn"}
                {p.auction ? " · has an Opening Bell Auction" : ""}
              </small>
            </div>
            <Address address={p.hook} name={`${p.pair} hook`} />
            <div className="v4-row__meta">
              {p.auction ? (
                <a className="v4-tag" data-kind="auction" href={explorerAddress(p.auction)} target="_blank" rel="noopener noreferrer">auction</a>
              ) : (
                <span className="v4-tag" data-kind="pending">no auction</span>
              )}
              <a className="v4-ext" href={explorerAddress(p.hook)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.pair} hook on the explorer`}>
                Explorer <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContractsLedger() {
  return (
    <div className="v4-ledger">
      {CONTRACT_GROUPS.filter((g) => g.id !== "adapters" && g.id !== "tokens" && g.id !== "policy").map((group) => (
        <section className="v4-group" key={group.id} aria-labelledby={`g-${group.id}`}>
          <header>
            <h3 id={`g-${group.id}`}>{group.title}</h3>
            <p>{group.blurb}</p>
          </header>
          <ul className="v4-rows">{group.rows.map((row) => <Row key={row.address} row={row} />)}</ul>
        </section>
      ))}
      <HooksGroup />
      {CONTRACT_GROUPS.filter((g) => g.id === "policy" || g.id === "tokens").map((group) => (
        <section className="v4-group" key={group.id} aria-labelledby={`g-${group.id}`}>
          <header>
            <h3 id={`g-${group.id}`}>{group.title}</h3>
            <p>{group.blurb}</p>
          </header>
          <ul className="v4-rows">{group.rows.map((row) => <Row key={row.address} row={row} />)}</ul>
        </section>
      ))}
      {CONTRACT_GROUPS.filter((g) => g.id === "adapters").map((group) => (
        <details className="v4-group v4-group--fold" key={group.id}>
          <summary>
            <span><h3 id={`g-${group.id}`}>{group.title}</h3><p>{group.blurb}</p></span>
            <em>{group.rows.length} contracts</em>
          </summary>
          <ul className="v4-rows">{group.rows.map((row) => <Row key={row.address} row={row} />)}</ul>
        </details>
      ))}
      <p className="v4-ledger__foot">
        Every contract is also listed on the <a href={`${EXPLORER}`} target="_blank" rel="noopener noreferrer">explorer</a>. “Verified” means the source was compiled and matched byte for byte against the deployed code on Sourcify.
      </p>
    </div>
  );
}
