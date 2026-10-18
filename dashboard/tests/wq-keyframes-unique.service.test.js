/**
 * The child pages' stylesheets share one document, so a @keyframes name defined in two of them is decided by whichever
 * sheet loads last, for every user (the doors' waiting pulse once replaced the toast's fade). Every name is defined once
 * across public/wq/*.css.
 */
const fs = require('fs');
const path = require('path');

const WQ = path.join(__dirname, '..', 'public', 'wq');

test('no @keyframes name is defined twice across public/wq/*.css', () => {
  const seen = {};
  for (const f of fs.readdirSync(WQ).filter((n) => n.endsWith('.css')).sort()) {
    const css = fs.readFileSync(path.join(WQ, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/@(?:-webkit-)?keyframes\s+([-\w]+)/g)) (seen[m[1]] = seen[m[1]] || []).push(f);
  }
  const twice = Object.entries(seen).filter(([, files]) => files.length > 1).map(([name, files]) => `${name}: ${files.join(', ')}`);
  expect(twice).toEqual([]);
});

test('the doors\' waiting pulse runs its own keyframes', () => {
  const css = fs.readFileSync(path.join(WQ, 'wq-doors.css'), 'utf8');
  expect(css).toMatch(/\.wq-wait\{animation:wq-dpulse /);
  expect(css).toMatch(/@keyframes wq-dpulse\{/);
});

test('every animation in the doors\' sheet runs keyframes the doors\' sheet defines', () => {
  const css = fs.readFileSync(path.join(WQ, 'wq-doors.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set([...css.matchAll(/@(?:-webkit-)?keyframes\s+([-\w]+)/g)].map((m) => m[1]));
  const used = [...css.matchAll(/animation(?:-name)?\s*:\s*([-\w]+)/g)].map((m) => m[1]).filter((n) => n !== 'none');
  expect(used.length).toBeGreaterThan(0);
  expect(used.filter((n) => !defined.has(n))).toEqual([]);
});
