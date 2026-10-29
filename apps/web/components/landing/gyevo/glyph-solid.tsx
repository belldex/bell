"use client";

import { useEffect, useRef } from "react";

/* The idea scene's picture: one object made of the same hex characters as the hero's forms, turning
   in 3D and reshaping itself as the story moves on. It replaces the made-up numbers.

     0  A public attestation          a sphere of readable characters. Everything is visible, including a few
                                      ruby ones: the private value, exposed.
     1  A private note                a closed cube of grey sealed cells: private, but nothing can check it.
     2  A sealed credential + proof   a burgundy core, still sealed, inside a white ring: the ring is the public
                                      proof. The chain checks the ring; the core is never shown.

   Colour keeps the page's meaning: white = public / on-chain, burgundy = private / on your device.

   Cost, because this page must stay light: about 500 sprites copied from a pre-rendered sheet (no text is laid
   out per frame), at most ~30 frames a second, and only while the canvas is on screen and the tab is visible.
   It turns with the scroll position (the scene's --ip) and drifts slowly in between. The static variant used
   in the stacked layout draws once. You can grab it and turn it (drag); the drift carries on from where you left it.
   Decorative: the label describes the state in words. */

/* The shapes. sphere / cube / seal are the three states of the idea scene; orb is a sphere with no private
   characters (an official, public record); rings is two linked rings (supply and borrow, joined by a proof);
   stack is four slabs (layers of on-chain evidence); book is an open book of text lines (documentation);
   assembly is tiered half-circle seating (a governing body voting in public). */
export type ShapeId = "sphere" | "cube" | "seal" | "orb" | "rings" | "stack" | "book" | "assembly";

const GLYPHS = "0123456789ABCDEF";
const NG = GLYPHS.length;
const COUNT = 486; /* 6 faces x 81 */
const CORE = 216; /* 6 faces x 36: the sealed core of state 2; the other 270 points are the ring */
const PALETTE: readonly (readonly [number, number, number])[] = [
  [240, 238, 232], /* public chalk */
  [174, 178, 181], /* session silver */
  [174, 178, 181], /* metallic reflection */
  [164, 168, 170], /* sealed graphite, drawn as a closed cell */
  [226, 226, 220], /* pale silver edge */
];
const SEALED = 3;
const MORPH_MS = 1500;
const FRAME_MS = 33;
const CAMERA = 5; /* distance for the perspective; larger = flatter */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ---- the three shapes, as unit-ish model coordinates ---- */
function cubePoint(face: number, a: number, b: number, h: number, out: Float32Array, o: number) {
  const u = a * h;
  const v = b * h;
  switch (face) {
    case 0: out[o] = h; out[o + 1] = u; out[o + 2] = v; break;
    case 1: out[o] = -h; out[o + 1] = u; out[o + 2] = v; break;
    case 2: out[o] = u; out[o + 1] = h; out[o + 2] = v; break;
    case 3: out[o] = u; out[o + 1] = -h; out[o + 2] = v; break;
    case 4: out[o] = u; out[o + 1] = v; out[o + 2] = h; break;
    default: out[o] = u; out[o + 1] = v; out[o + 2] = -h;
  }
}

function sphereShape(): Float32Array {
  const p = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const y = 1 - ((i + 0.5) * 2) / COUNT;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963229728653; /* golden angle */
    p[i * 3] = Math.cos(th) * r;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = Math.sin(th) * r;
  }
  return p;
}

function cubeShape(): Float32Array {
  const p = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const j = (i / 6) | 0;
    cubePoint(i % 6, (j % 9) / 4 - 1, ((j / 9) | 0) / 4 - 1, 0.72, p, i * 3);
  }
  return p;
}

function coreShape(): Float32Array {
  const p = new Float32Array(CORE * 3);
  for (let i = 0; i < CORE; i++) {
    const j = (i / 6) | 0;
    cubePoint(i % 6, (j % 6) / 2.5 - 1, ((j / 6) | 0) / 2.5 - 1, 0.36, p, i * 3);
  }
  return p;
}

/* the ring's points move over time (it orbits the core), so they are computed per frame */
const TILT = 0.2;
const TILT_C = Math.cos(TILT);
const TILT_S = Math.sin(TILT);
function ringPoint(k: number, spin: number, out: Float32Array, o: number) {
  const s = k % 3;
  const idx = (k / 3) | 0;
  const th = (idx / 90) * Math.PI * 2 + s * 0.5 + spin;
  const r = 1 + (s - 1) * 0.06;
  const x = Math.cos(th) * r;
  const y = (s - 1) * 0.05;
  out[o] = x * TILT_C - y * TILT_S;
  out[o + 1] = x * TILT_S + y * TILT_C;
  out[o + 2] = Math.sin(th) * r;
}

/* two linked rings: one upright, one flat, each passing through the other's middle */
const HALF = COUNT / 2;
function linkedPoint(i: number, spin: number, out: Float32Array, o: number) {
  const k = i % HALF;
  const s = k % 3;
  const idx = (k / 3) | 0; /* 81 per strand */
  const r = 0.78 + (s - 1) * 0.05;
  const z = (s - 1) * 0.04;
  if (i < HALF) {
    const th = (idx / 81) * Math.PI * 2 + s * 0.5 + spin;
    out[o] = -0.39 + Math.cos(th) * r;
    out[o + 1] = Math.sin(th) * r;
    out[o + 2] = z;
  } else {
    const th = (idx / 81) * Math.PI * 2 + s * 0.5 - spin * 0.8;
    out[o] = 0.39 + Math.cos(th) * r;
    out[o + 1] = z;
    out[o + 2] = Math.sin(th) * r;
  }
}

/* four slabs, one above the other */
function stackPoint(i: number, out: Float32Array, o: number) {
  if (i >= 484) { out[o] = 0; out[o + 1] = 0.9; out[o + 2] = 0; return; } /* the two spare points rest on top */
  const plate = (i / 121) | 0;
  const j = i % 121;
  out[o] = ((j % 11) / 5 - 1) * 0.74;
  out[o + 1] = (plate - 1.5) * 0.5;
  out[o + 2] = (((j / 11) | 0) / 5 - 1) * 0.74;
}

/* an open book: two pages rising from a spine, 11 lines of 22 characters each */
function bookPoint(i: number, out: Float32Array, o: number) {
  if (i >= 484) { out[o] = 0; out[o + 1] = -0.4 + (i - 484) * 0.04; out[o + 2] = 0; return; }
  const left = i < 242;
  const k = left ? i : i - 242;
  const u = ((k % 22) + 1) / 22; /* 0 at the spine, 1 at the outer edge */
  const v = ((k / 22) | 0) / 10 * 2 - 1;
  const a = 0.3;
  out[o] = (left ? -1 : 1) * u * Math.cos(a) * 0.98;
  out[o + 1] = u * Math.sin(a) * 0.98 - 0.12 + (1 - u) * -0.05;
  out[o + 2] = v * 0.66;
}

/* tiered half-circle seating: five rows, each row longer than the one in front */
const ASSEMBLY_RADII = [0.34, 0.5, 0.66, 0.82, 0.98];
const ASSEMBLY_COUNTS = (() => {
  const total = ASSEMBLY_RADII.reduce((a, b) => a + b, 0);
  const counts = ASSEMBLY_RADII.map((r) => Math.round((COUNT * r) / total));
  counts[counts.length - 1] += COUNT - counts.reduce((a, b) => a + b, 0);
  return counts;
})();
const P_ASSEMBLY = (() => {
  const p = new Float32Array(COUNT * 3);
  let i = 0;
  ASSEMBLY_RADII.forEach((r, row) => {
    const n = ASSEMBLY_COUNTS[row];
    for (let k = 0; k < n; k++, i++) {
      const a = (k / (n - 1)) * Math.PI;
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = 0.3 - row * 0.15; /* the back rows sit higher (y points down) */
      p[i * 3 + 2] = Math.sin(a) * r - 0.4;
    }
  });
  return p;
})();

/* which colour each point has */
const palette = (fn: (i: number) => number) => Uint8Array.from({ length: COUNT }, (_, i) => fn(i));
const PAL_SPHERE = palette((i) => (i % 9 === 0 ? 2 : rnd(i * 3) > 0.55 ? 0 : 1));
const PAL_ORB = palette((i) => (rnd(i * 3) > 0.55 ? 0 : 1));
const PAL_CUBE = palette(() => SEALED);
const PAL_SEAL = palette((i) => (i < CORE ? 2 : rnd(i * 5) > 0.78 ? 0 : 1));
const PAL_STACK = palette((i) => (rnd(i * 3) > 0.35 + ((i / 121) | 0) * 0.08 ? 1 : 0));
const PAL_ASSEMBLY = palette((i) => (rnd(i * 3) > 0.5 ? 1 : 0));
const PAL_BOOK = palette((i) => (rnd(i * 3) > 0.5 ? 1 : 0));
const PAL_RINGS = palette((i) => (i < HALF ? (rnd(i * 5) > 0.7 ? 0 : 1) : rnd(i * 7) > 0.88 ? 0 : 2));

const P_SPHERE = sphereShape();
const P_CUBE = cubeShape();
const P_CORE = coreShape();

interface Shape {
  pos(i: number, spin: number, out: Float32Array): void;
  pal: Uint8Array;
  /** the angle it rests at when it is drawn once, not animated */
  yaw: number;
  /** when set, it sways this far either side of its angle instead of turning all the way round (so a flat thing stays readable) */
  sway?: number;
}
const copy3 = (p: Float32Array, i: number, out: Float32Array) => { out[0] = p[i * 3]; out[1] = p[i * 3 + 1]; out[2] = p[i * 3 + 2]; };
const SHAPES: Record<ShapeId, Shape> = {
  sphere: { pos: (i, _s, out) => copy3(P_SPHERE, i, out), pal: PAL_SPHERE, yaw: 0.7 },
  orb: { pos: (i, _s, out) => copy3(P_SPHERE, i, out), pal: PAL_ORB, yaw: 0.7 },
  cube: { pos: (i, _s, out) => copy3(P_CUBE, i, out), pal: PAL_CUBE, yaw: 1.25 },
  seal: { pos: (i, spin, out) => (i < CORE ? copy3(P_CORE, i, out) : ringPoint(i - CORE, spin, out, 0)), pal: PAL_SEAL, yaw: 1.8 },
  rings: { pos: (i, spin, out) => linkedPoint(i, spin, out, 0), pal: PAL_RINGS, yaw: 0.9 },
  stack: { pos: (i, _s, out) => stackPoint(i, out, 0), pal: PAL_STACK, yaw: 0.6 },
  assembly: { pos: (i, _s, out) => copy3(P_ASSEMBLY, i, out), pal: PAL_ASSEMBLY, yaw: 0.5, sway: 0.7 },
  book: { pos: (i, _s, out) => bookPoint(i, out, 0), pal: PAL_BOOK, yaw: 0.45, sway: 0.75 },
};

interface Props {
  shape: ShapeId;
  /** Turn with the scroll and drift. Off for the stacked layout: one still frame. */
  animated?: boolean;
  label: string;
  className?: string;
}

export function GlyphSolid({ shape, animated = true, label, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shapeRef = useRef<ShapeId>(shape);
  const setShapeRef = useRef<((s: ShapeId) => void) | null>(null);
  shapeRef.current = shape;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const live = animated && !reduce;
    const run = canvas.closest<HTMLElement>(".lp-idea-run");

    const GLYPH = Uint8Array.from({ length: COUNT }, (_, i) => (i * 7 + 3) % NG);
    const DELAY = Float32Array.from({ length: COUNT }, (_, i) => rnd(i + 0.5) * 0.38);
    const JIT = Float32Array.from({ length: COUNT * 3 }, (_, n) => (rnd(n * 1.7 + 9) - 0.5) * 1.1);

    const cur = new Float32Array(COUNT * 3); /* where each point is now, model space */
    const from = new Float32Array(COUNT * 3);
    const fromPal = new Uint8Array(COUNT);
    const tgt = new Float32Array(3);
    const sx = new Float32Array(COUNT);
    const sy = new Float32Array(COUNT);
    const sz = new Float32Array(COUNT);
    const sc = new Float32Array(COUNT);
    const order = new Uint16Array(COUNT).map((_, i) => i);

    let to: ShapeId = shapeRef.current;
    let curPal = SHAPES[to].pal;
    let mStart = -1;
    let morphing = false;
    let dpr = 1;
    let cs = 20; /* atlas cell, device px */
    let atlas: HTMLCanvasElement | null = null;
    let fontFamily = "ui-monospace, monospace";
    let inView = false;
    let raf = 0;
    let lastFrame = 0;
    /* Turning by hand. The automatic motion keeps its own clock (auto*) and the hand adds an offset (user*) on top,
       so letting go never changes how the object drifts; it just carries on from where it was left. */
    let clock = 0; /* seconds of automatic motion; it stops while the object is held */
    let autoYaw = 0;
    let autoPhase = 0;
    let lastDraw = 0;
    let userYaw = 0;
    let userPitch = 0;
    let velYaw = 0;
    let velPitch = 0;
    let dragging = false;
    let pointerId = -1;
    let lastX = 0;
    let lastY = 0;
    let lastMoveAt = 0;

    const targetOf = (id: ShapeId, i: number, t: number, out: Float32Array) => SHAPES[id].pos(i, live ? t * 0.7 : 0.6, out);

    function readFont() {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;font-family:var(--lp-font-mono)";
      canvas!.parentElement?.appendChild(probe);
      const fam = getComputedStyle(probe).fontFamily;
      probe.remove();
      if (fam) fontFamily = fam;
    }

    /* every character in every colour, drawn once; the sealed colour is a small closed cell instead */
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
        for (let k = 0; k < NG; k++) {
          if (c === SEALED) {
            const m = cs * 0.3;
            a.fillRect(k * cs + m, c * cs + m, cs - 2 * m, cs - 2 * m);
          } else {
            a.fillText(GLYPHS[k], k * cs + cs / 2, c * cs + cs / 2 + dpr * 0.5);
          }
        }
      }
    }

    function size() {
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      if (!w || !h) return false;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      const pw = Math.round(w * d);
      const ph = Math.round(h * d);
      if (canvas!.width !== pw || canvas!.height !== ph || d !== dpr || !atlas) {
        dpr = d;
        canvas!.width = pw;
        canvas!.height = ph;
        buildAtlas();
      }
      return true;
    }

    function draw(now: number) {
      if (!atlas || !canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const dt = lastDraw ? Math.min(0.1, (now - lastDraw) / 1000) : 0;
      lastDraw = now;
      if (live && !dragging) clock += dt;
      const t = clock;
      const prog = live && run ? parseFloat(run.style.getPropertyValue("--ip")) || 0 : 0;
      const m = morphing ? clamp01((now - mStart) / MORPH_MS) : 1;
      if (morphing && m >= 1) morphing = false;

      const sh = SHAPES[to];
      if (!dragging) {
        /* after a flick the turn glides to a stop, and a tilt given by hand eases back to level */
        userYaw += velYaw * dt;
        userPitch += velPitch * dt;
        const k = Math.exp(-3 * dt);
        velYaw *= k;
        velPitch *= k;
        userPitch *= Math.exp(-0.5 * dt);
        if (live) { autoYaw += dt * 0.28; autoPhase += dt * 0.45; }
      }
      const yaw = (live ? (sh.sway ? sh.yaw + Math.sin(autoPhase) * sh.sway : autoYaw + prog * 3.2) : sh.yaw) + userYaw;
      const pitch = (live ? 0.5 + Math.sin(t * 0.35) * 0.06 : 0.5) + userPitch;
      const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const minDim = Math.min(w, h);
      const R = minDim * 0.33;
      const cxp = w / 2;
      const cyp = h / 2;
      const sizeK = Math.min(1.15, Math.max(0.55, minDim / dpr / 300));
      const base = 16 * dpr * sizeK;

      for (let i = 0; i < COUNT; i++) {
        targetOf(to, i, t, tgt);
        let x = tgt[0], y = tgt[1], z = tgt[2];
        if (m < 1) {
          const lp = clamp01((m - DELAY[i]) / 0.62);
          const e = lp < 0.5 ? 4 * lp * lp * lp : 1 - Math.pow(-2 * lp + 2, 3) / 2;
          const arc = Math.sin(Math.PI * e);
          x = from[i * 3] + (x - from[i * 3]) * e + JIT[i * 3] * arc;
          y = from[i * 3 + 1] + (y - from[i * 3 + 1]) * e + JIT[i * 3 + 1] * arc;
          z = from[i * 3 + 2] + (z - from[i * 3 + 2]) * e + JIT[i * 3 + 2] * arc;
          sc[i] = e < 0.5 ? fromPal[i] : curPal[i];
        } else {
          sc[i] = curPal[i];
        }
        cur[i * 3] = x; cur[i * 3 + 1] = y; cur[i * 3 + 2] = z;
        const x1 = x * cy + z * sy_;
        const z1 = -x * sy_ + z * cy;
        const y1 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const s = CAMERA / (CAMERA - z2);
        sx[i] = cxp + x1 * s * R;
        sy[i] = cyp + y1 * s * R;
        sz[i] = z2;
      }

      order.sort((a, b) => sz[a] - sz[b]); /* far to near */
      for (let n = 0; n < COUNT; n++) {
        const i = order[n];
        const dz = clamp01((sz[i] + 1.3) / 2.6);
        const s = CAMERA / (CAMERA - sz[i]);
        const dw = base * s * (0.62 + 0.5 * dz);
        ctx.globalAlpha = 0.2 + 0.8 * Math.pow(dz, 1.25);
        ctx.drawImage(atlas, GLYPH[i] * cs, sc[i] * cs, cs, cs, sx[i] - dw / 2, sy[i] - dw / 2, dw, dw);
      }
      ctx.globalAlpha = 1;
    }

    const canRun = () => live && inView && !document.hidden;
    const frame = (now: number) => {
      raf = 0;
      if (!canRun()) return;
      if (now - lastFrame >= FRAME_MS) {
        lastFrame = now;
        draw(now);
      }
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (live) {
        if (!raf && canRun()) raf = requestAnimationFrame(frame);
      } else if (inView && size()) {
        draw(performance.now());
      }
    };

    /* grab and drag to turn it (mouse: any direction; touch: sideways only, so the page can still scroll) */
    const DRAG_RAD_PER_PX = 0.011;
    let drawQueued = false;
    const redrawNow = () => {
      if (live || drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(() => { drawQueued = false; if (inView && size()) draw(performance.now()); });
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveAt = e.timeStamp;
      velYaw = 0;
      velPitch = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const dts = Math.max(0.001, (e.timeStamp - lastMoveAt) / 1000);
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveAt = e.timeStamp;
      userYaw += dx * DRAG_RAD_PER_PX;
      velYaw = velYaw * 0.6 + ((dx * DRAG_RAD_PER_PX) / dts) * 0.4;
      if (e.pointerType === "mouse") {
        userPitch = Math.max(-1.2, Math.min(1.2, userPitch - dy * DRAG_RAD_PER_PX));
        velPitch = velPitch * 0.6 - ((dy * DRAG_RAD_PER_PX) / dts) * 0.4;
      }
      redrawNow();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = "grab";
      if (!live || e.timeStamp - lastMoveAt > 120) { velYaw = 0; velPitch = 0; } /* held still before letting go: no glide */
      velYaw = Math.max(-6, Math.min(6, velYaw));
      velPitch = Math.max(-6, Math.min(6, velPitch));
      kick();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    /* a new state: the points leave where they are now and settle into the new shape */
    const setShape = (next: ShapeId) => {
      if (next === to) return;
      from.set(cur);
      fromPal.set(curPal);
      to = next;
      curPal = SHAPES[next].pal;
      if (live) {
        mStart = performance.now();
        morphing = true;
      } else {
        morphing = false;
      }
      kick();
    };
    setShapeRef.current = setShape;

    /* start in the current state, fully formed */
    for (let i = 0; i < COUNT; i++) {
      targetOf(to, i, 0, tgt);
      cur[i * 3] = tgt[0]; cur[i * 3 + 1] = tgt[1]; cur[i * 3 + 2] = tgt[2];
    }
    from.set(cur);
    fromPal.set(curPal);

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
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      if (size() && !live && inView) draw(performance.now());
    });
    ro.observe(canvas);
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);

    readFont();
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      atlas = null; /* rebuild with the loaded font */
      if (size()) kick();
    };
    if (document.fonts?.ready) void document.fonts.ready.then(start);
    else start();

    return () => {
      cancelled = true;
      setShapeRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [animated]);

  useEffect(() => {
    setShapeRef.current?.(shape);
  }, [shape]);

  return <canvas ref={canvasRef} className={className} role="img" aria-label={label} style={{ cursor: "grab", touchAction: "pan-y", userSelect: "none" }} />;
}
