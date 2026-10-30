/* BELL's market-session sculpture: a fine market-data shell with three moving session lanes, five named
   checkpoints and a small clock instrument inside. Scrolling carries the camera through the sculpture
   and into the hero; it is a BELL market mechanism, not a globe or credential network.

   What makes the inside read as inside: the layers are drawn back to front and a pale veil is laid over
   everything that is behind the near side of the shell, so the far mesh, the second shell and the core sit
   behind glass while the near mesh stays crisp on top of them. A soft clearing behind the words keeps the
   lines from fighting the type.

   Scrolling is a camera move through it, driven by the opening's progress (p, 0..1): the camera dollies
   toward the dot, the shell loosens into a cloud of nodes that streams past, the orbits widen and the core
   comes up, while the cipher plates (cipher-sculpture.ts) unfold over it and the dark hero appears behind
   them. It is a pure function of (p, time), so it runs in reverse.

   Plain canvas 2D with a hand-rolled perspective, like the other forms on this page; no library. Edges are
   batched into a few alpha levels (a handful of strokes per frame), it idles at 30 fps, stops entirely
   once the plates have covered it, and draws a single still under reduced motion. */

const CHARCOAL = [41, 39, 37] as const;
const POPPY = [199, 68, 79] as const; /* BELL poppy accent */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const LEVELS = 10; /* alpha levels the edges are batched into */
const A_OUT = 0.6; /* strongest line of the outer mesh, on a near-facing edge */
const A_MID = 0.55; /* and of the second shell */
const CZ0 = 3.6; /* camera distance at rest, in shell radii */
const CZ1 = 0.62; /* and when the plates have taken over */
const GONE = 0.97; /* progress at which the globe is hidden behind the plates and stops drawing */
const AREA_BUDGET = 3.4e6; /* canvas pixels, so a big monitor does not pay for a huge backing store */
const MID_R = 0.62; /* the second shell, as a fraction of the outer one */
const NAV_FADE = 128; /* the fixed nav sits over the top of the stage; the marquee over the bottom */
const FOOT_FADE = 190;

type Vec = [number, number, number];

/* ------------------------------------------------------------------ static geometry, built once */
/* Three stacked toroidal market lanes replace the generic globe mesh.
   Each lane has its own width, elevation and tilt; the inner layer repeats the sculpture at a smaller scale. */
function sessionSculpture(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const turns = Math.PI * (3 - Math.sqrt(5));
  const majorX = [0.44, 0.66, 0.86];
  const majorZ = [0.36, 0.54, 0.7];
  const tube = [0.1, 0.12, 0.14];
  const elevation = [0.82, 0, -0.82];
  const tilt = [0.48, -0.36, 0.42];
  const layerCount = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const tier = i % 3;
    const j = (i / 3) | 0;
    const around = (j / layerCount) * Math.PI * 2 + tier * 0.31;
    const section = j * turns + tier * 1.7;
    const ridge = Math.cos(around * 3 + section * 0.28) * 0.025;
    const radius = tube[tier] + ridge;
    const x = (majorX[tier] + radius * Math.cos(section)) * Math.cos(around);
    const z = (majorZ[tier] + radius * Math.cos(section)) * Math.sin(around);
    const y = elevation[tier] + radius * Math.sin(section);
    const ct = Math.cos(tilt[tier]);
    const st = Math.sin(tilt[tier]);
    out[i * 3] = x;
    out[i * 3 + 1] = y * ct - z * st;
    out[i * 3 + 2] = y * st + z * ct;
  }
  return out;
}

/* each node to its five nearest, kept short, de-duplicated: a triangulated-looking mesh without a mesher */
function neighbours(pts: Float32Array, n: number): Uint16Array {
  const spacing = Math.sqrt((4 * Math.PI) / n);
  const maxD2 = Math.pow(spacing * 1.62, 2);
  const seen = new Set<number>();
  const list: number[] = [];
  const bestD = new Float32Array(5);
  const bestI = new Int32Array(5);
  for (let i = 0; i < n; i++) {
    bestD.fill(9);
    bestI.fill(-1);
    const xi = pts[i * 3];
    const yi = pts[i * 3 + 1];
    const zi = pts[i * 3 + 2];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = pts[j * 3] - xi;
      const dy = pts[j * 3 + 1] - yi;
      const dz = pts[j * 3 + 2] - zi;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxD2 || d2 >= bestD[4]) continue;
      let k = 4;
      while (k > 0 && bestD[k - 1] > d2) {
        bestD[k] = bestD[k - 1];
        bestI[k] = bestI[k - 1];
        k--;
      }
      bestD[k] = d2;
      bestI[k] = j;
    }
    for (let k = 0; k < 5; k++) {
      const j = bestI[k];
      if (j < 0) continue;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = a * 4096 + b;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(a, b);
    }
  }
  return Uint16Array.from(list);
}

/* one mesh layer: nodes, edges, and the per-frame scratch they are drawn from */
type Layer = {
  n: number;
  base: Float32Array;
  seed: Float32Array;
  edges: Uint16Array;
  rest: Float32Array;
  rx: Float32Array; /* rotated, expanded node positions */
  ry: Float32Array;
  rz: Float32Array;
  sx: Float32Array; /* and where they land on screen; NaN when behind the camera */
  sy: Float32Array;
  near: Float32Array; /* distance fade per node: 0 right at the camera, 1 well in front of it */
  cue: Float32Array; /* how strongly a node is drawn: near the viewer is strong, far is faint */
  lv: Int8Array; /* per edge: alpha level, or -1 when it is not drawn this frame */
  fr: Uint8Array; /* per edge: 1 when it is on the viewer's side of the shell */
  seg: Float32Array;
  bandIdx: Int32Array;
};

function makeLayer(n: number, seedOffset: number): Layer {
  const base = sessionSculpture(n);
  const edges = neighbours(base, n);
  const ec = edges.length / 2;
  const rest = new Float32Array(ec);
  for (let e = 0; e < ec; e++) {
    const a = edges[e * 2];
    const b = edges[e * 2 + 1];
    rest[e] = Math.hypot(base[a * 3] - base[b * 3], base[a * 3 + 1] - base[b * 3 + 1], base[a * 3 + 2] - base[b * 3 + 2]);
  }
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) seed[i] = rnd(i + seedOffset);
  return {
    n,
    base,
    seed,
    edges,
    rest,
    rx: new Float32Array(n),
    ry: new Float32Array(n),
    rz: new Float32Array(n),
    sx: new Float32Array(n),
    sy: new Float32Array(n),
    near: new Float32Array(n),
    cue: new Float32Array(n),
    lv: new Int8Array(ec),
    fr: new Uint8Array(ec),
    seg: new Float32Array(LEVELS * ec * 4),
    bandIdx: new Int32Array(n * 4),
  };
}

/* Twelve indexed ticks form the small market clock inside the globe. */
const ICO: Vec[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const y = Math.sin(a * 2) * 0.08;
  const r = Math.sqrt(1 - y * y);
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});
const nearestPairs = (verts: Vec[]): [number, number][] => {
  const out: [number, number][] = [];
  let min = 9;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) min = Math.min(min, Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2]));
  }
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2]) < min * 1.02) out.push([i, j]);
    }
  }
  return out;
};
const ICO_EDGES = nearestPairs(ICO);
/* and a small octahedron turning inside it */
const OCT: Vec[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const OCT_EDGES = nearestPairs(OCT);

/* orbits: radius, the tilt of their plane, the lean, speed (rad/s), how many nodes ride them */
/* The sculpture's three integral toroidal lanes carry the motion. No satellite orbit rings: those read as a globe. */
const RINGS: readonly { r: number; tilt: number; lean: number; speed: number; riders: number }[] = [];
const RING_SEGS = 84;

const ARC_COUNT = 6;
const ARC_PTS = 26;
const SESSION_LANES = [
  { rx: 0.44, rz: 0.36, y: 0.82, tilt: 0.48 },
  { rx: 0.66, rz: 0.54, y: 0, tilt: -0.36 },
  { rx: 0.86, rz: 0.7, y: -0.82, tilt: 0.42 },
] as const;
const CLOCK_HANDS = [
  { offset: 0, speed: 0.16, scroll: Math.PI * 1.7, length: 1, width: 3.6, alpha: 1 },
  { offset: 1.15, speed: 0.015, scroll: 0.42, length: 0.58, width: 2.6, alpha: 0.86 },
] as const;

/* scratch space reused every frame, so drawing allocates nothing */
const ringX = new Float32Array(RING_SEGS);
const ringY = new Float32Array(RING_SEGS);
const ringZ = new Float32Array(RING_SEGS);
const ringOk = new Uint8Array(RING_SEGS);
const ringFront: number[][] = RINGS.map(() => []);
const ringBack: number[][] = RINGS.map(() => []);
const laneFront: number[][] = SESSION_LANES.map(() => []);
const laneBack: number[][] = SESSION_LANES.map(() => []);
const coreX = new Float32Array(12);
const coreY = new Float32Array(12);
const coreZ = new Float32Array(12);
const coreOk = new Uint8Array(12);
const octX = new Float32Array(6);
const octY = new Float32Array(6);
const octZ = new Float32Array(6);
const octOk = new Uint8Array(6);
const clockStart = new Float32Array(3);
const clockEnd = new Float32Array(3);

export type GlobeSculpture = {
  resize: (slot: HTMLElement) => void;
  getOpeningPoint: () => { x: number; y: number };
  setProgress: (p: number) => void;
  setReduced: (reduced: boolean) => void;
  destroy: () => void;
};

export function createGlobeSculpture(canvas: HTMLCanvasElement): GlobeSculpture | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let cx = 0;
  let cy = 0;
  let openingX = 0;
  let openingY = 0;
  let R = 0; /* the shell's radius on screen at rest */
  let focal = 0;

  let outer: Layer | null = null;
  let mid: Layer | null = null;
  let dust = new Float32Array(0);
  let dustN = 0;
  let verified: number[] = [];
  let labelOf: string[] = [];
  let arcs: { pts: Float32Array; phase: number; period: number }[] = [];
  let ringPts: Float32Array[] = [];
  const segN = new Int32Array(LEVELS);

  let progress = 0;
  let drawnP = -1;
  let reduced = false;
  let running = false;
  let raf = 0;
  let lastDraw = 0;
  let born = 0;
  let ptrX = 0;
  let ptrY = 0;
  let curX = 0;
  let curY = 0;
  let ready = false;
  let dead = false; /* destroyed: a late callback from an unmounted effect must not revive the loop */
  let fontFamily = "ui-monospace, monospace";
  let slotEl: HTMLElement | null = null;
  let fadeTop: CanvasGradient | null = null;
  let fadeBottom: CanvasGradient | null = null;
  let clearGrad: CanvasGradient | null = null;
  let clearBox = { x: 0, y: 0, rx: 0, ry: 0 };
  let builtFor = 0;

  const build = (outerN: number) => {
    if (outerN === builtFor) return;
    builtFor = outerN;
    outer = makeLayer(outerN, 9.3);
    mid = makeLayer(Math.round(outerN / 7.5), 31.7);

    dustN = outerN > 700 ? 170 : 90;
    dust = new Float32Array(dustN * 4);
    for (let i = 0; i < dustN; i++) {
      /* uniformly through a ball from just inside the shell out to well past the orbits */
      const u = rnd(i * 3.1 + 1.7);
      const v = rnd(i * 5.3 + 2.9) * 2 - 1;
      const a = rnd(i * 7.7 + 4.1) * Math.PI * 2;
      const r = 0.35 + 2.1 * Math.cbrt(rnd(i * 1.3 + 8.2) * 0.9 + 0.1);
      const s = Math.sqrt(1 - v * v);
      dust[i * 4] = Math.cos(a) * s * r;
      dust[i * 4 + 1] = v * r;
      dust[i * 4 + 2] = Math.sin(a) * s * r;
      dust[i * 4 + 3] = u;
    }

    /* Market-session checkpoints: larger and labelled so this globe is distinct to BELL. */
    const n = outer.n;
    verified = [];
    labelOf = [];
    const step = Math.floor(n / 26);
    const sessions = ["PRE", "REG", "EXT", "OVN", "CLOSE"];
    for (let k = 0; k < 26; k++) {
      const i = (k * step + Math.floor(rnd(k + 3.1) * step)) % n;
      verified.push(i);
      labelOf.push(sessions[Math.min(sessions.length - 1, Math.floor(k / 26 * sessions.length))]);
    }

    /* proofs: great-circle arcs between verified nodes, lifted off the shell */
    const base = outer.base;
    arcs = [];
    for (let k = 0; k < ARC_COUNT; k++) {
      const a = verified[(k * 4) % verified.length];
      let b = verified[(k * 4 + 7 + Math.floor(rnd(k + 20) * 9)) % verified.length];
      if (b === a) b = verified[(k * 4 + 8) % verified.length];
      const ax = base[a * 3];
      const ay = base[a * 3 + 1];
      const az = base[a * 3 + 2];
      const bx = base[b * 3];
      const by = base[b * 3 + 1];
      const bz = base[b * 3 + 2];
      const om = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
      const so = Math.sin(om) || 1;
      const lift = 0.07 + 0.16 * (om / Math.PI);
      const pts = new Float32Array(ARC_PTS * 3);
      for (let j = 0; j < ARC_PTS; j++) {
        const u = j / (ARC_PTS - 1);
        const s0 = Math.sin((1 - u) * om) / so;
        const s1 = Math.sin(u * om) / so;
        const r = 1 + lift * Math.sin(Math.PI * u);
        pts[j * 3] = (ax * s0 + bx * s1) * r;
        pts[j * 3 + 1] = (ay * s0 + by * s1) * r;
        pts[j * 3 + 2] = (az * s0 + bz * s1) * r;
      }
      arcs.push({ pts, phase: rnd(k + 41) * 7, period: 5.4 + rnd(k + 17) * 3.2 });
    }

    ringPts = RINGS.map((rg) => {
      const out = new Float32Array(RING_SEGS * 3);
      const ct = Math.cos(rg.tilt);
      const st = Math.sin(rg.tilt);
      const cl = Math.cos(rg.lean);
      const sl = Math.sin(rg.lean);
      for (let i = 0; i < RING_SEGS; i++) {
        const a = (i / RING_SEGS) * Math.PI * 2;
        const x0 = Math.cos(a);
        const y0 = Math.sin(a);
        const y1 = y0 * ct;
        const z1 = y0 * st;
        out[i * 3] = x0 * cl - y1 * sl;
        out[i * 3 + 1] = x0 * sl + y1 * cl;
        out[i * 3 + 2] = z1;
      }
      return out;
    });
  };

  const readFont = () => {
    const host = canvas.parentElement;
    if (!host) return;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;font-family:var(--lp-font-mono)";
    host.appendChild(probe);
    const fam = getComputedStyle(probe).fontFamily;
    probe.remove();
    if (fam) fontFamily = fam;
  };

  /* ------------------------------------------------------------------ one frame */
  const tmp: Vec = [0, 0, 0];

  const draw = (nowMs: number) => {
    if (!W || !H || !ctx || !outer || !mid) return;
    const p = reduced ? 0 : progress;
    const secs = reduced ? 0 : (nowMs - born) / 1000;
    drawnP = progress;
    lastDraw = nowMs;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const gone = smooth(0.7, GONE, p);
    if (gone >= 1) return;

    /* the network assembles on load: nodes start loose and settle onto the shell */
    const intro = reduced ? 1 : 1 - Math.pow(1 - clamp01(secs / 2.1), 3);
    const loose = (1 - intro) * (1 - intro);

    /* pointer lean, eased */
    curX += (ptrX - curX) * 0.06;
    curY += (ptrY - curY) * 0.06;

    /* the camera: dollies toward the dot, patient at first so the shell is seen coming, then through it and into the core */
    const x = clamp01(p / 0.85);
    const u = 0.3 * x + 0.7 * (x * x * (3 - 2 * x));
    const cz = CZ0 * Math.pow(CZ1 / CZ0, u);
    const sep = smooth(0.05, 0.8, p) * 0.95 + loose * 0.7;
    const privateTint = smooth(0.12, 0.8, p);

    const yaw = secs * 0.075 + p * 2.1 + 0.55 + curX * 0.2;
    const pitch = 0.34 - p * 0.3 + curY * 0.12;
    const roll = 0.16 + p * 0.1;
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);

    const f = focal;
    const fade = (1 - gone) * (reduced ? 1 : 0.35 + 0.65 * intro);

    const rotate = (vx: number, vy: number, vz: number, o: Vec) => {
      const x1 = vx * cyw + vz * syw;
      const z1 = -vx * syw + vz * cyw;
      const y2 = vy * cp - z1 * sp;
      const z2 = vy * sp + z1 * cp;
      o[0] = x1 * cr - y2 * sr;
      o[1] = x1 * sr + y2 * cr;
      o[2] = z2;
    };

    /* ---- place a mesh layer: rotate, push outward by the loosening, project */
    const place = (L: Layer, radius: number, sepAmt: number, sepVar: number) => {
      const { n, base, seed, rx, ry, rz, sx, sy, near, cue } = L;
      for (let i = 0; i < n; i++) {
        const r = radius * (1 + sepAmt * (0.22 + sepVar * seed[i]));
        rotate(base[i * 3] * r, base[i * 3 + 1] * r, base[i * 3 + 2] * r, tmp);
        rx[i] = tmp[0];
        ry[i] = tmp[1];
        rz[i] = tmp[2];
        const d = cz - tmp[2];
        if (d < 0.28) {
          sx[i] = NaN;
          sy[i] = NaN;
          near[i] = 0;
          continue;
        }
        const k = f / d;
        sx[i] = cx + tmp[0] * k;
        sy[i] = cy - tmp[1] * k;
        near[i] = smooth(0.28, 1.15, d);
        /* seen from outside the far side of the shell is faint (it gives volume); from inside, what is far is
           simply the other side of the room, so the cue also follows the distance to the camera */
        cue[i] = Math.max(clamp01((tmp[2] / radius + 1.2) / 2.4), (1 - smooth(0.8, 3.6, d)) * 0.8);
      }
    };

    /* ---- give every edge an alpha level and a side */
    const grade = (L: Layer, aMax: number, k: number) => {
      const { edges, rest, rx, ry, rz, sx, sy, near, cue, lv, fr } = L;
      const ec = edges.length / 2;
      for (let e = 0; e < ec; e++) {
        const a = edges[e * 2];
        const b = edges[e * 2 + 1];
        lv[e] = -1;
        if (sx[a] !== sx[a] || sx[b] !== sx[b]) continue;
        const nz = Math.min(near[a], near[b]);
        if (nz <= 0.02) continue;
        const dx = rx[a] - rx[b];
        const dy = ry[a] - ry[b];
        const dz = rz[a] - rz[b];
        const ratio = Math.sqrt(dx * dx + dy * dy + dz * dz) / (rest[e] * (L === mid ? MID_R : 1));
        const stretch = 1 - smooth(1.25, 2.6, ratio);
        if (stretch <= 0.02) continue;
        const depth = (cue[a] + cue[b]) * 0.5;
        const al = (0.07 + 0.93 * depth * depth) * aMax * nz * stretch * k;
        if (al < 0.012) continue;
        lv[e] = Math.min(LEVELS - 1, Math.floor((al / aMax) * LEVELS));
        fr[e] = rz[a] + rz[b] > 0 ? 1 : 0;
      }
    };

    /* ---- stroke one side of a layer's edges, a few strokes in all */
    const strokeEdges = (L: Layer, side: 0 | 1 | 2, r: number, g: number, b: number, aMax: number, lw: number) => {
      const { edges, lv, fr, sx, sy, seg } = L;
      const ec = edges.length / 2;
      segN.fill(0);
      for (let e = 0; e < ec; e++) {
        const l = lv[e];
        if (l < 0) continue;
        if (side !== 2 && fr[e] !== side) continue;
        const o = (l * ec + segN[l]) * 4;
        const a = edges[e * 2];
        const bb = edges[e * 2 + 1];
        seg[o] = sx[a];
        seg[o + 1] = sy[a];
        seg[o + 2] = sx[bb];
        seg[o + 3] = sy[bb];
        segN[l]++;
      }
      ctx.lineCap = "round";
      for (let l = 0; l < LEVELS; l++) {
        const c = segN[l];
        if (!c) continue;
        ctx.strokeStyle = `rgba(${r},${g},${b},${(((l + 0.5) / LEVELS) * aMax).toFixed(3)})`;
        ctx.lineWidth = l > LEVELS - 4 ? lw * 1.2 : lw;
        ctx.beginPath();
        const o = l * ec * 4;
        for (let j = 0; j < c; j++) {
          ctx.moveTo(seg[o + j * 4], seg[o + j * 4 + 1]);
          ctx.lineTo(seg[o + j * 4 + 2], seg[o + j * 4 + 3]);
        }
        ctx.stroke();
      }
    };

    /* ---- nodes: tiny squares, four depth levels, one side of the shell */
    const drawNodes = (L: Layer, side: 0 | 1 | 2, r: number, g: number, b: number, aScale: number, size: number) => {
      const { n, sx, sy, rz, cue, near, bandIdx } = L;
      const cnt = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        if (sx[i] !== sx[i]) continue;
        if (side !== 2 && (rz[i] > 0 ? 1 : 0) !== side) continue;
        const band = Math.min(3, Math.floor(cue[i] * 4));
        bandIdx[band * n + cnt[band]++] = i;
      }
      for (let band = 0; band < 4; band++) {
        if (!cnt[band]) continue;
        ctx.fillStyle = `rgba(${r},${g},${b},${((0.12 + band * 0.16) * aScale).toFixed(3)})`;
        ctx.beginPath();
        for (let j = 0; j < cnt[band]; j++) {
          const i = bandIdx[band * n + j];
          const s = (size + band * 0.4) * clamp01(near[i] * 1.4) * Math.min(2.2, Math.max(0.7, CZ0 / (cz - rz[i])));
          if (s < 0.3) continue;
          ctx.rect(sx[i] - s / 2, sy[i] - s / 2, s, s);
        }
        ctx.fill();
      }
    };

    /* the line colour: charcoal, picking up poppy as the camera enters the private side */
    const lr = Math.round(lerp(CHARCOAL[0], POPPY[0], privateTint * 0.75));
    const lg = Math.round(lerp(CHARCOAL[1], POPPY[1], privateTint * 0.75));
    const lb = Math.round(lerp(CHARCOAL[2], POPPY[2], privateTint * 0.75));

    place(outer, 1, sep, 1.15);
    place(mid, MID_R, sep * 0.55, 0.6);
    grade(outer, A_OUT, fade);
    grade(mid, A_MID, fade * (1 - smooth(0.5, 0.9, p)));

    /* ---- the orbits, placed now so their far halves can go behind the veil */
    const ringGrow = 1 + smooth(0.05, 0.8, p) * 0.7;
    const ringA = (1 - smooth(0.55, GONE, p)) * fade;
    const ringSpin: number[] = [];
    for (let ri = 0; ri < RINGS.length; ri++) {
      const rg = RINGS[ri];
      const pts = ringPts[ri];
      const spin = secs * rg.speed + p * (ri ? -1.1 : 1.3);
      ringSpin.push(spin);
      const cs = Math.cos(spin);
      const ss = Math.sin(spin);
      const rr = rg.r * ringGrow;
      const front = ringFront[ri];
      const back = ringBack[ri];
      front.length = 0;
      back.length = 0;
      for (let i = 0; i < RING_SEGS; i++) {
        ringOk[i] = 0;
        const ix = pts[i * 3];
        const iy = pts[i * 3 + 1];
        const iz = pts[i * 3 + 2];
        rotate((ix * cs - iz * ss) * rr, iy * rr, (ix * ss + iz * cs) * rr, tmp);
        const d = cz - tmp[2];
        if (d < 0.28) continue;
        const k = f / d;
        ringX[i] = cx + tmp[0] * k;
        ringY[i] = cy - tmp[1] * k;
        ringZ[i] = tmp[2];
        ringOk[i] = 1;
      }
      for (let i = 0; i < RING_SEGS; i++) {
        const j = (i + 1) % RING_SEGS;
        if (!ringOk[i] || !ringOk[j]) continue;
        (ringZ[i] + ringZ[j] > 0 ? front : back).push(ringX[i], ringY[i], ringX[j], ringY[j]);
      }
    }
    const strokeRing = (arr: number[], a: number) => {
      if (!arr.length) return;
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},${a.toFixed(3)})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let j = 0; j < arr.length; j += 4) {
        ctx.moveTo(arr[j], arr[j + 1]);
        ctx.lineTo(arr[j + 2], arr[j + 3]);
      }
      ctx.stroke();
    };

    /* Three integrated session rails outline the stacked sculpture: pre/extended, regular, close. */
    const laneScale = 1 + sep * 0.42;
    for (let ri = 0; ri < SESSION_LANES.length; ri++) {
      const lane = SESSION_LANES[ri];
      const front = laneFront[ri];
      const back = laneBack[ri];
      front.length = 0;
      back.length = 0;
      const ct = Math.cos(lane.tilt), st = Math.sin(lane.tilt);
      for (let i = 0; i < RING_SEGS; i++) {
        const a = (i / RING_SEGS) * Math.PI * 2;
        const x0 = Math.cos(a) * lane.rx;
        const z0 = Math.sin(a) * lane.rz;
        const y1 = lane.y * ct - z0 * st;
        const z1 = lane.y * st + z0 * ct;
        rotate(x0 * laneScale, y1 * laneScale, z1 * laneScale, tmp);
        const currentDepth = tmp[2];
        const d = cz - tmp[2];
        if (d < 0.28) continue;
        const k = f / d;
        const px = cx + tmp[0] * k;
        const py = cy - tmp[1] * k;
        const next = (i + 1) % RING_SEGS;
        const na = (next / RING_SEGS) * Math.PI * 2;
        const nx0 = Math.cos(na) * lane.rx;
        const nz0 = Math.sin(na) * lane.rz;
        const ny1 = lane.y * ct - nz0 * st;
        const nz1 = lane.y * st + nz0 * ct;
        rotate(nx0 * laneScale, ny1 * laneScale, nz1 * laneScale, tmp);
        const nd = cz - tmp[2];
        if (nd < 0.28) continue;
        const nk = f / nd;
        const nx = cx + tmp[0] * nk;
        const ny = cy - tmp[1] * nk;
        (currentDepth + tmp[2] > 0 ? front : back).push(px, py, nx, ny);
      }
    }
    const strokeLane = (arr: number[], alpha: number, width: number) => {
      if (!arr.length) return;
      ctx.strokeStyle = `rgba(${CHARCOAL[0]},${CHARCOAL[1]},${CHARCOAL[2]},${(alpha * fade).toFixed(3)})`;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 4) {
        ctx.moveTo(arr[i], arr[i + 1]);
        ctx.lineTo(arr[i + 2], arr[i + 3]);
      }
      ctx.stroke();
    };

    /* ===== 1. dust: a few specks of the cloud, far behind everything ===== */
    {
      const dustA = fade * (0.6 + 0.4 * smooth(0, 0.5, p));
      ctx.fillStyle = `rgba(${lr},${lg},${lb},${(0.34 * dustA).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < dustN; i++) {
        const r = 1 + sep * 0.5;
        rotate(dust[i * 4] * r, dust[i * 4 + 1] * r, dust[i * 4 + 2] * r, tmp);
        const d = cz - tmp[2];
        if (d < 0.4) continue;
        const k = f / d;
        const s = (0.9 + dust[i * 4 + 3] * 1.1) * Math.min(2.4, CZ0 / d) * smooth(0.4, 1.4, d);
        ctx.rect(cx + tmp[0] * k - s / 2, cy - tmp[1] * k - s / 2, s, s);
      }
      ctx.fill();
    }

    /* ===== 2. the far side of the outer mesh, and the far half of the orbits ===== */
    strokeEdges(outer, 0, lr, lg, lb, A_OUT, 0.62);
    drawNodes(outer, 0, CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], fade, 1.1);
    for (let ri = 0; ri < RINGS.length; ri++) strokeRing(ringBack[ri], 0.1 * ringA);
    for (let ri = 0; ri < SESSION_LANES.length; ri++) strokeLane(laneBack[ri], 0.34, 1.1);

    /* ===== 3. the second shell, softer and poppy-tinted ===== */
    strokeEdges(mid, 2, POPPY[0], POPPY[1], POPPY[2], A_MID, 0.6);
    drawNodes(mid, 2, POPPY[0], POPPY[1], POPPY[2], fade * (1 - smooth(0.5, 0.9, p)) * 1.1, 1.3);

    /* ===== 4. the core: the sealed value's own lattice, counter-turning, rising as the camera arrives ===== */
    const coreR = 0.5 + smooth(0, 0.7, p) * 0.2;
    const coreA = (0.55 + 0.45 * smooth(0.02, 0.5, p)) * (1 - smooth(0.62, GONE, p)) * (reduced ? 1 : 0.2 + 0.8 * intro);
    if (coreA > 0.02) {
      const turn = -secs * 0.2 - p * 2.6;
      const ct = Math.cos(turn);
      const st = Math.sin(turn);
      for (let i = 0; i < ICO.length; i++) {
        const v = ICO[i];
        rotate((v[0] * ct + v[2] * st) * coreR, v[1] * coreR, (-v[0] * st + v[2] * ct) * coreR, tmp);
        const d = cz - tmp[2];
        coreOk[i] = d >= 0.18 ? 1 : 0;
        const k = f / Math.max(d, 0.18);
        coreX[i] = cx + tmp[0] * k;
        coreY[i] = cy - tmp[1] * k;
        coreZ[i] = tmp[2];
      }
      ctx.lineWidth = 0.9;
      for (const [a, b] of ICO_EDGES) {
        if (!coreOk[a] || !coreOk[b]) continue;
        const depth = clamp01(((coreZ[a] + coreZ[b]) * 0.5 + coreR) / (2 * coreR));
        ctx.strokeStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${((0.45 + 0.5 * depth) * coreA).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(coreX[a], coreY[a]);
        ctx.lineTo(coreX[b], coreY[b]);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${(0.85 * coreA).toFixed(3)})`;
      for (let i = 0; i < ICO.length; i++) {
        if (!coreOk[i]) continue;
        ctx.fillRect(coreX[i] - 1.3, coreY[i] - 1.3, 2.6, 2.6);
      }
      /* the small octahedron, turning the other way */
      const octR = coreR * 0.46;
      const t2 = secs * 0.31 + p * 3.4;
      const c2 = Math.cos(t2);
      const s2 = Math.sin(t2);
      for (let i = 0; i < OCT.length; i++) {
        const v = OCT[i];
        rotate((v[0] * c2 + v[2] * s2) * octR, (v[1] * c2 - v[0] * s2 * 0.4) * octR, (-v[0] * s2 + v[2] * c2) * octR, tmp);
        const d = cz - tmp[2];
        octOk[i] = d >= 0.18 ? 1 : 0;
        const k = f / Math.max(d, 0.18);
        octX[i] = cx + tmp[0] * k;
        octY[i] = cy - tmp[1] * k;
        octZ[i] = tmp[2];
      }
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${(0.6 * coreA).toFixed(3)})`;
      ctx.beginPath();
      for (const [a, b] of OCT_EDGES) {
        if (!octOk[a] || !octOk[b]) continue;
        ctx.moveTo(octX[a], octY[a]);
        ctx.lineTo(octX[b], octY[b]);
      }
      ctx.stroke();

    }

    /* ===== 5. the veil: everything drawn so far is behind the near side of the shell ===== */
    const veil = (1 - smooth(0.02, 0.3, p)) * fade * 0.28;
    if (veil > 0.01 && cz > 1.2) {
      const rs = f / Math.sqrt(cz * cz - 1);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rs * 1.02);
      g.addColorStop(0, `rgba(238,236,229,${veil.toFixed(3)})`);
      g.addColorStop(0.72, `rgba(238,236,229,${(veil * 0.82).toFixed(3)})`);
      g.addColorStop(1, "rgba(238,236,229,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rs * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ===== 6. the near side: crisp, over the veil ===== */
    strokeEdges(outer, 1, lr, lg, lb, A_OUT, 0.7);
    drawNodes(outer, 1, CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], fade, 1.2);
    for (let ri = 0; ri < RINGS.length; ri++) strokeRing(ringFront[ri], 0.34 * ringA);
    for (let ri = 0; ri < SESSION_LANES.length; ri++) strokeLane(laneFront[ri], 0.92, 1.8);

    /* Clock hands ride the three existing session lanes; no additional dial geometry is drawn. */
    const drawClock = () => {
      const clockA = fade;
      if (clockA <= 0.02) return;
      const clockTint = smooth(0.08, 0.48, p);
      const clockR = Math.round(lerp(CHARCOAL[0], POPPY[0], clockTint));
      const clockG = Math.round(lerp(CHARCOAL[1], POPPY[1], clockTint));
      const clockB = Math.round(lerp(CHARCOAL[2], POPPY[2], clockTint));

      ctx.lineCap = "round";
      for (let ringIndex = 0; ringIndex < SESSION_LANES.length; ringIndex++) {
        const clockLane = SESSION_LANES[ringIndex];
        const laneCt = Math.cos(clockLane.tilt);
        const laneSt = Math.sin(clockLane.tilt);
        const projectClockPoint = (angle: number, radius: number, out: Float32Array) => {
          const z = Math.sin(angle) * clockLane.rz * radius;
          rotate(
            Math.cos(angle) * clockLane.rx * radius * laneScale,
            (clockLane.y * laneCt - z * laneSt) * laneScale,
            (clockLane.y * laneSt + z * laneCt) * laneScale,
            tmp,
          );
          const depth = cz - tmp[2];
          if (depth < 0.28) return false;
          const projection = f / depth;
          out[0] = cx + tmp[0] * projection;
          out[1] = cy - tmp[1] * projection;
          out[2] = tmp[2];
          return true;
        };

        if (!projectClockPoint(0, 0, clockStart)) continue;
        const frontSegments = laneFront[ringIndex];
        const backSegments = laneBack[ringIndex];
        let sumX = 0;
        let sumY = 0;
        let pointCount = 0;
        for (let i = 0; i < frontSegments.length; i += 4) {
          sumX += frontSegments[i] + frontSegments[i + 2];
          sumY += frontSegments[i + 1] + frontSegments[i + 3];
          pointCount += 2;
        }
        for (let i = 0; i < backSegments.length; i += 4) {
          sumX += backSegments[i] + backSegments[i + 2];
          sumY += backSegments[i + 1] + backSegments[i + 3];
          pointCount += 2;
        }
        const handPivotX = pointCount ? sumX / pointCount : clockStart[0];
        const handPivotY = pointCount ? sumY / pointCount : clockStart[1];
        if (ringIndex === 1) {
          openingX = handPivotX;
          openingY = handPivotY;
        }
        const ringWeight = ringIndex === 1 ? 1 : 0.62;
        const surfaceOpacity = (z: number) => clockA * ringWeight * lerp(0.34, 0.92, smooth(-0.08, 0.08, z));
        const handPivotAlpha = surfaceOpacity(clockStart[2]);

        /* Keep ticks on the main lane only; the two supporting lanes stay visually quiet. */
        if (ringIndex === 1) {
          ctx.lineWidth = 1.5;
          for (let i = 0; i < 4; i++) {
            const tickAngle = (i / 4) * Math.PI * 2;
            if (!projectClockPoint(tickAngle, 0.94, clockStart) || !projectClockPoint(tickAngle, 1, clockEnd)) continue;
            const tickAlpha = surfaceOpacity((clockStart[2] + clockEnd[2]) * 0.5) * 0.78;
            ctx.strokeStyle = `rgba(${clockR},${clockG},${clockB},${tickAlpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(clockStart[0], clockStart[1]);
            ctx.lineTo(clockEnd[0], clockEnd[1]);
            ctx.stroke();
          }
        }

        for (const hand of CLOCK_HANDS) {
          const angle = -Math.PI * 0.5 + (ringIndex - 1) * 0.62 + hand.offset + secs * hand.speed + p * hand.scroll;
          if (!projectClockPoint(angle, hand.length, clockEnd)) continue;
          ctx.lineWidth = hand.width * (ringIndex === 1 ? 1 : 0.76);
          const handGradient = ctx.createLinearGradient(handPivotX, handPivotY, clockEnd[0], clockEnd[1]);
          handGradient.addColorStop(0, `rgba(${clockR},${clockG},${clockB},${(handPivotAlpha * hand.alpha).toFixed(3)})`);
          handGradient.addColorStop(1, `rgba(${clockR},${clockG},${clockB},${(surfaceOpacity(clockEnd[2]) * hand.alpha).toFixed(3)})`);
          ctx.strokeStyle = handGradient;
          ctx.beginPath();
          ctx.moveTo(handPivotX, handPivotY);
          ctx.lineTo(clockEnd[0], clockEnd[1]);
          ctx.stroke();
        }

        ctx.fillStyle = `rgba(${clockR},${clockG},${clockB},${handPivotAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(handPivotX, handPivotY, ringIndex === 1 ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    /* verified nodes and their hex labels */
    {
      const labelOn = (1 - smooth(0.0, 0.32, p)) * fade;
      const { sx, sy, cue, near } = outer;
      ctx.font = `500 ${Math.max(9, Math.round(R * 0.026))}px ${fontFamily}`;
      ctx.textBaseline = "alphabetic";
      for (let k = 0; k < verified.length; k++) {
        const i = verified[k];
        const px = sx[i];
        if (px !== px) continue;
        const depth = cue[i];
        const al = (0.25 + 0.75 * depth) * near[i] * fade;
        if (al < 0.03) continue;
        const s = 2.6 + depth * 2;
        ctx.fillStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${(al * 0.95).toFixed(3)})`;
        ctx.fillRect(px - s / 2, sy[i] - s / 2, s, s);
        if (labelOn > 0.02 && depth > 0.58 && k % 2 === 0) {
          ctx.fillStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${(al * labelOn * 0.9).toFixed(3)})`;
          ctx.fillText(labelOf[k], px + s + 3, sy[i] - 3);
        }
      }
    }

    /* proofs on the shell: a bright head runs along each arc (they belong to the public network, so they
       leave as it loosens) */
    {
      const arcLife = (1 - smooth(0.0, 0.3, p)) * fade * intro * intro * (reduced ? 0.6 : 1);
      if (arcLife > 0.02) {
        const w = reduced ? 0 : secs;
        for (const arc of arcs) {
          const head = (((w + arc.phase) / arc.period) % 1) * 1.45 - 0.2;
          let prevX = 0;
          let prevY = 0;
          let prevOk = false;
          let prevZ = 0;
          for (let j = 0; j < ARC_PTS; j++) {
            rotate(arc.pts[j * 3], arc.pts[j * 3 + 1], arc.pts[j * 3 + 2], tmp);
            const d = cz - tmp[2];
            if (d < 0.28) {
              prevOk = false;
              continue;
            }
            const k = f / d;
            const px = cx + tmp[0] * k;
            const py = cy - tmp[1] * k;
            if (prevOk) {
              const uu = (j - 0.5) / (ARC_PTS - 1);
              const depth = clamp01(((tmp[2] + prevZ) * 0.5 + 1.3) / 2.6);
              const dist = head - uu;
              const glow = dist >= 0 && dist < 0.3 ? 1 - dist / 0.3 : 0;
              const al = (0.12 + 0.88 * depth * depth) * arcLife;
              if (glow > 0) {
                ctx.strokeStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${Math.min(1, al * (0.4 + 1.1 * glow)).toFixed(3)})`;
                ctx.lineWidth = 1 + glow * 0.8;
              } else {
                ctx.strokeStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${(al * 0.26).toFixed(3)})`;
                ctx.lineWidth = 0.7;
              }
              ctx.beginPath();
              ctx.moveTo(prevX, prevY);
              ctx.lineTo(px, py);
              ctx.stroke();
            }
            prevX = px;
            prevY = py;
            prevZ = tmp[2];
            prevOk = true;
          }
        }
      }
    }

    /* the nodes that ride the orbits, with a short trail */
    for (let ri = 0; ri < RINGS.length; ri++) {
      const rg = RINGS[ri];
      const spin = ringSpin[ri];
      const cs = Math.cos(spin);
      const ss = Math.sin(spin);
      const rr = rg.r * ringGrow;
      const ct = Math.cos(rg.tilt);
      const st = Math.sin(rg.tilt);
      const cl = Math.cos(rg.lean);
      const sl = Math.sin(rg.lean);
      for (let m = 0; m < rg.riders; m++) {
        const baseA = secs * rg.speed * 1.7 + m * Math.PI + ri * 1.7;
        for (let tr = 0; tr < 4; tr++) {
          const a = baseA - tr * 0.07 * Math.sign(rg.speed);
          const x0 = Math.cos(a);
          const y0 = Math.sin(a);
          const y1 = y0 * ct;
          const z1 = y0 * st;
          const ix = x0 * cl - y1 * sl;
          const iy = x0 * sl + y1 * cl;
          rotate((ix * cs - z1 * ss) * rr, iy * rr, (ix * ss + z1 * cs) * rr, tmp);
          const d = cz - tmp[2];
          if (d < 0.28) continue;
          const k = f / d;
          const depth = clamp01((tmp[2] + 1.8) / 3.6);
          const s = (tr === 0 ? 4 : 3 - tr * 0.5) * (0.7 + 0.5 * depth);
          ctx.fillStyle = `rgba(${POPPY[0]},${POPPY[1]},${POPPY[2]},${((tr === 0 ? 0.95 : 0.4 / tr) * ringA * (0.4 + 0.6 * depth)).toFixed(3)})`;
          ctx.fillRect(cx + tmp[0] * k - s / 2, cy - tmp[1] * k - s / 2, s, s);
        }
      }
    }

    /* ===== 7. edges of the stage: dissolve under the nav and above the marquee; a soft clearing behind the words ===== */
    ctx.globalCompositeOperation = "destination-out";
    if (fadeTop && fadeBottom) {
      ctx.fillStyle = fadeTop;
      ctx.fillRect(0, 0, W, NAV_FADE);
      ctx.fillStyle = fadeBottom;
      ctx.fillRect(0, H - FOOT_FADE, W, FOOT_FADE);
    }
    const clearA = 1 - smooth(0.1, 0.42, p);
    if (clearGrad && clearA > 0.01) {
      ctx.save();
      ctx.globalAlpha = clearA;
      ctx.translate(clearBox.x, clearBox.y);
      ctx.scale(1, clearBox.ry / clearBox.rx);
      ctx.fillStyle = clearGrad;
      ctx.fillRect(-clearBox.rx, -clearBox.rx, clearBox.rx * 2, clearBox.rx * 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";

    /* The clock is the final surface pass, so the cover's text clearing cannot erase it. */
    drawClock();

    if (!ready) {
      ready = true;
      canvas.dataset.ready = "1";
    }
  };

  /* ------------------------------------------------------------------ loop */
  const frame = (ts: number) => {
    raf = 0;
    if (!running) return;
    const moving = Math.abs(progress - drawnP) > 1e-4;
    if (moving || ts - lastDraw >= 32) draw(ts);
    raf = requestAnimationFrame(frame);
  };
  const wantRunning = () => !dead && !reduced && progress < GONE && !document.hidden && W > 0;
  const sync = () => {
    const should = wantRunning();
    if (should && !running) {
      running = true;
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (progress >= GONE && ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawnP = progress;
      }
    }
  };

  /* ------------------------------------------------------------------ public */
  const resize = (slot: HTMLElement) => {
    if (dead) return;
    slotEl = slot;
    const cr = canvas.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    if (!cr.width || !cr.height) return;
    W = cr.width;
    H = cr.height;
    const want = window.devicePixelRatio || 1;
    dpr = Math.max(1, Math.min(want, 1.5, Math.sqrt(AREA_BUDGET / (W * H))));
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    const narrow = W <= 860;
    /* Keep the session instrument in its own right-hand field; the opening copy
       no longer sits over its center as it did in the reference composition. */
    cx = narrow ? W * 0.74 : W * 0.75;
    cy = H * (narrow ? 0.52 : 0.5);
    openingX = cx;
    openingY = cy;
    R = narrow ? Math.min(W * 0.34, H * 0.34) : Math.min(W * 0.29, H * 0.42);
    focal = R * Math.sqrt(CZ0 * CZ0 - 1);
    fadeTop = ctx.createLinearGradient(0, 0, 0, NAV_FADE);
    fadeTop.addColorStop(0, "rgba(0,0,0,1)");
    fadeTop.addColorStop(0.55, "rgba(0,0,0,0.85)");
    fadeTop.addColorStop(1, "rgba(0,0,0,0)");
    fadeBottom = ctx.createLinearGradient(0, H - FOOT_FADE, 0, H);
    fadeBottom.addColorStop(0, "rgba(0,0,0,0)");
    fadeBottom.addColorStop(0.55, "rgba(0,0,0,0.8)");
    fadeBottom.addColorStop(1, "rgba(0,0,0,1)");

    /* the words: the headline and the line under it. The mesh is thinned out behind them, soft at the edges. */
    const words = slot.parentElement;
    const sub = words?.parentElement?.querySelector<HTMLElement>(".lp-sub") ?? null;
    const rects = [words, sub].filter((el): el is HTMLElement => !!el).map((el) => el.getBoundingClientRect());
    if (rects.length) {
      const x0 = Math.min(...rects.map((r) => r.left)) - cr.left;
      const x1 = Math.max(...rects.map((r) => r.right)) - cr.left;
      const y0 = Math.min(...rects.map((r) => r.top)) - cr.top;
      const y1 = Math.max(...rects.map((r) => r.bottom)) - cr.top;
      const rx = ((x1 - x0) / 2) * 1.06 + 40;
      const ry = ((y1 - y0) / 2) * 1.2 + 28;
      clearBox = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx, ry };
      clearGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      /* Keep this new three-lane sculpture continuous behind the heading; only soften the mesh slightly. */
      clearGrad.addColorStop(0, "rgba(0,0,0,0.12)");
      clearGrad.addColorStop(0.5, "rgba(0,0,0,0.08)");
      clearGrad.addColorStop(0.82, "rgba(0,0,0,0.04)");
      clearGrad.addColorStop(1, "rgba(0,0,0,0)");
    } else {
      clearGrad = null;
    }

    build(W < 700 ? 640 : 1200);
    readFont();
    drawnP = -1;
    if (!ready) born = performance.now();
    /* Publish the rendered clock hub before the cover measures its opening origin. */
    draw(performance.now());
    sync();
  };

  const setProgress = (p: number) => {
    if (dead) return;
    progress = clamp01(p);
    sync();
    /* drawn here too, in the same frame as the plates, so the two never disagree by a frame */
    if (running && Math.abs(progress - drawnP) > 1e-4) {
      const now = performance.now();
      if (now - lastDraw > 2) draw(now);
    }
  };

  const setReduced = (r: boolean) => {
    if (dead || r === reduced) return;
    reduced = r;
    drawnP = -1;
    sync();
    if (reduced && W) draw(performance.now());
  };

  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !W) return;
    ptrX = (e.clientX / window.innerWidth - 0.5) * 2;
    ptrY = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  const onVis = () => {
    if (!dead) sync();
  };
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("visibilitychange", onVis);
  let cancelled = false;
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      if (cancelled || dead) return;
      readFont();
      if (slotEl && !running && W && progress < GONE) draw(performance.now());
    });
  }
  born = performance.now();

  const destroy = () => {
    cancelled = true;
    dead = true;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("visibilitychange", onVis);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return {
    resize,
    getOpeningPoint: () => ({ x: openingX, y: openingY }),
    setProgress,
    setReduced,
    destroy,
  };
}
