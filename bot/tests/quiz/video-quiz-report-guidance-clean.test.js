'use strict';
/**
 * bd-2611 / bd-2612 — the two things a teacher actually reads must be clean.
 *
 * Found by re-rendering the ten largest REAL Rawalpindi class reports
 * (2026-08-09):
 *
 *   bd-2611  4 of 10 "For tomorrow" paragraphs contained literal markdown.
 *            gpt-5.4-mini writes "They think **the** is the word for any
 *            thing"; nothing strips it, so the asterisks reach the teacher in
 *            the PDF. The WhatsApp text fallback is wrong too — WhatsApp bold
 *            is a SINGLE asterisk, so "**the**" is not bold there either.
 *            A prompt instruction is not a fix: the model is free to ignore it.
 *            The strip has to be deterministic.
 *
 *   bd-2612  The roster printed "Grade Grade 3" and "Grade Class 3". Children
 *            type their class freely — "3", "Grade 3", "Class 3", "4 B" — and
 *            the template prefixed "Grade " to all of them.
 */
const path = require('path');

const renderVideoQuizReportHtml = require('../../shared/templates/video-quiz-report.template');
// Required from their true source (not re-exported through
// video-quiz-report.service.js, unlike the main bot's equivalent test) —
// that service transitively requires shared/config/supabase, which exits
// the process when Supabase env vars are absent (this fork's stricter
// config-loading convention). stripEmphasis/classLabel have zero deps, so
// there is nothing to mock by importing them directly.
const { stripEmphasis, classLabel } = require('../../shared/utils/text-format');

const base = {
  topic: 'Using A, An and The', teacherName: 'Humaira', grade: '3',
  started: 14, finished: 9, average: 72,
  hardest: [], unfinished: [], generatedAt: '6 Aug 2026',
};

describe('bd-2611 — guidance reaches the teacher without markup', () => {
  test('strips ** bold around words, keeping the words', () => {
    expect(stripEmphasis('They think **the** is the word for any thing.'))
      .toBe('They think the is the word for any thing.');
  });

  test('strips __ and single _ emphasis too', () => {
    expect(stripEmphasis('write __a__ first')).toBe('write a first');
    expect(stripEmphasis('write _a_ first')).toBe('write a first');
  });

  test('handles the real Urdu paragraph that shipped (RTL + markdown)', () => {
    const real = 'بچوں کو سب سے زیادہ یہ گڈمڈ ہے کہ **لکھا ہوا کام بھی حال ہے**۔';
    const out = stripEmphasis(real);
    expect(out).not.toContain('*');
    expect(out).toContain('لکھا ہوا کام بھی حال ہے');
  });

  test('leaves a genuine asterisk that is not an emphasis pair alone', () => {
    // "3 * 4" is arithmetic a maths guidance line may legitimately contain.
    expect(stripEmphasis('draw 3 * 4 dots')).toBe('draw 3 * 4 dots');
  });

  test('null and empty guidance stay null/empty (the report still sends)', () => {
    expect(stripEmphasis(null)).toBeNull();
    expect(stripEmphasis('')).toBe('');
  });

  test('the rendered report contains no literal ** in the For tomorrow block', () => {
    const html = renderVideoQuizReportHtml({
      ...base,
      students: [],
      guidance: 'They think **the** is for any thing, and **a/an** is special.',
    });
    const block = (html.match(/class="try"[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
    expect(block).toContain('For tomorrow');
    expect(block).not.toContain('**');
  });
});

describe('bd-2612 — the roster names the class the child gave, once', () => {
  test.each([
    ['3', 'Grade 3'],
    ['4', 'Grade 4'],
    ['Grade 3', 'Grade 3'],
    ['grade 3', 'grade 3'],
    ['Class 3', 'Class 3'],
    ['4 B', 'Grade 4 B'],
    ['Grade 4 B', 'Grade 4 B'],
    ['', ''],
    [null, ''],
  ])('classLabel(%p) -> %p', (input, expected) => {
    expect(classLabel(input)).toBe(expected);
  });

  test('a roster row never renders "Grade Grade" or "Grade Class"', () => {
    const html = renderVideoQuizReportHtml({
      ...base,
      guidance: null,
      students: [
        { student_name: 'Fatima Noor', student_class: 'Grade 3', mastery_percentage: 90 },
        { student_name: 'Nabia yasin', student_class: 'Class 3', mastery_percentage: 50 },
        { student_name: 'Mahira', student_class: '3', mastery_percentage: 80 },
      ],
    });
    expect(html).not.toMatch(/Grade\s+Grade/);
    expect(html).not.toMatch(/Grade\s+Class/);
    expect(html).toContain('Grade 3');
  });
});
