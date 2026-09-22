/**
 * bd-aixwl -- THE REFERENCE SHEET PRINTED ITSELF WITH NOTHING ON IT.
 *
 * OPERATOR, on the three grade-3 chapter-2 renders: *"last page as an empty reference page
 * should be deleted completely"*. All three ended on a page carrying about a hundred and sixty
 * characters, every one of them furniture: the REFERENCE pill, the grade-subject-page locator,
 * the topic, and the footer. Nothing the lesson says.
 *
 * WHY IT EMPTIED. Four separate decisions each moved one group off this sheet and none of them
 * was wrong on its own. The board plan went to the end of the Introduction (bd-a8veu.7);
 * mistakes and differentiation went to the sections they belong to (bd-a8veu.10); the coaching
 * corner went to the end of the teaching flow (bd-yjmxh); model answers stopped being painted
 * at all (bd-ir1aq); and `next_period` went because page 1 already prints it (bd-a8veu.20). A
 * primary lesson carries no exam bank and, once `prunePending` has run, usually no homework
 * key either. `S` already refuses to paint a section whose bodies are all empty -- so every
 * section obeyed the rule and the PAGE still appeared, because the masthead was pushed before
 * the first `S` call and `paginate` gives any non-empty atom list a `.page` of its own.
 *
 * THE MASTHEAD IS NOT CONTENT. It is a running head: it re-identifies these sheets once they
 * are printed and shuffled (bd-a8veu.9). A running head over nothing is not a short page, it is
 * a blank one, and it costs a real sheet of paper in a school that pays per copy.
 *
 * SO THE RULE FOLLOWS `S`'s OWN: a support part that painted no section emits no atoms, which
 * means no page, which means the lesson's page total drops by one and the footers count what
 * was actually built. A support part that painted even one section is untouched -- masthead
 * included -- because then the sheet has something on it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const built = (d, lang) => buildHtml(d, { docDir: path.dirname(FIXTURE), lang: lang || 'en' });

/** The rendered `.page` boxes of one part, in print order -- `.page` nests, so split on the
    boxes' own opening tag rather than matching a pair. */
const pagesOf = (html, part) => html
  .split('<div class="page"')
  .slice(1)
  .filter((seg) => seg.startsWith(' id="') && new RegExp(`data-part="${part}"`).test(seg.slice(0, 60)));

/**
 * A primary lesson with nothing left for Reference to say: every group that has a flow host
 * takes it, and the two that do not -- the exam bank and the homework key -- are absent, which
 * is the ordinary shape of a grade 1-5 plan.
 */
function emptyReference() {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 3, subject: 'Math' };
  delete d.page2.exam_bank;
  delete d.page2.homework_key;
  return d;
}

/** The same lesson with one thing genuinely worth a sheet -- the control. */
function fullReference() {
  const d = emptyReference();
  d.page2.homework_key = [{ ref: null, item: 'Page 34, question 1', answer: '3,553', marks: 1 }];
  return d;
}

afterEach(() => setPageFormat('phone'));

describe('bd-aixwl: a Reference sheet with nothing on it is not printed', () => {
  test('the empty case builds no support page at all', () => {
    const { html } = built(emptyReference());
    expect(pagesOf(html, 'support')).toHaveLength(0);
  });

  test('and no REFERENCE running head is left floating on a teach page', () => {
    const { html } = built(emptyReference());
    expect(html).not.toMatch(/class="p2head[ "]/);
  });

  test('the lesson still has its teaching pages -- this removes a sheet, not the lesson', () => {
    const { html } = built(emptyReference());
    expect(pagesOf(html, 'teach').length).toBeGreaterThan(0);
  });

  test('the footers count the pages that were built, with no phantom last page', () => {
    const { html } = built(emptyReference());
    const teach = pagesOf(html, 'teach').length;
    // every footer's right-hand cell reads "page N of TOTAL" -- read the cell, not the prose,
    // which is full of its own numbers.
    const totals = [...html.matchAll(/<div class="fr">[^<]*?(\d+)\s*of\s*(\d+)<\/div>/g)]
      .map((m) => Number(m[2]));
    expect(totals).toHaveLength(teach);
    expect(Math.max(...totals)).toBe(teach);
  });

  test('a Reference sheet that has something to say is printed exactly as before', () => {
    const { html } = built(fullReference());
    expect(pagesOf(html, 'support')).toHaveLength(1);
    expect(html).toMatch(/class="p2head[ "]/);
  });

  test('the same holds on an Urdu page, where a wasted sheet costs most', () => {
    const { html } = built(emptyReference(), 'ur');
    expect(pagesOf(html, 'support')).toHaveLength(0);
  });
});
