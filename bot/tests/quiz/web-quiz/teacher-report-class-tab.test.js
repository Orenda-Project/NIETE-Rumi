'use strict';
/**
 * The teacher web report's "All my classes" tab (teacher-report-class.page.js):
 * classReport() data in, an HTML fragment out — grade × subject cards, an
 * 8-week CSS bar trend, and quiz-by-quiz rows that link to each quiz's own
 * report with the token the route minted. Pure; nothing to mock.
 */
const { renderClassTab, classTabCss, CHROME } = require('../../../shared/templates/teacher-report-class.page');

const Q1 = '22222222-2222-4222-8222-222222222222';
const Q2 = '22222222-2222-4222-8222-222222222223';
const Q3 = '22222222-2222-4222-8222-222222222224';
const weekStart = (k) => new Date(Date.UTC(2026, 7, 17) + k * 7 * 86400000).toISOString().slice(0, 10);

const DATA = {
  cells: [
    { grade: '5', subject: 'maths', quizzes: 1, played: 1, avg: 50 },
    { grade: '3', subject: 'science', quizzes: 2, played: 14, avg: 63 },
    { grade: '3', subject: 'english', quizzes: 1, played: 0, avg: null },
  ],
  weeks: Array.from({ length: 8 }, (_, k) => ({ weekStart: weekStart(k), quizzes: k % 2, played: k === 7 ? 12 : k, avg: k ? 40 + k : null })),
  quizzes: [
    { id: Q1, date: '2026-10-05T09:00:00Z', topic: 'Plants <b>& roots</b>', grade: '3', subject: 'science', played: 12, of: 31, avg: 68 },
    { id: Q2, date: '2026-09-28T09:00:00Z', topic: 'کسر', grade: '5', subject: 'maths', played: 1, of: null, avg: 50 },
    { id: Q3, date: '2026-09-21T09:00:00Z', topic: 'Nouns', grade: '3', subject: 'english', played: 0, of: 31, avg: null },
  ],
};
const TOKENS = { [Q1]: 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA', [Q2]: 'eyJrIjoidHIiLCJxIjoyfQ.BBBBBBBBBBBBBBBBBBBBBB' };
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

describe('renderClassTab — English', () => {
  const html = renderClassTab(DATA, { language: 'en', tokens: TOKENS });

  test('a fragment, not a page', () => {
    expect(html.startsWith('<section class="trc">')).toBe(true);
    expect(html).not.toMatch(/<html|<style|@font-face/);
  });

  test('one card per grade × subject, lowest grade first, with average and counts', () => {
    const t = text(html);
    expect(t).toContain('Class 3 · General Science');
    expect(t).toContain('63% average');
    expect(t).toContain('2 quizzes · 14 played');
    expect(t.indexOf('Class 3 · General Science')).toBeGreaterThan(-1);
    expect(t.indexOf('Class 3')).toBeLessThan(t.indexOf('Class 5'));
    // a class nobody has played yet says so, never "0%" or "null%"
    expect(t).toContain('No one has played yet');
    expect(t).not.toMatch(/null%|undefined/);
  });

  test('the trend is eight CSS bars scaled to the busiest week, the average on top', () => {
    const bars = html.match(/class="trc-wk-bar[^"]*" style="height:(\d+)%"/g);
    expect(bars).toHaveLength(8);
    expect(html).toContain('style="height:100%"');   // week 8, 12 played
    expect(html).toContain('style="height:0%"');     // week 1, nobody
    expect(text(html)).toContain('47%');
  });

  test('each quiz links to its own report with the minted token; no token, no link', () => {
    expect(html).toContain(`href="/r/${TOKENS[Q1]}"`);
    expect(html).toContain(`href="/r/${TOKENS[Q2]}"`);
    expect((html.match(/<a class="trc-q"/g) || []).length).toBe(2);
    const t = text(html);
    expect(t).toContain('12 of 31 played · 68%');
    expect(t).toContain('1 played · 50%');        // no roster: no "of"
  });

  test('a topic from the database is escaped and directed by its own script', () => {
    expect(html).toContain('Plants &lt;b&gt;&amp; roots&lt;/b&gt;');
    expect(html).not.toContain('<b>& roots');
    expect(html).toMatch(/<span class="trc-q-topic" dir="rtl">کسر<\/span>/);
  });

  test('a base url is prefixed for an absolute link (the PDF)', () => {
    const abs = renderClassTab(DATA, { language: 'en', tokens: TOKENS, base: 'https://portal.example.test' });
    expect(abs).toContain(`href="https://portal.example.test/r/${TOKENS[Q1]}"`);
  });

  test('nothing sent: an empty state that says what to do, no cards', () => {
    const empty = renderClassTab({ cells: [], weeks: [], quizzes: [] }, { language: 'en' });
    expect(text(empty)).toContain('Send /quiz on WhatsApp');
    expect(empty).not.toContain('trc-card');
  });
});

describe('renderClassTab — Urdu', () => {
  const html = renderClassTab(DATA, { language: 'ur', tokens: TOKENS });

  test('Urdu chrome throughout, no English chrome left behind', () => {
    const t = text(html);
    expect(t).toContain(CHROME.ur.heading);
    expect(t).toContain('ہر quiz کی رپورٹ');
    expect(t).toContain('جماعت 3');
    Object.values(CHROME.en).filter((v) => typeof v === 'string' && v.length > 5)
      .forEach((en) => expect(t).not.toContain(en));
  });

  test('every number is an isolated LTR atom', () => {
    expect(html).toContain('<span class="trc-n">31</span> میں سے <span class="trc-n">12</span> نے کھیلا');
    expect(classTabCss(true)).toMatch(/\.trc-n\{[^}]*unicode-bidi:isolate;direction:ltr/);
  });

  test('a Latin topic inside the Urdu page is its own LTR block', () => {
    expect(html).toMatch(/<span class="trc-q-topic" dir="ltr">Nouns<\/span>/);
  });

  test('every Urdu string is gender-neutral (no gendered verb endings on the reader)', () => {
    const ur = Object.values(CHROME.ur).map((v) => (typeof v === 'function' ? v(2, 3) : v)).join(' ');
    expect(ur).not.toMatch(/(?:گا|گی|تا ہے|تی ہے|رہا|رہی)(?=\s|$|۔)/);
  });
});
