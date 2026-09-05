'use strict';
/**
 * bd-mg9c7 — the quiz language is decided by the SUBJECT in code, never by
 * the market default and never by the prompt: Urdu-medium subjects are quizzed
 * in Urdu, English in English, and everything else follows the lesson.
 */
const L = require('../../bot/shared/services/quiz/transcript-quiz-language');

describe('quizLanguageFor(subject, transcriptLanguage)', () => {
  test.each([
    ['islamiat', 'en', 'ur'],
    ['Islamiyat', 'en', 'ur'],
    ['urdu', 'en', 'ur'],
    ['اردو', 'en', 'ur'],
    ['sst', 'en', 'ur'],
    ['Social Studies', 'en', 'ur'],
    ['genk', 'en', 'ur'],
    ['General Knowledge', 'en', 'ur'],
    ['english', 'ur', 'en'],
    ['English', 'urdu', 'en'],
    ['maths', 'ur', 'ur'],
    ['Mathematics', 'urdu', 'ur'],
    ['science', 'en', 'en'],
    ['science', 'english', 'en'],
    ['maths', 'mixed', 'ur'],
    ['other', null, 'ur'],
  ])('%s + %s → %s', (subject, tl, want) => {
    expect(L.quizLanguageFor(subject, tl)).toBe(want);
  });
});

describe('canonicalSubject', () => {
  test.each([
    ['Islamiyat', 'islamiat'], ['islamic studies', 'islamiat'], ['اسلامیات', 'islamiat'],
    ['Math', 'maths'], ['ریاضی', 'maths'], ['General Science', 'science'], ['سائنس', 'science'],
    ['Social Study', 'sst'], ['معاشرتی علوم', 'sst'], ['GK', 'genk'], ['English Language', 'english'],
    ['Urdu', 'urdu'], ['Art', 'other'], [null, 'other'],
  ])('%s → %s', (s, want) => expect(L.canonicalSubject(s)).toBe(want));
});

describe('teacherLanguageFor — teacher-facing copy', () => {
  test('the stored preference wins', () => {
    expect(L.teacherLanguageFor({ preferredLanguage: 'en', transcriptLanguage: 'ur' })).toBe('en');
    expect(L.teacherLanguageFor({ preferredLanguage: 'ur', transcriptLanguage: 'en' })).toBe('ur');
  });

  test('nothing detected or transcribed may answer for her', () => {
    // The clamp's floor is the ONE answer to "nothing is known" across this
    // deployment. Falling back to the transcript meant the same teacher was
    // addressed differently depending on the lesson she had just recorded.
    expect(L.teacherLanguageFor({ preferredLanguage: null, transcriptLanguage: 'ur' })).toBe('en');
    expect(L.teacherLanguageFor({ preferredLanguage: null, transcriptLanguage: 'mixed' })).toBe('en');
    expect(L.teacherLanguageFor({})).toBe('en');
  });

  test('an off-offer preference (pa-PK) is clamped, not stored-through', () => {
    expect(L.teacherLanguageFor({ preferredLanguage: 'pa-PK', transcriptLanguage: 'ur' })).toBe('en');
  });
});

describe('lessonLabel — the subject and the topic as it was taught', () => {
  const URDU_GRAMMAR = { topic: 'singular and plural', topic_as_taught: 'واحد اور جمع', subject: 'urdu' };

  test('an English-reading teacher gets the subject in English, the topic as taught, and an English gloss', () => {
    const s = L.lessonLabel({ digest: URDU_GRAMMAR, quizLanguage: 'ur', teacherLanguage: 'en' });
    expect(s).toMatch(/Urdu lesson/);
    expect(s).toMatch(/واحد اور جمع/);
    expect(s).toMatch(/\(.*singular and plural.*\)/);
  });

  test('an Urdu-reading teacher whose quiz is Urdu too gets no gloss', () => {
    const s = L.lessonLabel({ digest: URDU_GRAMMAR, quizLanguage: 'ur', teacherLanguage: 'ur' });
    expect(s).toMatch(/اردو/);
    expect(s).toMatch(/واحد اور جمع/);
    expect(s).not.toMatch(/singular and plural/);
  });

  test('Islamiyat has a label of its own in both languages — never a raw key', () => {
    const d = { topic: 'The five pillars', topic_as_taught: 'ارکانِ اسلام', subject: 'islamiat' };
    expect(L.lessonLabel({ digest: d, quizLanguage: 'ur', teacherLanguage: 'en' })).toMatch(/Islamiyat/);
    expect(L.lessonLabel({ digest: d, quizLanguage: 'ur', teacherLanguage: 'ur' })).toMatch(/اسلامیات/);
  });

  test('the digest keys sst and genk map to their catalog labels', () => {
    expect(L.lessonLabel({ digest: { topic: 'Provinces', topic_as_taught: 'صوبے', subject: 'sst' }, quizLanguage: 'ur', teacherLanguage: 'en' })).toMatch(/Social Studies/);
    expect(L.lessonLabel({ digest: { topic: 'Our flag', topic_as_taught: 'ہمارا پرچم', subject: 'genk' }, quizLanguage: 'ur', teacherLanguage: 'en' })).toMatch(/General Knowledge/);
  });

  test('an unmapped subject falls back to the catalog word for a lesson, never "other"', () => {
    const s = L.lessonLabel({ digest: { topic: 'Shapes we drew', subject: 'art' }, quizLanguage: 'en', teacherLanguage: 'en' });
    expect(s).toMatch(/^lesson on /);
    expect(s).not.toMatch(/other/i);
    const ur = L.lessonLabel({ digest: { topic: 'Shapes', topic_as_taught: 'شکلیں', subject: 'art' }, quizLanguage: 'ur', teacherLanguage: 'ur' });
    expect(ur).toMatch(/سبق/);
    expect(ur).not.toMatch(/other/i);
  });

  test('the topic is isolated so a script switch cannot reorder the sentence around it', () => {
    const s = L.lessonLabel({ digest: URDU_GRAMMAR, quizLanguage: 'ur', teacherLanguage: 'en' });
    expect(s).toMatch(/⁨/);
    expect(s).toMatch(/⁩/);
  });
});

describe('transliterations seen on the live cards (2026-09-05 evening)', () => {
  test('ہول / پارٹس / ٹیسٹ / سرکل are written in English letters', () => {
    const out = L.fixTransliterations('یہ ایک ہول (whole) کے پارٹس کو دکھاتا ہے، ٹیسٹ میں سرکل کی شکل');
    expect(out).not.toMatch(/ہول|پارٹس|ٹیسٹ|سرکل/);
    expect(out).toMatch(/whole/); expect(out).toMatch(/parts/); expect(out).toMatch(/test/); expect(out).toMatch(/circle/);
  });
});
