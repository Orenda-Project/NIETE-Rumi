'use strict';
/**
 * bd-dflr7 — the LP-extraction worker stored only a 500-char excerpt + the
 * parsed structured JSON, never the full extracted text. The uploaded-LP
 * fidelity path reads `coaching_sessions.lesson_plan_text`, so it was always
 * null. buildCompletedPayload now carries the full extracted text.
 */
const Worker = require('../../bot/workers/lesson-plan-extraction.worker');

describe('LessonPlanExtractionWorker.buildCompletedPayload (bd-dflr7)', () => {
  test('includes the full extracted text as lesson_plan_text', () => {
    const p = Worker.buildCompletedPayload({
      excerpt: 'first 500 chars…',
      structuredData: { subject: 'Maths' },
      wordCount: 320,
      extractedText: 'THE FULL LESSON PLAN TEXT that fidelity needs, many paragraphs…',
      normalizedFormat: 'pdf',
    });
    expect(p.lesson_plan_text).toBe('THE FULL LESSON PLAN TEXT that fidelity needs, many paragraphs…');
    expect(p.lesson_plan_excerpt).toBe('first 500 chars…');
    expect(p.lesson_plan_structured).toEqual({ subject: 'Maths' });
    expect(p.lesson_plan_extraction_status).toBe('completed');
    expect(p.lesson_plan_word_count).toBe(320);
    expect(p.lesson_plan_format).toBe('pdf');
  });

  test('null extractedText → lesson_plan_text null (no crash)', () => {
    const p = Worker.buildCompletedPayload({ excerpt: '', structuredData: null, wordCount: 0, extractedText: null, normalizedFormat: 'pdf' });
    expect(p.lesson_plan_text).toBeNull();
  });
});
