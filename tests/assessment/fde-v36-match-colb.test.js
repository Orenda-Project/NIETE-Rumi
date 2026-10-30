/**
 * bd-5jmnfj.33.5.4 — G3 General Knowledge ch3 match rows printed Column B as «A: B» (the row's own Column A
 * term with the pair joined by a colon). `matchRowsShortfall` stripped the tail after the colon before
 * checking, so it passed data the renderer then misprinted. A row whose printed Column B holds its own
 * Column A text is a leak and must be flagged.
 */

const { matchRowsShortfall, matchRowsNote } = require('../../bot/shared/services/assessment/fde-match-rows');

const P = { g5_rules: false };
const SLOT = 'g3.general_knowledge.A.match';
const Q = 'کالم الف کو کالم ب سے ملائیں';
const exam = (items) => ({ _layout: { subject: 'General Knowledge', sections: [] }, unseen: { objective: { 'Match Columns': items } } });
const row = (a, b, answer) => ({ question: Q, column_a: [a], column_b: b, answer, slot: SLOT, marks: 1 });
const A = 'قابو سے باہر اختلاف';

const GOOD = [
  row('رکیں', ['غصہ روکنا'], 'غصہ روکنا'),
  row('بات کریں', ['رائے بتانا'], 'رائے بتانا'),
  row('سنیں', ['ہر ایک کی چاہت'], 'ہر ایک کی چاہت'),
];
const withLeak = (leak) => [...GOOD, leak];

describe('matchRowsShortfall: Column B that holds its own Column A text', () => {
  test('guard: distinct rows with proper column_b give no shortfall', () => {
    expect(matchRowsShortfall(exam(GOOD), P)).toEqual([]);
  });

  test.each([
    ['column_b ["A: B"]', row(A, [`${A}: لڑائی`], 'لڑائی')],
  ])('%s is flagged as a leak', (_n, leak) => {
    const flags = matchRowsShortfall(exam(withLeak(leak)), P);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: SLOT, reason: 'match_rows' });
    expect(flags[0].why.join(' ')).toMatch(/column A|pair|پیئر|leak/i);
    expect(flags[0].line).toContain(A);
  });

  test('the re-ask note mentions the leak', () => {
    const note = matchRowsNote(matchRowsShortfall(exam(withLeak(row(A, [`${A}: لڑائی`], 'لڑائی'))), P));
    expect(note).toContain(A);
    expect(note).toMatch(/Column A/);
    expect(note).toMatch(/Column B/);
    expect(note.toLowerCase()).toMatch(/own|inside|contain|leak|pair/);
  });
});
