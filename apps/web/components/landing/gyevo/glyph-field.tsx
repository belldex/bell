"use client";

import { useEffect, useRef } from "react";
import { buildBoundedGate, buildCloseAnchor, buildFeeStack, type HeroForm } from "./hero-forms";

/* The BELL hero sculpture uses one glyph-cloud engine and four market-specific forms:

     A  Session dial: a deep instrument face with a turned bezel and three session tracks.
     B  Fee stack (hero-forms.ts): three filled, offset liquidity tiers.
     C  Flow gate (hero-forms.ts): a 3D channel that narrows at the guarded throat.
     D  Close iris (hero-forms.ts): overlapping shutter leaves inside a finite housing.

   The form is a pure function of numbers the scroll code already writes on the stage, so it runs in reverse on
   its own: --h (0 -> 1 across the first hold) turns the session dial into the fee stack; --k (0 -> 1 across the extra
   forms) turns the stack into the gate and then the gate into the bounded close iris; --q only keeps it turning.
   The zoom (scale, fade) is the CSS on .lp-field, unchanged.

   Mouse: grab the hero and drag to turn the form (the automatic drift keeps its own clock, the hand adds
   an offset, a flick glides); without a button the form leans a little towards the pointer. Touch is left
   alone on purpose, so the page scrolls exactly as before.

   Cost, because this page must stay light: about 1300 glyph sprites copied from a pre-rendered sheet (no text is
   laid out per frame), at most ~30 frames a second while it drifts, one frame per scroll frame while --q
   moves, and nothing at all while the hero is closed, zoomed away, off screen or the tab is hidden.
   Decorative only: the wrapper is aria-hidden. */

const GLYPHS = "BELLFLOWMARKETSESSION";
const NG = GLYPHS.length;
const COUNT = 1320; /* glyphs flow from the session dial into the policy forms */
const PALETTE: readonly (readonly [number, number, number])[] = [
  [238, 236, 229], /* talc: verified state */
  [183, 180, 173], /* warm stone: session signal */
  [220, 215, 204], /* pale talc: metallic glint */
  [73, 70, 65], /* warm carbon depth */
  [238, 236, 229], /* talc edge */
];
const FRAME_MS = 40; /* ~25 frames a second while it drifts; the turn is slow, so it still looks smooth */
const Q_GONE = 0.8; /* the zoom has faded the field out completely by here (see .lp-field), so there is nothing to draw */
const CAMERA = 5; /* distance for the perspective; larger = flatter */
const H_FROM = 0.22; /* form A stays fully formed and readable through the first fifth of the hold, then the morph begins */
const H_TO = 0.90; /* form B is complete here, a little before the push-in begins */
const SPREAD = 0.24; /* how far apart in time the points leave */
/* the extra forms, as fractions of --k: form B rests, turns into C, C rests, turns into D, D rests until the zoom */
const K_BC_FROM = 0.14;
const K_BC_TO = 0.38;
const K_CD_FROM = 0.58;
const K_CD_TO = 0.82;
/* where each change of form begins and ends, in --h and --k, so the words that go with the picture follow it
   from one source (cover-reveal.tsx writes --s from these) */
export const FORM_TIMELINE = { hFrom: H_FROM, hTo: H_TO, bcFrom: K_BC_FROM, bcTo: K_BC_TO, cdFrom: K_CD_FROM, cdTo: K_CD_TO } as const;
const TAU = Math.PI * 2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const ease = (lp: number) => (lp < 0.5 ? 4 * lp * lp * lp : 1 - Math.pow(-2 * lp + 2, 3) / 2);

/* ---- the two forms, built once ---- */
interface Model {
  a: Float32Array; /* form A positions (static) */
  palA: Uint8Array;
  fee: HeroForm; /* form B: three broad, solid fee tiers */
  pair: Uint16Array; /* the point of form B that point i of form A turns into */
  glyph: Uint8Array;
  delay: Float32Array;
  jit: Float32Array;
  gate: HeroForm; /* form C */
  close: HeroForm; /* form D */
  pairBC: Uint16Array;
  pairCD: Uint16Array;
  delayC: Float32Array;
  delayD: Float32Array;
}

function buildModel(): Model {
  const a = new Float32Array(COUNT * 3);
  /* A market-session dial: a dense face, a thick turned bezel, three session tracks and a compact spindle.
     It reads as a timing instrument rather than a serving dome or a wire globe. */
  const faceEnd = Math.floor(COUNT * 0.65);
  const bezelEnd = Math.floor(COUNT * 0.82);
  const laneEnd = Math.floor(COUNT * 0.91);
  const tickEnd = Math.floor(COUNT * 0.98);
  for (let i = 0; i < COUNT; i++) {
    const o = i * 3;
    if (i < faceEnd) {
      const u = i / faceEnd;
      const radius = 0.88 * Math.sqrt(u);
      const angle = i * 2.399963229728653;
      a[o] = Math.cos(angle) * radius;
      a[o + 1] = Math.sin(angle) * radius;
      a[o + 2] = 0.035 - radius * radius * 0.045;
    } else if (i < bezelEnd) {
      const j = i - faceEnd;
      const angle = j * TAU / (bezelEnd - faceEnd);
      const depth = ((j % 5) / 4 - 0.5) * 0.24;
      const radius = 0.94 + Math.sin(angle * 12) * 0.008;
      a[o] = Math.cos(angle) * radius;
      a[o + 1] = Math.sin(angle) * radius;
      a[o + 2] = depth;
    } else if (i < laneEnd) {
      const j = i - bezelEnd;
      const lane = Math.min(2, Math.floor(j / ((laneEnd - bezelEnd) / 3)));
      const local = j % Math.ceil((laneEnd - bezelEnd) / 3);
      const angle = local * 2.399963229728653 + lane * 0.24;
      const radius = [0.72, 0.57, 0.42][lane];
      a[o] = Math.cos(angle) * radius;
      a[o + 1] = Math.sin(angle) * radius;
      a[o + 2] = 0.075;
    } else if (i < tickEnd) {
      const j = i - laneEnd;
      const group = Math.floor(j / Math.ceil((tickEnd - laneEnd) / 12));
      const local = j % Math.ceil((tickEnd - laneEnd) / 12);
      const angle = group * TAU / 12;
      const radius = 0.82 + local * 0.009;
      a[o] = Math.cos(angle) * radius;
      a[o + 1] = Math.sin(angle) * radius;
      a[o + 2] = 0.1;
    } else {
      const j = i - tickEnd;
      const y = 1 - ((j + 0.5) * 2) / (COUNT - tickEnd);
      const angle = j * 2.399963229728653;
      const radius = 0.16 * Math.sqrt(1 - y * y);
      a[o] = Math.cos(angle) * radius;
      a[o + 1] = y * 0.16;
      a[o + 2] = 0.13 + Math.sin(angle) * radius;
    }
  }

  const fee = buildFeeStack(COUNT);
  const palA = new Uint8Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const onInstrumentMark = i >= faceEnd;
    palA[i] = onInstrumentMark ? 4 : rnd(i * 3) > 0.94 ? 2 : rnd(i * 5 + 1) > 0.55 ? 1 : 0;
  }

  /* Pair the points by where they are, not by their number: both forms are sorted by azimuth around the
     vertical axis (then by height) and matched in that order, so the change flows round the form
     instead of scattering. */
  const tmp = new Float32Array(3);
  const keyOf = (x: number, y: number, z: number) => Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 18) * 10 + clamp01((y + 1.2) / 2.4);
  const keyA = Float32Array.from({ length: COUNT }, (_, i) => keyOf(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
  const keyB = Float32Array.from({ length: COUNT }, (_, i) => {
    fee.pos(i, 0, tmp);
    return keyOf(tmp[0], tmp[1], tmp[2]);
  });
  const byA = Array.from({ length: COUNT }, (_, i) => i).sort((p, q) => keyA[p] - keyA[q]);
  const byB = Array.from({ length: COUNT }, (_, i) => i).sort((p, q) => keyB[p] - keyB[q]);
  const pair = new Uint16Array(COUNT);
  for (let n = 0; n < COUNT; n++) pair[byA[n]] = byB[n];


  /* the same pairing, by place, for B -> C and C -> D (all three measured at t = 0) */
  const gate = buildBoundedGate(COUNT);
  const close = buildCloseAnchor(COUNT);
  const pairOf = (from: (i: number, out: Float32Array) => void, to: (i: number, out: Float32Array) => void) => {
    const kf = Float32Array.from({ length: COUNT }, (_, i) => { from(i, tmp); return keyOf(tmp[0], tmp[1], tmp[2]); });
    const kt = Float32Array.from({ length: COUNT }, (_, i) => { to(i, tmp); return keyOf(tmp[0], tmp[1], tmp[2]); });
    const sf = Array.from({ length: COUNT }, (_, i) => i).sort((p, q) => kf[p] - kf[q]);
    const st = Array.from({ length: COUNT }, (_, i) => i).sort((p, q) => kt[p] - kt[q]);
    const out = new Uint16Array(COUNT);
    for (let n = 0; n < COUNT; n++) out[sf[n]] = st[n];
    return out;
  };
  const pairBC = pairOf((i, o) => fee.pos(i, 0, o), (i, o) => gate.pos(i, 0, o));
  const pairCD = pairOf((i, o) => gate.pos(i, 0, o), (i, o) => close.pos(i, 0, o));

  return {
    a,
    palA,
    fee,
    pair,
    glyph: Uint8Array.from({ length: COUNT }, (_, i) => (i * 11 + 3) % NG),
    delay: Float32Array.from({ length: COUNT }, (_, i) => rnd(i + 0.5) * SPREAD),
    jit: Float32Array.from({ length: COUNT * 3 }, (_, n) => (rnd(n * 1.7 + 9) - 0.5) * 0.4),
    gate,
    close,
    pairBC,
    pairCD,
    delayC: Float32Array.from({ length: COUNT }, (_, i) => rnd(i * 1.3 + 41.5) * SPREAD),
    delayD: Float32Array.from({ length: COUNT }, (_, i) => rnd(i * 1.9 + 77.5) * SPREAD),
  };
}

export function GlyphField() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = cvRef.current;
    const ctx = cv?.getContext("2d");
    if (!wrap || !cv || !ctx) return;
    const host = wrap.closest<HTMLElement>("[data-lp-box]") ?? wrap;
    const stage = host.closest<HTMLElement>(".lp-stage") ?? host;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const live = !reduce;
    /* wide screens put the form beside the headline (full strength); narrow ones put it behind, so it is dimmer */
    const twoSide = window.matchMedia("(min-width: 861px) and (min-aspect-ratio: 1 / 1)");

    const M = buildModel();
    const cur = new Float32Array(3);
    const cur2 = new Float32Array(3);
    const sx = new Float32Array(COUNT);
    const sy = new Float32Array(COUNT);
    const sz = new Float32Array(COUNT);
    const sc = new Uint8Array(COUNT);
    const order = new Uint16Array(COUNT).map((_, i) => i);

    let dpr = 1;
    let cs = 20; /* glyph cell, device px */
    let atlas: HTMLCanvasElement | null = null;
    let fontFamily = "ui-monospace, monospace";
    let inView = false;
    let open = host.dataset.live === "1";
    let raf = 0;
    let lastDraw = 0;
    let lastQ = -1;
    let lastH = -1;
    let lastK = -1;
    /* Turning by hand. The automatic motion keeps its own clock and the hand adds an offset on top, so letting
       go never changes how the form drifts; it just carries on from where it was left. */
    let clock = 0;
    let autoYaw = 0;
    let userYaw = 0;
    let userPitch = 0;
    let velYaw = 0;
    let velPitch = 0;
    let dragging = false;
    let pointerId = -1;
    let lastX = 0;
    let lastY = 0;
    let lastMoveAt = 0;
    let leanX = 0;
    let leanY = 0;
    let leanTX = 0;
    let leanTY = 0;

    const readQ = () => parseFloat(stage.style.getPropertyValue("--q")) || 0;
    const readH = () => parseFloat(stage.style.getPropertyValue("--h")) || 0;
    const readK = () => parseFloat(stage.style.getPropertyValue("--k")) || 0;

    function readFont() {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;font-family:var(--lp-font-mono)";
      wrap!.appendChild(probe);
      const fam = getComputedStyle(probe).fontFamily;
      probe.remove();
      if (fam) fontFamily = fam;
    }

    /* Pre-render every glyph in each palette tone so no text layout runs during the scroll animation. */
    function buildAtlas() {
      cs = Math.max(12, Math.round(20 * dpr));
      atlas = document.createElement("canvas");
      atlas.width = cs * NG;
      atlas.height = cs * PALETTE.length;
      const a = atlas.getContext("2d");
      if (!a) return;
      a.textAlign = "center";
      a.textBaseline = "middle";
      a.font = `500 ${Math.round(cs * 0.68)}px ${fontFamily}`;
      for (let c = 0; c < PALETTE.length; c++) {
        const [r, g, b] = PALETTE[c];
        a.fillStyle = `rgb(${r},${g},${b})`;
        for (let k = 0; k < NG; k++) a.fillText(GLYPHS[k], k * cs + cs / 2, c * cs + cs / 2 + dpr * 0.5);
      }
    }

    function size() {
      const w = cv!.clientWidth;
      const h = cv!.clientHeight;
      if (!w || !h) return false;
      const d = Math.min(window.devicePixelRatio || 1, 1.5);
      const pw = Math.round(w * d);
      const ph = Math.round(h * d);
      if (cv!.width !== pw || cv!.height !== ph || d !== dpr || !atlas) {
        dpr = d;
        cv!.width = pw;
        cv!.height = ph;
        buildAtlas();
      }
      return true;
    }

    function draw(now: number) {
      if (!atlas || !cv || !ctx) return;
      const w = cv.width;
      const h = cv.height;
      ctx.clearRect(0, 0, w, h);
      const dt = lastDraw ? Math.min(0.1, (now - lastDraw) / 1000) : 0;
      lastDraw = now;
      if (live && !dragging) {
        clock += dt;
        autoYaw += dt * 0.28;
      }
      if (!dragging) {
        /* after a flick the turn glides to a stop, and a tilt given by hand eases back to level */
        userYaw += velYaw * dt;
        userPitch += velPitch * dt;
        const k = Math.exp(-3 * dt);
        velYaw *= k;
        velPitch *= k;
        userPitch *= Math.exp(-0.5 * dt);
      }
      const lk = 1 - Math.exp(-4 * dt);
      leanX += (leanTX - leanX) * lk;
      leanY += (leanTY - leanY) * lk;

      const q = live ? readQ() : 0;
      const hp = live ? readH() : 0;
      const kp = live ? readK() : 0;
      lastQ = q;
      lastH = hp;
      lastK = kp;
      const m = live ? clamp01((hp - H_FROM) / (H_TO - H_FROM)) : 0;
      const mC = clamp01((kp - K_BC_FROM) / (K_BC_TO - K_BC_FROM));
      const mD = clamp01((kp - K_CD_FROM) / (K_CD_TO - K_CD_FROM));
      const t = live ? clock : 0.6;
      const yaw = 0.35 + (live ? autoYaw + hp * 1.1 + kp * 0.9 + q * 2.4 : 0) + userYaw + leanX * 0.45;
      const pitch = 0.42 + (live ? Math.sin(clock * 0.35) * 0.05 : 0) + userPitch + leanY * 0.25;
      const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const minDim = Math.min(w, h);
      /* the canvas is a square placed by CSS (see .lp-form), so the form is simply centred in it */
      const Rr = minDim * 0.34;
      const cxp = w / 2;
      const cyp = h / 2;
      const base = Math.min(22, Math.max(13, minDim / dpr / 42)) * dpr;

      for (let i = 0; i < COUNT; i++) {
        const o = i * 3;
        let x = M.a[o], y = M.a[o + 1], z = M.a[o + 2];
        let pal = M.palA[i];
        const lp = clamp01((m - M.delay[i]) / (1 - SPREAD));
        if (mC > 0) {
          /* forms C and D: the point is already form B's (pair), and goes on to C's, then D's */
          const iB = M.pair[i];
          const iC = M.pairBC[iB];
          let fromPal: number;
          let toPal: number;
          let ld: number;
          if (mD > 0) {
            const iD = M.pairCD[iC];
            M.gate.pos(iC, t, cur);
            M.close.pos(iD, t, cur2);
            fromPal = M.gate.pal(iC, t);
            toPal = M.close.pal(iD, t);
            ld = clamp01((mD - M.delayD[i]) / (1 - SPREAD));
          } else {
            M.fee.pos(iB, t, cur);
            M.gate.pos(iC, t, cur2);
            fromPal = M.fee.pal(iB, t);
            toPal = M.gate.pal(iC, t);
            ld = clamp01((mC - M.delayC[i]) / (1 - SPREAD));
          }
          if (ld >= 1) {
            x = cur2[0]; y = cur2[1]; z = cur2[2];
            pal = toPal;
          } else if (ld <= 0) {
            x = cur[0]; y = cur[1]; z = cur[2];
            pal = fromPal;
          } else {
            const e = ease(ld);
            const arc = Math.sin(Math.PI * e);
            x = cur[0] + (cur2[0] - cur[0]) * e + M.jit[o] * arc;
            y = cur[1] + (cur2[1] - cur[1]) * e + M.jit[o + 1] * arc;
            z = cur[2] + (cur2[2] - cur[2]) * e + M.jit[o + 2] * arc;
            pal = e >= 0.5 ? toPal : fromPal;
          }
        } else if (lp > 0) {
          const bi = M.pair[i];
          M.fee.pos(bi, t, cur);
          if (lp >= 1) {
            x = cur[0]; y = cur[1]; z = cur[2];
            pal = M.fee.pal(bi, t);
          } else {
            const e = ease(lp);
            const arc = Math.sin(Math.PI * e);
            x += (cur[0] - x) * e + M.jit[o] * arc;
            y += (cur[1] - y) * e + M.jit[o + 1] * arc;
            z += (cur[2] - z) * e + M.jit[o + 2] * arc;
            if (e >= 0.5) pal = M.fee.pal(bi, t);
          }
        }
        sc[i] = pal;
        const x1 = x * cy + z * sy_;
        const z1 = -x * sy_ + z * cy;
        const y1 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const s = CAMERA / (CAMERA - z2);
        sx[i] = cxp + x1 * s * Rr;
        sy[i] = cyp + y1 * s * Rr;
        sz[i] = z2;
      }

      /* far to near; the order hardly changes between frames, so an insertion sort is nearly free */
      for (let n = 1; n < COUNT; n++) {
        const idx = order[n];
        const z = sz[idx];
        let j = n - 1;
        while (j >= 0 && sz[order[j]] > z) {
          order[j + 1] = order[j];
          j--;
        }
        order[j + 1] = idx;
      }
      const K = twoSide.matches ? 1 : 0.75;
      for (let n = 0; n < COUNT; n++) {
        const i = order[n];
        const dz = clamp01((sz[i] + 1.3) / 2.6);
        const s = CAMERA / (CAMERA - sz[i]);
        const dw = base * s * (0.62 + 0.5 * dz);
        ctx.globalAlpha = K * (0.2 + 0.8 * Math.pow(dz, 1.25));
        /* depth and silver tints distinguish the far shell from the market signal at its heart */
        const col = sc[i] <= 1 && dz < 0.36 ? 3 : sc[i];
        ctx.drawImage(atlas, M.glyph[i] * cs, col * cs, cs, cs, sx[i] - dw / 2, sy[i] - dw / 2, dw, dw);
      }
      ctx.globalAlpha = 1;
    }

    const canRun = () => live && open && inView && !document.hidden && readQ() < Q_GONE;
    const frame = (now: number) => {
      raf = 0;
      if (!canRun()) return;
      if (now - lastDraw >= FRAME_MS) draw(now);
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (live) {
        if (!raf && canRun()) raf = requestAnimationFrame(frame);
      } else if (inView && size()) {
        draw(performance.now());
      }
    };

    /* While --h, --k or --q move, draw right after cover-reveal has written them (a microtask after its frame callback),
       so the form is always in step with the zoom and never a frame behind. */
    const qWatch = live
      ? new MutationObserver(() => {
          if (!canRun() || !atlas) return;
          if (Math.abs(readQ() - lastQ) > 0.0004 || Math.abs(readH() - lastH) > 0.0004 || Math.abs(readK() - lastK) > 0.0004) draw(performance.now());
        })
      : null;
    qWatch?.observe(stage, { attributes: true, attributeFilter: ["style"] });

    const onLive = () => {
      open = host.dataset.live === "1";
      if (open) {
        size();
        kick();
      }
    };

    /* grab and drag to turn it: mouse only, so touch scrolling is never intercepted */
    const DRAG_RAD_PER_PX = 0.011;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || !canRun()) return;
      if ((e.target as Element | null)?.closest("a, button, input, select, textarea, label")) return;
      dragging = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveAt = e.timeStamp;
      velYaw = 0;
      velPitch = 0;
      host.setPointerCapture(e.pointerId);
      host.dataset.drag = "1";
      host.dataset.grab = "1";
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!dragging) {
        leanTX = e.clientX / window.innerWidth - 0.5;
        leanTY = e.clientY / window.innerHeight - 0.5;
        return;
      }
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const dts = Math.max(0.001, (e.timeStamp - lastMoveAt) / 1000);
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveAt = e.timeStamp;
      userYaw += dx * DRAG_RAD_PER_PX;
      velYaw = velYaw * 0.6 + ((dx * DRAG_RAD_PER_PX) / dts) * 0.4;
      userPitch = Math.max(-1.2, Math.min(1.2, userPitch - dy * DRAG_RAD_PER_PX));
      velPitch = velPitch * 0.6 - ((dy * DRAG_RAD_PER_PX) / dts) * 0.4;
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      delete host.dataset.drag;
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
      if (e.timeStamp - lastMoveAt > 120) { velYaw = 0; velPitch = 0; } /* held still before letting go: no glide */
      velYaw = Math.max(-6, Math.min(6, velYaw));
      velPitch = Math.max(-6, Math.min(6, velPitch));
      kick();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && !dragging) { leanTX = 0; leanTY = 0; }
    };
    if (live) {
      host.addEventListener("pointerdown", onDown);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerup", onUp);
      host.addEventListener("pointercancel", onUp);
      host.addEventListener("pointerleave", onLeave);
      host.addEventListener("lp-live", onLive);
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) {
          size();
          kick();
        }
      },
      { rootMargin: "80px 0px" },
    );
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      if (size() && !live && inView) draw(performance.now());
    });
    ro.observe(cv);
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);

    readFont();
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      readFont();
      atlas = null; /* rebuild with the loaded font */
      if (size()) kick();
    };
    if (document.fonts?.ready) void document.fonts.ready.then(start);
    else start();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      qWatch?.disconnect();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("lp-live", onLive);
      delete host.dataset.drag;
    };
  }, []);

  return (
    <>
      <div className="lp-field" ref={wrapRef} aria-hidden="true">
        <canvas className="lp-form" ref={cvRef} />
      </div>
    </>
  );
}
