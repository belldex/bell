"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { HOOK_FALLBACK, KEEPER_URL, VERIFIED_COUNT, BELL_CONTRACT_COUNT } from "@/config/mainnet";

/* Live Mainnet reads, served by the BELL keeper so a visitor's browser never has to reach a chain RPC.
   Everything here has a static fallback: if the keeper is down the page says so and keeps working. */

export type LivePool = { pair: string; hook: string; funded: boolean | null; auction: string | null };
export type LiveData = {
  state: "loading" | "ok" | "error";
  block: number | null;
  keeper: string | null;
  pools: LivePool[];
  boundAuctions: number | null;
};

const initial: LiveData = {
  state: "loading", block: null, keeper: null, boundAuctions: null,
  pools: HOOK_FALLBACK.map((h) => ({ pair: h.pair, hook: h.hook, funded: null, auction: null })),
};

const LiveContext = createContext<LiveData>(initial);
export const useLive = () => useContext(LiveContext);

async function getJson(path: string) {
  const response = await fetch(`${KEEPER_URL}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LiveData>(initial);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [status, directory] = await Promise.all([getJson("/status"), getJson("/pools")]);
        const poolList: { poolId: string; hook: string; poolLiquidity: string | null; legs: { symbol: string }[] }[] = directory.pools ?? [];
        let auctions: Record<string, { address: string }> = {};
        try {
          const feed = await getJson(`/auctions?pools=${poolList.map((p) => p.poolId).join(",")}`);
          auctions = feed.auctions ?? {};
        } catch { /* the pool list is still useful without auction data */ }
        if (cancelled) return;
        const pools: LivePool[] = poolList.map((p) => ({
          pair: p.legs.map((l) => l.symbol).join(" / "),
          hook: p.hook,
          funded: p.poolLiquidity === null || p.poolLiquidity === undefined ? null : BigInt(p.poolLiquidity) > 0n,
          auction: auctions[p.poolId.toLowerCase()]?.address ?? null,
        }));
        setData({
          state: "ok",
          block: Number(status.blockNumber),
          keeper: status.lastAuctionSettlement?.status ?? null,
          pools,
          boundAuctions: Object.keys(auctions).length,
        });
      } catch {
        if (!cancelled) setData((d) => ({ ...d, state: "error" }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <LiveContext.Provider value={data}>{children}</LiveContext.Provider>;
}

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

/* The strip above the ledger: what is true on chain right now. */
export function LiveStrip() {
  const live = useLive();
  const funded = live.pools.filter((p) => p.funded).length;
  const cells: [string, string, string][] = [
    ["Robinhood Chain", "4663", live.block === null ? "block —" : `block ${fmt(live.block)}`],
    ["Pools", live.state === "ok" ? String(live.pools.length) : "—", live.state === "ok" ? `${funded} with liquidity` : "reading directory"],
    ["Auctions bound", fmt(live.boundAuctions), live.keeper ? `keeper ${live.keeper}` : "keeper —"],
    ["BELL contracts", `${VERIFIED_COUNT}/${BELL_CONTRACT_COUNT}`, "source verified on Sourcify"],
  ];
  return (
    <div className="v4-strip" data-state={live.state} role="status" aria-live="polite">
      {cells.map(([label, value, note]) => (
        <div key={label}>
          <small>{label}</small>
          <b>{value}</b>
          <span>{note}</span>
        </div>
      ))}
      {live.state === "error" && <p className="v4-strip__note">Live reads are unavailable right now. Addresses below come from the deployment record.</p>}
    </div>
  );
}
