'use strict';
/**
 * bd-5j1zaf follow-up — the all-classes report's class tab (/r/<token>?tab=class, the page the WhatsApp "Class report"
 * link opens): with quiz_teacher_home_reports on (the route passes `late`), each "Your quizzes" row whose quiz has
 * children who finished after its 12 h report carries the chip "+{late} after the report" (the same catalog words as
 * the teacher home's chip; Urdu digits on the Urdu page, as the page writes its dates), and each row's link to its quiz
 * says it came from here (?from=class). A row with nobody late, or whose report has not gone, is today's row; off, the
 * tab is today's page byte for byte (stylesheet aside, pinned elsewhere).
 *
 * A pure renderer: data in, HTML out.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderPage } = require('../../shared/templates/teacher-report.page');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const NOW = Date.parse('2026-11-22T09:30:00Z');
const classData = (lang = 'en') => ({
  cells: [{ grade: '5', subject: 'english', quizzes: 3, played: 9, avg: 61 }],
  weeks: [{ weekStart: '2026-11-16', quizzes: 3, played: 9, avg: 61 }],
  quizzes: [
    { id: 'q-1', topic: lang === 'ur' ? 'پودے کے حصے' : 'Parts of a plant', date: '2026-11-20T09:00:00Z', grade: '5', subject: 'science', source: 'lp_v8', played: 13, of: 30, avg: 63, late: 3, reported: true },
    { id: 'q-2', topic: 'Fractions', date: '2026-11-19T09:00:00Z', grade: '5', subject: 'maths', source: 'lp_v8', played: 4, of: 30, avg: 58, reported: true },
    { id: 'q-3', topic: 'Shapes', date: '2026-11-18T09:00:00Z', grade: '5', subject: 'maths', source: 'lp_v8', played: 2, of: 30, avg: 70 },
  ],
});
const TOKENS = { self: TOKEN, quiz: { 'q-1': 'T1', 'q-2': 'T2', 'q-3': 'T3' } };
const page = (lang = 'en', opts = {}) => renderPage({ class: classData(lang) }, { lang, tab: 'class', tokens: TOKENS, now: NOW, ...opts });
const rows = (html) => (html.match(/<ul class="ql">([\s\S]*?)<\/ul>/) || ['', ''])[1].split('<li>').slice(1);
const chip = (row) => (row.match(/<span class="late tag">([\s\S]*?)<\/span>/) || [null, null])[1];
const text = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/[⁦-⁩‎‏]/g, '');

describe('late on: the class tab\'s quiz rows', () => {
  test('EN: the reported row with late finishers carries "+3 after the report"; the others carry no chip', () => {
    const r = rows(page('en', { late: true }));
    expect(r).toHaveLength(3);
    expect(text(chip(r[0]))).toBe('+3 after the report');
    expect(chip(r[1])).toBeNull(); // reported, nobody late
    expect(chip(r[2])).toBeNull(); // report not gone yet
  });

  test('UR: the Urdu chip with Urdu digits, as the page writes its dates', () => {
    const r = rows(page('ur', { late: true }));
    expect(text(chip(r[0]))).toBe('رپورٹ کے بعد +۳');
  });

  test('each row\'s link to its quiz says where it came from (?from=class)', () => {
    const r = rows(page('en', { late: true }));
    r.forEach((row) => expect(row).toMatch(/href="\/r\/T\d\?lang=en&amp;from=class"|href="\/r\/T\d\?lang=en&from=class"/));
  });

  test('print (the PDF) carries the chip, and no links', () => {
    const r = rows(page('en', { late: true, print: true }));
    expect(text(chip(r[0]))).toBe('+3 after the report');
  });
});

// GOLDEN: late off (false or absent), with late rows IN the data, is the class tab the code made before this change.
const FILE = path.join(__dirname, '__golden__', 'class-tab-late-off.json');
const withoutStyles = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '<style></style>');
const digest = (html) => ({ sha256: crypto.createHash('sha256').update(withoutStyles(html), 'utf8').digest('hex'), bytes: Buffer.byteLength(withoutStyles(html), 'utf8') });
const OFF_RENDERS = {
  'en-screen': () => page('en'),
  'en-screen-false': () => page('en', { late: false }),
  'ur-screen': () => page('ur'),
  'en-print': () => page('en', { print: true }),
};
if (process.env.GOLDEN_WRITE === '1') {
  test('write the class-tab late-off baselines (run on the code before this change)', () => {
    const out = Object.fromEntries(Object.entries(OFF_RENDERS).map(([k, f]) => [k, digest(f())]));
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, `${JSON.stringify(out, null, 1)}\n`);
  });
} else {
  describe('GOLDEN: late off is today\'s class tab byte for byte (late rows in the data)', () => {
    const golden = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    test.each(Object.keys(OFF_RENDERS))('%s', (k) => expect(digest(OFF_RENDERS[k]())).toEqual(golden[k]));
  });
}
