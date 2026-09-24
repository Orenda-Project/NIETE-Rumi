'use strict';
/**
 * R8 lane D task 3.2 — generate() against the REAL slide-script store.
 *
 * lp-quiz-generate.test.js mocks the store by its contract; this one mocks
 * only the network boundary (supabase) under the real store, so the call
 * shape generate() uses is proven against the module lane S shipped: the
 * exact-version key, and the slide script travelling from the row to the digest.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/lp-quiz-digest.service', () => ({
  run: jest.fn().mockRejectedValue(new Error('stop after the digest call')), lessonExcerpts: jest.fn().mockReturnValue(''),
  lessonDrewBlock: jest.fn().mockReturnValue(''),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const SLIDE_SCRIPT = { meta: { lessonId: 'grade_2_math_ch9_seg3' }, goal: 'Add with carrying', bloom: 'apply' };
const QUIZ = {
  id: 'q-1', teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Carrying', subject: 'maths',
  language: 'en', status: 'generating', grade: '2',
  meta: { lessons: [{ lesson_id: 'grade_2_math_ch9_seg3', version_stamp: 'v8-1', content_hash: 'h-1' }], lesson_date: '2026-09-22' },
};

test('the exact served version is looked up, and its slide script reaches the digest', async () => {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: 'q-1' }] } : { data: [QUIZ] }),
    users: { data: [{ id: 'u-1', phone_number: '923001234567', preferred_language: 'en', name: 'Rifat Noor' }] },
    niete_lp_asset_sources: {
      data: [{ asset_id: 'a-1', lesson_id: 'grade_2_math_ch9_seg3', version_stamp: 'v8-1', content_hash: 'h-1', slide_script: SLIDE_SCRIPT, verified: 'upload' }],
    },
  }));
  const r = await Gen.process('q-1', {});
  expect(r.reason).toBe('model_failed');    // stopped deliberately, one step past the store
  const q = supabase.from.callsFor('niete_lp_asset_sources')[0];
  expect(q).toEqual(expect.arrayContaining([
    ['eq', 'lesson_id', 'grade_2_math_ch9_seg3'], ['eq', 'version_stamp', 'v8-1'], ['eq', 'content_hash', 'h-1'],
  ]));
  expect(LpDigest.run.mock.calls[0][0].slideScript).toEqual(SLIDE_SCRIPT);
});
