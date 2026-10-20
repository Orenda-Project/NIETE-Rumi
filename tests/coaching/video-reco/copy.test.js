'use strict';
/**
 * bd-gzfdu9 (VIDREC): the words of the "watch this clip" message, the /cr card and the player (SPEC §4.2).
 * en + ur, gender-neutral, and every WhatsApp field inside Meta's cap counted in CODE POINTS (button 20, body 1024).
 */
const C = require('../../../bot/shared/services/coaching/video-reco/copy');
const { UX_STRINGS } = require('../../../bot/shared/config/ux-strings');

const cp = (s) => [...s].length;
const shown = (s) => String(s).replace(/[‎‏⁦-⁩]/g, '');

describe('minutes and digits', () => {
  test.each([[0, 1], [29, 1], [60, 1], [95, 2], [134, 2], [150, 3], [540, 9]])('%ps → %p min', (s, n) => {
    expect(C.minutesOf(s)).toBe(n);
  });
  test('Urdu-Indic digits', () => {
    expect(C.urduDigits(2)).toBe('۲');
    expect(C.urduDigits(10)).toBe('۱۰');
  });
  test('m:ss clock', () => {
    expect(C.clock(95)).toBe('1:35');
    expect(C.clock(188.5)).toBe('3:08');
    expect(C.clock(0)).toBe('0:00');
  });
});

describe('the button (SPEC §4.2 verbatim)', () => {
  test('en and ur, the two the SPEC names', () => {
    expect(shown(C.buttonText({ minutes: 2, language: 'en' }))).toBe('▶ Watch 2 min');
    expect(shown(C.buttonText({ minutes: 1, language: 'en' }))).toBe('▶ Watch 1 min');
    expect(shown(C.buttonText({ minutes: 2, language: 'ur' }))).toBe('▶ ۲ منٹ دیکھیں');
    expect(shown(C.buttonText({ minutes: 1, language: 'ur' }))).toBe('▶ ۱ منٹ دیکھیں');
  });
  test('ur: a U+200F right after ▶ so the glyph sits at the right end (SPEC v1.2 §4.2)', () => {
    expect(C.buttonText({ minutes: 2, language: 'ur' }).startsWith('▶\u200f ')).toBe(true);
  });
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('%p min fits 20 code points in en and ur', (n) => {
    expect(cp(C.buttonText({ minutes: n, language: 'en' }))).toBeLessThanOrEqual(20);
    expect(cp(C.buttonText({ minutes: n, language: 'ur' }))).toBeLessThanOrEqual(20);
  });
  test('an off-offer language falls to English', () => {
    expect(shown(C.buttonText({ minutes: 3, language: 'sw' }))).toBe('▶ Watch 3 min');
  });
});

describe('the body', () => {
  const reasonEn = 'At 12:40 you asked "What is a noun?" and moved on. This clip shows a teacher turning that into a why-question and waiting for the answer.';
  const reasonUr = 'آپ نے 12:40 پر پوچھا "اسم کیا ہے؟" اور آگے بڑھ گئے۔ اس کلپ میں ایک استاد open-ended questions پوچھتے ہیں اور wait time دیتے ہیں۔';

  test('en: lead, reason, meta — three lines, the SPEC words', () => {
    const b = C.messageBody({ minutes: 2, reason: reasonEn, clipLanguage: 'ur', language: 'en' });
    expect(shown(b).split('\n')).toEqual([
      '🎬 A 2-minute clip for your one thing to try.',
      reasonEn,
      '⏱ 2 min · Urdu',
    ]);
  });
  test('ur: Urdu digits, Urdu language name, Latin runs inside isolates, every line opens right to left', () => {
    const b = C.messageBody({ minutes: 2, reason: reasonUr, clipLanguage: 'en', language: 'ur' });
    const lines = b.split('\n');
    expect(shown(lines[0])).toBe('🎬 آپ کی آزمانے والی ایک بات کے لیے ۲ منٹ کا کلپ۔');
    expect(shown(lines[2])).toBe('⏱ ۲ منٹ · انگریزی');
    expect(lines[1]).toContain('⁦open-ended questions⁩');
    expect(lines[1]).toContain('⁦wait time⁩');
    expect(shown(lines[1])).toBe(reasonUr);
  });
  test('a mixed-language clip says both', () => {
    expect(shown(C.messageBody({ minutes: 1, reason: reasonEn, clipLanguage: 'mixed', language: 'en' }))).toContain('⏱ 1 min · Urdu + English');
  });
  test('never over 1024 code points; a long reason is cut, the lead and meta survive', () => {
    const b = C.messageBody({ minutes: 4, reason: 'word '.repeat(400), clipLanguage: 'ur', language: 'en' });
    expect(cp(b)).toBeLessThanOrEqual(1024);
    const lines = b.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(lines[2]).toBe('⏱ 4 min · Urdu');
  });
  test('no reason → two lines, never "undefined"', () => {
    const b = C.messageBody({ minutes: 2, reason: '', clipLanguage: 'ur', language: 'en' });
    expect(b.split('\n')).toHaveLength(2);
    expect(b).not.toMatch(/undefined|null/);
  });
});

describe('the catalog keys', () => {
  const KEYS = ['videoRecoButton', 'videoRecoBodyLead', 'videoRecoBodyMeta', 'videoRecoCardTitle', 'videoRecoCardButton',
    'videoRecoPlayerClip', 'videoRecoPlayerWhy', 'videoRecoPlayerFromStart', 'videoRecoPlayerLookFor', 'videoRecoPlayerBack',
    'videoRecoLangUr', 'videoRecoLangEn', 'videoRecoLangMixed',
    'videoRecoStripTitle', 'videoRecoStripHint'];
  test('SPEC v1.2 wording: the coach line is now about the next lesson; the Urdu back arrow points right', () => {
    expect(UX_STRINGS.videoRecoPlayerLookFor.en).toBe('Try it in your next lesson and record it — your next report will show the change.');
    expect(UX_STRINGS.videoRecoPlayerLookFor.ur).toBe('اگلے سبق میں آزمائیں اور ریکارڈ کریں — اگلی رپورٹ میں فرق نظر آئے گا۔');
    expect(UX_STRINGS.videoRecoPlayerBack.ur).toBe('میری رپورٹ پر واپس →');
  });
  test.each(KEYS)('%s has en and ur, ur in Urdu script', (k) => {
    expect(UX_STRINGS[k]).toBeDefined();
    expect(typeof UX_STRINGS[k].en).toBe('string');
    expect(/[؀-ۿ]/.test(UX_STRINGS[k].ur)).toBe(true);
  });
  test('gender-neutral: no gendered Urdu second-person forms, no she/he in English', () => {
    KEYS.forEach((k) => {
      expect(UX_STRINGS[k].en).not.toMatch(/\b(she|he|her|his|him)\b/i);
      expect(UX_STRINGS[k].ur).not.toMatch(/(گئی|گیا|سکتی|سکتا|رہی|رہا|کرتی|کرتا)\b/);
    });
  });
  test('the /cr button fits 20 code points in both languages, 1–9 minutes', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(cp(C.cardButton({ minutes: n, language: 'en' }))).toBeLessThanOrEqual(20);
      expect(cp(C.cardButton({ minutes: n, language: 'ur' }))).toBeLessThanOrEqual(20);
    }
  });
  test('no level label exists any more (lead ruling 18:38Z: it read as "you are a beginner")', () => {
    expect(C.levelLabel).toBeUndefined();
    expect(UX_STRINGS.videoRecoLevel).toBeUndefined();
    expect(UX_STRINGS.videoRecoLevelAspiring).toBeUndefined();
  });
});
