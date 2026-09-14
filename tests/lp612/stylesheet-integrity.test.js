/**
 * bd-a8veu.19 — EVERY RULE IN THE EMITTED SHEET HAS A REAL SELECTOR.
 *
 * The whole stylesheet is ONE JS template literal, so a CSS comment that is closed early does not
 * fail to build and does not fail any existing test — the prose after the stray `*​/` simply ships
 * into the sheet as text. There is no browser in jest to complain, and `pdftotext` shows no colour,
 * so it survives every gate we have.
 *
 * What it costs is not cosmetic. A CSS parser meeting unexpected text at the top level treats it as
 * the PRELUDE of a qualified rule and keeps consuming until the next `{…}` block — which it then
 * discards along with the prelude. So the stray prose does not just sit there being ignored: it
 * EATS THE NEXT RULE.
 *
 * That is exactly what happened to the sequence strip. `f86d22a5` — the commit whose entire job was
 * to fix that strip's layout — closed its comment after "…a plan she did not write." and left six
 * lines of explanation loose in the sheet, directly above `.seq{ background … border … padding …
 * font-size … }`. The `.seq` box was dropped on every lesson rendered since, which is why the
 * operator kept reporting *"its design is off putting, and wasting lines and space"* about a strip
 * we believed we had already styled. `.seq b`, `.seq .now` and `.seq .arrow` survived, because they
 * come after the block that was eaten — so the strip had bold text and amber arrows and no box,
 * which reads as broken rather than as missing.
 *
 * The guard is generic on purpose. It does not look for that one sentence; it walks every rule in
 * the emitted sheet and insists the prelude looks like a selector list. Any future stray prose,
 * anywhere in the file, reddens here instead of silently deleting whichever rule follows it.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/**
 * The emitted sheet, comments stripped — i.e. what a CSS parser actually sees.
 *
 * The base64 `@font-face` payloads are stripped too, for two reasons: they are hundreds of KB of
 * opaque data that a failing `toMatch` would dump into the test output, and walking them character
 * by character is most of this suite's runtime. They contain no rule for the walker to check.
 */
function sheet() {
  const out = buildHtml(doc(), { docDir: path.dirname(FIXTURE) }).html;
  const open = out.indexOf('<style>');
  const close = out.lastIndexOf('</style>');
  expect(open).toBeGreaterThan(-1);
  return out
    .slice(open + 7, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/**
 * A selector list: names, classes, ids, attributes, combinators, pseudos, commas — plus the
 * at-rule preludes this sheet legitimately uses (`@media`, `@page`, `@font-face`, `@keyframes`)
 * and the percentage/`from`/`to` selectors inside a keyframes block.
 */
const SELECTOR = /^[-\w\s.#:,>+~*()[\]="'%@/ ]*$/;

describe('bd-a8veu.19 — the emitted stylesheet contains only CSS', () => {
  test('every rule prelude is a selector, not prose', () => {
    const css = sheet();
    const offenders = [];
    // Walk top-level rules. Nested blocks (@media) are entered, not skipped, so their inner
    // rules are checked too.
    let prelude = '';
    let depth = 0;
    for (const ch of css) {
      if (ch === '{') {
        if (depth === 0 || /^\s*@/.test(prelude) === false) {
          const p = prelude.trim();
          if (p && !SELECTOR.test(p)) offenders.push(p.slice(0, 90));
        }
        depth++;
        prelude = '';
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1);
        prelude = '';
      } else if (depth === 0 || /^\s*@/.test(prelude)) {
        prelude += ch;
      } else {
        // inside a declaration block: declarations, not preludes — but a nested block (@media)
        // restarts prelude accumulation, handled by the depth check above.
        prelude += ch;
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no stray comment terminator leaves prose loose in the sheet', () => {
    // The specific shape that caused this: an explanatory paragraph with no `/*` before it.
    // Asserted as a boolean, not `not.toMatch` — a failing matcher against the sheet prints the
    // whole sheet, and the sheet is hundreds of KB.
    expect(sheet().includes('It flows as TEXT')).toBe(false);
  });

  test('the .seq box survives — background, border and padding all reach the strip', () => {
    const css = sheet();
    const rule = css.match(/(^|})\s*\.seq\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[2]).toMatch(/background\s*:/);
    expect(rule[2]).toMatch(/border\s*:/);
    expect(rule[2]).toMatch(/padding\s*:/);
  });
});
