/**
 * Terminal helpers shared by the BELL CLIs: BELL palette, big pixel banner, boxes, prompts.
 * Palette comes from apps/web/app/globals.css: talc, carbon and poppy.
 */
import { createInterface } from 'node:readline';

export const flags = new Set(process.argv.slice(2));
export const AUTO = flags.has('--auto') || !process.stdin.isTTY;
export const FAST = flags.has('--fast');

const rgb = (r, g, b) => (s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
export const ion = rgb(0xC7, 0x44, 0x4F);        // --color-ion (poppy)
export const ionSoft = rgb(0xE8, 0xB6, 0xB4);    // --color-ion-soft
export const ionStrong = rgb(0xA9, 0x36, 0x40);  // --color-ion-strong
export const warnRed = rgb(0xE2, 0x74, 0x78);    // --color-warn
export const ink = rgb(0xEE, 0xEC, 0xE5);        // --color-ink (talc)
export const muted = rgb(0xB7, 0xB4, 0xAD);      // --color-muted
export const dim = rgb(0x85, 0x81, 0x77);        // --color-dim
export const line = rgb(0x5D, 0x56, 0x50);       // --color-line-strong
export const bold = (s) => `\x1b[1m${s}\x1b[22m`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? ms / 5 : ms));
export const out = (s = '') => process.stdout.write(`${s}\n`);
export const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const pad = (s, w, right = false) => { const n = Math.max(0, w - strip(String(s)).length); return right ? ' '.repeat(n) + s : s + ' '.repeat(n); };

const GLYPHS = {
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '.####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  F: ['#####', '#....', '####.', '#....', '#....'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  ' ': ['..', '..', '..', '..', '..'],
};

/** Big pixel banner, shaded from soft poppy at the top to deep poppy at the bottom. */
export function banner(text) {
  const rows = [[0xE8, 0xB6, 0xB4], [0xD9, 0x7F, 0x84], [0xC7, 0x44, 0x4F], [0xA9, 0x36, 0x40], [0x70, 0x28, 0x2E]];
  return Array.from({ length: 5 }, (_, row) => {
    const text5 = [...text].map((ch) => GLYPHS[ch][row].replaceAll('#', '█').replaceAll('.', ' ')).join(' ');
    return rgb(...rows[row])(text5);
  });
}

export function box(lines) {
  const width = Math.max(...lines.map((l) => strip(l).length));
  return [`┌${'─'.repeat(width + 2)}┐`, ...lines.map((l) => `│ ${pad(l, width)} │`), `└${'─'.repeat(width + 2)}┘`].map(line).join('\n');
}

const rl = AUTO ? null : createInterface({ input: process.stdin, output: process.stdout });
export const closeInput = () => rl?.close();

export async function typeText(text, delay = 38) {
  for (const ch of text) { process.stdout.write(ch); await sleep(delay); }
}

export async function prompt(label) {
  process.stdout.write(`\n${ion('?')} ${ink(label)} ${dim('[Enter]')} `);
  if (AUTO) { await sleep(900); out(); return; }
  await new Promise((resolve) => rl.question('', resolve));
}

export const step = (n, total, title, sub) => out(`\n${ion(bold(`Step ${n}/${total}`))}  ${bold(ink(title))}\n${dim(sub)}\n`);
export const ok = (s) => out(`${ionSoft('✓')} ${ink(s)}`);
export const warn = (s) => out(`${warnRed('!')} ${ink(s)}`);
export const fail = (s) => out(`${warnRed('✗')} ${ink(s)}`);
