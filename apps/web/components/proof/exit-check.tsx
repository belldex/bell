"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { KEEPER_URL, explorerAddress } from "@/config/mainnet";
import { EXPECTED_BELL_FLAGS, PERMISSION_BITS, checkHook, isAddress } from "@/lib/hook-flags";

/* The same arithmetic as scripts/verify-exit-liveness.ts, run in your browser: the low 14 bits of a hook's address
   are its permissions, and the three that touch removing liquidity must be clear. */

export type ProofHook = { pair: string; poolId: string; hook: string };

type Source = { kind: "snapshot"; at: string | null } | { kind: "live"; block: number } | { kind: "unreachable"; at: string | null };

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function ExitTable({ initial, generatedAt }: { initial: ProofHook[]; generatedAt: string | null }) {
  const [hooks, setHooks] = useState<ProofHook[]>(initial);
  const [source, setSource] = useState<Source>({ kind: "snapshot", at: generatedAt });

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${KEEPER_URL}/pools`, { signal: ctl.signal, headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { blockNumber?: number; pools?: { hook: string; poolId: string; token0: string; token1: string }[] };
        if (!Array.isArray(body.pools) || body.pools.length === 0) throw new Error("empty");
        const known = new Map(initial.map((h) => [h.poolId.toLowerCase(), h.pair]));
        setHooks(body.pools.map((p) => ({ pair: known.get(p.poolId.toLowerCase()) ?? "New pool", poolId: p.poolId, hook: p.hook })));
        setSource({ kind: "live", block: Number(body.blockNumber ?? 0) });
      } catch {
        if (!ctl.signal.aborted) setSource({ kind: "unreachable", at: generatedAt });
      }
    })();
    return () => ctl.abort();
  }, [initial, generatedAt]);

  const rows = useMemo(() => hooks.map((h) => ({ ...h, c: checkHook(h.hook) })), [hooks]);
  const failed = rows.filter((r) => !r.c.pass).length;

  return (
    <div className="pf-block">
      <p className="pf-source" role="status">
        {source.kind === "live" && <>Read live from the BELL keeper at block {source.block.toLocaleString("en-US")}. Checked in your browser.</>}
        {source.kind === "snapshot" && <>Showing the list committed to the repo{source.at ? `, generated ${source.at.slice(0, 10)}` : ""}. Reading the live list…</>}
        {source.kind === "unreachable" && <>The keeper could not be reached. Showing the list committed to the repo{source.at ? `, generated ${source.at.slice(0, 10)}` : ""}.</>}
      </p>
      <div className="pf-scroll">
        <table className="legal__table pf-table">
          <thead>
            <tr><th>Pool</th><th>Hook</th><th>Flags</th><th>Exit bits</th><th>Result</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.poolId}>
                <td>{r.pair}</td>
                <td><a href={explorerAddress(r.hook)} target="_blank" rel="noopener noreferrer" title={r.hook}>{short(r.hook)}</a></td>
                <td>{r.c.flagsHex}</td>
                <td>{r.c.exitSet.length ? r.c.exitSet.join(", ") : "none set"}</td>
                <td><span className="pf-badge" data-pass={r.c.pass ? "1" : "0"}>{r.c.pass ? "PASS" : "FAIL"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pf-sum">{rows.length} hooks, {rows.length - failed} PASS, {failed} FAIL. {rows.filter((r) => r.c.flags === EXPECTED_BELL_FLAGS).length} carry the BELL mask 0x2cc0.</p>
    </div>
  );
}

export function AddressCheck() {
  const [value, setValue] = useState("");
  const v = value.trim();
  const valid = isAddress(v);
  const result = valid ? checkHook(v) : null;
  return (
    <div className="pf-block">
      <label className="pf-label" htmlFor="pf-addr">Hook address</label>
      <input
        id="pf-addr"
        className="pf-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0x6657dc160e05c0ff6afe2122ca7d8244390decc0"
        spellCheck={false}
        autoComplete="off"
        aria-describedby="pf-addr-help"
      />
      <p id="pf-addr-help" className="pf-help">
        {v === "" && "Paste any Uniswap v4 hook address. Nothing is sent anywhere."}
        {v !== "" && !valid && "That is not a 40-hex-digit address."}
      </p>
      {result && (
        <div className="pf-result" data-pass={result.pass ? "1" : "0"} role="status">
          <p className="pf-result__head">
            <span className="pf-badge" data-pass={result.pass ? "1" : "0"}>{result.pass ? "PASS" : "FAIL"}</span>
            <span>
              Low 14 bits <b>{result.flagsHex}</b>.{" "}
              {result.pass ? "This hook cannot be called when liquidity is removed." : `This hook is called on removal: ${result.exitSet.join(", ")}.`}
            </span>
          </p>
          <ul className="pf-bits">
            {PERMISSION_BITS.map((p) => {
              const on = ((result.flags >> p.bit) & 1) === 1;
              return (
                <li key={p.bit} data-on={on ? "1" : "0"} data-exit={p.exit ? "1" : "0"}>
                  {on ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                  <span>{p.name}</span>
                  <small>bit {p.bit}</small>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
