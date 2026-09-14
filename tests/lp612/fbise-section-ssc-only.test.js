/**
 * bd-a8veu.18 — THE FBISE SECTION IS FOR SSC. A GRADE 6-8 PLAN DOES NOT GET ONE.
 *
 * OPERATOR, 2026-09-12: *"Section B in the reference section is not needed."*
 *
 * Section B is `FBISE format Questions - (Optional)` — measured off the five v9.3 renders, where
 * the support-page index reads A model answers, B FBISE, C homework, D next period, E coaching.
 *
 * The renderer already knows this rule and already acts on half of it. `overlay.js` says so in its
 * own words — *"The SRQ label follows the GRADE. FBISE's examining remit starts at SSC, so on a
 * grade 6-8 plan nothing may be framed as board practice (the author brief forbids it)"* — and
 * `template.js` swaps `L.srq` for `L.srqEarly` below grade 9 on exactly that reasoning. Then it
 * stamps an FBISE HEADING over the questions anyway. So a middle-school teacher gets a section
 * whose heading names a board that does not examine her pupils, containing questions we were
 * careful not to call board practice. That is the inconsistency the operator is naming, and the
 * grade test that resolves it is already written one screen above.
 *
 * SSC STILL GETS IT. This is not "drop the FBISE section" — at 9-12 it is the reason the support
 * page exists, and the operator's own correction on bd-x0pw1 put the heading there in ink. The
 * split is the fix.
 *
 * THE LETTERS CLOSE UP BY THEMSELVES. `S()` assigns the index in emission order (render-law 15),
 * so on a grade 7 plan C becomes B and nothing downstream needs to know. Asserted below, because
 * a gap in the run would leave a teacher looking for a section that was never printed.
 *
 * THE DOCUMENT IS UNCHANGED — this is what the renderer PAINTS. `page2.exam_bank` stays in the
 * schema, the briefs keep ordering one, and `lint_lp.js` keeps its 6-8 warn: a stored grade-7
 * lesson that already carries a bank re-renders without the section and costs no model call.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');

/** the gate fixture, at whatever grade the caller needs. It is grade 9 and carries a full bank. */
function at(grade) {
  const d = JSON.parse(raw);
  d.provenance.grade = grade;
  // `board_weight` is an FBISE badge and travels with the grade; leaving grade 9's in place on a
  // middle-school doc would make this suite assert on the badge rather than on the section.
  if (grade < 9) d.board_weight = null;
  return d;
}

const build = (d, lang = 'en') => buildHtml(d, { docDir: path.dirname(FIXTURE), lang }).html;

const HEADING = 'FBISE format Questions - (Optional)';
const HEADING_UR = 'ایف بی آئی ایس ای طرز کے سوالات — (اختیاری)';

/**
 * Does the page paint an element of this class? `atom()` appends its own classes, so the block
 * ships as `class="mcq sp-1"` and an exact-string `toContain` would agree with you either way.
 */
const hasClass = (html, name) => new RegExp(`class="[^"]*\\b${name}\\b`).test(html);

/** the support-page index, in paint order, continuation bars excluded */
const barLetters = (html) =>
  [...html.matchAll(/<div[^>]*class="[^"]*\bp2bar\b([^"]*)"[^>]*data-sec="p2-([A-Z])"/g)]
    .filter((m) => !/\bcont\b/.test(m[1]))
    .map((m) => m[2]);

describe('bd-a8veu.18 — FBISE format questions are printed for SSC only', () => {
  test.each([6, 7, 8])('grade %i gets no FBISE heading and none of its questions', (grade) => {
    const html = build(at(grade));
    expect(html).not.toContain(HEADING);
    // the questions go with the heading — a headless bank is worse than no bank
    expect(hasClass(html, 'mcq')).toBe(false);
    expect(hasClass(html, 'srq')).toBe(false);
    expect(hasClass(html, 'erq')).toBe(false);
    // and none of the fixture's own exam-bank text survives anywhere on the page
    const eb = at(grade).page2.exam_bank;
    expect(html).not.toContain(eb.mcq[0].q);
    expect(html).not.toContain(eb.erq_skeleton.q);
  });

  test.each([9, 10, 11, 12])('grade %i still gets it — this is the reason the page exists', (grade) => {
    const html = build(at(grade));
    expect(html).toContain(HEADING);
    expect(hasClass(html, 'mcq')).toBe(true);
    expect(hasClass(html, 'erq')).toBe(true);
  });

  test('the support index closes up behind it — no gap where B used to be', () => {
    const letters = barLetters(build(at(7)));
    // The floor only stops the contiguity assertion going vacuous. It keeps dropping as
    // sections leave Reference — bd-a8veu.7 took the board plan into the Introduction,
    // bd-a8veu.10 took mistakes and differentiation into the flow, bd-ir1aq stopped emitting
    // model answers entirely. The count has never been this test's subject; line 93 is.
    expect(letters.length).toBeGreaterThan(1);
    expect(letters).toEqual(letters.map((_, i) => String.fromCharCode(65 + i)));
    // and it is genuinely one shorter than the SSC page, so this cannot pass on a re-letter alone
    expect(letters.length).toBe(barLetters(build(at(9))).length - 1);
  });

  test('the Urdu middle-school page drops it too', () => {
    const html = build(at(7), 'ur');
    expect(html).not.toContain(HEADING_UR);
    expect(hasClass(html, 'mcq')).toBe(false);
    expect(build(at(9), 'ur')).toContain(HEADING_UR);
  });

  test('a plan with no grade recorded keeps the section', () => {
    // `p.grade` is null on a doc whose provenance never carried one. Withholding a section on a
    // missing field would silently strip SSC lessons; the sibling SRQ rule fails the same way,
    // toward the label that says less. Absent means "not known to be middle school".
    const d = at(9);
    delete d.provenance.grade;
    expect(build(d)).toContain(HEADING);
  });

  test('the document still carries its bank — this is what we PAINT, not what we store', () => {
    // The zero-cost premise of the whole v9.4 bump: a stored grade-7 lesson re-renders under the
    // new rule with no model call, because nothing about the lp_doc has to change.
    const d = at(7);
    expect(d.page2.exam_bank.mcq.length).toBeGreaterThanOrEqual(2);
    build(d);
    expect(d.page2.exam_bank.mcq.length).toBeGreaterThanOrEqual(2);
  });
});
