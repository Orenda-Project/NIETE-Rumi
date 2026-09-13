/**
 * bd-a8veu.17 — THE LONG-QUESTION HEADING IS NAMED IN A TEACHER'S WORDS.
 *
 * OPERATOR, 2026-09-12: *"Extended response - skeleton heading wont make sense to a teacher, fix it
 * and make it relevant to them."*
 *
 * "Extended response" is an assessment-designer's term for a question type, and "skeleton" is our
 * own word for the shape we print under it. Neither is what a teacher calls this: she calls it the
 * long question, and what she does with the parts-and-marks structure beneath the heading is show a
 * class how to BUILD an answer that earns all of them. So the heading names the question, and says
 * what the block is for.
 *
 * "Names the question" is asserted literally, in both languages, because that is the actual design
 * decision and not a preference about wording: a teacher identifies this block by the question she
 * is going to set, not by the register the answer is written in.
 *
 * WHAT MUST NOT CHANGE — this is a LABEL, and only a label:
 *
 *   `erq_skeleton` is the schema key (`lp_doc.schema.json:397`, `lp_doc.v2.schema.json:459/524`),
 *   what `lint_lp.js` gates on, and what four author briefs write. Renaming it would invalidate
 *   every one of the ~4,700 stored lessons for a heading. The last test below builds the block from
 *   that key and proves it still renders, so a future "tidy-up" that renames it reddens here.
 *
 * WHY THIS IS A RENDERER FIX: the heading is painted, so it is renderer-side, so it lands on every
 * stored lesson at the next re-render with no model called. See the docblock of
 * `tests/lp612/outcome-one-voice-render.test.js` for the full version of that argument.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');
const { LABELS } = require('../../bot/vendor/lp-v9/lib/overlay');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const build = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) }).html;

/** CSS comments ship verbatim inside the emitted <style>; the body starts after it. */
const body = (out) => out.slice(out.lastIndexOf('</style>') + 8);

/** the long-question block as emitted. `atom()` REWRITES the class attribute — the block ships as
 *  `class="erq sp-2"` — so the needle must match the attribute's OPENING, never its closing quote. */
function erqBlock(out) {
  const b = body(out);
  const i = b.indexOf('class="erq');
  expect(i).toBeGreaterThan(-1);
  return b.slice(i, b.indexOf('</span>', i));
}

describe('bd-a8veu.17 — the long-question heading means something to a teacher', () => {
  test('the jargon is gone from the page, in both languages', () => {
    expect(body(build(doc()))).not.toMatch(/skeleton/i);
    expect(body(build(doc()))).not.toContain('Extended response');
    expect(body(build(doc(), 'ur'))).not.toMatch(/skeleton/i);
  });

  test('the heading names the QUESTION — that is what she recognises it by', () => {
    expect(LABELS.en.erq.toLowerCase()).toContain('question');
    expect(LABELS.ur.erq).toContain('سوال');
  });

  test('the heading says what the block is for, not what register it is in', () => {
    // A label that is only a noun phrase for the question type is what we had. This one has to
    // carry the second half: what the teacher does with the parts underneath.
    expect(LABELS.en.erq).toMatch(/—/);
    expect(LABELS.en.erq.split('—')[1].trim().length).toBeGreaterThan(3);
    expect(LABELS.ur.erq).toMatch(/—/);
  });

  test('the label that reaches the page is the label from the overlay', () => {
    expect(erqBlock(build(doc()))).toContain(LABELS.en.erq);
    expect(erqBlock(build(doc(), 'ur'))).toContain(LABELS.ur.erq);
  });

  test('the heading fits the column — it is furniture, not a sentence', () => {
    // 478px of content column at the 14px label size. A heading that wraps to three lines costs
    // more space than the question it introduces.
    for (const lang of ['en', 'ur']) expect(LABELS[lang].erq.length).toBeLessThanOrEqual(40);
  });

  test('erq_skeleton is still the key the block is built from', () => {
    // The rename is a LABEL change. The schema key stays: it is what lint gates on, what four
    // author briefs write, and what ~4,700 stored lessons already carry.
    const d = doc();
    expect(d.page2.exam_bank.erq_skeleton).toBeTruthy();
    const q = d.page2.exam_bank.erq_skeleton.q;
    expect(body(build(d))).toContain(q);

    delete d.page2.exam_bank.erq_skeleton;
    const without = body(build(d));
    expect(without).not.toContain(q);
    expect(without).not.toContain(LABELS.en.erq);
  });
});
