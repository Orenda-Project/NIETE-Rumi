/**
 * G5 Science key fixes from the v29 review (bd-5jmnfj.4.58 round 4), each run on the real v29 item.
 */
const { itemsInOrder } = require('../../bot/shared/services/assessment/fde-near-repeats');
const { scienceKeys } = require('../../bot/shared/services/assessment/fde-science-keys');
const exam = require('./fixtures/fde-v34-g5-science-v29.json');

const items = itemsInOrder(exam);
const find = (re) => items.find((q) => re.test(q.question));
const run = (re) => { const notes = []; const q = find(re); const out = scienceKeys(q, notes); return { q, out, notes }; };
const texts = (q) => q.scheme.points.map((p) => p.text).join(' | ');
const total = (q) => q.scheme.points.reduce((s, p) => s + p.marks, 0);
const stroke = /strokes a sewing needle/;

describe('G5 Science keys, v29 review', () => {
  test('Q3(b) 4 drops the stem restatements and the unasked fade point; marks hold', () => {
    const { q, out, notes } = run(stroke);
    expect(texts(out)).not.toMatch(/Stroking in one direction|cork lets|fades after/);
    expect(out.answer).not.toMatch(/After a while|floating cork it turns freely/);
    expect(total(out)).toBe(total(q));
    expect(notes.length).toBeGreaterThan(0);
  });

  test('Q3(b) 5 drops the unasked substitutes and land-pollution points', () => {
    const { q, out } = run(/rubbish dump/);
    expect(texts(out)).not.toMatch(/substitutes|land pollution/);
    expect(out.answer).not.toMatch(/substitutes|wildlife/);
    expect(total(out)).toBe(total(q));
  });

  test('Q3(a) 3 pays no marks for the forms a vaccine comes in', () => {
    const { q, out } = run(/Define the word vaccine/);
    expect(texts(out)).not.toMatch(/injection|pill|nasal/);
    expect(out.answer).not.toMatch(/injection|pill|nasal/);
    expect(total(out)).toBe(total(q));
    expect(out.scheme.points[0].text).toMatch(/teaches the immune system/);
  });

  test('Q2(a)(ii) no longer accepts a hawk that eats a fox', () => {
    const { out } = run(/Food Chain of four/);
    expect(out.scheme.accept.join(' ')).not.toMatch(/fox, hawk/);
    expect(out.scheme.accept.length).toBe(2);
  });

  test('Q3(b) 3 does not teach that animals hear louder noises', () => {
    const { out } = run(/noise pollution affects/);
    expect(out.answer).not.toMatch(/hear even louder/);
    expect(out.answer).toMatch(/animals/i);
  });

  test('Q3(a) 6 accepts petrol, diesel and LPG; the greenhouse trap point moves to Q3(b) 2 alone', () => {
    const { q, out } = run(/Name three fossil fuels/);
    expect(out.scheme.accept.join(' ')).toMatch(/petrol/i);
    expect(out.scheme.accept.join(' ')).toMatch(/diesel/i);
    expect(out.scheme.accept.join(' ')).toMatch(/LPG/);
    expect(out.question).not.toMatch(/What do greenhouse gases do/);
    expect(texts(out)).not.toMatch(/trap/i);
    expect(out.answer).not.toMatch(/trap/i);
    expect(total(out)).toBe(total(q));
  });

  test('Q3(b) 1 accepts vaccination, the polio vaccine, as a way to stop spread', () => {
    const { out } = run(/contagious diseases such as COVID-19/);
    expect(out.scheme.accept.join(' ')).toMatch(/polio vaccin/i);
  });

  test('Q1(a) vi no longer has a second defensible non-contagious option', () => {
    const { out } = run(/non-contagious disease/);
    expect(out.options.join(' ')).not.toMatch(/malaria|cholera/i);
    expect(out.options[0]).toMatch(/Diabetes/);
    expect(out.options.map((o) => o.slice(0, 2))).toEqual(['a)', 'b)', 'c)', 'd)']);
  });

  test('Q2(a) alternatives: the labels asked equal the label marks paid', () => {
    const { out } = run(/Draw and label the Respiratory/);
    const label = out.scheme.points.find((p) => p.kind === 'L');
    expect(out.question).toMatch(new RegExp(`Label at least ${label.marks} parts`));
    expect(label.text).not.toMatch(/Seven|7 labels/);
    expect(out.answer).not.toMatch(/7 labels/);
  });

  test('an item it does not know passes through untouched', () => {
    const q = { slot: 'science.C.Q3a', question: 'Explain why the Moon changes shape.', scheme: { points: [{ text: 'x', marks: 1 }], accept: [] } };
    expect(scienceKeys(q, [])).toBe(q);
    expect(scienceKeys(null, [])).toBe(null);
  });
});
