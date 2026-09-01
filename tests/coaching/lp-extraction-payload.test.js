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

/**
 * bd-5knlj — extraction can land AFTER analysis (the queue races: analysis is
 * queued at upload time, extraction runs in the background). When it does, the
 * fidelity section must be recomputed or the uploaded plan is silently useless.
 */
describe('maybeRecomputeFidelity hook (bd-5knlj)', () => {
  test('delegates to the recompute service, non-throwing', async () => {
    let called = null;
    const res = await Worker.maybeRecomputeFidelity('cs-7', {
      recompute: async (sid) => { called = sid; return { recomputed: true }; },
    });
    expect(called).toBe('cs-7');
    expect(res.recomputed).toBe(true);
  });
  test('a recompute crash never propagates', async () => {
    const res = await Worker.maybeRecomputeFidelity('cs-7', {
      recompute: async () => { throw new Error('boom'); },
    });
    expect(res.recomputed).toBe(false);
  });
});
