'use strict';
/**
 * The class tab's line under "Your class's Jugnu link" says what the link does with the evening round on or off: the
 * teacher forwards it once a term and pins it; each child taps their name and plays. It no longer promises "this
 * week's story" (the link opens the child's hub; in the evening, tonight's quiz).
 * Renders the card itself in English and Urdu; the deck holds the same bytes (copy-deck-lift checks the lift).
 */
const { renderClassLinkCard } = require('../../shared/templates/teacher-class-link-card');
const deck = require('../../shared/config/copy.v2.json');

const EN = 'Forward it once a term and pin it. Each child taps their name and plays.';
const UR = 'ہر ٹرم میں ایک بار فارورڈ کریں اور پِن کر دیں۔ بچے اپنا نام دبا کر کھیلتے ہیں۔';
const DATA = { cards: [{ classId: 'c1a55000-0000-4000-8000-0000000000e1', url: 'https://quiz.example.org/j/K7Q2MXTRAB' }] };
const sub = (html) => (/<p class="small muted">([^<]*)<\/p>/.exec(html) || [])[1];

test.each([['en', EN], ['ur', UR]])('the card in %s carries the new line under the title', (lang, want) => {
  const html = renderClassLinkCard(DATA, { lang, base: '/r/tok.sig' });
  expect(sub(html)).toBe(want);
  expect(html).not.toMatch(/this week|اس ہفتے/);
});

test('the deck holds the same words, its code-point counts measured', () => {
  const k = deck['jg.t.link_sub'];
  expect([k.en, k.ur]).toEqual([EN, UR]);
  expect(k.cp).toEqual({ en: [...EN].length, ur: [...UR].length });
  expect(Math.max(k.cp.en, k.cp.ur)).toBeLessThanOrEqual(k.cap_cp);
});
