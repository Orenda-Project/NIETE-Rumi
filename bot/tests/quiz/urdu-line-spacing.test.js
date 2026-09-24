'use strict';
/**
 * Urdu quiz text must not sit on top of itself.
 *
 * "Improve font spacing for Urdu quizzes, right now it's on top of each other."
 * On the teacher's quiz sheet a two-line Nastaliq stem printed with its second
 * line's tall letters (ک گ ل ٹ) running into the first line's tails (ے ں ی ؟),
 * the objective line above crowded the stem, option text ran through its own
 * row's border, and on the child's cards a name that opens with ک or گ lost
 * the letter's stroke to a clipped box — «کشف» printed as «لشف».
 *
 * Measured as INK, not as CSS: every rendered line is screenshotted on its own
 * and the smallest vertical distance between the ink of one line and the next
 * is read per pixel column (helpers/line-ink.js). A gap under 0.05 em is a
 * touch; negative is an overlap. Each surface is rendered by its production
 * template in the bot's own Chromium, from the synthetic quizzes in
 * fixtures/urdu-spacing-synthetic.js.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The diagram engine loads openchemlib (ESM) at module scope; no molecule is drawn here.
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const renderTeacher = require('../../shared/templates/transcript-quiz-teacher.template');
const renderReport = require('../../shared/templates/video-quiz-report.template');
const renderScorecard = require('../../shared/templates/video-quiz-scorecard.template');
const renderClassCard = require('../../shared/templates/video-quiz-leaderboard.template');
const Card = require('../../shared/services/quiz/transcript-quiz-card');
const Figure = require('../../shared/services/quiz/transcript-quiz-figure');
const Render = require('../../shared/services/quiz/video-quiz-render.service');
const { reportData } = require('./fixtures/class-report-synthetic');
const { QUIZZES, rows, TALL_NAMES, TALL_TOPIC } = require('./fixtures/urdu-spacing-synthetic');
const { measureLines, measureStack } = require('./helpers/line-ink');
const { renderOptOut } = require('./helpers/pdf-layout');

const run = renderOptOut() ? describe.skip : describe;
jest.setTimeout(240000);

/** Ink closer than this (em of the lower line's type) reads as touching. */
const TOUCH = 0.05;

let browser;
beforeAll(async () => {
  if (renderOptOut()) return;
  const { chromium } = require('playwright-core');
  browser = await chromium.launch();
});
afterAll(async () => { if (browser) await browser.close(); });

async function open(html, width, { print = false, dsf = 2 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: dsf });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {})));
    await document.fonts.ready;
  });
  if (print) await page.emulateMedia({ media: 'print' });
  return page;
}

/** The teacher sheet exactly as renderPdf builds it, figures drawn. */
function teacherHtml(q, language = 'ur') {
  const qs = rows(q.list, 'quiz-1').map((row) => (row.media.figure
    ? { ...row, figureSvg: Figure.renderFigureSvg(row.media.figure, language) } : row));
  return renderTeacher({
    topic: q.topic, teacherName: '', grade: null, date: '24 ستمبر 2026', link: '',
    digest: { slos: q.slos, ...(q.checks ? { checks_summary: q.checks } : {}) },
    questions: qs, lessonSummary: q.lessonSummary, language, contentLanguage: language, quizSource: q.quizSource,
  });
}

/** Every line pair closer than TOUCH, named so a failure says where. */
const touching = (label, list) => list.flatMap((r) => r.gaps
  .map((g, i) => ({ where: `${label} "${r.text}" line ${i + 1}→${i + 2}`, gapEm: g }))
  .filter((x) => x.gapEm < TOUCH));
/** Every box whose ink comes closer than TOUCH to its border (top or bottom). */
const crossing = (label, list) => list
  .filter((r) => r.boxClearTop !== null && (r.boxClearTop < TOUCH || r.boxClearBottom < TOUCH))
  .map((r) => ({ where: `${label} "${r.text}"`, top: r.boxClearTop, bottom: r.boxClearBottom }));
/**
 * Every label whose clip cuts its ink — above, below, or at the START of the
 * line, where a word-initial ک or گ carries a stroke that overhangs the text's
 * own edge (the end is the ellipsis's to cut).
 */
const cut = (label, list) => list
  .filter((r) => [r.clipClearTop, r.clipClearBottom, r.clipClearStart].some((v) => v !== null && v < 0))
  .map((r) => ({ where: `${label} "${r.text}"`, top: r.clipClearTop, bottom: r.clipClearBottom, start: r.clipClearStart }));

run('the teacher quiz PDF, Urdu: no line of the sheet touches another', () => {
  test.each(Object.keys(QUIZZES))('%s quiz: stems, options, the objective line and the summary boxes', async (key) => {
    const page = await open(teacherHtml(QUIZZES[key]), 794, { print: true });
    try {
      const stems = await measureLines(page, '.card .stem');
      const options = await measureLines(page, '.opt .otext', { boxSelector: '.opt' });
      const summaries = await measureLines(page, '.band .sum', { boxSelector: '.sum' });
      const eyebrow = await measureStack(page, '.card .cmeta', '.card .stem');
      const stemOverOption = await measureStack(page, '.card .stem', '.card .opt:first-child .otext');
      expect(stems.some((r) => r.lines > 1)).toBe(true); // the fixture does wrap
      expect([
        ...touching('stem', stems),
        ...touching('option', options),
        ...touching('summary', summaries),
        ...eyebrow.map((g, i) => ({ where: `objective line over stem ${i + 1}`, gapEm: g })).filter((x) => x.gapEm !== null && x.gapEm < TOUCH),
        ...stemOverOption.map((g, i) => ({ where: `stem ${i + 1} over option A`, gapEm: g })).filter((x) => x.gapEm !== null && x.gapEm < TOUCH),
      ]).toEqual([]);
      expect([...crossing('option row', options), ...crossing('summary box', summaries)]).toEqual([]);
    } finally { await page.close(); }
  });

  test('the English sheet keeps its Latin leading (the Urdu spacing does not leak)', async () => {
    const q = { ...QUIZZES.maths, topic: 'Adding fractions', slos: [{ id: 'M1', statement: 'Add like fractions', taught_level: 'apply' }, { id: 'M2', statement: 'Name the parts of a fraction', taught_level: 'understand' }],
      list: [['M1', 'What is $\\frac{2}{7} + \\frac{3}{7}$? Write the answer in its simplest form.', ['$\\frac{5}{7}$', '$\\frac{5}{14}$', '$\\frac{6}{7}$'], 'A']],
      lessonSummary: 'You taught the class to add fractions with the same denominator.' };
    const page = await open(teacherHtml(q, 'en'), 794, { print: true });
    try {
      const ratio = await page.evaluate(() => ['.card .stem', '.opt'].map((s) => {
        const cs = getComputedStyle(document.querySelector(s));
        return Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) / 100;
      }));
      expect(ratio).toEqual([1.42, 1.42]);
    } finally { await page.close(); }
  });
});

run('the class report, Urdu: no line touches another, no answer runs out of its chip', () => {
  test('missed questions, explanations, guidance and answer chips', async () => {
    const page = await open(renderReport(reportData('ur')), 794, { print: true });
    try {
      const questions = await measureLines(page, '.m-q');
      const whys = await measureLines(page, '.why', { boxSelector: '.why' });
      const guidance = await measureLines(page, '.try-text');
      const chips = await measureLines(page, '.rightpill, .wrongpill, .slo', { boxSelector: '.rightpill, .wrongpill, .slo' });
      expect([
        ...touching('missed question', questions),
        ...touching('explanation', whys),
        ...touching('guidance', guidance),
        ...touching('chip', chips),
      ]).toEqual([]);
      expect([...crossing('chip', chips), ...crossing('explanation box', whys)]).toEqual([]);
    } finally { await page.close(); }
  });
});

run('the child question card, Urdu: no line touches another', () => {
  test.each(Object.keys(QUIZZES))('%s quiz: every card', async (key) => {
    const found = [];
    const list = rows(QUIZZES[key].list, 'quiz-1');
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i];
      const labels = Render.optionLabels(row);
      const page = await open(Card.renderQuestionCardHtml({
        stem: row.question_text, options: labels, displayOrder: Render.displayOrder(row, labels),
        figureSvg: row.media.figure ? Figure.renderFigureSvg(row.media.figure, 'ur') : null,
        language: 'ur', questionNumber: i + 1, total: list.length,
      }), Card.CARD_WIDTH, { dsf: 1 });
      try {
        const options = await measureLines(page, '.opt .opt-text', { boxSelector: '.opt' });
        found.push(...touching(`Q${i + 1} stem`, await measureLines(page, '.card > .stem')));
        found.push(...touching(`Q${i + 1} option`, options), ...crossing(`Q${i + 1} option row`, options));
      } finally { await page.close(); }
    }
    expect(found).toEqual([]);
  });
});

run('the child scorecard and class card, Urdu: no letter of a name or topic is cut off', () => {
  test.each(TALL_NAMES)('scorecard for %s', async (name) => {
    const page = await open(renderScorecard({ topic: TALL_TOPIC, correct: 5, total: 8, pct: 63, subject: 'maths', takerName: name, language: 'ur' }), 540);
    try {
      expect(cut('scorecard', await measureLines(page, '.name, .topic, .subj'))).toEqual([]);
    } finally { await page.close(); }
  });

  test('class card: every name and the topic line', async () => {
    const rowsIn = TALL_NAMES.map((name, i) => ({ sessionId: `s${i + 1}`, name, correct: 8 - i, total: 8, pct: Math.round(((8 - i) / 8) * 100) }));
    const page = await open(renderClassCard({ topic: TALL_TOPIC, subject: 'maths', className: '4', language: 'ur', rows: rowsIn, targetSessionId: 's2', mode: 'full' }), 540);
    try {
      expect(cut('class card', await measureLines(page, '.nm, .sub .content, .place'))).toEqual([]);
      // …and a name stays inside its own row, clear of the row's edge.
      expect(crossing('class card row', await measureLines(page, '.row .nm', { boxSelector: '.row' }))).toEqual([]);
    } finally { await page.close(); }
  });
});
