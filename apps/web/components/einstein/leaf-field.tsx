"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LEAF_BUDGET, NEXT_LEAF, SPENT_LEAVES, mainnetTx } from "./einstein-data";

/* The signing budget of the mainnet governance key, drawn as it is: 4,096 one-time leaves in a 64 by 64 grid. A leaf signs
   once. Three are spent (the three calendar roots signed on 14 November 2026), the fourth is the next one the registry will
   accept, and the rest are untouched. Canvas keeps 4,096 cells cheap; the hover and keyboard readout names the real
   transactions behind the spent ones. */

const COLS = 64;
const INK = "238,236,229";
const ION = "199,68,79";

const label = (leaf: number) => {
  const spent = SPENT_LEAVES.find((s) => s.leaf === leaf);
  if (spent) return { text: `Leaf ${leaf} is spent on ${spent.what}.`, href: mainnetTx(spent.tx) };
  if (leaf === NEXT_LEAF) return { text: `Leaf ${leaf} is next. The registry accepts no other leaf first.`, href: null };
  return { text: `Leaf ${leaf} is unused.`, href: null };
};

export function LeafField() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const hover = useRef<number | null>(null);
  const progress = useRef(0);
  const reduced = useRef(false);
  const visible = useRef(true);
  const raf = useRef(0);

  const draw = useCallback((now: number) => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(box.clientWidth);
    if (el.width !== Math.round(size * dpr)) {
      el.width = Math.round(size * dpr);
      el.height = Math.round(size * dpr);
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cell = size / COLS;
    const gap = Math.max(1, Math.floor(cell * 0.22));
    const reveal = progress.current;
    const pulse = reduced.current ? 1 : 0.55 + 0.45 * Math.sin(now / 520);
    for (let i = 0; i < LEAF_BUDGET; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      // The grid appears as a diagonal sweep, so the empty field reads as a sheet being filled in, not a loading bar.
      const lead = (row + col) / (COLS * 2 - 2);
      const seen = Math.min(1, Math.max(0, (reveal * 1.35 - lead) * 4));
      if (seen <= 0) continue;
      const leaf = i + 1;
      const x = col * cell;
      const y = row * cell;
      const spent = leaf < NEXT_LEAF;
      const isHover = hover.current === leaf;
      if (spent) ctx.fillStyle = `rgba(${ION},${seen})`;
      else if (isHover) ctx.fillStyle = `rgba(${INK},${0.9 * seen})`;
      else ctx.fillStyle = `rgba(${INK},${0.17 * seen})`;
      ctx.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
      if (leaf === NEXT_LEAF) {
        ctx.strokeStyle = `rgba(${ION},${pulse * seen})`;
        ctx.lineWidth = Math.max(1.5, cell * 0.14);
        ctx.strokeRect(x + gap / 2 - 1, y + gap / 2 - 1, cell - gap + 2, cell - gap + 2);
      }
    }
  }, []);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const box = wrap.current;
    if (!box) return;
    let start = 0;
    const frame = (now: number) => {
      if (!start) start = now;
      if (progress.current < 1) progress.current = reduced.current ? 1 : Math.min(1, (now - start) / 1700);
      if (visible.current) draw(now);
      // After the sweep only the next-leaf outline moves, so stop the loop entirely when motion is reduced.
      if (!reduced.current || progress.current < 1) raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    const seen = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting; }, { threshold: 0.05 });
    seen.observe(box);
    const resize = new ResizeObserver(() => draw(performance.now()));
    resize.observe(box);
    return () => { cancelAnimationFrame(raf.current); seen.disconnect(); resize.disconnect(); };
  }, [draw]);

  const leafAt = (event: React.PointerEvent) => {
    const box = wrap.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * COLS)));
    const row = Math.min(COLS - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * COLS)));
    return row * COLS + col + 1;
  };

  const point = (leaf: number | null) => {
    hover.current = leaf;
    setActive(leaf);
    if (reduced.current) draw(performance.now());
  };

  const onKey = (event: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
    if (event.key === "Home") point(1);
    else if (event.key === "End") point(LEAF_BUDGET);
    else if (event.key in step) point(Math.min(LEAF_BUDGET, Math.max(1, (hover.current ?? NEXT_LEAF) + step[event.key])));
    else return;
    event.preventDefault();
  };

  const shown = active ?? NEXT_LEAF;
  const note = label(shown);
  const left = LEAF_BUDGET - SPENT_LEAVES.length;

  return (
    <div className="ein-field">
      <p className="ein-field__caption">Each square is one signature this key can ever make.</p>
      <div
        ref={wrap}
        className="ein-field__grid"
        role="group"
        tabIndex={0}
        aria-label="Signing budget of the governance key: 4,096 leaves in a grid. Use the arrow keys to inspect a leaf."
        onPointerMove={(event) => point(leafAt(event))}
        onPointerLeave={() => point(null)}
        onFocus={() => { if (hover.current === null) point(NEXT_LEAF); }}
        onBlur={() => point(null)}
        onKeyDown={onKey}
      >
        <canvas ref={canvas} aria-hidden="true" />
      </div>
      <div className="ein-zoom">
        <p>The first four squares, enlarged</p>
        <ol>
          {SPENT_LEAVES.map((s) => (
            <li key={s.leaf} className="is-spent"><strong>{s.asset}</strong><span>calendar root signed</span></li>
          ))}
          <li className="is-next"><strong>Next</strong><span>not signed yet</span></li>
        </ol>
      </div>
      <div className="ein-field__read">
        <p className="ein-field__count">
          <span className="ein-pixel">Leaf {NEXT_LEAF}</span>
          <span>of {LEAF_BUDGET.toLocaleString("en-US")} is next</span>
        </p>
        <p className="ein-field__note" aria-live="polite">
          {note.text}{" "}
          {note.href && <a href={note.href} target="_blank" rel="noopener noreferrer">See the transaction</a>}
        </p>
        <p className="ein-field__legend">
          <span><i className="ein-key ein-key--spent" />Spent, {SPENT_LEAVES.length}</span>
          <span><i className="ein-key ein-key--next" />Next</span>
          <span><i className="ein-key ein-key--free" />Unused, {(left - 1).toLocaleString("en-US")}</span>
        </p>
      </div>
    </div>
  );
}
