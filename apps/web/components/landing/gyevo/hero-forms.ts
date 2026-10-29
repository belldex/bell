/* BELL's two terminal glyph sculptures. The shared canvas renderer owns the point sprites,
   perspective, scroll morph and reduced-motion behavior; this file defines only the forms:
   a market-flow gate, then a finite close anchor. */

type V3 = [number, number, number];
type Stroke = { points: V3[]; tone: number; weight?: number; pulse?: boolean };

export interface HeroForm {
  pos(i: number, t: number, out: Float32Array): void;
  pal(i: number, t: number): number;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function measurePath(points: V3[]) {
  const cumulative = new Float32Array(points.length - 1);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
    cumulative[i - 1] = total;
  }
  return { cumulative, total };
}

function samplePath(points: V3[], cumulative: Float32Array, total: number, u: number, out: Float32Array) {
  const at = clamp01(u) * total;
  let segment = 0;
  while (segment < cumulative.length - 1 && at > cumulative[segment]) segment++;
  const from = segment === 0 ? 0 : cumulative[segment - 1];
  const span = Math.max(1e-5, cumulative[segment] - from);
  const k = (at - from) / span;
  const a = points[segment], b = points[segment + 1];
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
}

function loop(rx: number, ry: number, z: number, y = 0): V3[] {
  return Array.from({ length: 9 }, (_, i) => {
    const a = (i / 8) * TAU;
    const bevel = i % 2 ? 0.92 : 1;
    return [Math.cos(a) * rx * bevel, y + Math.sin(a) * ry * bevel, z];
  });
}

function line(a: V3, b: V3): V3[] { return [a, b]; }

function sculpt(count: number, strokes: Stroke[], rotate: number): HeroForm {
  const measured = strokes.map((s) => measurePath(s.points));
  const lengths = strokes.map((s, i) => Math.max(0.04, measured[i].total * (s.weight ?? 1)));
  const total = lengths.reduce((a, b) => a + b, 0);
  const raw = lengths.map((v) => (v / total) * count);
  const amounts = raw.map(Math.floor);
  const remainder = count - amounts.reduce((a, b) => a + b, 0);
  raw.map((n, i) => [n - Math.floor(n), i] as const).sort((a, b) => b[0] - a[0]).slice(0, remainder).forEach(([, i]) => amounts[i]++);

  const base = new Float32Array(count * 3);
  const pathId = new Uint8Array(count);
  const pathU = new Float32Array(count);
  let cursor = 0;
  for (let s = 0; s < strokes.length; s++) {
    for (let j = 0; j < amounts[s]; j++) {
      const i = cursor++;
      const u = (j + 0.5 + (rnd(i * 3.17 + 9) - 0.5) * 0.36) / amounts[s];
      const point = new Float32Array(3);
      samplePath(strokes[s].points, measured[s].cumulative, measured[s].total, u, point);
      const wiggle = (rnd(i * 5.3 + 4) - 0.5) * 0.009;
      base[i * 3] = point[0] + wiggle;
      base[i * 3 + 1] = point[1] - wiggle;
      base[i * 3 + 2] = point[2] + wiggle;
      pathId[i] = s;
      pathU[i] = u;
    }
  }

  const tone = new Uint8Array(count);
  const pulse = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    tone[i] = strokes[pathId[i]].tone;
    pulse[i] = strokes[pathId[i]].pulse ? 1 : 0;
  }

  return {
    pos(i, t, out) {
      const pulseScale = pulse[i] ? 1 + Math.sin(t * 2.6 - pathU[i] * 11) * 0.035 : 1;
      const x = base[i * 3] * pulseScale;
      const y = base[i * 3 + 1] * pulseScale;
      const z = base[i * 3 + 2] * pulseScale;
      const yaw = t * rotate;
      const pitch = Math.sin(t * 0.24) * 0.08;
      const xx = x * Math.cos(yaw) - z * Math.sin(yaw);
      const zz = x * Math.sin(yaw) + z * Math.cos(yaw);
      out[0] = xx;
      out[1] = y * Math.cos(pitch) - zz * Math.sin(pitch);
      out[2] = y * Math.sin(pitch) + zz * Math.cos(pitch);
    },
    pal(i, t) {
      if (pulse[i] && Math.sin(t * 2.6 - pathU[i] * 11) > 0.93) return 4;
      return tone[i];
    },
  };
}

/* A sculpted flow gate: the market stream enters a wide chamber, narrows through a guarded
   throat, then opens into the pool. Front/back frames and depth rails make it read as a volume. */
export function buildBoundedGate(count: number): HeroForm {
  const back = loop(0.96, 0.78, -0.58);
  const throat = loop(0.48, 0.42, 0);
  const front = loop(0.96, 0.78, 0.58);
  const strokes: Stroke[] = [
    { points: back, tone: 1, weight: 1.15 },
    { points: throat, tone: 0, weight: 0.8 },
    { points: front, tone: 0, weight: 1.2 },
  ];
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8;
    strokes.push({ points: line(back[i], throat[i]), tone: 2, weight: 0.75 });
    strokes.push({ points: line(throat[i], front[i]), tone: i % 2 ? 1 : 2, weight: 0.75 });
    if (i % 2 === 0) strokes.push({ points: line(front[i], front[next]), tone: 4, weight: 0.4 });
  }
  for (const y of [-0.16, 0.16]) {
    strokes.push({ points: [[-0.9, y, -0.72], [-0.58, y, -0.34], [-0.36, y, 0], [-0.58, y, 0.34], [-0.9, y, 0.72]], tone: 4, pulse: true, weight: 1.3 });
    strokes.push({ points: [[0.9, y, -0.72], [0.58, y, -0.34], [0.36, y, 0], [0.58, y, 0.34], [0.9, y, 0.72]], tone: 1, weight: 1.1 });
  }
  /* Limit bars across the throat are the visible guard, not a decorative free-floating cube. */
  for (const x of [-0.31, 0, 0.31]) strokes.push({ points: line([x, -0.39, 0.04], [x, 0.39, 0.04]), tone: 3, weight: 0.6 });
  strokes.push({ points: [[-0.75, -0.98, 0.66], [0, -0.98, 0.7], [0.75, -0.98, 0.66]], tone: 1, weight: 0.85 });
  strokes.push({ points: line([0.22, -1.05, 0.69], [0.22, -0.9, 0.69]), tone: 4, weight: 0.32 });
  return sculpt(count, strokes, 0.12);
}

/* The planned-close anchor: a clock capsule with indexed ticks, a moving hand, and a hard
   finite-budget rail. This gives the final story form a compact silhouette unlike the gate. */
export function buildCloseAnchor(count: number): HeroForm {
  const strokes: Stroke[] = [
    { points: loop(0.7, 0.7, -0.14), tone: 2, weight: 1.1 },
    { points: loop(0.58, 0.58, 0.14), tone: 0, weight: 1.2 },
    { points: loop(0.48, 0.48, 0.19), tone: 1, weight: 1 },
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const outer: V3 = [Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0.2];
    const inner: V3 = [Math.cos(a) * (i % 3 === 0 ? 0.52 : 0.58), Math.sin(a) * (i % 3 === 0 ? 0.52 : 0.58), 0.2];
    strokes.push({ points: line(outer, inner), tone: i % 3 === 0 ? 4 : 2, weight: i % 3 === 0 ? 0.7 : 0.34 });
  }
  strokes.push({ points: [[0, 0, 0.28], [0.1, 0.28, 0.28], [0.32, 0.42, 0.28]], tone: 4, pulse: true, weight: 0.9 });
  strokes.push({ points: line([0, 0, 0.28], [-0.28, -0.16, 0.28]), tone: 0, weight: 0.65 });
  /* The close ledger and its single, non-refilling reserve. */
  strokes.push({ points: [[-0.92, -0.94, 0.25], [-0.92, -0.68, 0.25], [0.92, -0.68, 0.25], [0.92, -0.94, 0.25]], tone: 2, weight: 1.1 });
  strokes.push({ points: line([-0.82, -0.81, 0.3], [0.34, -0.81, 0.3]), tone: 0, pulse: true, weight: 1.3 });
  strokes.push({ points: line([0.34, -0.88, 0.3], [0.34, -0.74, 0.3]), tone: 4, weight: 0.38 });
  for (const x of [-0.54, -0.26, 0.02, 0.62]) strokes.push({ points: line([x, -0.9, 0.3], [x, -0.84, 0.3]), tone: 1, weight: 0.24 });
  /* A rear seal sits behind the dial, giving the silhouette real depth as it turns. */
  strokes.push({ points: loop(0.83, 0.83, -0.42), tone: 3, weight: 0.85 });
  return sculpt(count, strokes, -0.075);
}
