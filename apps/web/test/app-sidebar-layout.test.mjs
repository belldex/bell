import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../app/(app)/app.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const at = css.indexOf(`
${selector} {`);
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at));
};

test('sidebar keeps its full-size elements: logo, menu rows and descriptions are not shrunk', () => {
  assert.match(rule('.app-brand__logo'), /width:\s*48px;\s*height:\s*48px/);
  assert.match(rule('.app-sidebar__nav a'), /min-height:\s*44px/);
  assert.match(rule('.app-sidebar__nav-copy small'), /font-size:\s*10px/);
});

test('short desktop screens only tighten vertical spacing, never hide content or shrink elements', () => {
  const block = css.match(/@media\s*\(min-width:\s*961px\)\s+and\s+\(max-height:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'a short-height desktop tier exists');
  assert.ok(Number(block[1]) >= 760, 'tier starts above the common 125%-scaled laptop height');
  assert.doesNotMatch(block[2], /display:\s*none/);
  assert.doesNotMatch(block[2], /font-size/);
  assert.doesNotMatch(block[2], /min-height/);
  assert.doesNotMatch(block[2], /\.app-brand__logo/);
});

test('sidebar scrolls only as a last resort, so the mobile drawer always can', () => {
  assert.match(rule('.app-sidebar'), /overflow-y:\s*auto/);
  assert.doesNotMatch(css, /\.app-sidebar\s*\{[^}]*overflow-y:\s*hidden/);
});
