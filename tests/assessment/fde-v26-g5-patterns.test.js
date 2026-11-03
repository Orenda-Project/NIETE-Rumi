/**
 * v25 G5 should-fix findings (bd-5jmnfj.4.57).
 *
 * - English Q8: the model answer said "5-8 sentences", the marking line "8–10". One length, from the template.
 * - Urdu Q4 ارکان سازی: the key split «دن – دا – ن – ساز» leaves a lone letter; a clean accept split is promoted.
 * - Urdu Q7: seven helper words at ½ each is 3½, the row is worth 3; the row asks for any six.
 * - Urdu Q1: plain stems, and punctuation options name each mark in words.
 *
 * Pure functions, no I/O.
 */

const { keyFixes } = require('../../bot/shared/services/assessment/fde-g5-key-fixes');
const { criteriaFor } = require('../../bot/shared/services/assessment/composition-criteria');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027');
const slot = (subject, id) => P.subjects[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id);

function paper(unseen, slots) {
  return { unseen, _layout: { sections: [{ slots }], notes: [] } };
}

describe('English paragraph: one length, from the marking template', () => {
  const lengthRow = criteriaFor('paragraph', 10, 'en').find((r) => r.name === 'Neatness and length');

  test('the model answer takes the template\'s sentence count', () => {
    const exam = paper(
      { subjective: { 'Paragraph Writing': [{ slot: 'english.C.Q8', answer: 'A paragraph of 5-8 sentences on the chosen topic, with a topic sentence.' }] } },
      [{ slot: 'english.C.Q8', type: 'Paragraph Writing', kinds: ['paragraph'] }],
    );
    const out = keyFixes(exam);
    const answer = out.examJson.unseen.subjective['Paragraph Writing'][0].answer;
    expect(answer).toBe('A paragraph of 8–10 sentences on the chosen topic, with a topic sentence.');
    expect(lengthRow.look_for).toContain('8–10 sentences');
  });

  test('an answer with no sentence count is left as it is', () => {
    const exam = paper(
      { subjective: { 'Paragraph Writing': [{ slot: 'english.C.Q8', answer: 'Any paragraph on the topic.' }] } },
      [{ slot: 'english.C.Q8', type: 'Paragraph Writing', kinds: ['paragraph'] }],
    );
    expect(keyFixes(exam).examJson.unseen.subjective['Paragraph Writing'][0].answer).toBe('Any paragraph on the topic.');
  });
});

describe('Urdu syllables: no lone letter in the key', () => {
  const item = (answer, accept) => ({
    slot: 'urdu.C.Q4',
    main_question: 'ارکان سازی',
    question: 'ارکان سازی: درج ذیل الفاظ کو ان کے ارکان میں الگ کریں: دندان ساز، مشغول۔',
    answer,
    scheme: { accept },
  });
  const layout = [{ slot: 'urdu.C.Q4', type: 'Rewrite Sentences', kinds: ['group_words', 'conditional', 'tense', 'syllables'] }];

  test('a clean accept split replaces the broken one (v25)', () => {
    const exam = paper({ subjective: { 'Rewrite Sentences': [item('دندان ساز: دن – دا – ن – ساز؛ مشغول: مش – غول', ['دن – دان – ساز اور مش – غول', 'مش – غول'])] } }, layout);
    const out = keyFixes(exam);
    expect(out.examJson.unseen.subjective['Rewrite Sentences'][0].answer).toBe('دندان ساز: دن – دان – ساز؛ مشغول: مش – غول');
    expect(out.notes).toEqual([expect.objectContaining({ slot: 'urdu.C.Q4', reason: 'syllables', fixed: true })]);
  });

  test('a marking point quoting the broken split quotes the promoted one, in the key\'s own separator', () => {
    const q = item('دندان ساز: دن + دا + ن + ساز', ['دن + دان + ساز']);
    q.scheme.points = [{ text: 'دندان ساز: دن + دا + ن + ساز', marks: 1.25, kind: 'A' }];
    const out = keyFixes(paper({ subjective: { 'Rewrite Sentences': [q] } }, layout));
    const got = out.examJson.unseen.subjective['Rewrite Sentences'][0];
    expect(got.answer).toBe('دندان ساز: دن + دان + ساز');
    expect(got.scheme.points[0].text).toBe('دندان ساز: دن + دان + ساز');
    expect(got.scheme.accept).toEqual(['دن + دان + ساز']);
  });

  test('with no clean split to promote, the key stays and a note is raised', () => {
    const exam = paper({ subjective: { 'Rewrite Sentences': [item('دندان ساز: دن – دا – ن – ساز؛ مشغول: مش – غول', ['مش – غول'])] } }, layout);
    const out = keyFixes(exam);
    expect(out.examJson.unseen.subjective['Rewrite Sentences'][0].answer).toBe('دندان ساز: دن – دا – ن – ساز؛ مشغول: مش – غول');
    expect(out.notes).toEqual([expect.objectContaining({ slot: 'urdu.C.Q4', reason: 'syllables', fixed: false })]);
  });

  test('a split with آ alone is fine, and a clean key is not touched', () => {
    const exam = paper({ subjective: { 'Rewrite Sentences': [item('آرام: آ – رام', []), item('جاگیردار: جا + گیر + دار؛ معذور: مع + ذور', [])] } }, layout);
    const out = keyFixes(exam);
    expect(out.notes).toEqual([]);
    expect(out.examJson.unseen.subjective['Rewrite Sentences'][0].answer).toBe('آرام: آ – رام');
    expect(out.examJson.unseen.subjective['Rewrite Sentences'][1].answer).toBe('جاگیردار: جا + گیر + دار؛ معذور: مع + ذور');
  });

  test('a non-syllable item of the slot is never read', () => {
    const exam = paper({ subjective: { 'Rewrite Sentences': [{ slot: 'urdu.C.Q4', question: 'جب گھنٹی بجی تب بچے کھڑے ہو گئے۔', answer: 'ج) جب، تب' }] } }, layout);
    expect(keyFixes(exam).notes).toEqual([]);
  });
});

describe('Urdu picture description: helper-word marks add up', () => {
  test('the helper row asks for a count whose halves equal its marks', () => {
    const rows = criteriaFor('picture_description', 10, 'ur');
    const row = rows.find((r) => r.name.includes('مددگار الفاظ'));
    expect(row.name).toContain('چھ');
    expect(6 * 0.5).toBe(row.marks);
  });

  test('the paper still gives seven helper words', () => {
    expect(slot('urdu', 'urdu.C.Q7').prompt_rule).toMatch(/seven helper words/);
  });
});

describe('Urdu MCQs: plain stems, named punctuation marks', () => {
  const rule = () => slot('urdu', 'urdu.A.Q1').prompt_rule;

  test('stems state the task with no lead-in', () => {
    expect(rule()).toMatch(/plain/i);
    expect(rule()).toMatch(/lead-in/i);
  });

  test('a punctuation option names its mark in words', () => {
    expect(rule()).toContain('۔ (ختمہ)');
    expect(rule()).toContain('؟ (سوالیہ نشان)');
  });
});
