/**
 * bd-5jmnfj.33 v33 BLOCKER — G4 Urdu ch8 Q1 x fuses two questions into one stem and prints its keyed option
 * «زحل» inside the stem. fde-answer-repeats / fde-stem-repeats never see it: both skip an item's own stem on
 * purpose (`j === i`, and `own` excuses the key word), so a key printed in its own stem has no check.
 */

const { mcqStemShortfall, mcqStemNote } = require('../../bot/shared/services/assessment/fde-mcq-stem');

const P = { g5_rules: false };
const exam = (items) => ({ _layout: { subject: 'Urdu', sections: [] }, unseen: { objective: { MCQs: items } } });
const mcq = (question, options, answer, slot = 'g4.urdu.A.mcq') => ({ slot, question, options, answer, marks: 1 });
const URDU_OPTS = ['الف) ضحل', 'ب) زحل', 'ج) ذحل', 'د) زہل'];

const V33 = mcq('"ستاروں اور سیاروں کے لیے ایک ہی سیدھ میں سفر" کے لیے درست لفظ کون سا ہے جس کے ہجے صحیح ہیں؟ '
  + 'سورج کے گرد گھومنے والی بڑی گیند جیسی دنیا میں سے ایک کا نام "زحل" ہے۔ اس کے ہجے کون سے ہیں؟', URDU_OPTS, 'ب) زحل');

describe('an MCQ stem that fuses questions or prints its key', () => {
  test('the v33 item is flagged twice: fused stem and answer in stem', () => {
    const flags = mcqStemShortfall(exam([V33]), P);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: 'g4.urdu.A.mcq', reason: 'mcq_stem' });
    expect(flags[0].why).toEqual(expect.arrayContaining(['two_questions', 'key_in_stem']));
  });

  test('a one-question stem that does not print the key is not flagged', () => {
    const ok = mcq('سورج کے گرد گھومنے والے چھٹے سیارے کے درست ہجے کون سے ہیں؟', URDU_OPTS, 'ب) زحل');
    expect(mcqStemShortfall(exam([ok]), P)).toEqual([]);
  });

  test('two question marks (Urdu or Latin) outside quotes flag; one inside a quotation does not', () => {
    const urdu = mcq('پہلا سوال کیا ہے؟ دوسرا سوال کیا ہے؟', URDU_OPTS, 'ب) زحل');
    expect(mcqStemShortfall(exam([urdu]), P)[0].why).toEqual(['two_questions']);
    const latin = mcq('What is it? And why is it so?', ['a) one', 'b) two'], 'a) one');
    expect(mcqStemShortfall(exam([latin]), P)[0].why).toEqual(['two_questions']);
    const quoted = mcq('"کیا یہ سچ ہے؟" یہ جملہ کس نے کہا؟', URDU_OPTS, 'ب) زحل');
    expect(mcqStemShortfall(exam([quoted]), P)).toEqual([]);
  });

  test('an English stem repeating its keyed option as a whole word is flagged', () => {
    const q = mcq('Which animal is the cat?', ['a) dog', 'b) cat', 'c) cow', 'd) hen'], 'b) cat', 'g4.english.A.mcq');
    expect(mcqStemShortfall(exam([q]), P)[0].why).toEqual(['key_in_stem']);
  });

  test('the key as part of a longer word is not flagged', () => {
    const en = mcq('Which of these is a category of pet?', ['a) dog', 'b) cat', 'c) cow', 'd) hen'], 'b) cat', 'g4.english.A.mcq');
    expect(mcqStemShortfall(exam([en]), P)).toEqual([]);
    const ur = mcq('"زحلی" کس کی طرف نسبت ہے؟', URDU_OPTS, 'ب) زحل');
    expect(mcqStemShortfall(exam([ur]), P)).toEqual([]);
  });

  test('matching ignores diacritics and quotation marks', () => {
    const q = mcq('اس سیارے کا نام «زَحَل» ہے، اس کے ہجے کون سے ہیں', URDU_OPTS, 'ب) زحل');
    expect(mcqStemShortfall(exam([q]), P)[0].why).toEqual(['key_in_stem']);
  });

  test('a stem that matches only a wrong option is not flagged', () => {
    const q = mcq('"ضحل" کے درست ہجے کون سے ہیں', URDU_OPTS, 'ب) زحل');
    expect(mcqStemShortfall(exam([q]), P)).toEqual([]);
  });

  test('non-MCQ items, a Grade 5 paper and a null exam are left alone', () => {
    const short = { slot: 's', question: 'کیا؟ کیوں؟', answer: 'زحل' };
    expect(mcqStemShortfall({ unseen: { subjective: { S: [short] } } }, P)).toEqual([]);
    expect(mcqStemShortfall(exam([V33]), { g5_rules: true })).toEqual([]);
    expect(mcqStemShortfall(null, P)).toEqual([]);
  });
});

describe('the re-ask note', () => {
  test('names the stem and what to fix', () => {
    const note = mcqStemNote(mcqStemShortfall(exam([V33]), P));
    expect(note).toContain('ستاروں اور سیاروں');
    expect(note).toMatch(/one question/i);
    expect(note).toMatch(/key|answer/i);
  });
  test('is null when no mcq_stem flag is present', () => {
    expect(mcqStemNote([{ slot: 's', reason: 'giveaway' }])).toBeNull();
    expect(mcqStemNote(undefined)).toBeNull();
  });
});
