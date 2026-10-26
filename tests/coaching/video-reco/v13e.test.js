'use strict';
/**
 * bd-gzfdu9 — SPEC §3.5 [v1.3c-5] (lead-final 21:18Z, on ped-review 21:17Z / red-team 21:18Z): the card-sentence
 * fallback never opens with a placeholder. Prod cards address the teacher by an Urdu-script first name; when
 * users.name is Latin the redactor misses the match and masks the address as the CHILD placeholder.
 */
let S;

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  S = require('../../../bot/shared/services/coaching/video-reco/select');
});

const FALLBACK_UR = (s, n) => `آپ کی رپورٹ کہتی ہے کہ یہ آزمائیں: "\u2068${s}\u2069"۔ یہ کلپ اس کا ایک طریقہ دکھاتا ہے۔`;
// bd-8hhqhf: the card sentence sits in an FSI…PDI isolate. R7d: no seconds (the header says minutes); n is unused.
const PLAIN_EN = (n) => `Your report gives you one thing to try next class. This clip shows one way to do it.`; // R7c §6
const FALLBACK_EN = (s, n) => `Your report asks you to try: "\u2068${s}\u2069". This clip shows one way to do it.`;
const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
const base = { none: 'validation:roman', segId: '10-s1', shortlist: list, startS: 30, endS: 120, language: 'ur', module: { subjects: ['general'] }, subject: null };

describe('[v1.3c-5] the fallback sentence never opens with a placeholder', () => {
  test('"اصغر، اگلی کلاس میں …" with users.name "Asghar" → the sentence starts at "اگلی"', () => {
    const out = S.cardFallback({ ...base, sentence: 'اصغر، اگلی کلاس میں دو کیوں والے سوال پوچھیں', teacherName: 'Asghar' });
    expect(out).toEqual({
      reason_en: PLAIN_EN(90), // R7c §6: an Urdu sentence is not quoted in the English line of an Urdu reader
      reason_ur: FALLBACK_UR('اگلی کلاس میں دو کیوں والے سوال پوچھیں', 90),
    });
  });
  test('a Latin vocative the redactor would not map ("Sir, …") is stripped too', () => {
    const out = S.cardFallback({ ...base, language: 'en', sentence: 'Sir, ask two why questions', teacherName: 'Asghar' });
    expect(out.reason_en).toBe(FALLBACK_EN('Ask two why questions', 90)); // R7b (P109): capital after the strip
  });
  test('a card already masked "[a student]، …" yields a sentence that starts at the verb', () => {
    const out = S.cardFallback({ ...base, sentence: '[a student]، اگلی کلاس میں سوال پوچھیں', teacherName: null });
    expect(out.reason_ur).toBe(FALLBACK_UR('اگلی کلاس میں سوال پوچھیں', 90));
  });
  test('a reason that would still start with "[" → the none stands', () => {
    expect(S.cardFallback({ ...base, sentence: '[a student] reads the question aloud first', teacherName: null })).toBeNull();
  });
  test('a child placeholder inside the sentence: no fallback (R7c ⛔9; was shown as [a student])', () => {
    expect(S.cardFallback({ ...base, language: 'en', sentence: 'Ask [a student] to read the question aloud', teacherName: null })).toBeNull();
  });
  test('a sentence with no vocative is unchanged', () => {
    const out = S.cardFallback({ ...base, language: 'en', sentence: 'Ask two why questions', teacherName: 'Asghar' });
    expect(out.reason_en).toBe(FALLBACK_EN('Ask two why questions', 90));
  });
});
