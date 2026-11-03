/**
 * v29 G5 Urdu Q8 and Q10 key rows. The dialogue row paid 5 marks for «دس سے بارہ جملے اور نتیجہ» (a dialogue has no
 * result and the dialogue part prints no count) and weighed 2/5/2/1 against the essay's content, language and
 * neatness; the letter row paid for «مقام و تاریخ» though the model letter prints a date only.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { criteriaFor } = require('../../bot/shared/services/assessment/composition-criteria');
const { alignCriteria } = require('../../bot/shared/services/assessment/fde-g5-criteria-2');
const { adjustCriteria } = require('../../bot/shared/services/assessment/fde-g5-criteria');

const P = Patterns.get('fde_g5_2027');
const slotOf = (id) => P.subjects.urdu.sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const sum = (rows) => rows.reduce((s, r) => s + r.marks, 0);

describe('G5 Urdu Q8 dialogue rows', () => {
  const rows = () => criteriaFor('dialogue', 10, 'ur');
  const out = adjustCriteria(rows(), slotOf('urdu.C.Q8'));

  test('no unasked «نتیجہ», no sentence count, no unasked form row', () => {
    const names = out.map((r) => r.name).join(' ');
    expect(names).not.toMatch(/نتیجہ|آٹھ|شکل/);
  });

  test('weights match the essay: content 6, language 3, neatness 1', () => {
    expect(out.map((r) => r.marks)).toEqual([6, 3, 1]);
    expect(sum(out)).toBe(10);
  });

  test('the essay rows carry the same weights', () => {
    const essay = adjustCriteria(criteriaFor('paragraph', 10, 'ur'), slotOf('urdu.C.Q8'));
    expect(essay.map((r) => r.marks)).toEqual(out.map((r) => r.marks));
  });

  test('a slot with no kinds keeps the template rows', () => {
    expect(alignCriteria(rows(), { slot: 'urdu.C.Q9', instruction_ur: 'x' })).toEqual(rows());
  });

  test('a stem that asks for a conclusion keeps it', () => {
    const slot = { ...slotOf('urdu.C.Q8'), instruction_ur: 'مکالمہ لکھیں اور نتیجہ بھی لکھیں۔', or_parts_ur: [] };
    expect(alignCriteria(rows(), slot)).toEqual(rows());
  });
});

describe('G5 Urdu Q10 letter row', () => {
  test('«مقام و تاریخ» becomes «تاریخ»; marks unchanged', () => {
    const rows = criteriaFor('letter', 10, 'ur');
    const out = alignCriteria(rows, slotOf('urdu.C.Q10'));
    expect(out[0].name).toBe('شکل: تاریخ، القاب و آداب، اختتام');
    expect(out.map((r) => r.marks)).toEqual(rows.map((r) => r.marks));
  });

  test('English rows and null input pass through', () => {
    const en = criteriaFor('letter', 10, 'en');
    expect(alignCriteria(en, { slot: 'maths.C.Q7' })).toEqual(en);
    expect(alignCriteria(null, null)).toBeNull();
  });
});

describe('G5 English Q7 and Q8: no length row for a length the paper never sets', () => {
  const EN = (id) => P.subjects.english.sections.flatMap((x) => x.slots).find((x) => x.slot === id);
  const lengthRow = (rows) => rows.find((r) => /length/i.test(r.name));

  test.each([['application', 'english.C.Q7'], ['letter', 'english.C.Q7'], ['paragraph', 'english.C.Q8']])('%s: the row is Neatness, marks unchanged', (kind, id) => {
    const rows = criteriaFor(kind, 10, 'en');
    const out = alignCriteria(rows, EN(id));
    expect(lengthRow(out)).toBeUndefined();
    expect(out.map((r) => r.marks)).toEqual(rows.map((r) => r.marks));
    expect(out[out.length - 1].name).toBe('Neatness');
    expect(out[out.length - 1].look_for).not.toMatch(/words|sentences/);
  });

  test('kept when the instruction states a length', () => {
    const slot = { ...EN('english.C.Q8'), instruction_en: 'Write 8 to 10 sentences on one topic.' };
    const rows = criteriaFor('paragraph', 10, 'en');
    expect(alignCriteria(rows, slot)).toEqual(rows);
  });
});
