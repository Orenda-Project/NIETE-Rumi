/**
 * fde-scheme-checks (bd-5jmnfj.4.58), required directly. v34 findings:
 *   G5 English Q1(b) i, ii, v: an open answer (a simile, a metaphor) keyed with one model sentence and no accept line.
 *   G5 Maths Q2 ii: common_error "... such as 523,... instead of 486,418." is cut off mid-number.
 * Shortfall shape: { slot, reason: 'answer', items: [line] }, one entry per slot, as the answer-slot re-ask consumes.
 */

const {
  openItemsWithoutAccept, cutOffScheme, schemeShortfall,
} = require('../../bot/shared/services/assessment/fde-scheme-checks');

const exam = (items) => ({ unseen: { objective: {}, subjective: { Group: items } } });
const english = (question, answer, accept, over = {}) => ({
  slot: 'english.A.Q1b', main_question: 'Rewrite the sentence as directed', question, answer, marks: 1,
  scheme: { points: [{ text: 'A correct rewrite', marks: 1, kind: 'A' }], accept, common_error: null, checked: null }, ...over,
});
const maths = (question, answer, scheme) => ({
  slot: 'maths.B.Q2', question, answer,
  scheme: { points: [{ text: 'Final answer', marks: 1, kind: 'A' }], accept: ['Another full method'], common_error: null, checked: 'ok', ...scheme },
});

const SIMILE = english('The lake was calm. (Rewrite as a simile using \'as ... as\')', 'The lake was as calm as a mirror.', []);
const METAPHOR = english('The classroom was as noisy as a market. (Rewrite as a metaphor)', 'The classroom was a noisy market.', []);
const SIMILE_LIKE = english('The snow was soft. (Rewrite as a simile using \'like\')', 'The snow was like a soft blanket.', []);
const PAST = english('Dani walks to the park every day. (Change into simple past)', 'Dani walked to the park every day.', []);
const SVO = english('The cook baked a cake. (Write the subject, verb and object)', 'Subject: The cook; Verb: baked; Object: a cake.', []);
const MSG = '(an open answer needs an accept line: at least two acceptable forms or the marking rule)';

describe('openItemsWithoutAccept', () => {
  test('the three v34 Q1(b) items (simile, metaphor, simile) are flagged, one entry for the slot', () => {
    const out = openItemsWithoutAccept(exam([SIMILE, METAPHOR, SIMILE_LIKE]), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'english.A.Q1b', reason: 'answer' });
    expect(out[0].items).toEqual([
      `${SIMILE.question} → ${SIMILE.answer} ${MSG}`,
      `${METAPHOR.question} → ${METAPHOR.answer} ${MSG}`,
      `${SIMILE_LIKE.question} → ${SIMILE_LIKE.answer} ${MSG}`,
    ]);
  });

  test('one accept entry is still short; two entries, or any accept on a closed item, pass', () => {
    const one = { ...SIMILE, scheme: { ...SIMILE.scheme, accept: ['The lake was as calm as glass.'] } };
    const two = { ...SIMILE, scheme: { ...SIMILE.scheme, accept: ['The lake was as calm as glass.', 'The lake was as calm as still water.'] } };
    expect(openItemsWithoutAccept(exam([one]), {})[0].items).toHaveLength(1);
    expect(openItemsWithoutAccept(exam([two]), {})).toEqual([]);
  });

  test('closed items (a fixed rewrite, a label list, an MCQ, a number) are not flagged', () => {
    const mcq = english('A ______ of elephants walked to the river.', 'b) herd', [], { options: ['a) fleet', 'b) herd'] });
    const num = maths('What is 12 x 4?', '48', { accept: [] });
    expect(openItemsWithoutAccept(exam([PAST, SVO, mcq, num]), {})).toEqual([]);
  });

  test.each([
    ['Write a sentence using the word "shelter".'],
    ['Use "gratitude" in a sentence.'],
    ['What does the phrase "break the ice" mean? Answer in your own words.'],
    ['What does "urban" mean?'],
    ['Give an example of a noun.'],
    ['Write your own title for the poem.'],
    ['اپنے الفاظ میں لکھیں۔'],
    ['اس لفظ سے جملہ بنائیں۔'],
  ])('open stem is detected: %s', (stem) => {
    const item = english(stem, 'A model answer.', []);
    expect(openItemsWithoutAccept(exam([item]), {})).toHaveLength(1);
  });

  test('an open item whose scheme is absent or null counts as no accept line (the saved v34 Q1(b) case)', () => {
    const noScheme = { slot: 's', question: 'Use "x" in a sentence.', answer: 'x' };
    const nullScheme = { ...SIMILE, scheme: null };
    expect(openItemsWithoutAccept(exam([noScheme]), {})[0].items).toHaveLength(1);
    expect(openItemsWithoutAccept(exam([nullScheme]), {})[0].items).toEqual([`${SIMILE.question} → ${SIMILE.answer} ${MSG}`]);
  });

  test('empty and non-exam input never throws and flags nothing', () => {
    expect(openItemsWithoutAccept({}, {})).toEqual([]);
    expect(openItemsWithoutAccept(null, {})).toEqual([]);
  });
});

describe('cutOffScheme', () => {
  const Q2II = maths('Use the vertical method to subtract 258,964 from 745,382.', '745,382 - 258,964 = 486,418', {
    common_error: 'Subtracts the smaller digit from the larger in a column without borrowing, giving a wrong answer such as 523,... instead of 486,418.',
  });

  test('v34 G5 Maths Q2 ii: "523,..." inside the common_error is flagged', () => {
    const out = cutOffScheme(exam([Q2II]), {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'maths.B.Q2', reason: 'answer' });
    expect(out[0].items).toEqual([`${Q2II.question} → ${Q2II.answer} (common_error is cut off: "${Q2II.scheme.common_error}")`]);
  });

  test.each([
    ['gives 523…'], ['gives 523...'], ['gives 523,'], ['gives 12-'], ['gives 523 ('], ['gives 523 +'], ['gives 5 ×'],
    ['gives 5 ÷'], ['gives 5 −'], ['gives 5 ='], ['gives 1,2'], ['gives 523,'],
  ])('common_error that ends cut off is flagged: %s', (text) => {
    const out = cutOffScheme(exam([maths('Q', '486,418', { common_error: text })]), {});
    expect(out).toHaveLength(1);
    expect(out[0].items[0]).toContain(`(common_error is cut off: "${text}")`);
  });

  test('points[].text and accept[] entries are checked and named by position', () => {
    const item = maths('Q', '72', { points: [{ text: 'Divides by 2, 2,', marks: 1, kind: 'M' }, { text: 'Final answer 72', marks: 1, kind: 'A' }], accept: ['Division method giving 72', 'LCM of 18 and 24 ='] });
    const [entry] = cutOffScheme(exam([item]), {});
    expect(entry.items).toEqual([
      expect.stringContaining('(points[0].text is cut off: "Divides by 2, 2,")'),
      expect.stringContaining('(accept[1] is cut off: "LCM of 18 and 24 =")'),
    ]);
  });

  test('complete strings from v34 are not flagged, including a recurring decimal inside an accept', () => {
    const items = [
      maths('Q a', '508,260', { common_error: 'Writes 580,260 or leaves out the zero in the tens place, giving five hundred eight thousand, two hundred six.' }),
      maths('Q b', '548,640', { common_error: 'Forgets to put a zero when multiplying by the tens digit, giving 106,680.' }),
      maths('Q c', '2,286 r 8', { common_error: 'Places a wrong digit or forgets a zero in the quotient, giving 286 or 2,86.' }),
      maths('Q d', 'Sara', { accept: ['Converts to decimals 0.375, 0.333..., 0.4166... and compares'], common_error: 'Compares only the denominators.' }),
    ];
    expect(cutOffScheme(exam(items), {})).toEqual([]);
  });

  test('a numeric common_error equal to the answer, apart from commas, spaces and units, is flagged', () => {
    const same = maths('Q', 'Rs. 434,322', { common_error: 'Rs 434322' });
    const [entry] = cutOffScheme(exam([same]), {});
    expect(entry.items[0]).toContain('(common_error equals the answer: "Rs 434322")');
  });

  test('a numeric common_error that differs from the answer, or a sentence, is not flagged', () => {
    const diff = maths('Q', '486,418', { common_error: '523,418' });
    const sentence = maths('Q', '486,418', { common_error: 'Writes 486,418 with the digits reversed.' });
    expect(cutOffScheme(exam([diff, sentence]), {})).toEqual([]);
  });

  test('missing scheme, null common_error and non-exam input never throw', () => {
    expect(cutOffScheme(exam([{ slot: 's', question: 'Q', answer: '1' }, maths('Q', '1', {})]), {})).toEqual([]);
    expect(cutOffScheme(undefined, {})).toEqual([]);
  });
});

describe('schemeShortfall', () => {
  test('is both checks concatenated, in order, each shortfall shaped { slot, reason: "answer", items }', () => {
    const bad = maths('Q', '486,418', { common_error: 'gives 523,' });
    const e = exam([SIMILE, bad]);
    const out = schemeShortfall(e, {});
    expect(out).toEqual([...openItemsWithoutAccept(e, {}), ...cutOffScheme(e, {})]);
    expect(out.map((f) => f.slot)).toEqual(['english.A.Q1b', 'maths.B.Q2']);
    out.forEach((f) => { expect(f.reason).toBe('answer'); expect(Array.isArray(f.items)).toBe(true); });
  });

  test('a clean paper has no shortfall', () => {
    expect(schemeShortfall(exam([PAST, maths('Q', '48', { common_error: 'Adds instead of multiplying, giving 16.' })]), {})).toEqual([]);
  });
});

// bd-5jmnfj.4.58.7.5: the first cut flagged every Social Studies long answer whose stem said «مثال» (example), and every
// rubric-scored answer (fde-r17-sst, fde-section-reask went red). A rubric of two or more points IS the marking rule.
describe('openItemsWithoutAccept leaves rubric-scored answers and Social Studies «مثال» stems alone', () => {
  const urdu = (slot, question, answer, points, marks, accept = []) => ({
    slot, question, answer, marks, scheme: { points, accept, common_error: null, checked: null },
  });
  const FLOW = urdu('social_studies.B.Q3', '«حکومت کے تین اعضا»۔ اس عنوان پر ایک خاکہ (فلو چارٹ) بنائیں۔ ہر خانے میں مناسب معلومات اور مثال لکھیں۔',
    'عنوان: حکومت کے تین اعضا۔ مقننہ: قانون بناتی ہے۔ انتظامیہ: قانون نافذ کرتی ہے۔ عدلیہ: انصاف کرتی ہے۔',
    [{ text: 'عنوان', marks: 1, kind: 'A' }, { text: 'چار خانے', marks: 2, kind: 'A' }, { text: 'ہر خانے کی مثال', marks: 1, kind: 'A' }], 4);
  const EXPLAIN = urdu('social_studies.C.Q5', 'شہریت کا مطلب اپنے الفاظ میں واضح کریں۔ ایک مثال دیں۔',
    'کسی ملک کا قانونی رکن ہونا شہریت ہے۔ مثلاً پاکستان میں پیدا ہونے والا بچہ پاکستانی شہری ہے۔',
    [{ text: 'مطلب', marks: 2, kind: 'A' }, { text: 'مثال', marks: 2, kind: 'A' }], 4);
  const ONE_EXAMPLE = urdu('social_studies.D.Q7', 'پرنٹ میڈیا کی ایک مثال لکھیں۔', 'اخبار (یا رسالہ)۔', [{ text: 'اخبار', marks: 1, kind: 'A' }], 1);
  const OWN_WORDS = urdu('urdu.C.Q5', 'لفظ «محنت» کا مطلب اپنے الفاظ میں لکھیں۔', 'کوئی کام دل لگا کر کرنا۔', [{ text: 'مطلب', marks: 1, kind: 'A' }], 1);
  const MAKE_SENTENCE = urdu('urdu.C.Q6', 'لفظ «بہادر» سے جملہ بنائیں۔', 'علی ایک بہادر لڑکا ہے۔', [{ text: 'جملہ', marks: 1, kind: 'A' }], 1);
  const RUBRIC_ENGLISH = english('Write a sentence of your own using the word "brave".', 'The brave boy saved the cat.', [], {
    marks: 2, scheme: { points: [{ text: 'Uses "brave" correctly', marks: 1, kind: 'A' }, { text: 'A complete sentence', marks: 1, kind: 'A' }], accept: [], common_error: null, checked: null },
  });

  test('a flow chart and a four-mark explanation marked by a rubric of two or more points are not flagged, «مثال» or not', () => {
    expect(openItemsWithoutAccept(exam([FLOW, EXPLAIN]), {})).toEqual([]);
    expect(schemeShortfall(exam([FLOW, EXPLAIN]), {})).toEqual([]);
  });

  test('«مثال» alone does not make a stem open: a one-mark "write one example" item is left to the answer-check path', () => {
    expect(openItemsWithoutAccept(exam([ONE_EXAMPLE]), {})).toEqual([]);
  });

  test('«اپنے الفاظ» and «جملہ بنائیں» single-point items with no accept line are still flagged', () => {
    const out = openItemsWithoutAccept(exam([OWN_WORDS, MAKE_SENTENCE]), {});
    expect(out.map((r) => r.slot).sort()).toEqual(['urdu.C.Q5', 'urdu.C.Q6']);
    out.forEach((r) => expect(r.items[0]).toContain(MSG));
  });

  test('an English open item scored by a two-point rubric is not flagged; the single-point simile still is', () => {
    expect(openItemsWithoutAccept(exam([RUBRIC_ENGLISH]), {})).toEqual([]);
    expect(openItemsWithoutAccept(exam([SIMILE]), {})).toHaveLength(1);
  });
});
