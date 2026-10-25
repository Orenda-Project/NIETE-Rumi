'use strict';
/**
 * first-reply-english-evidence — the pure rule that may answer a BRAND-NEW row's first message in
 * English, and only on POSITIVE English evidence (Latin script alone is not evidence: Roman Urdu is
 * Latin-script Urdu). Switch FIRST_REPLY_ENGLISH_EVIDENCE, exactly "true"; anything else is off.
 */
const {
  hasEnglishEvidence,
  isBrandNewRow,
  isSwitchOn,
  firstReplyLanguage,
  ROMAN_URDU,
  ENGLISH,
  SHARED,
} = require('../../shared/utils/first-reply-english-evidence');

const NEW_ROW = { id: 'u-new', preferred_language: 'ur', language_locked: false, first_message_at: null };
const OLD_ROW = { ...NEW_ROW, id: 'u-old', first_message_at: '2026-09-01T08:00:00.000Z' };
const ON = { FIRST_REPLY_ENGLISH_EVIDENCE: 'true' };

describe('hasEnglishEvidence — positive evidence only', () => {
  test.each([
    'I need a lesson plan on fractions for class 4',
    'Please send me a lesson plan for grade 5 science',
    'Hi, I am a teacher. How can you help me?',
    'Can you make a quiz about photosynthesis?',
    "I'd like help with my students' reading",
  ])('English: %s', (text) => {
    expect(hasEnglishEvidence(text).english).toBe(true);
  });

  test.each([
    ['lesson plan chahiye', 'Roman Urdu word'],
    ['aoa sir', 'greeting, too short'],
    ['Hello', 'one word'],
    ['hi there', 'two words'],
    ['I need lesson plan chahiye', 'mixed'],
    ['Sir ji mujhe lesson plan bhej dein', 'Roman Urdu'],
    ['class 4 ka lesson plan', 'Roman Urdu particle'],
    ['mujhe fractions par lesson plan chahiye', 'Roman Urdu'],
    ['مجھے کلاس 4 کے لیے لیسن پلان چاہیے', 'Urdu script'],
    ['I need a lesson plan کلاس', 'any Perso-Arabic is not English'],
    ['lesson plan do', 'shared words do not count toward three'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['4 5 6', 'numbers only'],
    ['I need xqzlorb vrumple frangent', 'unknown words are not evidence'],
  ])('not English: %s (%s)', (text) => {
    expect(hasEnglishEvidence(text).english).toBe(false);
  });

  test('null / non-string never throws and is not evidence', () => {
    expect(hasEnglishEvidence(null).english).toBe(false);
    expect(hasEnglishEvidence(undefined).english).toBe(false);
    expect(hasEnglishEvidence(42).english).toBe(false);
  });

  test('the three lists are disjoint (a word cannot be both evidence and a veto)', () => {
    for (const w of ROMAN_URDU) {
      expect(ENGLISH.has(w)).toBe(false);
      expect(SHARED.has(w)).toBe(false);
    }
    for (const w of SHARED) expect(ENGLISH.has(w)).toBe(false);
  });

  test('the brief\'s Roman-Urdu words are all vetoes', () => {
    for (const w of ['hai', 'ka', 'ki', 'ke', 'ko', 'se', 'chahiye', 'mujhe', 'mera', 'meri', 'kya', 'aoa',
      'salam', 'assalam', 'ji', 'bhai', 'karo', 'kar', 'dein', 'bhej', 'plz']) {
      expect(ROMAN_URDU.has(w)).toBe(true);
    }
  });
});

describe('isBrandNewRow / isSwitchOn', () => {
  test('a row that has never sent a message is new; one with first_message_at is not', () => {
    expect(isBrandNewRow(NEW_ROW)).toBe(true);
    expect(isBrandNewRow(OLD_ROW)).toBe(false);
    expect(isBrandNewRow(null)).toBe(false);
    expect(isBrandNewRow({ first_message_at: null })).toBe(false); // no id: no row
  });
  test('a locked row is never "new" for this rule — their choice wins', () => {
    expect(isBrandNewRow({ ...NEW_ROW, language_locked: true })).toBe(false);
  });
  test('the switch is exactly "true"', () => {
    expect(isSwitchOn(ON)).toBe(true);
    for (const v of [undefined, '', 'TRUE', '1', 'yes', 'true ', 'false']) {
      expect(isSwitchOn({ FIRST_REPLY_ENGLISH_EVIDENCE: v })).toBe(false);
    }
  });
});

describe('firstReplyLanguage — en only for new row + switch on + evidence', () => {
  const EN = 'I need a lesson plan on fractions for class 4';
  test('all three → en', () => {
    expect(firstReplyLanguage({ user: NEW_ROW, text: EN, env: ON })).toMatchObject({ language: 'en' });
  });
  test('switch off → null (today)', () => {
    expect(firstReplyLanguage({ user: NEW_ROW, text: EN, env: {} }).language).toBeNull();
  });
  test('existing row → null (today)', () => {
    expect(firstReplyLanguage({ user: OLD_ROW, text: EN, env: ON }).language).toBeNull();
  });
  test('no evidence → null (today)', () => {
    expect(firstReplyLanguage({ user: NEW_ROW, text: 'lesson plan chahiye', env: ON }).language).toBeNull();
  });
  test('it has no side effects: the row is untouched', () => {
    const row = { ...NEW_ROW };
    firstReplyLanguage({ user: row, text: EN, env: ON });
    expect(row).toEqual(NEW_ROW);
  });
});
