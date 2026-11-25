'use strict';
/**
 * bd-0q8b4x (queue #300) — Urdu word help on English lesson quizzes, switched OFF.
 * The pure half: the book's own glossary, matching it into a question, cleaning
 * made meanings, the lot, and what the page is served.
 */
const W = require('../../shared/services/quiz/quiz-word-help');

const slideScript = {
  hook: {
    keyWords: [
      { term: 'harvest', urdu: 'فصل کاٹنا', def: 'to cut and gather crops' },
      { term: 'plant', def: 'to put a seed in the ground' }, // no Urdu: not a gloss
      { word: 'shade (سایہ)', meaning: 'a cool dark place' }, // Urdu in brackets
      { term: 'tree', def: 'درخت — a tall plant' }, // Urdu inside the definition
    ],
  },
  wrap: { keyFacts: ['root — جڑ', 'Seeds need water.'] }, // the v9 "word — meaning" line
};

describe('bookGlossary', () => {
  test('takes only English words that carry an Urdu meaning, in every shape a plan writes one', () => {
    expect(W.bookGlossary(slideScript)).toEqual([
      { en: 'harvest', ur: 'فصل کاٹنا' },
      { en: 'shade', ur: 'سایہ' },
      { en: 'tree', ur: 'درخت' },
      { en: 'root', ur: 'جڑ' },
    ]);
  });
  test('nothing for a missing or odd script', () => {
    expect(W.bookGlossary(null)).toEqual([]);
    expect(W.bookGlossary({ hook: { keyWords: 'x' } })).toEqual([]);
  });
});

describe('matchWords', () => {
  const g = W.bookGlossary(slideScript);
  test('finds glossary words in the stem and options, whole words only, at most 3', () => {
    const row = { question_text: 'Why did the farmer harvest early?', option_a: 'The trees were dry', option_b: 'Rain', option_c: 'Shade' };
    expect(W.matchWords(row, g)).toEqual([
      { en: 'harvest', ur: 'فصل کاٹنا', from: 'book' },
      { en: 'shade', ur: 'سایہ', from: 'book' },
      { en: 'tree', ur: 'درخت', from: 'book' }, // "trees": a plain plural counts
    ]);
  });
  test('"tree" does not match "street"', () => {
    expect(W.matchWords({ question_text: 'Who lives on the street?' }, g)).toEqual([]);
  });
});

describe('cleanMade', () => {
  const row = { question_text: 'What did the farmer harvest?', option_a: 'wheat', option_b: 'stones', option_c: 'shoes' };
  test('keeps a short Urdu meaning for a word that is in the question', () => {
    expect(W.cleanMade(row, { en: 'Wheat', ur: 'گندم' })).toEqual({ en: 'wheat', ur: 'گندم', from: 'made' });
  });
  test('drops a word not in the question, a meaning not in Urdu script, and a long one', () => {
    expect(W.cleanMade(row, { en: 'river', ur: 'دریا' })).toBeNull();
    expect(W.cleanMade(row, { en: 'wheat', ur: 'gandum' })).toBeNull();
    expect(W.cleanMade(row, { en: 'wheat', ur: 'ایک قسم کا اناج جو کھیت میں اگتا ہے' })).toBeNull();
  });
});

describe('armOf — the lot', () => {
  test('the same class link always lands in the same half', () => {
    expect(W.armOf('abc-123')).toBe(W.armOf('abc-123'));
  });
  test('about half of class links get the help', () => {
    let help = 0;
    for (let i = 0; i < 1000; i += 1) if (W.armOf(`link-${i}`) === 'help') help += 1;
    expect(help).toBeGreaterThan(430);
    expect(help).toBeLessThan(570);
  });
});

describe('servedWords — what the page gets', () => {
  const row = { media: { word_help: [{ en: 'harvest', ur: 'فصل کاٹنا', from: 'book' }] } };
  test('switch off: nothing, even when the question carries words', () => {
    expect(W.servedWords(row, { on: false, lot: false, shareCodeId: 'x' })).toBeNull();
  });
  test('switch on: the words, without where they came from', () => {
    expect(W.servedWords(row, { on: true, lot: false, shareCodeId: 'x' })).toEqual([{ en: 'harvest', ur: 'فصل کاٹنا' }]);
  });
  test('switch on by lot: only the help half', () => {
    let link = 'a';
    while (W.armOf(link) !== 'control') link += 'a';
    expect(W.servedWords(row, { on: true, lot: true, shareCodeId: link })).toBeNull();
    while (W.armOf(link) !== 'help') link += 'b';
    expect(W.servedWords(row, { on: true, lot: true, shareCodeId: link })).toHaveLength(1);
  });
  test('a question with no words gets nothing', () => {
    expect(W.servedWords({ media: {} }, { on: true, lot: false, shareCodeId: 'x' })).toBeNull();
  });
});
