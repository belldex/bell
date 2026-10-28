import { readFile, writeFile } from 'node:fs/promises';

const file = 'D:/Project/wealthypeople/BELL/apps/web/app/landing.css';
let css = await readFile(file, 'utf8');

css = css.replaceAll(
  'font-family:Instrument Sans,Instrument Sans Fallback',
  'font-family:"BELL Landing Instrument Sans","BELL Landing Instrument Sans Fallback"',
);
css = css.replaceAll(
  'font-family:Geist Mono,Geist Mono Fallback',
  'font-family:"BELL Landing Geist Mono","BELL Landing Geist Mono Fallback"',
);
css = css.replaceAll(
  'font-family:Silkscreen,Silkscreen Fallback',
  'font-family:"BELL Landing Silkscreen","BELL Landing Silkscreen Fallback"',
);

css = css.replace(
  '--sans:var(--font-sans), Helvetica, Arial, sans-serif',
  '--sans:"BELL Landing Instrument Sans","BELL Landing Instrument Sans Fallback",Helvetica,Arial,sans-serif',
);
css = css.replace(
  '--mono:var(--font-mono), "Courier New", monospace',
  '--mono:"BELL Landing Geist Mono","BELL Landing Geist Mono Fallback","Courier New",monospace',
);
css = css.replace(
  '--pixel:var(--font-pixel), var(--font-mono), monospace',
  '--pixel:"BELL Landing Silkscreen","BELL Landing Silkscreen Fallback","BELL Landing Geist Mono",monospace',
);

await writeFile(file, css, 'utf8');
const families = [...new Set(css.match(/--(?:sans|mono|pixel):[^;}]+/g) ?? [])];
console.log(families.join('\n'));
