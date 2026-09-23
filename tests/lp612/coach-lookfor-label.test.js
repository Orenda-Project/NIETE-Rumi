/**
 * bd-6bvh0 -- THE LOOK-FOR IS THE ONE LINE IN THE CORNER THAT DOES NOT SAY WHAT IT IS.
 *
 * OPERATOR: *"coaching corner should hve a look for"*.
 *
 * It has one, and it has had one all along -- `page2.coaching_lookfor` is the corner's single
 * REQUIRED field (schema, page2.required), it is authored in every lesson of the trio, and
 * `coachCard` prints it. What it does not do is name it. The card renders as a "Coaching
 * corner" heading, then a bare paragraph, then a paragraph that DOES carry a label ("Ask
 * yourself" / "خود سے پوچھیے"). A labelled line under an unlabelled one reads as though the
 * unlabelled one were preamble to it -- so the thing she asked for prints as throat-clearing
 * before the question, and the only line in the corner addressed to what she should watch in
 * the classroom is the only line with no name on it.
 *
 * The fix is one span, not a rewrite: the body text is already right, and touching it would
 * re-open content the operator has signed off. This asserts the label, in both languages,
 * and asserts the body it labels is unchanged.
 *
 * RULE 20. A new teacher-facing label exists in BOTH language blocks of `overlay.js`, in real
 * Urdu -- an English string left in the `ur` block prints Latin text inside an RTL line, which
 * is how the phone number once printed backwards. The last test here is that guard.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** The fixture at a primary grade -- the one thing `isPrimary` reads -- so the corner is
    hoisted into the teach flow and carries its heading, which is the card the operator sees. */
function doc() {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return d;
}

const built = (lang) => buildHtml(doc(), { docDir: path.dirname(FIXTURE), lang: lang || 'en' }).html;
/** The one `<div class="coach ...">` card, from its opening tag to the end of the offer line. */
const card = (html) => {
  const i = html.search(/class="coach[ "]/);
  expect(i).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf('</div>', html.indexOf('class="offer"', i)));
};

afterEach(() => setPageFormat('phone'));

describe('bd-6bvh0: the look-for says that it is the look-for', () => {
  test('the paragraph carries a label, like the question below it does', () => {
    expect(card(built('en'))).toMatch(
      new RegExp(`<p><span class="lbl">${LABELS.en.coachLook}</span>`));
  });

  test('the Urdu card carries its own, in Urdu', () => {
    expect(card(built('ur'))).toContain(`<span class="lbl">${LABELS.ur.coachLook}</span>`);
  });

  /** The defect was "unlabelled", not "wrong" -- the sentence the operator approved stays. */
  test('the look-for text itself is untouched', () => {
    const body = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).page2.coaching_lookfor;
    expect(card(built('en'))).toContain(body);
  });

  test('the reflection keeps its own label -- two labels, not one moved', () => {
    const c = card(built('en'));
    expect(c).toContain(`<span class="lbl">${LABELS.en.coachAsk}</span>`);
    expect((c.match(/class="lbl"/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * THE 1-5 WORK STAYS SEPARATE FROM 6-12 (operator: *"pls make sure the 1-5 work is separate
   * from 6-12"*). The corner is one function serving both sheets, and the G6-12 ones are live.
   * `primary-worked-cfu` holds the grade-9 body byte-for-byte and is what caught this span
   * leaking into it -- this test says the same thing in words, where the next reader will look.
   */
  test('a G6-12 sheet is untouched -- its look-for prints exactly as it did', () => {
    const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    expect(d.provenance.grade).toBe(9);
    const c = card(buildHtml(d, { docDir: path.dirname(FIXTURE) }).html);
    expect(c).toContain(`<p>${d.page2.coaching_lookfor}`);
    expect(c).not.toContain(LABELS.en.coachLook);
  });

  /** Rule 20. Both blocks, and the Urdu one in Urdu script rather than a copied English string. */
  test('the label exists in both language blocks, and the Urdu one is Urdu', () => {
    expect(typeof LABELS.en.coachLook).toBe('string');
    expect(typeof LABELS.ur.coachLook).toBe('string');
    expect(LABELS.ur.coachLook).not.toBe(LABELS.en.coachLook);
    expect(LABELS.ur.coachLook).toMatch(/[؀-ۿ]/);
    expect(LABELS.ur.coachLook).not.toMatch(/[A-Za-z]/);
  });
});
