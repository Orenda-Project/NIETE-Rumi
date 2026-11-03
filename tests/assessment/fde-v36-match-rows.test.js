/**
 * bd-5jmnfj.33.5.3 — a regenerated G3 General Knowledge paper printed a match-the-columns item whose Column A
 * word «رکیں» sat in two rows, with two Column B meanings that both fit either row, so a correct match could
 * score 0. No check looked at distinctness across match rows; this pins `fde-match-rows`.
 */

const { matchRowsShortfall, matchRowsNote, distinctMatchRows } = require('../../bot/shared/services/assessment/fde-match-rows');

const P = { g5_rules: false };
const SLOT = 'g3.general_knowledge.A.match';
const Q1 = 'کالم الف کے لفظ کو کالم ب کے درست مطلب سے جوڑیں';
const Q2 = 'مسئلے کے حل کے مرحلے کو اس کے کام سے ملائیں';
const row = (question, a, b, answer, slot = SLOT) => ({ question, column_a: [a], column_b: [b], answer: answer ?? b, slot, marks: 1 });
const exam = (items) => ({ _layout: { subject: 'General Knowledge', sections: [] }, unseen: { objective: { 'Match Columns': items } } });

const DEFECT = [
  row(Q1, 'رکیں', 'ٹھہر جانا'),
  row(Q2, 'رکیں', 'غصہ روکنا', 'رکیں: غصہ روکنا'),
  row(Q2, 'بات کریں', 'رائے بتانا'),
  row(Q2, 'سنیں', 'ہر ایک کی چاہت'),
  row(Q2, 'سوچیں', 'مثبت خیال'),
];
const DISTINCT = [
  row(Q2, 'رکیں', 'غصہ روکنا'),
  row(Q2, 'بات کریں', 'رائے بتانا'),
  row(Q2, 'سنیں', 'ہر ایک کی چاہت'),
  row(Q2, 'سوچیں', 'مثبت خیال'),
  row(Q2, 'مدد مانگیں', 'بڑوں سے پوچھنا'),
];

describe('distinctMatchRows', () => {
  test('five rows with distinct Column A and Column B give no entries', () => {
    expect(distinctMatchRows(DISTINCT)).toEqual([]);
  });

  test('the exact defect rows give one dup_a entry for «رکیں» at rows 0 and 1', () => {
    expect(distinctMatchRows(DEFECT)).toEqual([{ why: 'dup_a', text: 'رکیں', rows: [0, 1] }]);
  });

  test('two rows sharing a Column B entry give dup_b', () => {
    const rows = [row(Q2, 'سنیں', 'غور کرنا'), row(Q2, 'سوچیں', 'غور کرنا'), row(Q2, 'بات کریں', 'رائے بتانا')];
    const out = distinctMatchRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ why: 'dup_b', text: 'غور کرنا', rows: [0, 1] });
  });

  test('comparison trims and ignores Urdu diacritics and Latin case', () => {
    const spaced = distinctMatchRows([row(Q2, 'رکیں', 'الف'), row(Q2, 'رکیں ‌', 'ب')]);
    expect(spaced.map((e) => e.why)).toEqual(['dup_a']);
    const marked = distinctMatchRows([row(Q2, 'رَکیں', 'الف'), row(Q2, 'رکیں', 'ب')]);
    expect(marked.map((e) => e.why)).toEqual(['dup_a']);
    const latin = distinctMatchRows([row(Q2, 'Cat', 'x'), row(Q2, ' cat ', 'y')]);
    expect(latin.map((e) => e.why)).toEqual(['dup_a']);
  });

  test('Column A falls back to question when column_a is missing', () => {
    const rows = [{ question: 'سنیں', column_b: ['الف'] }, { question: 'سنیں', column_b: ['ب'] }];
    expect(distinctMatchRows(rows).map((e) => e.why)).toEqual(['dup_a']);
  });

  test('Column B falls back to the tail of the answer after the last colon or arrow', () => {
    const colon = [{ column_a: ['الف'], answer: 'الف: غصہ روکنا' }, { column_a: ['ب'], answer: 'ب: غصہ روکنا' }];
    expect(distinctMatchRows(colon).map((e) => e.why)).toEqual(['dup_b']);
    const arrow = [{ column_a: ['الف'], answer: 'الف → ٹھہرنا' }, { column_a: ['ب'], answer: 'ب → ٹھہرنا' }];
    expect(distinctMatchRows(arrow).map((e) => e.why)).toEqual(['dup_b']);
  });

  test('never throws on malformed rows', () => {
    const bad = [null, undefined, {}, { column_a: 'x', column_b: 5 }, { column_a: [7], column_b: [null] }, 'text', { answer: 3 }];
    expect(() => distinctMatchRows(bad)).not.toThrow();
    expect(distinctMatchRows([])).toEqual([]);
    expect(distinctMatchRows(undefined)).toEqual([]);
    expect(distinctMatchRows(null)).toEqual([]);
  });

  test('empty cells do not count as repeats of each other', () => {
    expect(distinctMatchRows([{ column_a: [''], column_b: [''] }, { column_a: [''], column_b: [''] }])).toEqual([]);
  });
});

describe('matchRowsShortfall', () => {
  test('an exam with no match group gives no flags', () => {
    const e = { _layout: { subject: 'x', sections: [] }, unseen: { objective: { MCQs: [{ slot: 'g3.x.A.mcq', question: 'q', options: ['a', 'b'], answer: 'a' }] } } };
    expect(matchRowsShortfall(e, P)).toEqual([]);
  });

  test('Grade 5 rules (g5_rules not false) give no flags, even on the defect', () => {
    expect(matchRowsShortfall(exam(DEFECT), { g5_rules: true })).toEqual([]);
    expect(matchRowsShortfall(exam(DEFECT), {})).toEqual([]);
  });

  test('distinct rows give no flags', () => {
    expect(matchRowsShortfall(exam(DISTINCT), P)).toEqual([]);
  });

  test('the defect gives one match_rows flag naming the repeated word', () => {
    const flags = matchRowsShortfall(exam(DEFECT), P);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: SLOT, reason: 'match_rows', why: ['dup_a'] });
    expect(typeof flags[0].line).toBe('string');
    expect(flags[0].line).toContain('رکیں');
    expect(Array.isArray(flags[0].text)).toBe(true);
    expect(flags[0].text.join(' ')).toContain('رکیں');
  });

  test('never throws on a malformed exam or group', () => {
    expect(() => matchRowsShortfall(null, P)).not.toThrow();
    expect(matchRowsShortfall(null, P)).toEqual([]);
    expect(matchRowsShortfall(undefined, undefined)).toEqual([]);
    expect(matchRowsShortfall({}, P)).toEqual([]);
    expect(matchRowsShortfall(exam([]), P)).toEqual([]);
    expect(() => matchRowsShortfall(exam([{ slot: SLOT }, { slot: SLOT, column_a: 'x', column_b: [5] }, null]), P)).not.toThrow();
  });
});

describe('matchRowsNote', () => {
  test('no flags give an empty string', () => {
    expect(matchRowsNote([])).toBe('');
    expect(matchRowsNote(undefined)).toBe('');
    expect(matchRowsNote([{ slot: 'x', reason: 'mcq_stem', why: ['two_questions'], text: ['q'] }])).toBe('');
  });

  test('a match_rows flag gives a one-paragraph note naming the repeated entry, with no arrow', () => {
    const note = matchRowsNote(matchRowsShortfall(exam(DEFECT), P));
    expect(typeof note).toBe('string');
    expect(note).toContain('رکیں');
    expect(note).not.toMatch(/→|←|->|⇒/);
    expect(note.trim().split(/\n\s*\n/)).toHaveLength(1);
  });

  test('never throws on malformed flags', () => {
    expect(() => matchRowsNote([null, {}, { reason: 'match_rows' }, { reason: 'match_rows', why: 'dup_a' }])).not.toThrow();
  });
});
