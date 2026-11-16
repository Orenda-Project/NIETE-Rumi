/**
 * bd-snkn32.36 — a grades 1–5 "Make my own" page reads tight and in order (lp-k5-own-render.js).
 *
 * Testers (10–12 Nov): "In We Do the bullet points are divided with vast space in between" and "the LP layout looks
 * cluttered". The vast space was the old page split (bd-snkn32.23). What was left in the page itself: every plain
 * paragraph kept the browser's default 1em margin (15px in print) while the numbered steps sit 5px apart, so a
 * section read as loose blocks with tight lists inside, and the section title ran straight into its first line.
 *
 * Two layers, as quranic-annotation-marks.test.js does it: the stylesheet rules (always run) and real Chromium
 * measuring the printed gaps (skips where there is no browser, i.e. CI).
 */
const path = require('path');
const { renderK5Own } = require('../../bot/shared/services/lp-k5-own-render');

let chromium = null;
try {
  chromium = require(path.join(__dirname, '..', '..', 'bot', 'node_modules', 'playwright-core')).chromium;
} catch (_) { /* no browser */ }

/** Bushra's We Do (grade 2 English ch5, sandbox 10 Nov), trimmed: a strategy line, numbered moves, a check. */
function script() {
  return {
    meta: { grade: 2, subject: 'English', topic: 'Memory Lane & New Words', minutes: 40, day: 1, total: 6 },
    goal: 'A compound word is two smaller words joined together.',
    hook: { warmUp: { teacherAsks: 'Which verb did we use?', expectedAnswer: 'HELP' }, materials: ['chalk', 'board'],
      conversation: [{ teacherAsks: 'Open the textbook at page 56.' }], keyWords: [{ term: 'shrine', def: 'a special place' }] },
    iDo: { steps: [{ n: 1, action: 'Hold up the textbook.' }, { n: 2, say: 'Look, this is my TEXTBOOK.' }],
      worked: { problem: 'Split FARMHOUSE.', work: ['FARM = crops', 'HOUSE = home'], answer: 'farm + house' },
      cfu: 'Why is it a compound word?', misconception: { slip: 'Children split it in the wrong place.', fix: 'Clap each half.' } },
    weDo: {
      strategy: 'Group children by level using rows: Row A claps word-halves; Row B splits words; Row C makes a sentence.',
      steps: [
        { n: 1, action: 'Whole class claps TIME-clap-TABLE-clap together.' },
        { n: 2, say: 'TIME... TABLE... a table that shows times: TIMETABLE!' },
        { n: 3, action: 'Row A: teacher claps each half slowly with them.' },
        { n: 4, action: 'Row B: choral split and meaning of each half.' },
      ],
      cfu: 'Row-by-row choral check: each row says its word-split aloud.',
    },
    youDo: { problems: [{ prompt: 'Puzzle 1' }, { prompt: 'Puzzle 2' }], cfu: 'Fingers check.', behind: { prompt: 'Clap the halves.' } },
    wrap: { exitOptions: [{ prompt: 'Thumbs up or down.' }], reteach: 'Redo with two words.', homework: ['Find one compound word.', 'Draw a line.'] },
  };
}

const html = renderK5Own(script(), { lang: 'en', grade: 2, subject: 'English', way: 'Sounds first' });
const sheet = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

describe('bd-snkn32.36 — the stylesheet keeps a tight, even rhythm', () => {
  const printBlock = sheet.slice(sheet.lastIndexOf('@media print'));

  it('a paragraph inside a section drops the browser default 1em margin (print and screen)', () => {
    expect(sheet).toMatch(/\.sec p\{margin:\d+px 0 0\}/);
    const px = (s) => Number((s.match(/\.sec p\{margin(?:-top)?:(\d+)px/) || [])[1]);
    expect(px(sheet)).toBeLessThanOrEqual(8);
    expect(px(printBlock)).toBeLessThanOrEqual(6);
  });

  it('a numbered step keeps no paragraph margin of its own (the bullets stay tight)', () => {
    expect(sheet).toMatch(/\.sec \.mv p\{margin:0\}/);
  });

  it('each section title sits on its own ruled line, apart from the text under it', () => {
    expect(sheet).toMatch(/\.sec>\.sh\{[^}]*border-bottom:/);
  });
});

const maybe = chromium ? describe : describe.skip;

maybe('bd-snkn32.36 — real Chromium: the printed We Do has no loose gaps', () => {
  jest.setTimeout(60000);
  let browser;
  beforeAll(async () => {
    try { browser = await chromium.launch(); } catch (_) { browser = await chromium.launch({ channel: 'chrome' }); }
  });
  afterAll(async () => { if (browser) await browser.close(); });

  it('every block in every section sits at most 6px under the one above it, and no content is lost', async () => {
    const page = await browser.newPage({ viewport: { width: 520, height: 2000 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const out = await page.evaluate(() => [...document.querySelectorAll('section.sec')].map((sec) => {
      const kids = [...sec.children].slice(1); // after the title row
      const gaps = kids.slice(1).map((k, i) => k.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom);
      return { title: sec.querySelector('h2').textContent, gaps, text: sec.textContent };
    }));
    await page.close();
    const we = out.find((s) => s.title === 'We Do');
    expect(we.gaps.length).toBeGreaterThanOrEqual(5);
    const loose = out.flatMap((s) => s.gaps.filter((g) => g > 6.5).map((g) => `${s.title}: ${Math.round(g)}px`));
    expect(loose).toEqual([]);
    for (const t of ['Row A: teacher claps', 'TIMETABLE!', 'Row-by-row choral check', 'Group children by level']) expect(we.text).toContain(t);
  });
});
