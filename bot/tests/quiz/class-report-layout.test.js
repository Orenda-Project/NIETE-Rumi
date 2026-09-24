'use strict';
/**
 * The class-results report, PRINTED — through the real template, the service's
 * own render options and a real Chromium — and read back page by page.
 *
 * What the teacher saw on the Urdu report before this was fixed, for a class of
 * twelve with three questions worth reteaching:
 *   - page 1 held the dark header and nothing else;
 *   - every "worth reteaching" card that did not fit jumped to a page of its
 *     own, leaving the rest of the page before it empty;
 *   - a page carried one roster row and the not-finished box, then the whole
 *     "For tomorrow" box moved on;
 *   - six pages in all, where the English report of the same class took four;
 *   - next to a long correct answer the label "درست جواب" broke over two lines.
 *
 * The synthetic class is in ./fixtures/class-report-synthetic.js.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { renderReportPdf } = require('../../shared/services/quiz/video-quiz-report.service');
const { closeBrowser } = require('../../shared/utils/html-to-pdf');
const renderHtml = require('../../shared/templates/video-quiz-report.template');
const { reportData, CLASSES_MIXED } = require('./fixtures/class-report-synthetic');
const { pageInk, pageCount, renderOptOut, hasPoppler } = require('./helpers/pdf-layout');

const run = renderOptOut() ? describe.skip : describe;

jest.setTimeout(120000);

afterAll(async () => { await closeBrowser(); });

/**
 * A footer stranded on a page of its own is one line of type at the top of the
 * sheet: its ink ends about 5% of the way down. Anything that reaches further
 * than 10% has content above the footer.
 */
const FOOTER_ONLY = 0.1;

/**
 * Every page but the last is used to its foot (a page that ends early is the
 * blank the teacher scrolls past), and the last carries more than a footer.
 */
function expectPacked(pages) {
  const endsEarly = pages.slice(0, -1)
    .map((p, i) => ({ page: i + 1, lastInk: Number(p.lastInk.toFixed(2)) }))
    .filter((p) => p.lastInk < 0.72);
  expect(endsEarly).toEqual([]);
  expect(pages[pages.length - 1].lastInk).toBeGreaterThan(FOOTER_ONLY);
}

run('the printed class report packs its pages', () => {
  beforeAll(() => {
    if (!hasPoppler()) throw new Error('pdftoppm (poppler) is needed to read the printed pages back');
  });

  test('Urdu, twelve children, three to reteach: four pages, page 1 carries more than the header', async () => {
    const pdf = await renderReportPdf(reportData('ur'));
    const pages = pageInk(pdf);
    expect(pageCount(pdf)).toBe(pages.length);
    expect(pages.length).toBeLessThanOrEqual(4);
    // The hero ends about a third of the way down; the first card follows it.
    expect(pages[0].lastInk).toBeGreaterThan(0.8);
    expectPacked(pages);
  });

  test('Urdu, a class of three grades (a class label on every row): still four pages, still packed', async () => {
    const pages = pageInk(await renderReportPdf(reportData('ur', { classes: CLASSES_MIXED })));
    expect(pages.length).toBeLessThanOrEqual(4);
    expectPacked(pages);
  });

  test('English, the same class: three pages, packed', async () => {
    const pages = pageInk(await renderReportPdf(reportData('en')));
    expect(pages.length).toBeLessThanOrEqual(3);
    expectPacked(pages);
  });
});

run('the report never ends on a page that holds only its footer', () => {
  // Growing the roster one child at a time walks the end of the document down
  // the page in steps shorter than the footer is tall, so each sweep passes
  // through the lengths where a footer would strand. The footer may not split
  // and the break in front of it is avoided: the last guidance part comes over
  // with it instead. The Urdu sweep carries the longest "For tomorrow" box the
  // model writes — the one that, held together with the footer, overran a page
  // and left the footer alone on the last sheet.
  test.each([
    ['ur', 1, 10, true],
    ['en', 8, 16, false],
  ])('%s, %i to %i children (long guidance: %s)', async (language, from, to, long) => {
    const base = reportData(language, { long });
    const stranded = [];
    for (let n = from; n <= to; n += 1) {
      const students = Array.from({ length: n }, (_, i) => ({ ...base.students[i % base.students.length], student_name: `${base.students[i % base.students.length].student_name}${i >= base.students.length ? ` ${i}` : ''}` }));
      const pages = pageInk(await renderReportPdf({ ...base, students }));
      const last = pages[pages.length - 1];
      if (last.lastInk <= FOOTER_ONLY) stranded.push({ children: n, pages: pages.length, lastPageEnds: Number(last.lastInk.toFixed(2)) });
    }
    expect(stranded).toEqual([]);
  });
});

run('a long answer stays inside its chip, and its label stays on one line', () => {
  let browser;
  beforeAll(async () => {
    const { chromium } = require('playwright-core');
    browser = await chromium.launch();
  });
  afterAll(async () => { if (browser) await browser.close(); });

  async function measure(language) {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await page.setContent(renderHtml(reportData(language)), { waitUntil: 'load' });
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {})));
      await document.fonts.ready;
    });
    await page.emulateMedia({ media: 'print' });
    const out = await page.evaluate(() => {
      const lineCount = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top / 4)));
        return tops.size;
      };
      return {
        labels: Array.from(document.querySelectorAll('.chose .lbl')).map((el) => ({ text: el.textContent, lines: lineCount(el) })),
        // Every wrapped chip's line pitch, as a multiple of its type size. Nastaliq's
        // tall stacks need room between wrapped lines or the lines collide.
        chips: Array.from(document.querySelectorAll('.rightpill, .wrongpill, .slo')).map((el) => {
          const cs = getComputedStyle(el);
          return { text: el.textContent.slice(0, 24), lines: lineCount(el), pitch: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) };
        }),
      };
    });
    await page.close();
    return out;
  }

  test.each(['ur', 'en'])('%s: "correct answer" never breaks over two lines', async (language) => {
    const { labels } = await measure(language);
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach((l) => expect(l).toEqual({ text: l.text, lines: 1 }));
  });

  test('ur: the long right answer wraps inside its chip on a line pitch Nastaliq can stack', async () => {
    const { chips } = await measure('ur');
    const wrapped = chips.filter((c) => c.lines > 1);
    expect(wrapped.length).toBeGreaterThan(0);           // the fixture's long answer does wrap
    wrapped.forEach((c) => expect(c.pitch).toBeGreaterThanOrEqual(1.65));
  });
});

run('a paragraph of the "For tomorrow" box is never split across a page', () => {
  // Seen on staging: the box's last part printed three lines at the foot of
  // one page and four over the next, then the footer. Each part is one
  // paragraph a teacher reads as one thought; the box breaks between parts.
  // The reteach part here opens on "common denominator" and closes on
  // "numerator" (terms of record, in Latin, so pdftotext finds them on an Urdu
  // page); growing the roster walks it over a page boundary.
  const pagesOf = (pdf) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'try-part-'));
    try {
      const file = path.join(dir, 'doc.pdf');
      fs.writeFileSync(file, pdf);
      return execFileSync('pdftotext', ['-layout', file, '-']).toString().split('\f');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  test('ur, 1 to 12 children: the reteach part starts and ends on the same page', async () => {
    const base = reportData('ur');
    const board = 'بورڈ پر common denominator لکھیں اور بچوں سے ہر کسر کو اسی نسب نما میں بدلوائیں۔ '
      + 'پھر ہر بچہ اپنی کاپی میں تینوں کسریں ترتیب سے لکھے اور ساتھ والے کو دکھائے۔ '
      + 'اس کے بعد دو کسروں کا موازنہ کر کے بتائیں کہ بڑی کون سی ہے اور کیوں۔ '
      + 'آخر میں ایک مثال پر ہر کسر کا numerator';
    const guidance = { ...base.guidance, board: `${board} دکھائیں۔` };
    const split = [];
    for (let n = 1; n <= 12; n += 1) {
      const students = base.students.slice(0, n);
      const pages = pagesOf(await renderReportPdf({ ...base, students, guidance }));
      const start = pages.findIndex((p) => p.includes('common denominator'));
      const end = pages.findIndex((p) => p.includes('numerator'));
      if (start !== end) split.push({ children: n, startsOnPage: start + 1, endsOnPage: end + 1 });
    }
    expect(split).toEqual([]);
  });
});
