/* Scroll forms for BELL's glyph sculpture. The letters stay the same; these builders place them on
   broad 3D surfaces so each market policy reads as a volume rather than a wireframe. */
type V3 = [number, number, number];

export interface HeroForm {
  pos(i: number, t: number, out: Float32Array): void;
  pal(i: number, t: number): number;
}

const TAU = Math.PI * 2;
const fract = (n: number) => n - Math.floor(n);
const rnd = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const smooth = (a: number, b: number, v: number) => {
  const x = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

function turned(p: V3, t: number, speed: number, out: Float32Array) {
  const yaw = t * speed;
  const pitch = Math.sin(t * 0.2) * 0.035;
  const x = p[0] * Math.cos(yaw) - p[2] * Math.sin(yaw);
  const z = p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
  out[0] = x;
  out[1] = p[1] * Math.cos(pitch) - z * Math.sin(pitch);
  out[2] = p[1] * Math.sin(pitch) + z * Math.cos(pitch);
}

function shellTone(i: number, n: number, phase = 0) {
  const v = rnd(i * 7.31 + phase);
  return v > 0.965 ? 4 : v > 0.78 ? 1 : v > 0.48 ? 0 : 2;
}

/* A tier is a shallow, filled fee plate. Most glyphs lie across its face; the rest wrap its edge,
   giving the stack a readable thickness instead of three lonely circular outlines. */
export function buildFeeStack(count: number): HeroForm {
  const base = new Float32Array(count * 3);
  const tone = new Uint8Array(count);
  const radii = [0.96, 0.72, 0.48];
  const levels = [0.48, 0, -0.48];
  const perTier = Math.floor(count / 3);

  for (let i = 0; i < count; i++) {
    const tier = Math.min(2, Math.floor(i / perTier));
    const j = i - tier * perTier;
    const face = rnd(i * 4.11 + 2) > 0.2;
    const a = j * 2.399963229728653 + tier * 0.37;
    const r = radii[tier] * Math.sqrt(rnd(i * 2.17 + 8));
    const edgeA = a + (rnd(i * 3.7) - 0.5) * 0.02;
    const edgeY = levels[tier] + (rnd(i * 5.9 + 1) - 0.5) * 0.115;
    const radius = face ? r : radii[tier] * (0.975 + rnd(i * 6.1) * 0.025);
    const o = i * 3;
    base[o] = Math.cos(face ? a : edgeA) * radius;
    base[o + 1] = face ? levels[tier] + (rnd(i * 8.3) - 0.5) * 0.035 : edgeY;
    base[o + 2] = Math.sin(face ? a : edgeA) * radius;
    tone[i] = tier === 0 ? shellTone(i, count, 0) : tier === 1 ? shellTone(i, count, 11) : shellTone(i, count, 23);
  }

  return {
    pos(i, t, out) {
      const p: V3 = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
      turned(p, t, 0.09, out);
    },
    pal(i) { return tone[i]; },
  };
}

/* The gross-flow limiter: a continuous octagonal channel, broad at both ports and pinched at the
   guarded throat. Glyphs cover the entire lofted skin, so the silhouette reads as a solid conduit. */
export function buildBoundedGate(count: number): HeroForm {
  const base = new Float32Array(count * 3);
  const tone = new Uint8Array(count);
  const facePulse = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const u = fract((i + 0.5) * 0.61803398875);
    const v = rnd(i * 1.91 + 14);
    const z = (v * 2 - 1) * 0.82;
    const throat = smooth(0.08, 0.88, Math.abs(z));
    const sx = 0.3 + throat * 0.72;
    const sy = 0.28 + throat * 0.56;
    const angle = u * TAU;
    const c = Math.cos(angle), s = Math.sin(angle);
    /* Superellipse cross-section: softly chamfered square ports, not a circular cage. */
    const x = Math.sign(c) * Math.pow(Math.abs(c), 0.62) * sx;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 0.62) * sy;
    const o = i * 3;
    base[o] = x;
    base[o + 1] = y;
    base[o + 2] = z;
    tone[i] = Math.abs(z) < 0.16 ? (rnd(i * 3.17) > 0.78 ? 4 : 0) : shellTone(i, count, 41);
    facePulse[i] = Math.abs(z) > 0.68 && rnd(i * 9.2) > 0.82 ? 1 : 0;
  }

  return {
    pos(i, t, out) {
      const p: V3 = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
      const flow = facePulse[i] ? Math.sin(t * 2.1 + i * 0.14) * 0.018 : 0;
      turned([p[0], p[1], p[2] + flow], t, 0.075, out);
    },
    pal(i, t) { return facePulse[i] && Math.sin(t * 2.1 + i * 0.14) > 0.88 ? 4 : tone[i]; },
  };
}

/* Scheduled close: six broad shutter leaves overlap into a sealed iris, nested inside a thick
   octagonal housing. The filled leaf faces make the closed state unmistakable at a glance. */
export function buildCloseAnchor(count: number): HeroForm {
  const base = new Float32Array(count * 3);
  const tone = new Uint8Array(count);
  const leafCount = Math.floor(count * 0.78);
  const housingCount = count - leafCount;

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (i < leafCount) {
      const perLeaf = Math.ceil(leafCount / 6);
      const leaf = Math.min(5, Math.floor(i / perLeaf));
      const j = i - leaf * perLeaf;
      const u = fract((j + 0.5) * 0.754877666);
      const v = rnd(i * 3.31 + 71);
      const angle0 = leaf * TAU / 6;
      const radius = 0.17 + u * 0.76;
      const sweep = (v - 0.5) * (TAU / 6 + 0.15);
      const angle = angle0 + sweep + (1 - u) * 0.48;
      /* Each leaf rises slightly at its outer edge and overlaps the next leaf at the center. */
      base[o] = Math.cos(angle) * radius;
      base[o + 1] = Math.sin(angle) * radius * 0.84;
      base[o + 2] = 0.14 + (1 - u) * 0.15 + Math.sin(angle * 3) * 0.018;
      tone[i] = rnd(i * 7.7) > 0.91 ? 4 : leaf % 2 ? 1 : 0;
    } else {
      const j = i - leafCount;
      const side = j % 8;
      const along = fract(j * 0.61803398875);
      const depth = j % 2 ? 0.34 : -0.34;
      const r = 1.02;
      const a0 = side * TAU / 8;
      const a1 = (side + 1) * TAU / 8;
      base[o] = Math.cos(a0) * r * (1 - along) + Math.cos(a1) * r * along;
      base[o + 1] = (Math.sin(a0) * r * (1 - along) + Math.sin(a1) * r * along) * 0.84;
      base[o + 2] = depth;
      tone[i] = j % 2 ? 2 : 4;
    }
  }

  return {
    pos(i, t, out) {
      const p: V3 = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
      turned(p, t, -0.035, out);
    },
    pal(i) { return tone[i]; },
  };
}
