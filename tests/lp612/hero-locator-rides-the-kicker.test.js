/**
 * bd-p5418 -- THE HERO MASTHEAD SPENDS FOUR LINES SAYING FOUR SHORT THINGS.
 *
 * OPERATOR, with a screenshot of the phone render attached: *"the header/footer has too many
 * lines"*, and *"the header caption containing the page numbr and minutes of the class can be
 * on the right, I took a screenshot of the artifact, save space Claude!!!"*
 *
 * What she photographed, top to bottom, on a 520px page:
 *
 *     GRADE 3 · ENGLISH                      <- kicker, ~18 characters of a 478px measure
 *     Reading: Jojo Doesn't Want to Go       <- the title, and the only line that earns its width
 *     to School
 *     Ch.2 · See? We're All Special!         <- the chapter
 *     p.13 · 40 min                          <- the locator
 *
 * Four stacked rows, two of which are short enough to share one.
 *
 * WHY THE OLD TWO-COLUMN SPLIT IS NOT THE ANSWER, and must not come back. The stacking is a
 * measured fix, not an oversight (v9.3, bd-oak77.16): `.hero .h-meta` is `flex:0 1 auto`, so at
 * the phone measure it shrank to ~110px and printed "Ch. 1 · Matrices and Determinants p.24-25
 * · 40 min" down FIVE lines while stealing the width from the title. Restoring the pair would
 * restore that. The `max-width:46%` cap on A4 is measured too -- an uncapped board badge set the
 * column split, and at 63 characters the title was down to 23% of the hero and nine lines.
 *
 * SO THE FIX IS NOT A COLUMN, IT IS A HOST LINE. Of the four rows exactly one is short AND
 * fixed in shape: the kicker is `GRADE <n> · <subject>`, and the locator is `p.<pages> · <n>
 * min`. Pinning the locator to the reading-end of the kicker's own line costs the kicker
 * nothing it was using and costs the title and the chapter nothing at all -- they keep the full
 * measure they have today. This is the same arithmetic `.p2head` already runs on the support
 * page: the piece that is short and fixed shares the eyebrow, the piece that has to wrap gets
 * the whole column.
 *
 * TWO THINGS HOLD IT. The locator is `white-space:nowrap`, so it can never become the wrapping
 * meta column this replaced; and the kicker -- not the locator -- is the flex item that may
 * shrink, so a long subject wraps the kicker and leaves the locator whole and readable on the
 * first line. Degrading the wrong way round is the pathology, not the length.
 *
 * THE BOARD BADGE keeps its own row and is not counted against the three. It is a pill, it is
 * G6-12 only (grades 6-8 print none at all), and the operator's screenshot is a grade 3 plan
 * that has none -- so the three-row bound is asserted on the shape she photographed, and the
 * badge is asserted separately to cost exactly one row and never more.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
/** The shape the operator photographed: no board badge (she reviews grade 1-5). */
const noBadgeDoc = () => { const d = baseDoc(); delete d.board_weight; return d; };

/** `buildHtml` re-applies `setPageFormat(opts.format || 'phone')` on every call, so the format
 *  has to travel in the build options -- a bare `setPageFormat` beforehand is overwritten. */
const build = (doc = noBadgeDoc(), opts = {}) =>
  buildHtml(doc, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts }).html;

const sheet = (html) => html.split('<style>')[1].split('</style>')[0]
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\(data:[^)]*\)/g, 'url()');
const rule = (html, sel) => {
  const m = sheet(html).match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  return m ? m[0] : null;
};

/** The hero element, by a balanced `<div>` scan -- it holds nothing but divs, spans and bolds. */
function hero(html) {
  // the atom decorator rewrites the root tag (`<div data-atom class="hero sp-0">`)
  const m0 = /<div\b[^>]*class="(?:[^"]*\s)?hero(?:\s[^"]*)?"[^>]*>/.exec(html);
  if (!m0) return null;
  const i = m0.index;
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(i, re.lastIndex);
  }
  return null;
}

/** Class names the emitted sheet lays on ONE flex line inside the hero. Read off the sheet, so
 *  a row that quietly stops being a row is counted as the rows it really becomes. `flex-wrap`
 *  disqualifies a rule: a wrapping row is not a bound. */
const oneLineFlexClasses = (html) => new Set(
  [...sheet(html).matchAll(/\.hero \.([\w-]+)\{([^}]*)\}/g)]
    .filter((m) => /display:\s*flex/.test(m[2]) && !/flex-wrap/.test(m[2]))
    .map((m) => m[1]),
);

/**
 * How many LINE ROWS the hero stacks -- the number the operator counted off her screenshot.
 * An element that holds text of its own is one row; everything inside a one-line flex row
 * counts once, between them all, which is the entire point of the change.
 */
function heroRows(html) {
  const frag = hero(html);
  const flexSet = oneLineFlexClasses(html);
  const stack = [];
  let rows = 0;
  let inFlexRow = 0;                                     // depth of the open flex row, or 0
  const re = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*?)\/?>|([^<]+)/g;
  for (let m = re.exec(frag); m; m = re.exec(frag)) {
    if (m[4] !== undefined) {                            // a text run
      if (!m[4].trim() || inFlexRow) continue;
      const top = stack[stack.length - 1];
      if (top && !top.counted) { top.counted = true; rows += 1; }
      continue;
    }
    if (m[1]) {                                          // a closing tag
      if (inFlexRow === stack.length) inFlexRow = 0;
      stack.pop();
      continue;
    }
    const cls = (/class="([^"]*)"/.exec(m[3]) || [, ''])[1].split(/\s+/);
    stack.push({ counted: false });
    if (!inFlexRow && cls.some((c) => flexSet.has(c))) { inFlexRow = stack.length; rows += 1; }
  }
  return rows;
}

/** The text of the hero, tags stripped -- what a reader sees, in order. */
const heroText = (html) => hero(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** The class of the element carrying the page/minutes locator (`sp-N` is the rhythm class the
 *  atom decorator adds, never the name). */
function locatorClass(html) {
  const frag = hero(html);
  const i = frag.indexOf('p.24-25');
  if (i < 0) return null;
  const open = frag.lastIndexOf('<', i);
  const tag = frag.slice(open, frag.indexOf('>', open) + 1);
  const cls = (/class="([^"]*)"/.exec(tag) || [, ''])[1];
  return cls.split(/\s+/).find((c) => c && !/^sp-\d$/.test(c)) || null;
}

afterEach(() => setPageFormat('phone'));

describe('bd-p5418: the locator rides the kicker line instead of buying its own', () => {
  test('the phone hero stacks at most THREE line rows', () => {
    expect(heroRows(build())).toBeLessThanOrEqual(3);
  });

  test('the locator is emitted on the eyebrow, between the kicker and the title', () => {
    const frag = hero(build());
    const kicker = frag.indexOf('class="kicker"');
    const loc = frag.indexOf('p.24-25');
    const title = frag.indexOf('class="h-title"');
    expect(kicker).toBeGreaterThan(-1);
    expect(loc).toBeGreaterThan(kicker);
    expect(loc).toBeLessThan(title);
  });

  test('the kicker and the locator are laid on ONE flex line', () => {
    const html = build();
    const frag = hero(html);
    const flexSet = oneLineFlexClasses(html);
    // the SAME element encloses both, and the sheet lays that element on a single flex line
    const rows = [...frag.matchAll(/<div\b[^>]*class="([^"]*)"[^>]*>/g)]
      .filter((m) => m[1].split(/\s+/).some((c) => flexSet.has(c)));
    expect(rows).toHaveLength(1);
    const row = frag.slice(rows[0].index, frag.indexOf('</div>', frag.indexOf('p.24-25')));
    expect(row).toContain('class="kicker"');
    expect(row).toContain('p.24-25');
  });

  test('the locator can never wrap, whatever it holds', () => {
    const html = build();
    expect(rule(html, `.hero .${locatorClass(html)}`)).toMatch(/white-space:\s*nowrap/);
  });

  test('a long subject shrinks the KICKER, never the locator', () => {
    // the pathology this replaces is a meta column that shrinks and wraps. Whichever item
    // yields, it must not be the one carrying the page number and the minutes.
    const html = build();
    expect(rule(html, `.hero .${locatorClass(html)}`)).toMatch(/flex:\s*0 0 auto/);
    expect(rule(html, '.hero .kicker')).toMatch(/min-width:\s*0/);
  });

  test('the page and the minutes are printed ONCE', () => {
    const t = heroText(build());
    expect(t.match(/p\.24-25/g)).toHaveLength(1);
    expect(t.match(/40 min/g)).toHaveLength(1);
  });

  test('the board badge costs exactly one row on top, and nothing else moves', () => {
    expect(heroRows(build(baseDoc()))).toBe(heroRows(build()) + 1);
  });

  test('the title and the chapter keep the full measure -- no column pair comes back', () => {
    const html = build();
    expect(rule(html, '.hero')).toMatch(/display:\s*block/);
    expect(rule(html, '.hero')).not.toMatch(/display:\s*flex/);
    expect(rule(html, '.hero .h-meta')).toMatch(/max-width:\s*100%/);
  });

  describe('a4 (794px) does not regress', () => {
    const a4 = (doc) => build(doc, { format: 'a4' });

    test('the masthead is at most three rows there too', () => {
      expect(heroRows(a4())).toBeLessThanOrEqual(3);
    });

    test('the two-column hero survives, capped exactly as it was', () => {
      expect(rule(a4(), '.hero')).toMatch(/display:\s*flex/);
      expect(rule(a4(), '.hero .h-meta')).toMatch(/max-width:\s*46%/);
    });

    test('the locator is on the eyebrow there too, and still cannot wrap', () => {
      const html = a4();
      expect(rule(html, `.hero .${locatorClass(html)}`)).toMatch(/white-space:\s*nowrap/);
    });
  });
});
