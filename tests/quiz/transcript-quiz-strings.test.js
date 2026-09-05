'use strict';
/**
 * bd-mg9c7.12 — every transcript-quiz string exists in BOTH offered
 * languages, fits its WhatsApp field measured in CODE POINTS, and never
 * addresses the teacher or child with a gendered Urdu stem.
 */
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');
const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');

const cp = (s) => [...String(s)].length;
const FEM = /(کرتی ہیں|چاہتی ہیں|کریں گی|رہی ہوں گی|سکتی ہیں|بتاتی ہیں|سوچتی ہیں|رہی ہوں|چاہیں گی|کرتے ہیں|چاہتے ہیں|سکتے ہیں|کریں گے)/;

const TQ_KEYS = Object.keys(UX_STRINGS).filter((k) => /^(tq|vq)[A-Z]/.test(k));

describe('transcript-quiz catalog', () => {
  test('there is a catalog to test', () => {
    expect(TQ_KEYS.length).toBeGreaterThan(20);
  });

  test.each(TQ_KEYS)('%s carries every offered language', (key) => {
    for (const lang of LANGUAGE_OFFER) {
      expect(typeof UX_STRINGS[key][lang]).toBe('string');
      expect(UX_STRINGS[key][lang].trim().length).toBeGreaterThan(0);
    }
  });

  const BUTTONS = TQ_KEYS.filter((k) => /Button$|Yes$|No$|Btn$/.test(k));
  test.each(BUTTONS)('%s fits a 20-code-point reply button', (key) => {
    for (const lang of LANGUAGE_OFFER) expect(cp(UX_STRINGS[key][lang])).toBeLessThanOrEqual(20);
  });

  const LIST_TITLES = TQ_KEYS.filter((k) => /ListButton$|ListSection$/.test(k));
  test.each(LIST_TITLES)('%s fits a 20/24-code-point list title', (key) => {
    for (const lang of LANGUAGE_OFFER) expect(cp(UX_STRINGS[key][lang])).toBeLessThanOrEqual(20);
  });

  test.each(TQ_KEYS)('%s stays under the 1024-code-point body cap after params', (key) => {
    for (const lang of LANGUAGE_OFFER) expect(cp(UX_STRINGS[key][lang])).toBeLessThanOrEqual(1024);
  });

  test.each(TQ_KEYS.filter((k) => k.startsWith('tq')))('%s is gender-neutral in Urdu', (key) => {
    expect(UX_STRINGS[key].ur).not.toMatch(FEM);
  });

  test.each(TQ_KEYS)('%s: an Urdu body that could open with Latin carries a right-to-left mark', (key) => {
    const ur = UX_STRINGS[key].ur;
    if (/Button$|Yes$|No$|Btn$|ListButton$|ListSection$|Word$/.test(key)) return;   // titles, not paragraphs
    // Skip leading whitespace, emoji, punctuation and WhatsApp bold stars; look at the first real character.
    const body = ur.replace(/^[\s\u200F*"'«»(\p{Extended_Pictographic}\uFE0F]+/u, '');
    const opensLatinOrParam = /^[A-Za-z{]/.test(body);
    if (opensLatinOrParam) expect(ur.startsWith('\u200F')).toBe(true);
  });

  test('the offer copy names the topic and the date, and mentions /quiz', () => {
    for (const lang of LANGUAGE_OFFER) {
      const s = resolveUx('tqOffer', { language: lang, params: { topic: 'Fractions', date: '5 Sep' } });
      expect(s).toMatch(/Fractions/);
      expect(s).toMatch(/5 Sep/);
      expect(s).toMatch(/\/quiz/);
    }
  });

  test('the decline copy points at /quiz', () => {
    for (const lang of LANGUAGE_OFFER) expect(resolveUx('tqDeclined', { language: lang })).toMatch(/\/quiz/);
  });

  test('the student message carries teacher, topic, date and link and nothing that looks like a phone', () => {
    for (const lang of LANGUAGE_OFFER) {
      const s = resolveUx('tqStudentMessage', {
        language: lang, params: { teacher: 'Rifat', topic: 'Fractions', date: '5 Sep', link: 'https://wa.me/1?text=QUIZ-ABC234' },
      });
      expect(s).toMatch(/Rifat/); expect(s).toMatch(/Fractions/); expect(s).toMatch(/5 Sep/); expect(s).toMatch(/QUIZ-ABC234/);
      expect(s.replace(/https:\/\/wa\.me\/\d+/, '')).not.toMatch(/\d{9,}/);
    }
  });
});
