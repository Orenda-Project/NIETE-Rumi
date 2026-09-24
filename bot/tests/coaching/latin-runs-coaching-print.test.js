'use strict';
/**
 * The coaching hero report and the commitment card print an English phrase
 * with "&" as the teacher wrote it: one run, the "&" drawn as "&".
 *
 * The card's own Latin-run regex ran over escaped text and started a run
 * inside the entity, so "Think & Share" was drawn as "Think &amp; Share".
 * The hero cut entities out before matching runs, so the "&" fell outside the
 * English span. The hero's spans are bidi embeds, so the words kept their
 * order, but the "&" and its spaces were set in the Urdu face and drawn
 * squeezed ("Comparing&ordering"). pdftotext still reads those spaces, so the
 * hero case here passes on the old code too: it guards that joining the run
 * leaves the drawn order alone. The hero's red test is the HTML one
 * (tests/coaching/coaching-latin-runs.test.js: one span per phrase).
 *
 * Printed through the real templates and the real Chromium, then read back
 * with pdftotext in drawn order. Skipped, saying so, on a checkout installed
 * without the browser; fails, naming it, when the browser is there but
 * pdftotext is not.
 */

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildHeroReportHtml } = require('../../shared/services/coaching/report-v2/hero-report.template');
const { buildCardHtml } = require('../../shared/services/coaching/coaching-card/card-template');
const { htmlToPdf, closeBrowser } = require('../../shared/utils/html-to-pdf');
const { renderOptOut, hasPoppler } = require('../quiz/helpers/pdf-layout');

const TITLE = 'Comparing & ordering unlike fractions';
const PAGE = { width: '800px', height: '1500px', margin: { top: '0', right: '0', bottom: '0', left: '0' } };

/** The printed text in drawn order, bidi controls removed, spaces collapsed. */
async function printed(html) {
  const pdf = await htmlToPdf(html, { pdfOptions: PAGE });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-latin-'));
  try {
    const file = path.join(dir, 'doc.pdf');
    fs.writeFileSync(file, pdf);
    return execFileSync('pdftotext', ['-layout', file, '-']).toString()
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '').replace(/[ \t]+/g, ' ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const card = () => buildCardHtml({
  commitment: 'کل کلاس میں Think & Share کا طریقہ آزمانا',
  action: 'بچوں سے Questions & Answers کے ذریعے سبق دہرانا',
  highlights: [],
  lesson_label: TITLE,
}, { language: 'ur', teacherName: 'ثنا' });

const hero = () => buildHeroReportHtml({
  language: 'ur',
  teacherName: 'ثنا',
  topic: TITLE,
  date: '2026-09-20',
  score: { overall: 70, marks: 70, max: 100 },
  groups: [{ key: 'B', name: 'Lesson Plan Fidelity', score: 31, max: 40, pct: 78 }],
  narrative: {
    affirmation: 'آپ نے کلاس میں Think & Share کروایا',
    strength_name: 'Wait time',
    strength_note: 'بچوں کو سوچنے کا وقت ملا',
    horizon_title: 'Cold call',
    horizon_note: 'ہر بچے سے باری باری پوچھیں',
    moments: [],
  },
  tryNext: 'کل Questions & Answers کا طریقہ آزمائیں',
  trend: [],
  photoB64: '',
});

const skip = renderOptOut();
const maybe = skip ? describe.skip : describe;

maybe('Urdu coaching documents print an "&" phrase whole', () => {
  beforeAll(() => {
    if (!hasPoppler()) throw new Error('pdftotext (poppler) is not installed; these tests read the printed page with it');
  });
  afterAll(async () => { await closeBrowser(); });

  test('the commitment card: no "amp;" and each phrase in order', async () => {
    const text = await printed(card());
    expect(text).not.toMatch(/amp;/);
    expect(text).toContain('Think & Share');
    expect(text).toContain('Questions & Answers');
    expect(text).toContain(TITLE);
  }, 60000);

  test('the hero report: each phrase still drawn in order', async () => {
    const text = await printed(hero());
    expect(text).not.toMatch(/amp;/);
    expect(text).toContain('Think & Share');
    expect(text).toContain('Questions & Answers');
    expect(text).toContain(TITLE);
  }, 60000);
});
