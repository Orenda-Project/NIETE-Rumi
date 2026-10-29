/**
 * bd-5jmnfj.4.51.7 (paper part): G2 Maths Q2 asked for "the underlined digit's place" but
 * no digit was underlined. The items name the digit in words ("In 472, what is the value of
 * 7?" - the pattern's prompt rule says never an underline), so the heading must not promise one.
 * Item shapes are from the v23 g2-maths exam.json.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-29T07:00:00.000Z';
const P = Patterns.get('fde_g2_2026').subjects.maths;
const item = (question, answer) => ({
  slot: 'g2.maths.A.Q2', lines: 1, marks: 1, answer, blooms: 'Remember',
  scheme: { accept: [answer], points: [{ kind: 'A', text: 'States the correct value of the digit', marks: 1 }], checked: null, common_error: 'Writing the digit itself' },
  question, main_question: 'Write the value of the digit',
});
const ITEMS = [item('In 472, what is the value of 7?', '70'), item('In 815, what is the value of 8?', '800'), item('In 369, what is the value of 9?', '9'),
  item('In 254, what is the value of 5?', '50'), item('In 906, what is the value of 6?', '6')];

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}
function q2Text() {
  const exam = normaliseScheme(applyLayout({ unseen: { subjective: { 'Place Value': ITEMS } } }, P, { kind: 'fde' }, { now: NOW }).examJson).examJson;
  const html = R.renderPaper({ examJson: exam, grade: 2, subject: 'maths', answerLines: true, allowShort: true });
  const start = html.indexOf('<span class="lab">Q2.</span>');
  return { html, text: visible(html.slice(start, html.indexOf('<span class="lab">Q3.</span>', start))) };
}

describe('G2 Maths Q2 heading (bd-5jmnfj.4.51.7)', () => {
  it('prints the five stems naming the digit', () => {
    const { text } = q2Text();
    expect(text).toContain('In 472, what is the value of 7?');
  });

  it('does not tell the child to look at an underlined digit when none is underlined', () => {
    const { html, text } = q2Text();
    expect(html).not.toMatch(/<u[ >]|text-decoration:\s*underline/);
    expect(text).not.toMatch(/underline/i);
  });

  it('the pattern instruction itself no longer mentions an underline', () => {
    const slot = P.sections.flatMap((s) => s.slots).find((s) => s.slot === 'g2.maths.A.Q2');
    expect(slot.instruction_en).not.toMatch(/underline/i);
  });
});
