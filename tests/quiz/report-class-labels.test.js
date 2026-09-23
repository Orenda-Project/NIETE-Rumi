'use strict';
/**
 * The class a child types into the join form is free text, and one class of
 * children types it a dozen ways: "4", "Class 4", "grade 4", "4th", "جماعت ۴",
 * "۴" (Urdu digit), "٤" (Arabic-Indic digit). The report used to compare those
 * as strings, so its hero printed "جماعتیں 4، ۴" — two classes out of one — and
 * its roster printed each spelling back exactly as it was typed, so a single
 * report carried "Class 4", "Grade 5", "class 5" and "جماعت ۴" side by side.
 *
 * The rule now: digits are normalised (۰-۹ and ٠-٩ to 0-9), the grade number is
 * read out of the free text, children are grouped by it, and every label on the
 * document is written ONE way, in the document's own language ("Class 4" /
 * "جماعت 4"). A class with no number in it ("KG", "Prep") keeps its own word.
 * When every child is in the same class the hero already says so, and the
 * roster does not repeat it on every row.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The PDF render fails, so the report falls back to its text form — the other
// surface that prints a roster.
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('render failed')),
}));

const { classLabel, classHeading, normaliseClasses } = require('../../bot/shared/utils/text-format');
const renderHtml = require('../../bot/shared/templates/video-quiz-report.template');
const { reportData, CLASSES_ONE, CLASSES_MIXED } = require('../../bot/tests/quiz/fixtures/class-report-synthetic');
const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const report = require('../../bot/shared/services/quiz/video-quiz-report.service');

/** What the page SAYS: markup and the stylesheet stripped, Latin-run isolates unwrapped. */
function textOf(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, '');
}

/** The roster rows' class labels, in order. */
function rowLabels(html) {
  return [...html.matchAll(/<div class="cls">(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
}

describe('one class, however it was typed, is one class', () => {
  test('Urdu and Arabic-Indic digits are the same digits', () => {
    expect(normaliseClasses(['4', '۴', '٤'])).toEqual(['4']);
    expect(classHeading(['4', '۴'], 'ur')).toBe('جماعت 4');
  });

  test('the grade number is read out of free text', () => {
    expect(normaliseClasses(CLASSES_ONE)).toEqual(['4']);
    expect(normaliseClasses(['Class 4', 'grade 4', '4th', 'Class-4', '4 B', 'جماعت ۴'])).toEqual(['4']);
  });

  test('a number written as a word counts too', () => {
    expect(normaliseClasses(['class four', 'Fourth', 'چوتھی جماعت', '4'])).toEqual(['4']);
  });

  test('several real classes are still several, sorted numerically', () => {
    expect(normaliseClasses(CLASSES_MIXED)).toEqual(['3', '4', '5']);
    expect(classHeading(CLASSES_MIXED, 'en')).toBe('Classes 3, 4, 5');
    expect(classHeading(CLASSES_MIXED, 'ur')).toBe('جماعتیں 3، 4، 5');
  });

  test('a class with no number in it keeps its own word', () => {
    expect(normaliseClasses(['KG', 'kg', 'Prep'])).toEqual(['KG', 'Prep']);
  });
});

describe('every class label is written one way per document language', () => {
  test.each([
    ['5', 'en', 'Class 5'],
    ['Grade 5', 'en', 'Class 5'],
    ['class 5', 'en', 'Class 5'],
    ['جماعت ۴', 'en', 'Class 4'],
    ['5th', 'en', 'Class 5'],
    ['Class 4', 'ur', 'جماعت 4'],
    ['Grade 5', 'ur', 'جماعت 5'],
    ['۴', 'ur', 'جماعت 4'],
    ['KG', 'en', 'Class KG'],
    ['', 'ur', ''],
  ])('classLabel(%p, %p) -> %p', (input, lang, expected) => {
    expect(classLabel(input, lang)).toBe(expected);
  });
});

describe('the report document', () => {
  test('Urdu hero names one class, not "4، ۴"', () => {
    const text = textOf(renderHtml(reportData('ur')));
    expect(text).toContain('جماعت 4');
    expect(text).not.toContain('جماعتیں');
  });

  test('one class: the roster does not repeat it on every row, and no typed spelling survives', () => {
    ['ur', 'en'].forEach((lang) => {
      const html = renderHtml(reportData(lang));
      expect(rowLabels(html)).toEqual([]);
      const text = textOf(html);
      ['Grade 4', 'class 4', '4th', 'Class-4', '۴', '٤'].forEach((typed) => expect(text).not.toContain(typed));
    });
  });

  test('several classes: every row carries its class in the document\'s one format', () => {
    const en = rowLabels(renderHtml(reportData('en', { classes: CLASSES_MIXED })));
    expect(en).toHaveLength(12);
    en.forEach((l) => expect(l).toMatch(/^Class [345]$/));
    const ur = rowLabels(renderHtml(reportData('ur', { classes: CLASSES_MIXED })));
    expect(ur).toHaveLength(12);
    ur.forEach((l) => expect(l).toMatch(/^جماعت [345]$/));
  });
});

describe('the text fallback roster follows the same rule', () => {
  const SHARE = {
    id: 'sc-1', code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 't1', teacher_name: 'Teacher',
    topic: 'Fractions', language: 'en', report_sent_at: null,
  };
  function stub(classes) {
    const sessions = classes.map((c, i) => ({
      id: `s${i}`, student_id: `k${i}`, student_name: `Child ${i + 1}`, student_class: c, status: 'completed',
      total_questions_answered: 4, correct_answers: 2, mastery_percentage: 50, completed_at: '2026-09-20T08:00:00Z',
    }));
    supabase.from.mockImplementation((table) => {
      const single = {
        quiz_share_codes: SHARE,
        users: { phone_number: '920000000000', preferred_language: 'en' },
        quizzes: { quiz_source: 'video', meta: {}, language: 'en', subject: 'maths', grade: null },
      }[table] || null;
      const list = table === 'quiz_sessions' ? sessions : [];
      const chain = {};
      ['select', 'eq', 'in', 'is', 'update', 'order', 'limit'].forEach((m) => { chain[m] = () => chain; });
      chain.maybeSingle = async () => ({ data: single, error: null });
      chain.then = (resolve, reject) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
      return chain;
    });
  }
  const summary = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');

  beforeEach(() => { jest.clearAllMocks(); });

  test('several classes: "(Class 5)", never the spelling the child typed', async () => {
    stub(['Grade 5', 'class 4', '۵']);
    await report.generate('sc-1', { reason: 'requested', force: true });
    const text = summary();
    expect(text).toContain('Classes 4, 5');
    expect(text).toContain('(Class 5)');
    expect(text).toContain('(Class 4)');
    expect(text).not.toMatch(/\((Grade 5|class 4|۵)\)/);
  });

  test('one class: named once at the top, not after every child', async () => {
    stub(['4', 'Class 4', '۴']);
    await report.generate('sc-1', { reason: 'requested', force: true });
    const text = summary();
    expect(text).toContain('Class 4');
    expect(text).not.toMatch(/Child \d+ \(/);
  });
});
