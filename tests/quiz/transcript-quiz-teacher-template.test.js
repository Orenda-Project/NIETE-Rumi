'use strict';
/**
 * bd-mg9c7.10 — the teacher's PDF. PlayWriteReports rules: embedded Nastaliq,
 * RTL for Urdu, per-language chrome, Latin runs isolated. Content: every
 * question shows its SLO, the why, each distractor's misconception and the
 * child guidance.
 */
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');

const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5',
  slos: [{ id: 'S1', statement: 'آدھے کو کسر میں لکھنا', taught_level: 'recall' },
         { id: 'S2', statement: 'برابر حصوں کی پہچان', taught_level: 'understand' }],
  key_terms: [{ term: 'fraction', as_spoken: 'fraction' }], examples_used: ['آدھی روٹی'],
};
const QUESTIONS = [
  { external_id: 'tq:S1:1', question_text: 'آدھی روٹی کا fraction کیا ہے؟', option_a: '½', option_b: '⅓', option_c: '¼', correct_option: 'A',
    explanation: 'روٹی دو برابر حصوں میں کٹی، ایک حصہ آدھا ہے۔',
    distractor_misconceptions: { B: 'تین حصے سمجھنا', C: 'چار حصے سمجھنا' },
    option_feedback: { correct: 'بالکل — ایک بٹا دو۔', wrong: { 1: 'تین حصے نہیں تھے۔', 2: 'چار حصے نہیں تھے۔' } } },
  { external_id: 'tq:S2:2', question_text: 'کون سے حصے برابر ہیں؟', option_a: 'دو برابر ٹکڑے', option_b: 'ایک بڑا ایک چھوٹا', option_c: 'تین ٹکڑے', correct_option: 'A',
    explanation: 'کسر کے لیے حصے برابر ہونے چاہییں۔', distractor_misconceptions: { B: 'کوئی بھی حصے', C: 'گنتی' },
    option_feedback: { correct: 'ٹھیک — برابر حصے۔', wrong: { 1: 'حصے برابر نہیں۔', 2: 'گنتی نہیں، برابری۔' } } },
];
const BASE = { topic: 'کسریں', teacherName: 'Rifat Noor', date: '5 ستمبر 2026', link: 'https://wa.me/923222482222?text=QUIZ-ABC234', digest: DIGEST, questions: QUESTIONS, language: 'ur' };

describe('Urdu render', () => {
  const html = render(BASE);
  test('<html dir="rtl" lang="ur"> with a non-empty embedded Nastaliq face', () => {
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(html).toMatch(/font-family:'NastaliqUrdu';font-weight:400;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]{100,}/);
  });
  test('Urdu chrome present, English chrome absent, .ltr rule forces direction', () => {
    expect(html).toMatch(/کوئز/);
    expect(html).not.toMatch(/Why this question/);
    expect(html).toMatch(/\.ltr\{[^}]*direction:ltr/);
  });
  test('every question shows its SLO, the why, each distractor’s misconception and the child guidance', () => {
    expect(html).toMatch(/آدھے کو کسر میں لکھنا/);
    expect(html).toMatch(/روٹی دو برابر حصوں میں کٹی/);
    expect(html).toMatch(/تین حصے سمجھنا/);
    expect(html).toMatch(/چار حصے نہیں تھے/);
    expect(html).toMatch(/بالکل — ایک بٹا دو/);
  });
  test('marks the correct option and isolates Latin runs', () => {
    expect(html).toMatch(/class="opt correct"/);
    expect(html).toMatch(/<span class="ltr">fraction<\/span>/);
  });
  test('uses the NIETE palette, never the Rumi navy', () => {
    expect(html).toMatch(/#333748/);
    expect(html).toMatch(/#47BA7D/i);
    expect(html).not.toMatch(/#0c1a4e/);
  });
  test('names no grade anywhere', () => {
    expect(html).not.toMatch(/جماعت\s*\d/);
    expect(html).not.toMatch(/Grade\s*\d/);
  });
});

describe('English render', () => {
  const html = render({ ...BASE, language: 'en', topic: 'Fractions', date: '5 Sep 2026' });
  test('ltr, English chrome, Urdu chrome absent', () => {
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Why this question/);
    expect(html).not.toMatch(/یہ سوال کیوں/);
  });
});
