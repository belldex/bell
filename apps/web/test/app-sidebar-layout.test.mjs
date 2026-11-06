import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../app/(app)/app.css', import.meta.url), 'utf8');

test('desktop sidebar fits the viewport without its own scrollbar', () => {
  assert.match(css, /@media\s*\(min-width:\s*961px\)[^{]*\{[^}]*\.app-sidebar\s*\{[^}]*overflow-y:\s*hidden/s);
  assert.match(css, /@media\s*\(max-width:\s*960px\)[^{]*\{[^}]*\.app-sidebar\s*\{[^}]*overflow-y:\s*auto/s);
});

test('short desktop viewports compact secondary sidebar copy without hiding navigation', () => {
  assert.match(css, /@media\s*\(min-width:\s*961px\)\s+and\s+\(max-height:\s*800px\)/);
  assert.match(css, /\.app-sidebar__nav-copy small,\s*\.app-sidebar__session > p,\s*\.app-sidebar__network-label\s*\{\s*display:\s*none/s);
  assert.match(css, /app-sidebar__nav a[^}]*min-height:\s*36px/s);
});
