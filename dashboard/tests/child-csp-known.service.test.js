/**
 * The child pages' known policy reports, as data (fixtures/child-csp-known.json).
 *
 * With web_quiz_child_csp on, the child pages are report-only (routes/child-csp.js): the sources below are expected to
 * report until they are rewritten. The list is checked against the page scripts themselves (public/wq/*.js):
 *   (a) every scanned source is listed, with its exact count: a NEW inline handler, cross-origin upload or no-cors
 *       warm-up in any child script is red until it is listed (and a listed one that is gone is red until removed);
 *   (b) the list may only shrink: KNOWN_MAX and KNOWN_COUNT_MAX are today's sizes and are only ever lowered.
 * Matched by text, not line: lines drift, the text does not.
 */
const fs = require('fs');
const path = require('path');
const KNOWN = require('./fixtures/child-csp-known.json');

const PUBLIC_WQ = path.join(__dirname, '..', 'public', 'wq');

// ONLY EVER LOWER these two (a fixed source leaves the list); never raise them.
const KNOWN_MAX = 8;
const KNOWN_COUNT_MAX = 15;

// What the policy reports, as it reads in a script's text: [directive, pattern (its match is the entry's `match`)].
// style-src allows inline styles ('unsafe-inline'), so a style="" is not a source; scripts load from this site only.
const keyOf = (e) => `${e.file}|${e.directive}|${e.match}`;
const byKey = (a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0);

const SCAN = [
  ['script-src-attr', /\son[a-z]{3,20}=\\?["']/g],                 // an inline handler written into markup
  ['script-src-attr', /setAttribute\(\s*['"]on[a-z]+/g],            // …or set as an attribute
  ['script-src-elem', /javascript:/g],                              // a javascript: address
  ['script-src', /\beval\(|\bnew Function\(/g],                     // eval (no 'unsafe-eval')
  ['connect-src', /fetch\([a-z]+\.[a-z_]*url\b/gi],                 // a fetch to an address the bot hands over
  ['connect-src', /mode:\s*'no-cors'/g],                            // a no-cors warm-up (any origin)
];

/** Every scanned source in `files` ({name: text}): [{directive, file, match, count}], sorted. */
function scan(files) {
  const seen = new Map();
  for (const [file, text] of Object.entries(files)) {
    for (const [directive, rx] of SCAN) {
      for (const m of text.matchAll(rx)) {
        const match = m[0].replace(/\\(["'])/, '$1');
        const k = `${directive}|${file}|${match}`;
        seen.set(k, { directive, file, match, count: ((seen.get(k) || {}).count || 0) + 1 });
      }
    }
  }
  return [...seen.values()].sort(byKey);
}

const scripts = () => Object.fromEntries(fs.readdirSync(PUBLIC_WQ).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(path.join(PUBLIC_WQ, f), 'utf8')]));
const listed = () => KNOWN.entries.map(({ directive, file, match, count }) => ({ directive, file, match, count }))
  .sort(byKey);

describe('the known reports are exactly what the child scripts hold', () => {
  test('every scanned source is listed with its count, and every listed one is still there', () => {
    expect(scan(scripts())).toEqual(listed());
  });
  test('each entry names a directive the policy has, a real script and a reason', () => {
    for (const e of KNOWN.entries) {
      expect([e.file, ['script-src-attr', 'script-src-elem', 'script-src', 'connect-src'].includes(e.directive)]).toEqual([e.file, true]);
      expect(fs.existsSync(path.join(PUBLIC_WQ, e.file))).toBe(true);
      expect(typeof e.what).toBe('string');
      expect(e.count).toBeGreaterThan(0);
    }
  });
  test('the scanner sees a new inline handler, a set attribute and a no-cors warm-up', () => {
    const got = scan({ 'x.js': "var a = '<img src=\"/a\" onclick=\"go()\">'; el.setAttribute('onload', 'x'); fetch(u, { mode: 'no-cors' });" });
    expect(got.map((e) => [e.directive, e.match])).toEqual([['connect-src', "mode: 'no-cors'"], ['script-src-attr', ' onclick="'], ['script-src-attr', "setAttribute('onload"]]);
  });
});

describe('the list may only shrink', () => {
  // Against the merge-base with the sandbox branch, when git can name one (a checkout with no such history runs the
  // two fixed ceilings below only): no entry may be added and no count raised.
  test('no entry added and no count raised since the merge-base', () => {
    const { execFileSync } = require('child_process');
    const git = (...a) => execFileSync('git', a, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    let base = null;
    try { base = JSON.parse(git('show', `${git('merge-base', 'HEAD', 'origin/sandbox').trim()}:dashboard/tests/fixtures/child-csp-known.json`)); } catch (_) { base = null; }
    if (!base) return;
    const was = new Map(base.entries.map((e) => [keyOf(e), e.count]));
    expect(KNOWN.entries.filter((e) => !was.has(keyOf(e)) || e.count > was.get(keyOf(e))).map(keyOf)).toEqual([]);
  });

  test(`${KNOWN_MAX} entries, ${KNOWN_COUNT_MAX} sources (lower these when a source is fixed; never raise them)`, () => {
    expect(KNOWN.entries.length).toBe(KNOWN_MAX);
    expect(KNOWN.entries.reduce((n, e) => n + e.count, 0)).toBe(KNOWN_COUNT_MAX);
  });
});
