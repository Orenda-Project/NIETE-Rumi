/**
 * bd-5jmnfj.4.51.6 (key part): G1 Maths Q4 "34 ☐ 43". The paper draws the square; the key printed the
 * raw U+2610 glyph, which the paper font lacks (tofu). The key also showed a green "checked" badge.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const maths = require('./fixtures/early/g1-maths-exam.json');

const html = R.renderMarkingScheme({ examJson: maths, grade: 1, subject: 'maths', allowShort: true });
const q4 = html.split('<tr').filter((r) => r.includes('data-row="g1.maths.A.Q4"'));

describe('bd-5jmnfj.4.51.6 the maths key', () => {
  test('Q4 prints a drawn box, never the raw box glyph', () => {
    expect(q4.length).toBe(5);
    q4.forEach((r) => {
      expect(r).not.toContain('☐');
      expect(r).toContain('class="sq"');
    });
    expect(html).not.toContain('☐');
  });

  test('the key carries no "checked" badge on any row', () => {
    expect(html).not.toMatch(/class="chip checked"/);
    expect(html).not.toContain('✓');
  });
});
