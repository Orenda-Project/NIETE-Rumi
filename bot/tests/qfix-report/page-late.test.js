'use strict';
/**
 * bd-5j1zaf — the live report's quiz tab (/r/<token>) marks the children who finished after the 12 h report went.
 *
 *   - render option `late` (the route passes it only while app_settings quiz_teacher_home_reports is on): with
 *     summary.late ≥ 1, one line under the header's sub line, "{n} played · {late} after the report was sent", and on
 *     each late child's Scores row (p.late === true) a small "after the report" tag. One list, today's order.
 *   - the Urdu page keeps the report's Western digits; the PDF (print) carries the same line and tags.
 *   - option off or absent: the page is the one the code made BEFORE this change, byte for byte (the baselines in
 *     __golden__/page-late-off.json were written by THIS test on origin/sandbox c1cd7ebf49 with GOLDEN_WRITE=1),
 *     except the three button rules of the 48 px change (its own test: report-page-48px.test.js), which is not
 *     behind the switch.
 *   - a storybook send's report never shows any of it.
 *
 * A pure renderer: data in, HTML out. Children are invented "Testwala" fixtures.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderPage } = require('../../shared/templates/teacher-report.page');
const { resolveUx } = require('../../shared/config/ux-strings');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const NOW = Date.parse('2026-11-22T09:30:00Z');
const LINK = 'https://portal.example.test/q/AB12CD';

function quizData(over = {}) {
  return {
    quiz: { id: 'q-1', topic: 'Parts of a plant', subject: 'science', grade: '5', source: 'lp_v8', language: 'en', date: '2026-11-20T09:00:00Z', code: 'AB12CD', link: LINK },
    roster: { state: 'known', className: '5-A', of: 5, lists: [{ id: 'l-5a', label: '5-A' }] },
    summary: { played: 4, of: 5, avg: 63, total: 4, hardestN: 2, late: 2, reported: true },
    played: [
      { first: 'Ayesha Testwala', roll: 2, correct: 3, total: 4, pct: 75, onList: true },
      { first: 'Chand Testwala', roll: 3, correct: 2, total: 4, pct: 50, onList: true, late: true },
      { first: 'Bilal Testwala', roll: 7, correct: 1, total: 4, pct: 25, onList: false, late: true },
      { first: 'Dua Testwala', roll: 4, correct: 4, total: 4, pct: 100, onList: true },
    ],
    notPlayed: [{ first: 'Hina Testwala', roll: 1 }],
    questions: [
      { n: 1, text: 'Which part takes in water?', answered: 4, correctPct: 75, wrongTop: null },
      { n: 2, text: 'What do leaves make?', answered: 4, correctPct: 25, wrongTop: { option: 'B', text: 'Water', pct: 75 } },
    ],
    guidance: { muddled: 'Roots and stems were mixed up.', board: 'Draw a plant and label it.', check: 'Ask: which part drinks?' },
    reminder: { language: 'en', text: `Our quiz on Parts of a plant is still open: ${LINK}` },
    ...over,
  };
}
const urData = (over = {}) => quizData({
  quiz: { ...quizData().quiz, topic: 'پودے کے حصے', language: 'ur' },
  reminder: { language: 'ur', text: `ہمارا کوئز ابھی کھلا ہے: ${LINK}` },
  ...over,
});
function storyData(over = {}) {
  return {
    quiz: { id: 'q-s', topic: 'The Kite', grade: '2', source: 'story', language: 'en', date: '2026-11-20T09:00:00Z' },
    roster: { state: 'known', className: '2-A', lists: [{ id: 'l-2a', label: '2-A' }] },
    summary: { played: 2, of: 3, avg: null, hardestN: null, late: 1, reported: true },
    played: [{ first: 'Zara Testwala', roll: 1, correct: 0, total: 0, pct: 0, onList: true }, { first: 'Sana Testwala', roll: 3, correct: 0, total: 0, pct: 0, onList: true, late: true }],
    notPlayed: [{ first: 'Hina Testwala', roll: 2 }],
    reminder: { language: 'en', text: `A story for you: ${LINK}` },
    story: {
      children: [{ first: 'Zara Testwala', listened: 2, read: 1, questions: { correct: 3, total: 4 }, done: true }],
      counts: { opened: 2, listened: 1, read: 1, questions: 1 }, kinds: [], words: [],
    },
    ...over,
  };
}

const page = (data, opts = {}) => renderPage({ quiz: data }, { lang: 'en', tab: 'quiz', tokens: { self: TOKEN }, now: NOW, ...opts });
const visible = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, '');
const header = (html) => (html.match(/<header class="top">[\s\S]*?<\/header>/) || [''])[0];
const lateLine = (html) => (html.match(/<div class="sub late-line">([\s\S]*?)<\/div>/) || [null, null])[1];
const scoresSection = (html) => (html.match(/<section class="card" id="scores">[\s\S]*?<\/section>/) || [''])[0];
/** The Scores rows in order: each child's name and whether the row carries the late tag. */
const scoreRows = (html, tag) => scoresSection(html).split('<li ').slice(1).map((li) => ({
  name: visible(`<li ${li}`).match(/([A-Za-z]+) Testwala/)[1],
  late: li.includes('class="late tag"'),
  tagText: (li.match(/<span class="late tag">([^<]*)<\/span>/) || [null, null])[1],
  hasTagWords: tag ? visible(li).includes(tag) : null,
}));
const URDU_DIGITS = /[۰-۹٠-٩]/;

describe('late on: the counts line under the header', () => {
  test('EN: "{n} played · {late} after the report was sent" sits right under the header\'s sub line', () => {
    const html = page(quizData(), { late: true });
    const want = resolveUx('qfix_report_page_line', { language: 'en', params: { n: 4, late: 2 } });
    expect(want).toBe('4 played · 2 after the report was sent');
    expect(visible(lateLine(html) || '')).toBe(want);
    // in the header, straight after the date · class · subject line, once
    expect(header(html)).toMatch(/<div class="sub">[^]*?<\/div><div class="sub late-line">/);
    expect(html.match(/late-line/g)).toHaveLength(1);
  });

  test('UR: the Urdu line, with Western digits, never Urdu ones', () => {
    const html = page(urData(), { late: true, lang: 'ur' });
    const want = resolveUx('qfix_report_page_line', { language: 'ur', params: { n: 4, late: 2 } });
    const line = lateLine(html);
    expect(line).not.toBeNull();
    expect(visible(line)).toBe(want);
    expect(visible(line)).toContain('4');
    expect(visible(line)).toContain('2');
    expect(line).not.toMatch(URDU_DIGITS);
  });

  test('n is the played count the page already shows (summary.played), late is summary.late', () => {
    const html = page(quizData({ summary: { ...quizData().summary, played: 9, late: 3 } }), { late: true });
    expect(visible(lateLine(html))).toBe('9 played · 3 after the report was sent');
  });

  test('late on but nobody late (summary.late absent or 0): no line, no tag', () => {
    const none = quizData({ summary: { played: 4, of: 5, avg: 63, total: 4, hardestN: 2, reported: true }, played: quizData().played.map(({ late, ...p }) => p) });
    for (const data of [none, quizData({ summary: { ...quizData().summary, late: 0 }, played: none.played })]) {
      const html = page(data, { late: true });
      expect(html).not.toContain('late-line');
      expect(html).not.toContain('class="late tag"');
      expect(html).toBe(page(data));
    }
  });
});

describe('late on: the tag on each late child\'s Scores row', () => {
  test('EN: Chand and Bilal carry "after the report"; Ayesha and Dua do not; one list, today\'s order', () => {
    const tag = resolveUx('qfix_report_page_tag', { language: 'en' });
    expect(tag).toBe('after the report');
    const on = scoreRows(page(quizData(), { late: true }), tag);
    const off = scoreRows(page(quizData()), tag);
    expect(on.map((r) => r.name)).toEqual(['Ayesha', 'Chand', 'Bilal', 'Dua']);
    expect(on.map((r) => r.name)).toEqual(off.map((r) => r.name));
    expect(on.map((r) => r.late)).toEqual([false, true, true, false]);
    expect(on.filter((r) => r.late).map((r) => r.tagText)).toEqual([tag, tag]);
    expect(off.map((r) => r.late)).toEqual([false, false, false, false]);
    const html = page(quizData(), { late: true });
    expect(html.match(/id="scores"/g)).toHaveLength(1);
    expect(html.match(/<ul class="sc">/g)).toHaveLength(1);
  });

  test('the tag keeps the row\'s other marks: the not-on-list tag and the list number stay where they were', () => {
    const rows = scoresSection(page(quizData(), { late: true })).split('<li ').slice(1);
    const chand = rows.find((li) => li.includes('Chand'));
    const bilal = rows.find((li) => li.includes('Bilal'));
    expect(chand).toMatch(/list no\. <span class="num">3<\/span><\/span>.*class="late tag"/);
    expect(bilal).toMatch(/not on list<\/span>.*class="late tag"/);
  });

  test('UR: the Urdu tag', () => {
    const tag = resolveUx('qfix_report_page_tag', { language: 'ur' });
    expect(tag).toBe('رپورٹ کے بعد');
    const rows = scoreRows(page(urData(), { late: true, lang: 'ur' }), tag);
    expect(rows.map((r) => r.late)).toEqual([false, true, true, false]);
    expect(rows.map((r) => r.hasTagWords)).toEqual([false, true, true, false]);
  });

  test('only the JSON true marks a row: a "true" string or 1 does not', () => {
    const played = quizData().played.map((p) => (p.first.startsWith('Chand') ? { ...p, late: 'true' } : p.first.startsWith('Bilal') ? { ...p, late: 1 } : p));
    const rows = scoreRows(page(quizData({ played }), { late: true }));
    expect(rows.map((r) => r.late)).toEqual([false, false, false, false]);
  });
});

describe('the PDF is this page: print carries the same line and tags', () => {
  test.each(['en', 'ur'])('print, %s', (lang) => {
    const data = lang === 'ur' ? urData() : quizData();
    const html = page(data, { late: true, print: true, lang });
    expect(visible(lateLine(html) || '')).toBe(resolveUx('qfix_report_page_line', { language: lang, params: { n: 4, late: 2 } }));
    expect(scoreRows(html).map((r) => r.late)).toEqual([false, true, true, false]);
    const off = page(data, { print: true, lang });
    expect(off).not.toContain('late-line');
    expect(off).not.toContain('class="late tag"');
  });
});

describe('a storybook send\'s report: never marked', () => {
  test('late on renders the story report exactly as late off', () => {
    const data = storyData();
    expect(page(data, { late: true })).toBe(page(data));
    expect(page(data, { late: true, print: true })).toBe(page(data, { print: true }));
    expect(page(data, { late: true })).not.toContain('late-line');
  });
});

/**
 * GOLDEN: late off (false or absent), with late rows IN the data, is the page the code made before this change. The
 * 48 px change is a layout fix outside the switch: its three rules (.btn, the language toggle, the Copy-message
 * summary) are dropped from both sides before the digest, and pinned by report-page-48px.test.js instead.
 */
const FILE = path.join(__dirname, '__golden__', 'page-late-off.json');
const BUTTON_RULE = /^(?:\.btn\{|\.brand a(?:::before)?\{|details summary\{)/;
const withoutButtonRules = (html) => html.split('\n').filter((l) => !BUTTON_RULE.test(l)).join('\n');
const digest = (html) => ({ sha256: crypto.createHash('sha256').update(withoutButtonRules(html), 'utf8').digest('hex'), bytes: Buffer.byteLength(withoutButtonRules(html), 'utf8') });
const OFF_RENDERS = {
  'en-screen': () => page(quizData()),
  'en-screen-false': () => page(quizData(), { late: false }),
  'ur-screen': () => page(urData(), { lang: 'ur' }),
  'en-print': () => page(quizData(), { print: true }),
  'ur-print': () => page(urData(), { lang: 'ur', print: true }),
  'story-en': () => page(storyData()),
};

if (process.env.GOLDEN_WRITE === '1') {
  test('write the late-off baselines (run on the code before this change)', () => {
    const out = Object.fromEntries(Object.entries(OFF_RENDERS).map(([k, f]) => [k, digest(f())]));
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, `${JSON.stringify(out, null, 1)}\n`);
  });
} else {
  describe('GOLDEN: late off is today\'s page byte for byte (late rows in the data)', () => {
    const golden = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    test.each(Object.keys(OFF_RENDERS))('%s', (k) => {
      expect(digest(OFF_RENDERS[k]())).toEqual(golden[k]);
    });
  });
}
