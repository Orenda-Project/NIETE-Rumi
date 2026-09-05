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

  test('falls back to the transcript language, then Urdu — never the English market floor', () => {
    expect(L.teacherLanguageFor({ preferredLanguage: null, transcriptLanguage: 'en' })).toBe('en');
    expect(L.teacherLanguageFor({ preferredLanguage: null, transcriptLanguage: 'mixed' })).toBe('ur');
    expect(L.teacherLanguageFor({})).toBe('ur');
  });

  test('an off-offer preference (pa-PK) is treated as unset', () => {
    expect(L.teacherLanguageFor({ preferredLanguage: 'pa-PK', transcriptLanguage: 'ur' })).toBe('ur');
  });
});
