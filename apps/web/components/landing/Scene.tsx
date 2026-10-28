'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Block = [number, number, number, number];
type Pose = {
  blocks: Block[];
  scale: number;
  y: number;
  x?: number;
  rx: number;
  ry: number;
  spin: number;
  dim: number;
};

/** Solid lattice: w x h x d cells, some cells flagged hot by a hash. */
function lattice(w: number, h: number, d: number, hotMod = 0, yOffset = 0): Block[] {
  const out: Block[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        const hot = hotMod && (7 * x + 13 * y + 3 * z) % hotMod === 0 ? 1 : 0;
        out.push([x - (w - 1) / 2, y - (h - 1) / 2 + yOffset, z - (d - 1) / 2, hot]);
      }
    }
  }
  return out;
}

/** Hollow cube shell: only cells on the surface, optionally perforated. */
function shell(n: number, skipMod = 0): Block[] {
  const out: Block[] = [];
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (let z = 0; z < n; z++) {
        if (skipMod && (31 * y + 17 * x + 7 * z) % skipMod === 0) continue;
        out.push([x - (n - 1) / 2, y - (n - 1) / 2, z - (n - 1) / 2, 0]);
      }
    }
  }
  return out;
}

/**
 * The reference's nine scroll poses, transcribed from the shipped scene module.
 * Pose 0 is the hero, pose 8 is the closing wall.
 */
const POSES: Pose[] = [
  { blocks: lattice(12, 6, 3, 23, 0), scale: 1.9, y: -7.6, rx: 0.62, ry: -0.55, spin: 0.05, dim: 0.4 },
  { blocks: shell(5, 9), scale: 0.6, y: 1.2, rx: 0.32, ry: 0.4, spin: 0.12, dim: 0.42 },
  { blocks: shell(6, 7), scale: 0.78, y: -4.2, rx: 0.5, ry: -0.3, spin: 0.08, dim: 0.5 },
  {
    blocks: (() => {
      const out: Block[] = [];
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 9; b++) {
          for (let c = 0; c < 4; c++) {
            if ((b + c + a) % 5 !== 0 || a % 2 !== 1) {
              out.push([b - 4, 1.5 * a - 3, c - 1.5, a === 2 && b === 4 && c === 0 ? 1 : 0]);
            }
          }
        }
      }
      return out;
    })(),
    scale: 0.95,
    y: 0,
    rx: 0.45,
    ry: 0.65,
    spin: 0.06,
    dim: 0.95,
    x: 1.2,
  },
  {
    blocks: (() => {
      const out: Block[] = [];
      [6, 3, 5, 2, 4, 7].forEach((h, col) => {
        for (let y = 0; y < h; y++) {
          for (let z = 0; z < 3; z++) {
            out.push([1.6 * col - 4, y - 3, z - 1, y === h - 1 && z === 0 && col % 2 === 0 ? 1 : 0]);
          }
        }
      });
      return out;
    })(),
    scale: 0.95,
    y: -0.2,
    rx: 0.35,
    ry: -0.6,
    spin: 0.06,
    dim: 0.95,
    x: -1.2,
  },
  { blocks: lattice(10, 5, 3, 7, 0), scale: 0.95, y: 0, rx: 0.4, ry: 0.55, spin: 0.06, dim: 0.95, x: 1.2 },
  {
    blocks: (() => {
      const out = lattice(10, 5, 3, 0);
      for (const b of out) {
        if (b[0] === 0.5 && b[1] === 0 && b[2] === -1) {
          b[1] = -5.5;
          b[2] = -3;
          b[3] = 1;
        }
        if (b[0] === -0.5 && b[1] === 1 && b[2] === -1) b[3] = 1;
      }
      return out;
    })(),
    scale: 0.95,
    y: 0.3,
    rx: 0.42,
    ry: -0.5,
    spin: 0.05,
    dim: 0.95,
    x: -1.2,
  },
  { blocks: lattice(14, 7, 3, 0, 0), scale: 2.6, y: 0, rx: 0.3, ry: 0.2, spin: 0.02, dim: 0.85 },
  { blocks: shell(5, 0), scale: 0.5, y: 9, rx: 0.4, ry: 0.4, spin: 0.1, dim: 0 },
];

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vN;
  varying float vHot;
  varying float vDepth;

  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    #ifdef USE_INSTANCING_COLOR
      vHot = instanceColor.r;
    #else
      vHot = 0.0;
    #endif
    vec4 mv = viewMatrix * wp;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uCell;
  uniform float uNear;
  uniform float uFar;
  uniform float uDim;
  uniform float uTime;
  uniform vec3 uInk;
  uniform vec3 uHot;

  varying vec3 vN;
  varying float vHot;
  varying float vDepth;

  void main() {
    vec3 L = normalize(vec3(0.35, 1.0, 0.55));
    float d = max(dot(normalize(vN), L), 0.0);
    float b = (0.16 + 0.84 * d);
    float fog = 1.0 - smoothstep(uNear, uFar, vDepth);
    b *= fog * uDim;

    if (vHot > 0.25 && vHot < 0.75) b *= 0.4; // water behind a dam
    if (vHot > 0.75) {
      float pulse = 0.75 + 0.25 * sin(uTime * 2.2);
      gl_FragColor = vec4(uHot * (0.8 + 0.2 * fog) * pulse, 1.0);
      return;
    }

    vec2 g = gl_FragCoord.xy / uCell;
    vec2 f = fract(g) - 0.5;
    float r = max(abs(f.x), abs(f.y)) * 0.55 + length(f) * 0.45;
    float rad = sqrt(b) * 0.6;
    float m = 1.0 - smoothstep(rad - 0.06, rad + 0.03, r);
    if (b > 0.93) m = 1.0;
    gl_FragColor = vec4(uInk * m, 1.0);
  }
`;

const CAPACITY = 220;

export default function Scene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      host.classList.add('scene-fallback');
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 1);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    camera.position.set(0, 0, 30);

    const geometry = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uCell: { value: 6 * dpr },
        uNear: { value: 20 },
        uFar: { value: 44 },
        uDim: { value: 1 },
        uTime: { value: 0 },
        uInk: { value: new THREE.Color('#F4F6F8') },
        uHot: { value: new THREE.Color('#FF5A1F') },
      },
    });

    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);

    const group = new THREE.Group();
    group.add(mesh);
    scene.add(group);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const positions = new Float32Array(CAPACITY * 3);
    const hidden = new Float32Array(CAPACITY);
    let poseIndex = 0;

    const cam = {
      scale: POSES[0].scale,
      y: POSES[0].y,
      x: 0,
      rx: POSES[0].rx,
      ry: POSES[0].ry,
      dim: POSES[0].dim,
      spin: 0,
    };

    const dummy = new THREE.Object3D();
    const color = mesh.instanceColor.array as Float32Array;

    const poseFor = (index: number): Pose => POSES[Math.max(0, Math.min(POSES.length - 1, index))];

    // Seed instance positions below the frame so blocks fly up into the first pose.
    {
      const initial = poseFor(0).blocks;
      for (let i = 0; i < CAPACITY; i++) {
        const b = initial[i % Math.max(1, initial.length)];
        positions[i * 3] = b[0];
        positions[i * 3 + 1] = b[1] - 14;
        positions[i * 3 + 2] = b[2];
        hidden[i] = i < initial.length ? 0 : 1;
      }
    }

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w < 768 ? 44 : 32;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let last = performance.now();
    let visible = true;
    let poseChangedAt = performance.now();

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (visible) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    /** Read the nearest [data-pose] section above the viewport midpoint. */
    const readPose = () => {
      const sections = document.querySelectorAll('[data-pose]');
      const mid = 0.5 * window.innerHeight;
      let next = poseIndex;
      let found = false;
      sections.forEach((section) => {
        if (section.getBoundingClientRect().top <= mid) {
          next = Number((section as HTMLElement).dataset.pose);
          found = true;
        }
      });
      return found ? next : 0;
    };

    function frame(now: number) {
      if (!visible) return;

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const next = readPose();
      if (next !== poseIndex) {
        poseIndex = next;
        poseChangedAt = now;
      }

      const pose = poseFor(poseIndex);
      const ease = reduced ? 1 : 1 - Math.pow(9e-4, dt);
      const sinceChange = (now - poseChangedAt) / 1000;

      for (let i = 0; i < CAPACITY; i++) {
        const present = i < pose.blocks.length;
        const b = pose.blocks[present ? i : i % Math.max(1, pose.blocks.length)];
        const delay = sinceChange - (i % 17) * 0.018;

        if (delay > 0 || reduced) positions[i * 3 + 1] += (b[1] - positions[i * 3 + 1]) * ease;
        if (delay > 0.18 || reduced) positions[i * 3] += (b[0] - positions[i * 3]) * ease;
        if (delay > 0.32 || reduced) positions[i * 3 + 2] += (b[2] - positions[i * 3 + 2]) * ease;

        hidden[i] += ((present ? 0 : 1) - hidden[i]) * ease;

        const scale = Math.max(1e-4, 1 - hidden[i]);
        dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        const hot = present && b[3] === 1 ? 1 : present && b[3] === 2 ? 0.5 : 0;
        color[i * 3] = hot;
        color[i * 3 + 1] = 0;
        color[i * 3 + 2] = 0;
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      const camEase = reduced ? 1 : 1 - Math.pow(0.02, dt);
      cam.scale += (pose.scale - cam.scale) * camEase;
      cam.y += (pose.y - cam.y) * camEase;
      cam.x += ((window.innerWidth < 768 ? 0 : pose.x ?? 0) - cam.x) * camEase;
      cam.rx += (pose.rx - cam.rx) * camEase;
      cam.ry += (pose.ry - cam.ry) * camEase;
      cam.dim += (pose.dim - cam.dim) * camEase;
      if (!reduced) cam.spin += dt * pose.spin;

      group.scale.setScalar(cam.scale);
      group.position.y = cam.y;
      group.position.x = 4 * cam.x;
      group.rotation.set(cam.rx, cam.ry + 0.35 * Math.sin(cam.spin), 0);

      material.uniforms.uDim.value =
        cam.dim * (window.innerWidth < 768 && poseIndex === 0 ? 0.6 : 1);
      material.uniforms.uTime.value = now / 1000;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }

    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="scene" aria-hidden="true" />;
}
