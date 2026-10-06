/**
 * The feedback a child sees and hears after a WRONG pick, on the web page.
 *
 * Video-bank rows store WhatsApp-shaped feedback: "C) Good try! <the mix-up>. The correct answer
 * is B) <answer>, because <reason>. Keep going!". On the page the options are shuffled and badged
 * differently, the page already names the right answer, and a wrong answer must never be praised.
 * So the page gets the mix-up and the reason only: no option letters, no "the correct answer is",
 * no praise or cheering, no Urdu sentence that addresses the child with a gendered verb.
 */
const { cleanWrongFeedback } = require('../../../shared/services/quiz/web-quiz-feedback');

describe('cleanWrongFeedback', () => {
  test.each([
    ['C) Good effort. You mixed up winter snow with spring. The correct answer is B) Flowers are everywhere because spring has many flowers. Keep trying!',
      'You mixed up winter snow with spring. Spring has many flowers.'],
    ['A) Good try! You divided 8 tens by 4 but left the 4 ones. Correct answer is B) 21, because 84 ÷ 4 = 21. Keep going!',
      'You divided 8 tens by 4 but left the 4 ones. 84 ÷ 4 = 21.'],
    ["A) Nice try! Don’t leave out V in XV; XV is 15. The correct answer is B) 17, because 15 + 2 = 17. Keep practicing!",
      "Don’t leave out V in XV; XV is 15. 15 + 2 = 17."],
    ['C) Nice effort! You subtracted 9 − 4, but the p should stay. Correct answer: B) 5p, because both terms have p. Keep going!',
      'You subtracted 9 − 4, but the p should stay. Both terms have p.'],
    ['A) اچھی کوشش! آپ نے پنکی نام چنا، مگر ب سے لفظ بلی آیا۔ درست جواب B) بلی ہے، کیونکہ سبق میں ب سے بلی بتایا گیا۔ چلیں آگے!',
      'آپ نے پنکی نام چنا، مگر ب سے لفظ بلی آیا۔ سبق میں ب سے بلی بتایا گیا۔'],
    ['C) اچھی کوشش! دائیں ایک سمت ہے، دن کا الٹ نہیں۔ درست جواب A) رات ہے، کیونکہ دن کے مقابل رات آتی ہے۔ شاباش، آگے بڑھیں!',
      'دائیں ایک سمت ہے، دن کا الٹ نہیں۔ دن کے مقابل رات آتی ہے۔'],
    ['C) کوئی بات نہیں، آپ نے صرف انسان یاد رکھا، مگر حیوان بھی شامل ہیں۔ درست جواب A ہے: حقیقی مذکر مونث انسانوں اور حیوانوں کے لیے ہوتے ہیں۔ آگے بڑھیں!',
      'آپ نے صرف انسان یاد رکھا، مگر حیوان بھی شامل ہیں۔ حقیقی مذکر مونث انسانوں اور حیوانوں کے لیے ہوتے ہیں۔'],
    ['C) پیارے، تم قریب آئے لفظ چڑیا کو مراد سمجھ رہے ہو۔ درست جواب B ہے: یہ حمد ہے، اس لیے «اس کی» سے مراد اللہ تعالیٰ ہے۔ ہمت جاری!',
      'یہ حمد ہے، اس لیے «اس کی» سے مراد اللہ تعالیٰ ہے۔'],
    ['A) Good try! Our is for a group. Correct answer: B) her, because the lesson said “That is her balloon.” Keep going!',
      'Our is for a group. The lesson said “That is her balloon.”'],
    ["B) Good try! You placed the modal too late. The correct answer is A) Before the subject because questions start like 'Can I...?' Keep going!",
      "You placed the modal too late. Questions start like 'Can I...?'"],
    ['A) کوئی بات نہیں، آپ نے ب اور پ کی آوازیں ملا دیں۔ صحیح جواب C) ب ہے، کیونکہ ب کی آواز ب بتائی گئی۔ اچھا کام، آگے بڑھیں!',
      'آپ نے ب اور پ کی آوازیں ملا دیں۔ ب کی آواز ب بتائی گئی۔'],
    ['C) اچھا، آپ نے پَ چنا، یہ پے کی آواز ہے۔ درست جواب A) رَ ہے، کیونکہ رے کی آواز رَ ہوتی ہے۔ آپ سیکھ رہے ہیں، بہت خوب!',
      'آپ نے پَ چنا، یہ پے کی آواز ہے۔ رے کی آواز رَ ہوتی ہے۔'],
    ['B) پیارے بچے، ٹکٹ بس کی چیز ہے، مگر شین والا لفظ نہیں۔ صحیح جواب C) شاباش ہے، کیونکہ شاباش ش سے شروع ہوتا ہے۔ خوب!',
      'ٹکٹ بس کی چیز ہے، مگر شین والا لفظ نہیں۔ شاباش ش سے شروع ہوتا ہے۔'],
    ['Good try — you chose carbon dioxide, which plants use in photosynthesis. Plants use oxygen in respiration.',
      'You chose carbon dioxide, which plants use in photosynthesis. Plants use oxygen in respiration.'],
    ['You counted one bat extra. 1 bat plus 3 bats makes 4 bats. Well done trying!', 'You counted one bat extra. 1 bat plus 3 bats makes 4 bats.'],
    ['You stopped at 6. There are 8 candies. Keep going to the end!', 'You stopped at 6. There are 8 candies.'],
    ['شاباش کوشش پر! آپ نے اسے صفت جیسا سمجھا۔ حروفِ عطف دو اسماء یا دو جملے جوڑتے ہیں۔ جاری رکھیں!',
      'آپ نے اسے صفت جیسا سمجھا۔ حروفِ عطف دو اسماء یا دو جملے جوڑتے ہیں۔'],
  ])('%s', (raw, want) => {
    expect(cleanWrongFeedback(raw)).toBe(want);
  });

  test.each([
    'Try the next one!', 'آگے چلیں!', 'آگے بڑھو!', 'اچھا سوچا!', 'You’ve got this!', 'خوب کوشش!', 'پیاری کوشش!', 'You’re learning!',
    'Nice attempt!', 'آگے چلو!', 'پیارا جواب!', 'Keep counting!', 'لگے رہیں!', 'کوشش جاری رکھو!', 'Keep thinking!', 'You are learning!',
    'Kind try!', 'Nice attempt.', 'پھر کوشش کریں!', 'Good attempt!', 'You’re improving!', 'You’re getting there!', 'Not quite.', 'You’re close!',
    'چلتے رہیں!', 'یاد رکھیں!', 'اگلا سوال کریں!', 'Go on!', 'Stay focused!', 'You’re doing well!', 'Careful!', 'خیر ہے!', 'Move ahead!',
  ])('a short cheer after the reason is left out: "%s"', (cheer) => {
    expect(cleanWrongFeedback(`Incubation comes before hatching. ${cheer}`)).toBe('Incubation comes before hatching.');
  });

  test('a short sentence that carries content is kept, even with "!"', () => {
    expect(cleanWrongFeedback('Hatching comes after incubation. Eggs come first!')).toBe('Hatching comes after incubation. Eggs come first!');
    expect(cleanWrongFeedback('بیج پہلے آتا ہے۔ پھر پودا!')).toBe('بیج پہلے آتا ہے۔ پھر پودا!');
  });

  test('plain feedback with nothing to strip is kept as it is', () => {
    expect(cleanWrongFeedback('Leaves make food from sunlight; they do not take water from the soil.'))
      .toBe('Leaves make food from sunlight; they do not take water from the soil.');
    expect(cleanWrongFeedback('پتے دھوپ سے خوراک بناتے ہیں، مٹی سے پانی نہیں لیتے۔')).toBe('پتے دھوپ سے خوراک بناتے ہیں، مٹی سے پانی نہیں لیتے۔');
  });

  test('feedback that is only praise or a letter leaves nothing (the page then says the why)', () => {
    expect(cleanWrongFeedback('B) Good try! Keep going!')).toBe('');
    expect(cleanWrongFeedback('شاباش!')).toBe('');
    expect(cleanWrongFeedback(null)).toBe('');
  });

  test('a word that merely starts like a cheer is kept («خوبصورتی», "Almost all")', () => {
    expect(cleanWrongFeedback('خوبصورتی ہر جگہ ہے۔')).toBe('خوبصورتی ہر جگہ ہے۔');
    expect(cleanWrongFeedback('Almost all plants need sunlight.')).toBe('Almost all plants need sunlight.');
  });

  test('a decimal or money amount is never split as a sentence end', () => {
    expect(cleanWrongFeedback('A) Good try! One egg costs Rs.8 and 2.5 is not 8. Keep going!')).toBe('One egg costs Rs.8 and 2.5 is not 8.');
  });
});
