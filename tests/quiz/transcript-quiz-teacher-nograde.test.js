'use strict';
/**
 * Operator round-5 item 6: "The report I got on staging before the quiz tells
 * me grade 6-8, that's a wild range. Leave out grade from the pre-send PDF."
 *
 * The hero's meta line was `name · Grade N · date`; it is now `name · date`.
 * `grade` stays in the signature (the caller is owned by another lane this
 * round) but is accepted and ignored — a template that ignores a prop it no
 * longer renders is the additive change.
 */
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');

const BASE_EN = {
  topic: 'Fractions', teacherName: 'Rifat Noor', grade: '6-8', date: '5 Sep 2026',
  link: 'https://wa.me/1', digest: { slos: [] }, questions: [],
  language: 'en', contentLanguage: 'en', lessonSummary: 'You started with half a roti.',
};
const BASE_UR = {
  ...BASE_EN, language: 'ur', contentLanguage: 'ur', topic: 'کسریں', date: '5 ستمبر 2026',
  lessonSummary: 'آپ نے آدھی روٹی سے شروع کیا۔',
};

describe('the pre-send PDF drops the grade band (operator item 6)', () => {
  test('an English render with a grade band shows no "Grade" and no "6-8" anywhere', () => {
    const html = render(BASE_EN);
    expect(html).not.toMatch(/Grade/);
    expect(html).not.toMatch(/6-8/);
  });

  test('the Urdu render shows no جماعت (the Urdu "grade" chrome) in the meta line', () => {
    const html = render(BASE_UR);
    expect(html).not.toMatch(/جماعت/);
  });

  test('name and date still appear, separated by exactly one "·" between two parts', () => {
    const html = render(BASE_EN);
    const who = /<div class="who">([^<]*(?:<span[^>]*>[^<]*<\/span>[^<]*)*)<\/div>/.exec(html);
    expect(who).toBeTruthy();
    const metaHtml = who[1];
    expect(metaHtml).toMatch(/Rifat Noor/);
    expect(metaHtml).toMatch(/5 Sep 2026/);
    const seps = metaHtml.match(/class="sep"/g) || [];
    expect(seps).toHaveLength(1);
  });
});

describe('Urdu chrome uses Latin "quiz", never a transliteration (operator item 14)', () => {
  test('the eyebrow and "what this quiz checks" label carry Latin quiz, not کوئز', () => {
    const html = render(BASE_UR);
    expect(html).not.toMatch(/کوئز/);
    expect(html).toMatch(/<span class="ltr">quiz<\/span>/);
  });
});
