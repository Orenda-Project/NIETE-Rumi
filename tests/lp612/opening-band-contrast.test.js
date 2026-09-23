/**
 * bd-f445i -- THE CRUX AND THE DC CHIP ARE UNREADABLE ON THE NAVY OPENING BAND.
 *
 * OPERATOR, three separate times, about three different subjects:
 *   *"the font colour should be different, hard to read with a dark background"*
 *   *"Engliosh opening hook has same font colour issue"*
 *   *"Urdu has similar feedback to english and Math with the font colour"*
 *
 * Three messages, three subjects, one cause -- so this is not a subject bug and it is
 * not three bugs. The Opening block renders as `.blk hook`, which is
 * `background:var(--navy)` (#303749) and sets `color:#fff` on itself. Everything the
 * band printed BEFORE bd-3jemp/bd-yjmxh was authored as a `.hook`-scoped rule and got
 * an on-navy ink to go with it: `.hook .lbl` amber, `.hook .lf` the light #c9d4e6.
 *
 * Then `movePill()` started injecting TWO more children into whatever container a block
 * rendered as -- `<span class="dct">` (the Digital Coach phase) and `<div class="crux">`
 * (the one line a teacher acts on). Both are styled by GLOBAL rules written for a white
 * page: `.crux` is `color:var(--ink)` (#1a2233) and `.dct` is `color:var(--mut)`
 * (#5b6472). Neither has ever had a `.hook`-scoped override. On the navy band that is
 * 1.34:1 and 1.99:1 measured -- WCAG AA body text wants 4.5:1. The crux, the single most
 * important line on the block, was the least legible thing on the page.
 *
 * WHY THE TEST SCANS RATHER THAN NAMES. Listing `.hook .crux` and `.hook .dct` would fix
 * today and re-open the hole the next time a global child is injected into the band --
 * which is exactly how this one opened. So the test walks the RENDERED Opening band,
 * collects every class that actually prints inside it, resolves each one's effective ink
 * through the same cascade the browser would (a `.hook `-scoped rule wins over the bare
 * one; no rule at all means it inherits the band's white), and measures it. Any future
 * child that lands on navy wearing page ink fails here before an operator sees it.
 *
 * NO NEW HEXES. The on-navy inks already on this sheet are #fff for the loud thing and
 * #c9d4e6 for the quiet one (`.hook .lf`, `.hero .h-sub`). The crux is heading weight and
 * takes the white; the chip is deliberately quieter than the move pill beside it and
 * takes the light ink, now named `--ink-on-navy` so the next rule has a token to reach
 * for instead of a literal.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** WCAG AA for body text. The crux is body text that happens to be bold. */
const AA = 4.5;
/** The band's own fill -- the thing every ink inside it is measured against. */
const NAVY = '#303749';

/* ----------------------------------------------------------------- colour maths */

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Relative luminance of a #rgb or #rrggbb literal. */
function luminance(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => srgb(parseInt(h.substr(i, 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours. */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ------------------------------------------------------------------ the document */

/** The gate fixture re-provenanced to a primary grade -- `isPrimary` is what gates the
 *  move pill, the DC chip and the crux, and none of the three prints without it. */
function doc() {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  const hook = d.sections.find((s) => s.id === 'introduction').blocks.find((b) => b.hook);
  // The fixture authors no crux, and an unauthored crux renders nothing at all -- so the
  // most damaging half of this defect would be invisible to a test built on it as-is.
  hook.crux = 'Ask the question, then wait five seconds before taking an answer.';
  return d;
}

const built = (lang) => buildHtml(doc(), { docDir: path.dirname(FIXTURE), lang: lang || 'en' });
const sheetOf = (html) => html.slice(0, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const bodyOf = (html) => html.split('</style>').pop();

/* ------------------------------------------------------------- a very small cascade */

/** Every `selectorList { declarations }` pair in source order. */
function rules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim()),
    decls: m[2],
  }));
}

/** The `:root` custom properties, as a plain map. */
function tokens(css) {
  const out = {};
  for (const r of rules(css)) {
    if (!r.selectors.includes(':root')) continue;
    for (const m of r.decls.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[m[1]] = m[2].trim();
  }
  return out;
}

/** A declared value with any `var(--x)` resolved through `:root`, transitively. */
function resolve(value, vars, depth = 0) {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(String(value).trim());
  if (!m || depth > 8) return String(value).trim();
  return resolve(vars[m[1]] == null ? '' : vars[m[1]], vars, depth + 1);
}

/** The last `color:` declared by any rule whose selector list contains `sel` exactly. */
function inkFor(css, vars, sel) {
  let ink = null;
  for (const r of rules(css)) {
    if (!r.selectors.includes(sel)) continue;
    const m = [...r.decls.matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)].pop();
    if (m) ink = resolve(m[1], vars);
  }
  return ink;
}

/* ----------------------------------------------------------- the rendered band itself */

/** The Opening band's own markup, from its opening tag to its matching close. */
function openingBand(body) {
  const open = /<div[^>]*class="[^"]*\bhook\b[^"]*"[^>]*>/.exec(body);
  if (!open) return null;
  let i = open.index + open[0].length;
  let depth = 1;
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = i;
  let m;
  while ((m = tag.exec(body))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return body.slice(open.index, m.index + m[0].length);
  }
  return body.slice(open.index);
}

/** Every distinct class printed INSIDE the band (the band's own classes excluded). */
function descendantClasses(band) {
  const inner = band.slice(band.indexOf('>') + 1);
  const seen = new Set();
  for (const m of inner.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) seen.add(c);
  }
  return [...seen];
}

/** Effective ink for one class inside the band: the scoped rule wins, then the bare one,
 *  and a class with neither simply inherits the band's `color:#fff`. */
function effectiveInk(css, vars, cls) {
  return inkFor(css, vars, `.hook .${cls}`) || inkFor(css, vars, `.${cls}`) || '#ffffff';
}

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------------ 1. the two reported offenders */

describe('bd-f445i: the Opening band gives its injected children an on-navy ink', () => {
  test('the band really is the navy fill everything here is measured against', () => {
    const css = sheetOf(built().html);
    const vars = tokens(css);
    expect(resolve(vars['--navy'], vars).toLowerCase()).toBe(NAVY);
    const band = rules(css).find((r) => r.selectors.includes('.hook'));
    expect(resolve(/background\s*:\s*([^;]+)/.exec(band.decls)[1], vars).toLowerCase()).toBe(NAVY);
  });

  test('the crux is scoped to the band at all -- a bare `.crux` is page ink on navy', () => {
    const css = sheetOf(built().html);
    expect(inkFor(css, tokens(css), '.hook .crux')).not.toBeNull();
  });

  test('the crux clears AA on the band', () => {
    const css = sheetOf(built().html);
    expect(contrast(effectiveInk(css, tokens(css), 'crux'), NAVY)).toBeGreaterThanOrEqual(AA);
  });

  test('the DC phase chip is scoped to the band at all', () => {
    const css = sheetOf(built().html);
    expect(inkFor(css, tokens(css), '.hook .dct')).not.toBeNull();
  });

  test('the DC phase chip clears AA on the band', () => {
    const css = sheetOf(built().html);
    expect(contrast(effectiveInk(css, tokens(css), 'dct'), NAVY)).toBeGreaterThanOrEqual(AA);
  });

  test('the chip stays quieter than the crux -- outline and light ink, not a second heading', () => {
    const css = sheetOf(built().html);
    const vars = tokens(css);
    expect(contrast(effectiveInk(css, vars, 'crux'), NAVY))
      .toBeGreaterThan(contrast(effectiveInk(css, vars, 'dct'), NAVY));
  });

  test('the crux keeps the amber rule that already read on navy', () => {
    const css = sheetOf(built().html);
    const decls = rules(css).filter((r) => r.selectors.some((s) => s === '.crux')).map((r) => r.decls).join(';');
    expect(decls).toMatch(/border-(inline-start|left|right)\s*:\s*3px solid var\(--amber\)/);
  });
});

/* ----------------------------------- 2. the systematic part -- scan, do not enumerate */

describe('bd-f445i: nothing printed inside the Opening band wears page ink', () => {
  for (const lang of ['en', 'ur']) {
    test(`every class rendered inside the ${lang} band clears AA against the navy`, () => {
      const { html } = built(lang);
      const css = sheetOf(html);
      const vars = tokens(css);
      const band = openingBand(bodyOf(html));
      expect(band).not.toBeNull();
      const classes = descendantClasses(band);
      // Guard the guard: if the band ever stops printing the two children this bead is
      // about, the scan would pass by printing nothing.
      expect(classes).toEqual(expect.arrayContaining(['crux', 'dct']));
      const failures = classes
        .map((c) => [c, contrast(effectiveInk(css, vars, c), NAVY)])
        .filter(([, ratio]) => ratio < AA)
        .map(([c, ratio]) => `.${c} ${ratio.toFixed(2)}:1`);
      expect(failures).toEqual([]);
    });
  }
});

/* ------------------------------------------------- 3. the token, so the next rule reuses */

describe('bd-f445i: the on-navy ink is a token, not a fourth loose literal', () => {
  test('`--ink-on-navy` exists and is the light ink the band already used', () => {
    const vars = tokens(sheetOf(built().html));
    expect(String(vars['--ink-on-navy'] || '').toLowerCase()).toBe('#c9d4e6');
  });

  test('the look-for line now reads the token rather than repeating the hex', () => {
    const css = sheetOf(built().html);
    const lf = rules(css).find((r) => r.selectors.includes('.hook .lf'));
    expect(lf.decls).toMatch(/color\s*:\s*var\(--ink-on-navy\)/);
  });
});
