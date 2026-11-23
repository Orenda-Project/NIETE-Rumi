'use strict';
/**
 * The report page's score rows, laid out by a real Chromium at 360x740 (the phone the page is opened on, in WhatsApp's
 * in-app browser). A child's row carries the name, the list number and up to two tags (the "tries" tag and the "after
 * the report" tag). Before this the name cell was one line that never wrapped: a tag took the cell, the child's name
 * shrank to nothing and the last tag was cut to a sliver. The "after the report" tag alone was enough, on a short name.
 * Now the tags drop under the name.
 *
 * What a teacher needs from every row, in English and Urdu:
 *   - the child's name whole (not cut, not ellipsised);
 *   - every tag whole, inside the row's name cell, on one line;
 *   - a tag that drops to a line of its own starts at the name's edge (no indent);
 *   - nothing clipped: the row looks the same with every overflow in the name cell made visible;
 *   - the row grows taller rather than cutting; the page never scrolls sideways.
 * A row with no tags keeps its markup (the page goldens pin it) and its pixels (the last test here).
 */
const path = require('path');
const { renderPage } = require('../../shared/templates/teacher-report.page');
const { renderOptOut } = require('../quiz/helpers/pdf-layout');

const run = renderOptOut() ? describe.skip : describe;
jest.setTimeout(120000);

const FONT = path.join(__dirname, '../../../dashboard/public/wq/fonts/wq-nastaliq-1.woff2');
const quizData = (lang, keep = () => true) => {
  const ur = lang === 'ur';
  const data = {
    quiz: { id: 'q-1', topic: ur ? 'عبارت کا مرکزی خیال' : 'Main idea of a passage', subject: 'english', grade: '5', source: 'lp_v8', language: lang, date: '2026-11-20T09:00:00Z' },
    roster: { state: 'known', className: '5-A', of: 34, lists: [{ id: 'l', label: '5-A' }] },
    summary: { played: 4, of: 34, avg: 66, total: 4, hardestN: 2, late: 3 },
    played: [
      // both tags, a three-word name, a two-digit list number
      { first: ur ? 'محمد عبدالرحمان قریشی' : 'Muhammad Abdur Rehman', roll: 27, correct: 8, total: 10, pct: 80, onList: true, late: true, attempts: 2 },
      // the "after the report" tag alone, a short name, a one-digit list number (the row the teacher saw with no name)
      { first: ur ? 'فاطمہ' : 'Zara', roll: 1, correct: 7, total: 8, pct: 88, onList: true, late: true },
      // the "after the report" tag alone, a three-word name, a two-digit list number
      { first: ur ? 'عائشہ بی بی خان' : 'Ayesha Bibi Khan', roll: 12, correct: 6, total: 8, pct: 75, onList: true, late: true },
      // no tags
      { first: ur ? 'زینب' : 'Zainab', roll: 3, correct: 4, total: 10, pct: 40, onList: true },
    ],
    notPlayed: [],
    questions: [],
  };
  data.played = data.played.filter(keep);
  return data;
};

// The score rows' name-cell rules before the wrap, laid over the page: used only to show a row with no tags draws the
// same pixels as before.
const ONE_LINE = '.sc .nm{overflow:hidden;white-space:nowrap;flex-wrap:nowrap;gap:6px}.sc .nm>span:first-child{min-width:auto;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal}';
const CLIP_OFF = '.sc .nm,.sc .nm *{overflow:visible!important;text-overflow:clip!important}';

run('report page score rows at 360 px: the name whole, the tags whole, no sideways scroll', () => {
  let browser;
  beforeAll(async () => { browser = await require('playwright-core').chromium.launch(); });
  afterAll(async () => { if (browser) await browser.close(); });

  const open = async (lang, keep) => {
    const html = renderPage({ quiz: quizData(lang, keep) }, { lang, tab: 'quiz', tokens: { self: 'tok' }, now: Date.parse('2026-11-22T09:30:00Z'), late: true });
    const page = await browser.newPage({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 3 });
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.endsWith('/r/tok')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      if (u.includes('/wq/fonts/')) return route.fulfill({ status: 200, contentType: 'font/woff2', path: FONT });
      return route.abort();
    });
    await page.goto('http://report.test/r/tok');
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  const shots = async (page) => {
    const rows = await page.$$('#scores .sc li');
    return Promise.all(rows.map((r) => r.screenshot()));
  };
  const style = (page, css) => page.evaluate((c) => { const s = document.createElement('style'); s.textContent = c; document.head.appendChild(s); }, css);

  const measure = async (lang) => {
    const page = await open(lang);
    const out = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#scores .sc li')].map((li) => {
        const nm = li.querySelector('.nm');
        const box = nm.getBoundingClientRect();
        const name = nm.firstElementChild;
        const nr = name.getBoundingClientRect();
        // the start edge (left in English, right in Urdu) of every piece that begins a new line, against the name's
        const rtl = getComputedStyle(nm).direction === 'rtl';
        const start = (r) => (rtl ? r.right : r.left);
        const kids = [...nm.children];
        const indents = kids.slice(1)
          .filter((k, i) => k.getBoundingClientRect().top >= kids[i].getBoundingClientRect().bottom - 1)
          .map((k) => Math.round(Math.abs(start(k.getBoundingClientRect()) - start(nr))));
        const tags = [...nm.querySelectorAll('.tag, .roll')].map((t) => {
          const r = t.getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(t).lineHeight);
          return {
            text: t.textContent,
            inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5,
            whole: t.scrollWidth <= t.clientWidth + 1,
            oneLine: r.height < lh * 1.5,
          };
        });
        return {
          name: name.textContent,
          nameWhole: name.scrollWidth <= name.clientWidth + 1 && nr.width > 0,
          cellHidesNothing: nm.scrollWidth <= nm.clientWidth + 1,
          indents,
          tags,
        };
      });
      return { rows, xScroll: document.documentElement.scrollWidth > window.innerWidth };
    });
    const before = await shots(page);
    await style(page, CLIP_OFF);
    const after = await shots(page);
    await page.close();
    out.rows.forEach((r, i) => { r.clipFree = before[i].equals(after[i]); });
    return out;
  };

  test.each(['ur', 'en'])('%s: rows with both tags, the late tag alone (short and long name), and none', async (lang) => {
    const { rows, xScroll } = await measure(lang);
    expect(rows).toHaveLength(4);
    expect(xScroll).toBe(false);
    // every row in one assertion, so a failure names each row that loses something
    const seen = rows.map((r) => ({ name: r.name, nameWhole: r.nameWhole, cellHidesNothing: r.cellHidesNothing, clipFree: r.clipFree, badTags: r.tags.filter((t) => !t.inside || !t.whole || !t.oneLine).map((t) => t.text), indented: r.indents.filter((d) => d > 1) }));
    expect(seen).toEqual(rows.map((r) => ({ name: r.name, nameWhole: true, cellHidesNothing: true, clipFree: true, badTags: [], indented: [] })));
    expect(rows.map((r) => r.tags.length)).toEqual([3, 2, 2, 1]); // list number + tries + after the report; list number + after the report; list number
  });

  test.each(['ur', 'en'])('%s: a row with no tags draws the same pixels as before', async (lang) => {
    // the row on its own, so no row above it changes height under the old rules and moves it
    const page = await open(lang, (p) => !p.late && !p.attempts);
    const [now] = await shots(page);
    await style(page, ONE_LINE);
    const [was] = await shots(page);
    await page.close();
    expect(now.equals(was)).toBe(true);
  });
});
