'use strict';
/**
 * The child has no gender — the forms the address check must see, the ones it
 * must leave alone, and what it tells the repair to write instead.
 *
 * Staging E2E, 25 Sep: a live quiz's feedback told a child «… کہہ کر آپ بیمار کا
 * حوصلہ بڑھا سکتے ہیں۔» — a masculine modal. The check DID flag it (quiz meta:
 * attempt 3 and the last rewrite both name «آپ … سکتے ہیں»); the last targeted
 * rewrite fixed the future «بڑھائیں گے» beside it and left the modal, and the
 * question shipped with the fault recorded. The complaint the rewrite reads
 * showed only how to neutralise a future or a question, never a modal, a
 * progressive or a habitual — so each form class found now carries its own
 * neutral rewrite.
 *
 * Measured on 2,400 recent production Urdu items (FINDINGS, W11): one class the
 * check missed — آپ with a perfective and no auxiliary, «آپ 0 کو گننا بھول گئے۔».
 * It is flagged now, with the honorific guards the narrative past needs.
 *
 * Driven through the real detector and the real validator.
 */
const A = require('../../bot/shared/services/quiz/transcript-quiz-address');
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const fb = (text) => A.addressForms(text, { kind: 'feedback' });

describe('forms the staging finding named — flagged (locks)', () => {
  test.each([
    ['the staging sentence', 'شاباش! \'فِکر نہ کریں، جَلد ٹھیک ہوں گی\' کہہ کر آپ بیمار کا حوصلہ بڑھا سکتے ہیں۔', 'آپ … سکتے ہیں'],
    ['feminine modal', 'آپ بیمار کا حوصلہ بڑھا سکتی ہیں۔', 'آپ … سکتی ہیں'],
    ['wanting', 'اگر آپ یہ جاننا چاہتے ہیں تو سبق دوبارہ پڑھیں۔', 'آپ … چاہتے ہیں'],
    ['progressive, masculine', 'آپ شاید جمع کو ضرب سمجھ رہے ہیں۔', 'آپ … رہے ہیں'],
    ['progressive, feminine', 'آپ شاید جمع کو ضرب سمجھ رہی ہیں۔', 'آپ … رہی ہیں'],
    ['future modal', 'آپ یہ سوال خود حل کر سکیں گے۔', 'آپ … سکیں گے'],
  ])('%s', (_, text, form) => {
    expect(fb(text)).toContain(form);
  });
});

describe('آپ with a perfective and no auxiliary — the class production showed the check missing', () => {
  test.each([
    ['آپ 0 کو گننا بھول گئے۔'],
    ['آپ نے ones کی جگہ پر 2 اور 9 کو جمع کیا، لیکن آپ کیری کو جمع کرنا بھول گئے۔'],
    ['شاباش! آپ سمجھ گئیں۔'],
    ['آپ یہ سوال پہلے ہی حل کر چکے۔'],
  ])('%s', (text) => {
    expect(fb(text).length).toBeGreaterThan(0);
  });
});

describe('left alone — third person, named characters, the honorific narrative, quotes', () => {
  test.each([
    ['a story character, future', 'فاطمہ جلد ٹھیک ہوں گی۔'],
    ['a story character, perfective', 'علی گھر جانا بھول گیا۔'],
    ['a thing, perfective', 'آئس کریم دھوپ میں پگھل گئی۔'],
    ['children, perfective', 'بچے میدان میں چلے گئے۔'],
    ['آپ نے: the verb agrees with its object', 'آپ نے کیری کو جمع نہیں کیا۔'],
    ['آپ کے: not the subject', 'آپ کے دوست گھر چلے گئے۔'],
    ['the Prophet ﷺ right after آپ', 'آپ ﷺ مدینہ تشریف لے گئے۔'],
    ['the Prophet ﷺ named in the sentence before', 'نبی کریم ﷺ نے مکہ سے ہجرت کی۔ آپ مدینہ تشریف لے گئے۔'],
    ['a companion named earlier in the field', 'حضرت ابوبکر رضی اللہ عنہ ساتھ تھے۔ آپ غار میں ٹھہر گئے۔'],
    ['a quoted example sentence', 'جملہ \'آپ کھانا کھانا بھول گئے\' کس زمانے کا ہے؟'],
    ['a past narrative with تھے (unchanged)', 'آپ روز مسجد جاتے تھے۔'],
    // Production (R11 measurement): the perfective is the ice cream's, after «اور وہ».
    ['a new subject after «اور» owns the perfective', 'آپ بازار سے آئس کریم لائے اور وہ پگھل گئی۔'],
  ])('%s', (_, text) => {
    expect(fb(text)).toEqual([]);
  });
});

describe('the complaint the repair reads names the neutral rewrite for the form it found', () => {
  const DIGEST = { slos: [{ id: 'S1', statement: 's', taught_level: 'recall' }, { id: 'S2', statement: 't', taught_level: 'understand' }] };
  const ctx = { language: 'ur', subject: 'urdu', digest: DIGEST, nExpected: 8 };
  const base = (i) => ({
    slo_id: i % 2 ? 'S2' : 'S1', level: i % 2 ? 'understand' : 'recall',
    question: `پودے کا کون سا حصہ مٹی کے نیچے ہوتا ہے؟ ${i}`,
    options: ['جڑ', 'پتا', 'پھول'], correct_index: 0,
    explanation: 'جڑ مٹی کے اندر ہوتی ہے۔',
    selected_because: 'یہ سوال پودے کے حصوں کی پہچان جانچتا ہے۔',
    distractor_misconceptions: { 1: 'پتوں کو جڑ سمجھنا', 2: 'پھولوں کو جڑ سمجھنا' },
    option_feedback: { correct: 'بالکل — جڑ مٹی کے نیچے ہوتی ہے۔', wrong: { 1: 'پتا ہوا میں ہوتا ہے۔', 2: 'پھول اوپر ہوتا ہے۔' } },
  });
  const complaintFor = (feedback) => {
    const qs = [0, 1, 2, 3, 4, 5, 6, 7].map(base);
    qs[1].option_feedback.correct = feedback;
    return V.validate(qs, ctx).errors.find((e) => /^q1: PEDAGOGY_GENDERED_CHILD/.test(e)) || '';
  };

  test('a modal: the impersonal «… جا سکتا ہے» or the imperative', () => {
    const c = complaintFor('شاباش! یہ کہہ کر آپ بیمار کا حوصلہ بڑھا سکتے ہیں۔');
    expect(c).toMatch(/آپ … سکتے ہیں/);
    expect(c).toMatch(/جا سکتا ہے/);
  });

  test('a progressive: «شاید آپ نے … سمجھا»', () => {
    const c = complaintFor('آپ شاید جمع کو ضرب سمجھ رہے ہیں۔');
    expect(c).toMatch(/شاید آپ نے … سمجھا/);
  });

  test('a habitual: the impersonal «… کہا جاتا ہے»', () => {
    const c = complaintFor('آپ اسے روزانہ دہراتے ہیں۔');
    expect(c).toMatch(/کہا جاتا ہے/);
  });

  test('a perfective with no auxiliary: the verb agrees with what was missed', () => {
    const c = complaintFor('آپ 0 کو گننا بھول گئے۔');
    expect(c).toMatch(/رہ گیا/);
  });

  test('the complaint still opens the same way (the rewrite and the soft-fault ship key on it)', () => {
    expect(complaintFor('آپ بیمار کا حوصلہ بڑھا سکتے ہیں۔')).toMatch(/^q1: PEDAGOGY_GENDERED_CHILD — option_feedback speaks to the child with a gendered verb \("آپ … سکتے ہیں"\); the class is boys and girls\./);
  });
});
