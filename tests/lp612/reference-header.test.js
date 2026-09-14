/**
 * bd-a8veu.9 — the Reference page's header fits in three line boxes.
 *
 * Operator, 2026-09-12, item 9 of the v9.3 PDF design review:
 *   *"Reference should be better formatted header to occupy only 3 lines at max"*
 *
 * WHAT IT LOOKED LIKE. On `grade_6_geography_c04_p63_en.pdf` the header printed FOUR lines:
 *
 *     REFERENCE
 *     Forests of Pakistan
 *     Grade 6 Geography · Not read aloud in class
 *     Ch. 4 · Forests of the World · p.63–64
 *
 * — and five once the topic is long enough to wrap. Three separate things each took a whole
 * line of a 478px column and none of them filled it:
 *
 *   1. The REFERENCE pill is `display:inline-block` with nothing beside it, so it sat alone on
 *      a line that was 352.8px blank — 74% of the measure spent on one nine-letter badge.
 *   2. The meta block carried a hard `<br>`, which is a line break that cannot be taken back:
 *      it costs a line whether or not the text needed one.
 *   3. The meta's second half repeated the chapter — `Ch. 4 · Forests of the World` — which
 *      page 1's hero already prints in full. The Reference page is the back of a plan the
 *      teacher is holding, not a second cover.
 *
 * WHAT IT IS NOW. An eyebrow and a name:
 *
 *     REFERENCE  Grade 6 Geography · p.63–64
 *     Forests of Pakistan
 *
 * WHAT DECIDES THE ARRANGEMENT is the arithmetic of the phone measure. The badge costs 133px of
 * whatever line it sits on. Beside the TITLE, a long topic loses a third of its first line and
 * runs to three lines by itself, which blows the budget; beside the META — short, fixed in
 * shape, never needing the whole measure — it costs nothing, and the title keeps the full width
 * on both of its lines. One line of furniture that cannot grow, plus at most two of topic.
 *
 * The meta carries the locator and nothing else. `Not read aloud in class` is the other thing
 * the arithmetic cannot fit, and it is the right one to drop: it is advice rather than identity,
 * and a page badged REFERENCE — model answers, an exam bank, the mistakes to expect — is not a
 * thing anyone reads to a class. Grade, subject and pages are what re-identify these sheets once
 * they are printed and shuffled, which is the job a running head exists to do.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. This repo's Jest run has no browser (`tests/__mocks__`
 * stubs playwright-core), so a line box cannot be counted here. What CAN be checked here is
 * every structural cause listed above — where the pill sits in the tree, the hard break, the
 * repeated chapter — each of which is emitted by `buildHtml` and each of which is a line. The
 * measurement half is recorded on the bead, taken off a real render at 520x2000 in Chrome,
 * counting each block's content height over its line-height:
 *
 *     fixture                        before             after
 *     v9_gate_base (EN)              4 lines / 133.8px  2 lines / 79.8px
 *     geography, the operator's own  4 lines / 133.8px  2 lines / 79.8px
 *     the same with a 63-char topic  5 lines / 164.9px  3 lines / 110.9px
 *     geography (UR)                 4 lines / 171.4px  2 lines / 101.3px
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const build = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) }).html;
const built = (lang = 'en') => build(doc(), lang);

/** the emitted BODY — everything after the stylesheet, so a class name in a CSS selector can
 *  never be mistaken for a class name on an element */
const body = (html) => html.slice(html.indexOf('</style>'));

/** the one rule the emitted sheet declares for `sel`, as it was written */
function rule(html, sel) {
  const m = html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  if (!m) throw new Error(`the emitted stylesheet has no rule for \`${sel}\``);
  return m[0];
}

/**
 * The Reference header as it was emitted, `<div class="p2head …">` through its closing tag.
 * `atom()` rewrites the outer class attribute (`class="p2head sp-0"`), so the needle matches
 * the OPENING of the attribute and the slice runs to the matching close.
 */
function header(html) {
  const b = body(html);
  const i = b.indexOf('class="p2head');
  if (i < 0) throw new Error('the emitted document has no Reference header');
  const open = b.lastIndexOf('<div', i);
  let depth = 0;
  for (const m of b.slice(open).matchAll(/<(\/?)div\b[^>]*>/g)) {
    if (m[1]) depth--;
    else depth++;
    if (depth === 0) return b.slice(open, open + m.index + m[0].length);
  }
  throw new Error('the Reference header is not closed');
}

/** the inner HTML of the header's `<div class="t">` — the title line */
function titleLine(h) {
  const i = h.indexOf('class="t"');
  if (i < 0) throw new Error('the Reference header has no title block');
  const from = h.indexOf('>', i) + 1;
  return h.slice(from, h.indexOf('</div>', from));
}

/** the inner HTML of the header's `<div class="r">` — the meta line */
function metaLine(h) {
  const i = h.indexOf('class="r"');
  if (i < 0) throw new Error('the Reference header has no meta block');
  const from = h.indexOf('>', i) + 1;
  return h.slice(from, h.indexOf('</div>', from));
}

describe('bd-a8veu.9 — the Reference header is a running head, not a second cover', () => {
  // ── 1. the pill shares the meta's line ───────────────────────────────────
  test('the REFERENCE pill is emitted INSIDE the meta line, not on a line of its own', () => {
    // The pill is inline-block. As a sibling ahead of a block-level title it could only ever be
    // alone on its line. Inside the meta it flows ahead of the locator; inside the TITLE it
    // would flow too, but there it costs a long topic a third of its first line.
    const h = header(built());
    expect(metaLine(h)).toContain('class="pill"');
    expect(titleLine(h)).not.toContain('class="pill"');
    expect(h).toContain('Reference'); // …and the badge was not simply deleted
  });

  test('the eyebrow leads: the meta line is emitted BEFORE the title', () => {
    // Reversed from the old order, which put the topic first and the meta under it. The pill
    // has to open the header for it to read as an eyebrow rather than a caption.
    const h = header(built());
    expect(h.indexOf('class="r"')).toBeLessThan(h.indexOf('class="t"'));
  });

  test('the pill is spaced off the topic in the READING direction', () => {
    // A trailing margin, not a literal `margin-right`: on the Urdu page the gap belongs on
    // the left. `start`/`end` are interpolated per direction at template.js:259-260.
    expect(rule(built(), '.p2head .pill')).toMatch(/margin-right:\s*\d/);
    expect(rule(built('ur'), '.p2head .pill')).toMatch(/margin-left:\s*\d/);
  });

  // ── 2. no hard break ─────────────────────────────────────────────────────
  test('the header contains no <br> — a break it cannot take back', () => {
    expect(header(built())).not.toMatch(/<br\s*\/?>/i);
    expect(header(built('ur'))).not.toMatch(/<br\s*\/?>/i);
  });

  // ── 3. the meta is a locator, and says it once ───────────────────────────
  test('the meta line names the grade, the subject and the pages — the locator, nothing else', () => {
    const m = metaLine(header(built()));
    const p = doc().provenance;
    expect(m).toContain(`Grade ${p.grade}`);
    expect(m).toContain(p.subject);
    expect(m).toContain(p.printed_pages);
  });

  test('the meta line does NOT repeat the chapter, which page 1 already prints in full', () => {
    const html = built();
    const p = doc().provenance;
    expect(metaLine(header(html))).not.toContain(p.chapter_title);
    // moved, not lost: the hero on page 1 still carries the whole chapter line
    expect(body(html).indexOf(p.chapter)).toBeGreaterThan(-1);
    expect(body(html).indexOf(p.chapter)).toBeLessThan(body(html).indexOf('class="p2head'));
  });

  test('the Urdu header carries the same locator, in Urdu, and the same omissions', () => {
    const h = header(built('ur'));
    const m = metaLine(h);
    const p = doc().provenance;
    expect(m).toContain('جماعت');
    expect(m).toContain(p.printed_pages);
    expect(m).toContain('حوالہ جاتی مواد'); // the eyebrow, inside the meta line
    expect(m).not.toContain(p.chapter_title);
    expect(h).not.toContain('کلاس میں پڑھ کر نہ سنائیں');
  });

  // ── 4. regression guards on what must not change ─────────────────────────
  test('the header is still a block, so nothing in it is an atomic flex item', () => {
    // The sequence strip's defect (bd-a8veu.2) one section down: a flex child that does not
    // fit jumps to the next line whole and strands the rest of its own line.
    const r = rule(built(), '.p2head');
    expect(r).not.toMatch(/display:\s*flex/);
    expect(r).toMatch(/border-bottom:\s*3px solid/);
  });

  test('the topic is still the loudest thing in the header', () => {
    // Sizes are asserted against each other, not against a number: the sheet is emitted
    // through `scaledPx`, so 20.5px in the source ships as 23.92px on the phone page.
    const html = built();
    expect(titleLine(header(html))).toContain(doc().provenance.topic);
    const px = (sel) => parseFloat(rule(html, sel).match(/font-size:\s*([\d.]+)px/)[1]);
    expect(px('.p2head .t')).toBeGreaterThan(px('.p2head .r'));
    expect(px('.p2head .t')).toBeGreaterThan(px('.p2head .pill'));
  });
});
