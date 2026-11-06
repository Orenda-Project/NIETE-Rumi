/**
 * bd-cj8ggk.3 — field report: "each option appears on a separate line, which increases the number of pages".
 * The standard paper printed every MCQ option as a block line. Short options now sit four to a row, medium
 * ones two to a row, and only long ones keep a line each — the board-pattern paper's rule (`.opts.four/.two`).
 */

const R = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const paper = (options) => R.renderPaper({
  grade: 3, subject: 'science',
  examJson: { unseen: { objective: { MCQs: [{ question: 'Which is a living thing?', options, marks: 1 }] } } },
});

describe('MCQ options sit side by side', () => {
  test('four short options print four to a row', () => {
    const html = paper(['(a) Rock', '(b) Plant', '(c) Chair', '(d) Cup']);
    expect(html).toMatch(/<div class="options four">/);
    expect(html).toMatch(/\.options\.four\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
  });

  test('medium options print two to a row', () => {
    const html = paper(['(a) A plant needs water', '(b) A rock needs water', '(c) Both', '(d) Neither']);
    expect(html).toMatch(/<div class="options two">/);
    expect(html).toMatch(/\.options\.two\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  });

  test('long options keep a line each', () => {
    const long = '(a) Plants make their own food using sunlight, water and air';
    const html = paper([long, '(b) x', '(c) y', '(d) z']);
    expect(html).toMatch(/<div class="options">/);
  });

  test('every option still prints, in order', () => {
    const html = paper(['(a) Rock', '(b) Plant', '(c) Chair', '(d) Cup']);
    const at = ['(a) Rock', '(b) Plant', '(c) Chair', '(d) Cup'].map((o) => html.indexOf(`>${o}<`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});
