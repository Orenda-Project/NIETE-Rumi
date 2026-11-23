'use strict';
/**
 * bd-97daxo.34.3 — a GB grade 1-5 lesson as the source of a quiz (queue #216).
 *
 * GB's K-5 plans are written by the same author as 6-12 (lp612-author.service) and are delivered
 * through 6-12's document send, so each one lands in the 6-12 delivery ledger and is listed in /quiz
 * as an lp612 lesson. But GB keeps its documents in its OWN lane, `gb-lp/{tv}/{lang}/{segment}.lp.json`
 * (gb-lp-serving keyFor), never under `lp612/`. Reading the 6-12 key for a GB lesson found nothing,
 * so every GB K-5 quiz failed "could not open the lesson plan" (source_missing).
 *
 * The rule: a GB lesson (its segment's curriculum is not ICT's, stamped `lane: 'gb'` when the quiz
 * is made, or a GB template version `gb_*` on an older row) is read from gb-lp/; ICT is unchanged.
 */
jest.mock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { downloadFromR2 } = require('../../bot/shared/storage/r2');
const DOC = require('../lp612/__fixtures__/v9_gate_base.lp.json');
const Source = require('../../bot/shared/services/quiz/lp612-quiz-source');

const SEG = 'gb_g3_english_nbf.u02.l04';
beforeEach(() => {
  jest.clearAllMocks();
  downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(DOC)));
});

describe('a GB grade 1-5 lesson is read from GB\'s own lane', () => {
  test('stamped lane gb: the gb-lp/ document of that exact version', async () => {
    const doc = await Source.resolveLessonDoc({ segment_id: SEG, lang: 'en', template_version: 'gb_k5_v9', lane: 'gb' });
    expect(doc).toEqual(DOC);
    expect(downloadFromR2).toHaveBeenCalledWith(`gb-lp/gb_k5_v9/en/${SEG}.lp.json`);
  });

  test('an older quiz row with no lane: a GB template version still reads gb-lp/', async () => {
    await Source.resolveLessonDoc({ segment_id: SEG, lang: 'ur', template_version: 'gb_k5_v10' });
    expect(downloadFromR2).toHaveBeenCalledWith(`gb-lp/gb_k5_v10/ur/${SEG}.lp.json`);
  });

  test('the slide script a GB quiz is written from carries the lesson, in the language delivered', async () => {
    const ss = await Source.resolveSlideScript({ segment_id: SEG, lang: 'ur', template_version: 'gb_k5_v9', lane: 'gb' });
    expect(ss.goal).toBe(DOC.objectives.outcome);
    expect(ss.meta.language).toBe('ur');
  });

  test('an ICT 6-12 lesson is unchanged: lp612/', async () => {
    await Source.resolveLessonDoc({ segment_id: 'grade_9_mathematics.c01.p024-025', lang: 'en', template_version: 'v9.6' });
    expect(downloadFromR2).toHaveBeenCalledWith('lp612/v9.6/en/grade_9_mathematics.c01.p024-025.lp.json');
  });

  test('a GB document that was never stored is no source (source_missing), never a throw', async () => {
    downloadFromR2.mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    await expect(Source.resolveLessonDoc({ segment_id: SEG, lang: 'en', template_version: 'gb_k5_v9', lane: 'gb' })).resolves.toBeNull();
  });
});
