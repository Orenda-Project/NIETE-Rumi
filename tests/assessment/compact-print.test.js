/**
 * bd-ipoxhx.5 — ICT Feedback, Assessment Generator row 30 (Saman Zahoor, coach):
 * "The teacher want to edit the page size … so that they can print more number of questions on one
 * side of paper due to financial constraints."
 *
 * A "Save paper" print packs the same A4 sheet tighter: smaller margins, type and gaps. The ruled
 * answer lines keep their height (a child's hand does not shrink), and a paper printed without the
 * option is byte for byte what it was.
 */

const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const { compactCss } = require('../../bot/shared/services/assessment/compact-print');

const EXAM = { unseen: {
  objective: { MCQs: [{ question: 'Which is a fruit?', options: ['Apple', 'Brick', 'Chair', 'Door'], marks: 1 }] },
  subjective: { 'Short Questions': [{ question: 'Name two fruits.', marks: 2 }] },
} };
const base = { examJson: EXAM, grade: 4, subject: 'science' };

describe('Save paper print (compact)', () => {
  test('a paper without the option is unchanged', () => {
    expect(Renderer.renderPaper({ ...base, compact: false })).toBe(Renderer.renderPaper(base));
  });

  test('the option adds the tighter page and keeps every question', () => {
    const html = Renderer.renderPaper({ ...base, compact: true });
    expect(html).toContain(compactCss({ rtl: false }));
    expect(html).toContain('Which is a fruit?');
    expect(html).toContain('Name two fruits.');
    // the override follows the base style so it wins the cascade
    expect(html.lastIndexOf('@page')).toBe(html.indexOf(compactCss({ rtl: false })) + compactCss({ rtl: false }).indexOf('@page'));
  });

  test('the tighter page is smaller margins, type and gaps, never shorter answer lines', () => {
    const css = compactCss({ rtl: false });
    expect(css).toMatch(/@page \{ size: A4; margin: 8mm 9mm; \}/);
    expect(css).toMatch(/font-size: 10\.5pt/);
    expect(css).toMatch(/\.q \{ margin-bottom: 5px; \}/);
    expect(css).not.toMatch(/answer-line/);
  });

  test('an Urdu paper keeps a larger type than an English one', () => {
    expect(compactCss({ rtl: true })).toMatch(/font-size: 12pt/);
    expect(compactCss({ rtl: true })).not.toBe(compactCss({ rtl: false }));
  });
});
