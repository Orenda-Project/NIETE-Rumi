/**
 * bd-oyqb2 item 4 -- THE ARRAY FORM'S OWN TWO DEFECTS, BOTH INSIDE THE OPENING HOOK.
 *
 * `ask.question` was one of the nine slots widened to `string | string[]`, and an array there
 * renders through `richRows`, which emits `<ul class="kp">`. That list is styled by the GLOBAL
 * `.kp` rules, which were written for a white page -- so the moment the operator's own
 * *"format this better"* request is honoured on the OPEN WITH THIS QUESTION block, two things
 * silently go wrong that never went wrong for the string form:
 *
 *   1. MARKERS VANISH. `.hook` is `background:var(--navy)` = #303749. `.kp li::marker` is
 *      `color:var(--navy2)` = #2A3550. Measured: 1.03:1. The bullets are invisible on the
 *      band. This is the SAME defect bd-f445i fixed for `.crux` and `.dct` -- a global rule
 *      chosen against white landing on the navy band -- and the same operator complaint:
 *      *"the font colour should be different, hard to read with a dark background"*,
 *      *"Engliosh opening hook has same font colour issue"*. bd-f445i's scan walks CLASSES and
 *      resolves `color:`; a `::marker` pseudo carries its own `color` and is invisible to it,
 *      which is why this one survived that sweep.
 *
 *   2. THE WORDS SHRINK BY 1px. `.hook .q` is 19px; `.kp li` is 18px. Changing the AUTHORED
 *      SHAPE of a field must not change its type size -- the array is a LAYOUT of the question,
 *      not a different kind of text. Resolved UPWARDS, and by inheritance rather than by a
 *      second literal 19: the list takes `.hook .q`'s own size, so the two can never drift.
 *      Resolving downwards was rejected -- it would shrink the loudest box on page 1, and the
 *      operator's complaint about this block is that it is hard to read, not that it is loud.
 *
 * NEITHER is a type-floor change: the global `.kp li` stays 18px, which is BODY_FLOOR_PX/
 * TYPE_SCALE, so `smallest body 21px (floor 21)` is unmoved. Only the hook's own list grows.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, TYPE_SCALE } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'primary_g1_english.lp.json');

/** WCAG AA for body text; the markers sit beside 19px/700 words, so this is the strict bar. */
const AA = 4.5;
const NAVY = '#303749';

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function luminance(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => srgb(parseInt(h.substr(i, 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const QUESTION = ['What do you see in the picture?', 'What do you think happens next?'];

function doc(question) {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const hook = d.sections.find((s) => s.id === 'introduction').blocks.find((b) => b.hook);
  if (question !== undefined) hook.question = question;
  return d;
}
const built = (q) => buildHtml(doc(q), { docDir: path.dirname(FIXTURE) }).html;
/** Comments stripped: several carry hex literals and `font-size:` in prose. */
const sheetOf = (html) => html.slice(0, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const bodyOf = (html) => html.split('</style>').pop();

function rules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim()),
    decls: m[2],
  }));
}
function tokens(css) {
  const out = {};
  for (const r of rules(css)) {
    if (!r.selectors.includes(':root')) continue;
    for (const m of r.decls.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[m[1]] = m[2].trim();
  }
  return out;
}
function resolve(value, vars, depth = 0) {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(String(value).trim());
  if (!m || depth > 8) return String(value).trim();
  return resolve(vars[m[1]] == null ? '' : vars[m[1]], vars, depth + 1);
}
/** The last `<prop>:` declared by any rule whose selector list contains `sel` exactly. */
function declFor(css, sel, prop) {
  let v = null;
  for (const r of rules(css)) {
    if (!r.selectors.includes(sel)) continue;
    const m = [...r.decls.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))].pop();
    if (m) v = m[1].trim();
  }
  return v;
}
const px = (v) => (v == null ? null : Number(/([\d.]+)px/.exec(v)[1]));

/* --------------------------------------------------------------- the array really lands */

describe('bd-oyqb2 item 4: an array question prints a .kp list on the navy hook ground', () => {
  test('the hook renders a <ul class="kp"> when its question is an array', () => {
    expect(bodyOf(built(QUESTION))).toContain(
      `<div class="q"><ul class="kp">${QUESTION.map((x) => `<li>${x}</li>`).join('')}</ul></div>`
    );
  });

  test('the string form is unchanged -- no list, no marker, no size question', () => {
    expect(bodyOf(built('One plain question.'))).toContain('<div class="q">One plain question.</div>');
  });

  test('the ground really is the navy this is all measured against', () => {
    const css = sheetOf(built(QUESTION));
    const vars = tokens(css);
    expect(resolve(declFor(css, '.hook', 'background'), vars).toLowerCase()).toBe(NAVY);
  });
});

/* ------------------------------------------------------------------ 1. marker contrast */

describe('bd-oyqb2 item 4: the list markers read on the hook ground', () => {
  test('the global .kp marker is the one that is unreadable here -- that is the defect', () => {
    const css = sheetOf(built(QUESTION));
    const vars = tokens(css);
    const global = resolve(declFor(css, '.kp li::marker', 'color'), vars);
    expect(contrast(global, NAVY)).toBeLessThan(AA);
  });

  test('a .hook-scoped marker rule exists at all', () => {
    const css = sheetOf(built(QUESTION));
    expect(declFor(css, '.hook .kp li::marker', 'color')).not.toBeNull();
  });

  test('the effective marker ink clears AA against the navy', () => {
    const css = sheetOf(built(QUESTION));
    const vars = tokens(css);
    const ink = resolve(declFor(css, '.hook .kp li::marker', 'color'), vars);
    expect(contrast(ink, NAVY)).toBeGreaterThanOrEqual(AA);
  });

  test('it is a token already on the sheet, not a new hex', () => {
    const css = sheetOf(built(QUESTION));
    expect(declFor(css, '.hook .kp li::marker', 'color')).toMatch(/^var\(--[\w-]+\)$/);
  });

  test('every other .kp ground is untouched -- the global marker still reads on white', () => {
    const css = sheetOf(built(QUESTION));
    const vars = tokens(css);
    const global = resolve(declFor(css, '.kp li::marker', 'color'), vars);
    expect(global.toLowerCase()).toBe(resolve(vars['--navy2'], vars).toLowerCase());
    expect(contrast(global, '#ffffff')).toBeGreaterThanOrEqual(AA);
  });
});

/* ----------------------------------------------------------------- 2. the silent 1px */

describe('bd-oyqb2 item 4: the authored shape does not change the type size', () => {
  test('the hook question and the global .kp item really do disagree -- that is the defect', () => {
    const css = sheetOf(built(QUESTION));
    expect(px(declFor(css, '.hook .q', 'font-size')))
      .not.toBe(px(declFor(css, '.kp li', 'font-size')));
  });

  test('the hook list is pinned to the hook question by inheritance, not by a second literal', () => {
    const css = sheetOf(built(QUESTION));
    expect(declFor(css, '.hook .q .kp li', 'font-size')).toBe('inherit');
  });

  test('the resolution is UPWARDS -- the question keeps its 19px source size', () => {
    const css = sheetOf(built(QUESTION));
    // scaleTypeCss multiplies every source px by TYPE_SCALE on the way out.
    expect(px(declFor(css, '.hook .q', 'font-size'))).toBe(+(19 * TYPE_SCALE).toFixed(2));
  });

  test('the TYPE FLOOR is unmoved: the global .kp item is still 18px source = 21px emitted', () => {
    const css = sheetOf(built(QUESTION));
    expect(px(declFor(css, '.kp li', 'font-size'))).toBe(+(18 * TYPE_SCALE).toFixed(2));
  });
});
