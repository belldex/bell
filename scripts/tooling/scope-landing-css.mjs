import postcss from 'postcss';
import { readFile, writeFile } from 'node:fs/promises';

const file = 'apps/web/app/landing.css';
const css = await readFile(file, 'utf8');
const root = postcss.parse(css);

const SCOPE = '.bell-landing';

function scopeSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const s = part.trim();
      if (!s) return s;

      // Document-level selectors become the landing root itself.
      if (s === ':root') return SCOPE;
      if (s === 'html') return SCOPE;
      if (s === 'body') return SCOPE;
      if (s === '*') return `${SCOPE} *`;

      // "html.lenis, html.lenis body" -> landing equivalents
      if (s.startsWith('html.lenis')) {
        const rest = s.slice('html.lenis'.length).trim();
        return rest ? `${SCOPE} ${rest}` : SCOPE;
      }

      // Element selectors that target bare tags must not leak.
      if (/^(a|button|img|p|h1|h2|h3|h4|ul|li|nav|span|svg|section|article|div)\b/.test(s)) {
        return `${SCOPE} ${s}`;
      }

      // Already-scoped or class-based selectors.
      return `${SCOPE} ${s}`;
    })
    .join(', ');
}

root.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
  if (rule.selector.includes(SCOPE)) return;
  rule.selector = scopeSelector(rule.selector);
});

// Keep @font-face untouched but rename families so they cannot clash with app fonts.
root.walkAtRules('font-face', (at) => {
  at.walkDecls('font-family', (decl) => {
    decl.value = decl.value.replace(/^(['"]?)([^'"]+)\1$/, 'BELL Landing $2');
  });
});

const out = root.toString();
await writeFile(file, out, 'utf8');
console.log('Scoped landing.css under', SCOPE);
