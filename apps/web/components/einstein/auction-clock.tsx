"use client";

import { useEffect, useState } from "react";

/** A live countdown to the Opening Bell Auction order window. It only reads the clock, so it needs no data from the chain. */
export function AuctionClock({ opensAt, closesAt }: { opensAt: string; closesAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const open = Date.parse(opensAt);
  const close = Date.parse(closesAt);
  const state = now === null ? "wait" : now < open ? "wait" : now < close ? "open" : "done";
  const left = now === null ? 0 : Math.max(0, open - now);
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  const local = new Date(open).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  return (
    <div className="pp-clockface" data-state={state} role="timer" aria-live="off">
      <p className="pp-clockface__label">
        {state === "open" ? "The order window is open" : state === "done" ? "The order window has passed" : "Order window opens in"}
      </p>
      {state === "wait" && (
        <p className="pp-clockface__digits" aria-label={`${d} days ${h} hours ${m} minutes ${s} seconds`}>
          <span><b>{now === null ? "--" : two(d)}</b>d</span>
          <span><b>{now === null ? "--" : two(h)}</b>h</span>
          <span><b>{now === null ? "--" : two(m)}</b>m</span>
          <span><b>{now === null ? "--" : two(s)}</b>s</span>
        </p>
      )}
      <p className="pp-clockface__when">{state === "wait" ? `${local}, for ten minutes, 00:50 to 01:00 UTC` : "00:50 to 01:00 UTC on 16 November 2026"}</p>
    </div>
  );
}
