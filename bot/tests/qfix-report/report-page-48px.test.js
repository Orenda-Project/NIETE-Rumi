'use strict';
/**
 * The live report page (/r/<token>, opened in WhatsApp's in-app browser): every button, the "Copy message" summary and
 * the «اردو»/English toggle give a tap target of at least 48 px (PLAN A86/A92). One rule each in the page's shared
 * stylesheet, never a copy per card (A16). Not behind a switch: a pure layout fix. Measured in headless Chromium at
 * 360×740 with the page's own fonts (the lane's measure-48px.js): English buttons 44.8–46.8 → 48–50 px, Urdu unchanged
 * at 49.6–51.6, the toggle's tap box 23.7/27.8 → 48 px with its visible pill and the header's height unchanged.
 *
 * A pure renderer: data in, HTML out. Children are invented "Testwala" fixtures.
 */
const { renderPage } = require('../../shared/templates/teacher-report.page');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const NOW = Date.parse('2026-11-22T09:30:00Z');
const LINK = 'https://portal.example.test/q/AB12CD';
const quizData = (lang = 'en') => ({
  quiz: { id: 'q-1', topic: lang === 'ur' ? 'پودے کے حصے' : 'Parts of a plant', subject: 'science', grade: '5', source: 'lp_v8', language: lang, date: '2026-11-20T09:00:00Z', code: 'AB12CD', link: LINK },
  roster: { state: 'known', className: '5-A', of: 5, lists: [{ id: 'l-5a', label: '5-A' }] },
  summary: { played: 2, of: 5, avg: 63, total: 4, hardestN: 2 },
  played: [
    { first: 'Ayesha Testwala', roll: 2, correct: 3, total: 4, pct: 75, onList: true },
    { first: 'Dua Testwala', roll: 4, correct: 2, total: 4, pct: 50, onList: true },
  ],
  notPlayed: [{ first: 'Hina Testwala', roll: 1 }],
  questions: [{ n: 1, text: 'Which part takes in water?', answered: 2, correctPct: 50, wrongTop: null }],
  guidance: null,
  reminder: { language: lang, text: `Our quiz is still open: ${LINK}` },
});
const page = (lang) => renderPage({ quiz: quizData(lang) }, { lang, tab: 'quiz', tokens: { self: TOKEN }, now: NOW });
const css = (html) => (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const rule = (html, sel) => (css(html).split('\n').find((l) => l.startsWith(`${sel}{`)) || '');

describe('48 px (A86): every report button and the language toggle', () => {
  test.each(['en', 'ur'])('%s: .btn, the language toggle and the Copy-message summary have min-height:48px', (lang) => {
    const html = page(lang);
    expect(rule(html, '.btn')).toMatch(/min-height:48px/);
    expect(rule(html, '.brand a')).toMatch(/min-height:48px/);
    expect(rule(html, 'details summary')).toMatch(/min-height:48px/);
  });

  test('the toggle keeps today\'s pill (drawn behind the 48 px box), so the header looks as before', () => {
    const html = page('en');
    expect(rule(html, '.brand a::before')).toMatch(/border-radius:999px/);
    expect(rule(html, '.brand a')).not.toMatch(/border:1px/);
  });

  test('the measured elements are on the page: the toggle and at least three buttons', () => {
    const html = page('en');
    expect(html).toMatch(/<div class="brand">[\s\S]*?<a class="act" href="[^"]*lang=ur" lang="ur">اردو<\/a>/);
    expect(html.match(/class="btn /g).length).toBeGreaterThanOrEqual(3);
  });

  test('the PDF (print) carries the same stylesheet rules', () => {
    const html = renderPage({ quiz: quizData('en') }, { lang: 'en', tab: 'quiz', tokens: { self: TOKEN }, now: NOW, print: true });
    expect(rule(html, '.btn')).toMatch(/min-height:48px/);
  });
});
