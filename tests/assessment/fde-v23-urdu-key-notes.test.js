/**
 * bd-5jmnfj.4.51.5: on an Urdu paper the key's marking notes (point text, common error) are Urdu.
 * v23 G1 Urdu Q4-Q10 printed English notes; Q6's English note carried the Urdu letters ا and ے,
 * which the bidi algorithm scattered across lines. Fixture: the real v23 g1-urdu exam, pictures stripped.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const urdu = require('./fixtures/early/g1-urdu-exam.json');

const html = R.renderMarkingScheme({ examJson: urdu, grade: 1, subject: 'urdu', allowShort: true });
const rowsOf = (n) => html.split('<tr').filter((r) => r.includes(`data-row="g1.urdu.B.Q${n}"`));
// The notes cell without the A1/K1 chip (a Latin letter by design).
const notes = (row) => (row.split('class="pts"')[1] || '').replace(/<span class="chip">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('bd-5jmnfj.4.51.5 Urdu key notes are Urdu', () => {
  [4, 5, 6, 7, 8, 9, 10].forEach((n) => {
    test(`Q${n}: every marking note is free of Latin letters`, () => {
      const rows = rowsOf(n);
      expect(rows.length).toBe(5);
      rows.forEach((r) => expect(notes(r)).not.toMatch(/[A-Za-z]/));
    });
  });

  test('Q6 common-error note is whole Urdu text, with no English words around the letters ا and ے', () => {
    rowsOf(6).forEach((r) => {
      const err = (r.match(/<span class="err">([\s\S]*?)<\/span>/) || [])[1] || '';
      expect(err).toMatch(/عام غلطی/);
      expect(err.replace(/<[^>]+>/g, '')).not.toMatch(/[A-Za-z]/);
    });
  });
});
