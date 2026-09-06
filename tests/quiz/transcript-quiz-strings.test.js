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

  // The scorecard's words are painted into a 540x400 image, so their cap is
  // the badge they sit in, not WhatsApp's message body.
  const CARD = ['vqScorecardEyebrow', 'vqBadgeMastered', 'vqBadgeDeveloping', 'vqBadgeNeedsPractice'];
  test.each(CARD)('%s fits the scorecard badge it is painted into', (key) => {
    expect(UX_STRINGS[key]).toBeDefined();
    for (const lang of LANGUAGE_OFFER) expect(cp(UX_STRINGS[key][lang])).toBeLessThanOrEqual(18);
  });
  test.each(CARD)('%s is gender-neutral in Urdu', (key) => {
    expect(UX_STRINGS[key].ur).not.toMatch(FEM);
  });

  test('the offer copy names the lesson and the date, and mentions /quiz', () => {
    for (const lang of LANGUAGE_OFFER) {
      const s = resolveUx('tqOffer', { language: lang, params: { lesson: 'Urdu lesson on Fractions', date: '5 Sep' } });
      expect(s).toMatch(/Fractions/);
      expect(s).toMatch(/5 Sep/);
      expect(s).toMatch(/\/quiz/);
    }
  });

  test('the hand-off caption names the lesson and the question count', () => {
    for (const lang of LANGUAGE_OFFER) {
      const s = resolveUx('tqHandoffIntro', { language: lang, params: { lesson: 'Urdu lesson on Fractions', n: 8 } });
      expect(s).toMatch(/Fractions/);
      expect(s).toMatch(/8/);
    }
  });

  test('the lesson-label fragments render in both languages and never leak a placeholder', () => {
    for (const lang of LANGUAGE_OFFER) {
      expect(resolveUx('tqLessonOnSubject', { language: lang, params: { subject: 'Urdu', topic: 'X' } })).not.toMatch(/[{}]/);
      expect(resolveUx('tqLessonNoTopic', { language: lang, params: { subject: 'Urdu' } })).not.toMatch(/[{}]/);
      expect(resolveUx('tqLessonOnTopic', { language: lang, params: { topic: 'X' } })).not.toMatch(/[{}]/);
      expect(resolveUx('tqLessonPlain', { language: lang })).toMatch(/\S/);
    }
  });

  test('the list body no longer promises a fixed count now that /quiz pages', () => {
    // bd-mg9c7.63: the list pages (see PLAN_R5) instead of showing a flat cap
    // of 10, so the body copy dropped the "up to 10" promise — the HEADER
    // (tqListHeader) now carries the actual range instead.
    for (const lang of LANGUAGE_OFFER) {
      const body = resolveUx('tqListBody', { language: lang });
      expect(body).not.toMatch(/\b10\b/);
      expect(body).toMatch(/\S/);
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

describe('the /quiz command token survives an Urdu paragraph', () => {
  // A leading slash is a bidi-neutral at the boundary between Urdu and the
  // Latin word, so in an RTL paragraph it renders to the RIGHT of "quiz" —
  // the teacher is shown "quiz/" and told to send that (seen in real browser
  // renders of tqOffer and tqListBody). The token has to be isolated.
  const catalog = require('../../bot/shared/config/ux-strings');
  const strings = catalog.UX_STRINGS || catalog.STRINGS || catalog.default || catalog;
  const urduWithCommand = Object.entries(strings)
    .filter(([, v]) => v && typeof v.ur === 'string' && v.ur.includes('/quiz'))
    .map(([k]) => k);
  test('there are Urdu strings that name the command', () => {
    expect(urduWithCommand.length).toBeGreaterThan(5);
  });
  test('every one of them wraps /quiz in a first-strong isolate (U+2066 … U+2069)', () => {
    const bare = urduWithCommand.filter((k) => /(?<!⁦)\/quiz/.test(strings[k].ur) || !/⁦\/quiz⁩/.test(strings[k].ur));
    expect(bare).toEqual([]);
  });
});
