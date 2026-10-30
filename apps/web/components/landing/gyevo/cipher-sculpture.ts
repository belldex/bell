/*
 * BELL cipher aperture.
 *
 * The session sculpture resolves into three interlocked, machined rings. As the page is scrolled,
 * the rings cant away from one another while a faceted aperture opens onto the session-aware
 * hero. This is drawn as one deterministic canvas frame from scroll progress: no animation loop,
 * no asset download, and the same motion reverses cleanly when the visitor scrolls back.
 */

type Vec2 = { x: number; y: number };
export type CipherRect = { x: number; y: number; w: number; h: number };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, value: number) => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

function ringPoint(cx: number, cy: number, rx: number, ry: number, angle: number, tilt: number): Vec2 {
  /* A soft superellipse reads as a faceted policy aperture, not a planet orbit. */
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  const x = Math.sign(cosAngle) * Math.pow(Math.abs(cosAngle), 0.38) * rx;
  const y = Math.sign(sinAngle) * Math.pow(Math.abs(sinAngle), 0.38) * ry;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  return { x: cx + x * cosTilt - y * sinTilt, y: cy + x * sinTilt + y * cosTilt };
}

function traceRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tilt: number,
  start = 0,
  end = TAU,
  steps = 112,
) {
  for (let i = 0; i <= steps; i++) {
    const p = ringPoint(cx, cy, rx, ry, mix(start, end, i / steps), tilt);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  depth: number,
  tilt: number,
  phase: number,
  progress: number,
  dpr: number,
  alpha: number,
) {
  const rx = radius * (1 + depth * 0.1);
  const ry = radius * (0.42 + depth * 0.035);
  const thickness = Math.max(2.2, radius * 0.045) * dpr;
  const open = smooth(0.08, 0.82, progress);
  const gap = mix(0.05, 0.38, open);
  const start = phase + gap;
  const end = phase + TAU - gap;
  const mid = (start + end) / 2;

  /* A dark body and a narrow silver lip give the ring a machined edge without a flat card face. */
  ctx.beginPath();
  traceRing(ctx, cx, cy + depth * radius * 0.08, rx, ry, tilt, start, end);
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(23,23,23,${(0.7 + open * 0.2) * alpha})`;
  ctx.shadowColor = "rgba(0,0,0,.58)";
  ctx.shadowBlur = thickness * 1.4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  traceRing(ctx, cx, cy + depth * radius * 0.08, rx, ry, tilt, start, end);
  ctx.lineWidth = Math.max(0.8, thickness * 0.13);
  ctx.strokeStyle = `rgba(238,236,229,${(0.22 + open * 0.44) * alpha})`;
  ctx.stroke();

  /* Three engraved breaks make each ring feel like a session instrument, not a generic orbit. */
  for (const offset of [-0.16, 0, 0.16]) {
    const angle = mid + offset;
    const a = ringPoint(cx, cy + depth * radius * 0.08, rx - thickness * 0.45, ry - thickness * 0.45, angle, tilt);
    const b = ringPoint(cx, cy + depth * radius * 0.08, rx + thickness * 0.42, ry + thickness * 0.42, angle, tilt);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = Math.max(0.8, dpr * 1.1);
    ctx.strokeStyle = `rgba(238,236,229,${(0.28 + open * 0.38) * alpha})`;
    ctx.stroke();
  }
}

export function createCipherSculpture(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let dpr = 1;
  let dirty = false;

  const resize = (screenWidth: number, screenHeight: number) => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = screenWidth;
    height = screenHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    dirty = false;
  };

  const clear = () => {
    if (!ctx || !dirty) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty = false;
  };

  const draw = (e: number, slot: CipherRect): string | null => {
    if (!ctx || !width || !height) return null;
    const p = clamp01(e);
    if (p < 0.0008 || p > 0.9995) {
      clear();
      return null;
    }

    const v = Math.pow(p, 0.58);
    const cx = slot.x + slot.w / 2;
    const cy = slot.y + slot.h / 2;
    const diagonal = Math.hypot(width, height);
    /* Keep the mechanical sculpture compact while the reveal window grows to the full hero. */
    const reach = mix(Math.max(slot.w, slot.h) * 0.075, Math.min(width, height) * 0.45, smooth(0.02, 0.74, v));
    const unfold = smooth(0.12, 0.84, v);
    const sculptureFade = 1 - smooth(0.72, 0.92, v);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    dirty = true;
    ctx.lineJoin = "round";

    /* The rings turn at different rates, making one nested volume with a visible inner throat. */
    const baseTilt = mix(0.08, 0.46, Math.sin(Math.PI * unfold));
    drawBand(ctx, cx, cy, reach, -1.2, baseTilt - 0.28, -0.48 + unfold * 0.2, v, dpr, sculptureFade);
    drawBand(ctx, cx, cy, reach * 0.79, 0.05, -baseTilt + 0.32, 1.66 - unfold * 0.28, v, dpr, sculptureFade);
    drawBand(ctx, cx, cy, reach * 0.56, 1.15, baseTilt + 0.18, 3.52 + unfold * 0.22, v, dpr, sculptureFade);

    /* Small radial bridges connect the rings like a three-lane market clock. */
    const spokeAlpha = (1 - smooth(0.72, 0.98, v)) * 0.36 * sculptureFade;
    if (spokeAlpha > 0.01) {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * TAU + unfold * 0.12;
        const outer = ringPoint(cx, cy, reach * 0.8, reach * 0.34, angle, baseTilt - 0.2);
        const inner = ringPoint(cx, cy, reach * 0.56, reach * 0.24, angle + 0.12, baseTilt + 0.18);
        ctx.beginPath();
        ctx.moveTo(outer.x, outer.y);
        ctx.lineTo(inner.x, inner.y);
        ctx.lineWidth = Math.max(0.7, dpr * 0.9);
        ctx.strokeStyle = `rgba(238,236,229,${spokeAlpha})`;
        ctx.stroke();
      }
    }

    /* The clipped hero opens through the same faceted instrument, not a circular or slab-shaped mask. */
    const opening = mix(Math.max(slot.w, slot.h) * 0.04, diagonal * 0.58, smooth(0.42, 0.98, v));
    const ry = opening * mix(0.9, 0.82, unfold);
    const aperture: string[] = [];
    for (let i = 0; i < 48; i++) {
      const point = ringPoint(cx, cy, opening, ry, (i / 48) * TAU, baseTilt * 0.3);
      aperture.push(`${point.x.toFixed(1)}px ${point.y.toFixed(1)}px`);
    }
    return `polygon(${aperture.join(",")})`;
  };

  return { resize, draw, clear };
}
