'use strict';
/**
 * The live report's class tab (/r/<token>?tab=class): each "Your quizzes" row is a tap target of at least 48 px and its
 * title is never cut. Before, an English row was 41–42 px tall and a long topic ended in "…" against the date · played
 * column, so two quizzes on the same theme ("Main purpose …", "Matching wor…") read alike. The title now takes the
 * row's width and wraps when it must, and the date · played · % line drops beneath it on a phone. Stylesheet only; no
 * copy change. Measured at 360x740 (the lane's measure-rows.js).
 *
 * A pure renderer: data in, HTML out.
 */
const { renderPage } = require('../../shared/templates/teacher-report.page');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const NOW = Date.parse('2026-11-22T09:30:00Z');
const LONG = 'Main purpose of the passage and the details that support it';
const classData = (lang = 'en') => ({
  cells: [{ grade: '5', subject: 'english', quizzes: 2, played: 7, avg: 61 }],
  weeks: [{ weekStart: '2026-11-16', quizzes: 2, played: 7, avg: 61 }],
  quizzes: [
    { id: 'q-1', topic: LONG, date: '2026-11-20T09:00:00Z', grade: '5', subject: 'english', source: 'lp_v8', played: 4, of: 30, avg: 63 },
    { id: 'q-2', topic: lang === 'ur' ? 'عبارت کا مرکزی خیال اور اس کی تائید کرنے والی تفصیلات' : 'Matching words with their meanings in a short story', date: '2026-11-19T09:00:00Z', grade: '5', subject: 'english', source: 'lp_v8', played: 3, of: 30, avg: 58 },
  ],
});
const page = (lang) => renderPage({ class: classData(lang) }, { lang, tab: 'class', tokens: { self: TOKEN, quiz: { 'q-1': 'T1', 'q-2': 'T2' } }, now: NOW });
const css = (html) => (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const rule = (html, sel) => (css(html).split('\n').find((l) => l.startsWith(`${sel}{`)) || '');

describe('"Your quizzes" rows on the class tab', () => {
  test.each(['en', 'ur'])('%s: each row link is at least 48 px tall', (lang) => {
    expect(rule(page(lang), '.ql a')).toMatch(/min-height:48px/);
  });

  test.each(['en', 'ur'])('%s: the title wraps, never cut with an ellipsis', (lang) => {
    const tp = rule(page(lang), '.ql .tp');
    expect(tp).not.toMatch(/text-overflow:ellipsis/);
    expect(tp).not.toMatch(/white-space:nowrap/);
    expect(tp).toMatch(/overflow-wrap:anywhere/);
  });

  test('a long title takes the row\'s width and the date · played · % line wraps beneath it, never squeezing the title', () => {
    expect(rule(page('en'), '.ql a')).toMatch(/flex-wrap:wrap/);
    expect(rule(page('en'), '.ql .tp')).toMatch(/flex:1 1 12em/);
    expect(rule(page('en'), '.ql .m')).toMatch(/white-space:nowrap/);
  });

  test('the rows are on the page with the whole title text', () => {
    const html = page('en');
    expect(html).toContain('<ul class="ql">');
    expect(html).toContain(LONG);
  });
});
