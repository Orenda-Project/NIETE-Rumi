'use strict';
/**
 * An English phrase inside an Urdu document is ONE left-to-right run.
 *
 * Both teacher documents isolate each Latin run in an Urdu page (wrapLatin),
 * so a reader meets it left to right. The run stopped at any character outside
 * its class. "&" never reached the class at all: esc() turns it into "&amp;",
 * and entities are cut out before runs are matched. "·" (U+00B7) was not in it.
 * So "Comparing & ordering unlike fractions" became two isolates with a bare
 * "&" between them, and the RTL paragraph laid them out right to left: the
 * remade Urdu teacher PDF on staging printed "ordering unlike & Comparing" over
 * "fractions". The eyebrow "کلاس quiz · forward کرنے کے لیے تیار" read
 * "forward · quiz".
 *
 * Checked two ways: in the HTML (one isolate per phrase), and on the printed
 * page, where pdftotext gives the Latin words in the order they were drawn.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The figure engine loads a molecule renderer whose ESM build Jest cannot
// parse; nothing here draws a molecule. (The root suite stubs it the same way.)
jest.mock('openchemlib', () => ({}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const renderTeacher = require('../../shared/templates/transcript-quiz-teacher.template');
const renderReport = require('../../shared/templates/video-quiz-report.template');
const Gen = require('../../shared/services/quiz/transcript-quiz-generate.service');
const { renderReportPdf } = require('../../shared/services/quiz/video-quiz-report.service');
const { closeBrowser } = require('../../shared/utils/html-to-pdf');
const { teacherPdfArgs } = require('./fixtures/teacher-pdf-synthetic');
const { reportData } = require('./fixtures/class-report-synthetic');
const { renderOptOut, hasPoppler } = require('./helpers/pdf-layout');

const TITLE = 'Comparing & ordering unlike fractions';

/** The text of every Latin isolate inside `html`, entities decoded. */
function isolates(html) {
  return [...html.matchAll(/<span class="ltr">([\s\S]*?)<\/span>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&middot;/g, '·'));
}
const between = (html, open, close) => {
  const i = html.indexOf(open);
  return i < 0 ? '' : html.slice(i, html.indexOf(close, i + open.length) + close.length);
};

/** Page 1's text in drawn (visual) order, bidi embedding controls removed. */
function pageText(pdf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latin-runs-'));
  try {
    const file = path.join(dir, 'doc.pdf');
    fs.writeFileSync(file, pdf);
    return execFileSync('pdftotext', ['-f', '1', '-l', '1', '-layout', file, '-']).toString()
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '').replace(/[ \t]+/g, ' ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function teacherHtml() {
  const a = teacherPdfArgs(0);
  return renderTeacher({
    topic: TITLE, teacherName: '', date: a.date, link: '', digest: a.digest, questions: a.questions,
    lessonSummary: a.lessonSummary, language: 'ur', contentLanguage: 'ur', quizSource: 'transcript',
  });
}

describe('the Urdu teacher PDF keeps an English phrase in one run', () => {
  test('the title is one isolate, "&" and all', () => {
    const h1 = between(teacherHtml(), '<h1', '</h1>');
    expect(isolates(h1)).toEqual([TITLE]);
  });

  test('the eyebrow\'s "quiz · forward" is one isolate', () => {
    const eyebrow = between(teacherHtml(), '<div class="eyebrow">', '</div>');
    expect(isolates(eyebrow)).toEqual(['quiz · forward']);
  });

  test('an option or stem with "&" between English words is one isolate too', () => {
    const a = teacherPdfArgs(0);
    const q = { ...a.questions[0], question_text: 'Which pair shows fruits & vegetables correctly?' };
    const html = renderTeacher({
      topic: 'x', teacherName: '', date: a.date, link: '', digest: a.digest, questions: [q],
      lessonSummary: '', language: 'ur', contentLanguage: 'ur', quizSource: 'transcript',
    });
    expect(isolates(html)).toContain('Which pair shows fruits & vegetables correctly?');
  });

  test('an entity outside a Latin phrase is never cut into, and is kept whole', () => {
    // The chrome carries real entities; a run must never start inside one
    // ("&<span>amp</span>;" was the shape of the original bug on the main bot).
    const html = teacherHtml();
    expect(html).not.toMatch(/&<span/);
    expect(html).not.toMatch(/<span class="ltr">[a-z]+;<\/span>/);
  });
});

describe('the Urdu class report keeps an English phrase in one run', () => {
  test('the title is one isolate', () => {
    const html = renderReport({ ...reportData('ur'), topic: TITLE });
    const h1 = between(html, '<h1', '</h1>');
    expect(isolates(h1)).toEqual([TITLE]);
  });

  test('a reteach question with "&" between English words is one isolate', () => {
    const data = reportData('ur');
    const hardest = [{ ...data.hardest[0], question_text: 'Which pair shows fruits & vegetables correctly?' }];
    expect(isolates(renderReport({ ...data, hardest }))).toContain('Which pair shows fruits & vegetables correctly?');
  });
});

/**
 * A quiz written from a LESSON PLAN is named by the catalog: the name on the
 * lesson's own PDF, verbatim (lp-quiz-digest catalogLessonName). A maths,
 * science or English lesson has an ENGLISH name, and an Urdu quiz on it prints
 * that name in an Urdu document. 330 of the catalog's 1,390 English names join
 * their parts with a dash or an arrow — "Chapter 1 Assessment Worksheet — …",
 * "… (hook) → Coloured-Water Investigation …" — and neither was a joiner, so
 * the name split into two isolates with the dash between them, and the RTL page
 * laid them out right to left: the second half printed first.
 */
const LP_TITLES = [
  "Chapter 1 Assessment Worksheet — 'Hello World!' (student, fillable)",
  'Transport of Water in Plants: how does water reach the leaves? (hook) → Coloured-Water Investigation: watching water climb the stem',
  'Ordering Numbers – smallest to largest',
];

describe('a lesson-plan quiz named by its catalog title keeps the title in one run', () => {
  test.each(LP_TITLES)('the Urdu teacher PDF title is one isolate: %s', (title) => {
    const a = teacherPdfArgs(0);
    const html = renderTeacher({
      topic: title, teacherName: '', date: a.date, link: '', digest: a.digest, questions: a.questions,
      lessonSummary: a.lessonSummary, language: 'ur', contentLanguage: 'ur', quizSource: 'lp_v8',
    });
    expect(isolates(between(html, '<h1', '</h1>'))).toEqual([title]);
  });

  test.each(LP_TITLES)('the Urdu class report title is one isolate: %s', (title) => {
    const html = renderReport({ ...reportData('ur'), topic: title });
    expect(isolates(between(html, '<h1', '</h1>'))).toEqual([title]);
  });

  test('a dash between an English phrase and Urdu is still NOT a joiner', () => {
    // Joining only ever happens between two Latin runs: the Urdu after the dash
    // keeps its own place, and the English phrase ends where it ends.
    const html = renderReport({ ...reportData('ur'), topic: 'unlike fractions — کسر کا موازنہ' });
    expect(isolates(between(html, '<h1', '</h1>'))).toEqual(['unlike fractions']);
  });

  test('the report chrome\'s own &mdash; entity is left exactly as it was', () => {
    const html = renderReport({ ...reportData('ur'), topic: LP_TITLES[0] });
    expect(html).toContain('&mdash;');
    expect(html).not.toMatch(/&<span/);
  });
});

const run = renderOptOut() ? describe.skip : describe;

run('printed, the English phrase reads in order', () => {
  jest.setTimeout(120000);
  beforeAll(() => {
    if (!hasPoppler()) throw new Error('pdftotext (poppler) is needed to read the printed page back');
  });
  afterAll(async () => { await closeBrowser(); });

  test('the teacher PDF prints "Comparing & ordering" and "quiz · forward" in that order', async () => {
    const args = teacherPdfArgs(0);
    const text = pageText(await Gen.renderPdf({ ...args, quiz: { ...args.quiz, topic: TITLE } }));
    expect(text).toMatch(/Comparing & ordering/);
    expect(text).not.toMatch(/ordering unlike & Comparing/);
    expect(text).toMatch(/quiz · forward/);
    expect(text).not.toMatch(/forward · quiz/);
  });

  test('an Urdu lesson-plan quiz\'s English catalog title prints in order on both documents', async () => {
    // A title short enough to print on ONE line: pdftotext re-orders the
    // pieces of a wrapped line by its own guess, so only a one-line title is a
    // fair reading of what was drawn. (A real catalog name.)
    const title = 'Divisibility — apply the rules';
    const args = teacherPdfArgs(0);
    const teacher = pageText(await Gen.renderPdf({ ...args, quiz: { ...args.quiz, topic: title, quiz_source: 'lp_v8' } }));
    expect(teacher).toMatch(/Divisibility — apply the rules/);
    const report = pageText(await renderReportPdf({ ...reportData('ur'), topic: title }));
    expect(report).toMatch(/Divisibility — apply the rules/);
  });

  test('the class report prints "Comparing & ordering" in that order', async () => {
    const text = pageText(await renderReportPdf({ ...reportData('ur'), topic: TITLE }));
    expect(text).toMatch(/Comparing & ordering/);
    expect(text).not.toMatch(/& Comparing/);
  });
});
