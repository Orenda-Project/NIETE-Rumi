/**
 * bd-5jmnfj.4.51.10: G5 Science Q1 (b), the label frame. (1) The item's `main_question`
 * ("Label the diagram. Write the names of the five parts in order on the lines in the
 * frame.") carries no "Word bank:", so only the slot's "Label the given Diagram" printed.
 * The instruction the item gives must print. (2) The stored layout frame said book_page 168
 * (the pattern's example) while the item and the supplies line say 68. Item shape from the
 * v23 g5-science exam.json.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-29T07:00:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects.science;
const ITEM = {
  slot: 'science.A.Q1b', lines: 0, marks: 5, answer: '1) Sun, 2) Grass, 3) Grasshopper, 4) Mouse, 5) Snake', blooms: 'Remember',
  scheme: { accept: ['Producer for Grass'], points: ['Sun', 'Grass', 'Grasshopper', 'Mouse', 'Snake'].map((t) => ({ kind: 'A', text: `${t} named`, marks: 1 })), checked: null, common_error: 'Reverse order' },
  question: 'A simple food chain', book_page: 68,
  main_question: 'Label the diagram. Write the names of the five parts in order on the lines in the frame.',
};
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const laid = (item = ITEM) => applyLayout({ unseen: { subjective: { 'Label the Diagram': [item] } } }, P, { kind: 'fde' }, { now: NOW }).examJson;

function frameSlot(html) {
  const at = html.indexOf('id="fde-frame-science.A.Q1b"');
  return visible(html.slice(html.lastIndexOf('<div class="slot-head">', at), at));
}

describe('G5 Science Q1 (b) label frame (bd-5jmnfj.4.51.10)', () => {
  it('prints the item instruction, not only the slot head', () => {
    const exam = normaliseScheme(laid()).examJson;
    const text = frameSlot(R.renderPaper({ examJson: exam, grade: 5, subject: 'science', answerLines: true, allowShort: true }));
    expect(text).toContain('Label the given Diagram');
    expect(text).toContain('Write the names of the five parts in order on the lines in the frame.');
  });

  it('does not print the item sentence that only repeats the slot head twice', () => {
    const exam = normaliseScheme(laid()).examJson;
    const text = frameSlot(R.renderPaper({ examJson: exam, grade: 5, subject: 'science', answerLines: true, allowShort: true }));
    expect(text.match(/Label the (?:given )?diagram/gi)).toHaveLength(1);
  });

  it('the stored layout frame takes the item page (68), not the pattern example (168)', () => {
    const exam = laid();
    const slot = exam._layout.sections.flatMap((s) => s.slots).find((s) => s.slot === 'science.A.Q1b');
    expect(slot.frame.book_page).not.toBe(168);
    expect(slot.frame.book_page).toBe(68);
    expect(exam._layout.supplies.find((s) => s.slot === 'science.A.Q1b').book_page).toBe(68);
  });

  it('an item that names no page leaves the frame with none, never the example 168', () => {
    const exam = laid({ ...ITEM, book_page: undefined });
    const slot = exam._layout.sections.flatMap((s) => s.slots).find((s) => s.slot === 'science.A.Q1b');
    expect(slot.frame.book_page || null).toBeNull();
  });
});
