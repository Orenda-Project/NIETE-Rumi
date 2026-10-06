'use strict';
/**
 * The quiz is written from the SOURCE of the version the teacher was served — a
 * v8 slide script, or a v9 lesson plan that exists only as HTML. generate()
 * against the real store (only supabase mocked) and the real digest picker.
 *
 *  - a v9 version whose HTML was ingested reaches the author as the lesson text;
 *  - a version with no source fails `source_missing` as before, and now SAYS which
 *    source was missing (v9 HTML not ingested vs a v8 slide script missing) — in
 *    the log and on the quiz row — instead of one reason for two different states.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/lp-quiz-digest.service', () => ({
  ...jest.requireActual('../../bot/shared/services/quiz/lp-quiz-digest.service'),
  run: jest.fn().mockRejectedValue(new Error('stop after the digest call')),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const V9 = require('../../bot/shared/services/quiz/lp-v9-html-source');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { EN } = require('./fixtures/lp-v9-html');

const LESSON = 'grade_2_math_ch6_seg3';
const quizFor = (versionStamp) => ({
  id: 'q-9', teacher_id: 'u-9', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Sharing', subject: 'maths',
  language: 'en', status: 'generating', grade: '2',
  meta: { lessons: [{ lesson_id: LESSON, version_stamp: versionStamp, content_hash: 'c0ffee000001' }], lesson_date: '2026-10-05' },
});

function install(quiz, sourceRows) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: quiz.id }] } : { data: [quiz] }),
    users: { data: [{ id: 'u-9', phone_number: '920000000009', preferred_language: 'en', name: 'Test Teacher' }] },
    niete_lp_asset_sources: { data: sourceRows },
  }));
}

const updatesOf = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((c) => c[1]);

beforeEach(() => { jest.clearAllMocks(); });

test('a v9 lesson whose HTML was ingested: the author is given the lesson text of THAT version', async () => {
  const slideScript = V9.toSlideScript(EN, { lessonId: LESSON });
  install(quizFor('ch37_2Oct'), [{
    asset_id: 'a-9', lesson_id: LESSON, version_stamp: 'ch37_2Oct', content_hash: 'c0ffee000001',
    slide_script: slideScript, source_url: `lp/v9/html/${LESSON}/c0ffee000001.html`, verified: 'v9_html',
  }]);
  const r = await Gen.process('q-9', {});
  expect(r.reason).toBe('model_failed'); // stopped deliberately, one step past the source
  const q = supabase.from.callsFor('niete_lp_asset_sources')[0];
  expect(q).toEqual(expect.arrayContaining([['eq', 'version_stamp', 'ch37_2Oct'], ['eq', 'content_hash', 'c0ffee000001']]));
  const given = LpDigest.run.mock.calls[0][0].slideScript;
  const text = LpDigest.lessonExcerpts(given);
  expect(text).toContain('Sharing means putting the same number of things in every group.');
  expect(text).toContain('Share 10 pebbles into 2 bags. How many in each bag?');
  expect(text).not.toContain('PRACTICE-ANSWER-SECRET');
});

test('a v9 version with no ingested HTML fails source_missing and says v9_html_missing (ids only)', async () => {
  install(quizFor('ch37_2Oct'), []);
  const r = await Gen.process('q-9', {});
  expect(r).toMatchObject({ failed: true, reason: 'source_missing' });
  expect(logEvent).toHaveBeenCalledWith('lp_quiz.source_missing', {
    quizId: 'q-9', lessonId: LESSON, versionStamp: 'ch37_2Oct', contentHash: 'c0ffee000001', reason: 'v9_html_missing',
  });
  const failed = updatesOf().find((u) => u.status === 'failed');
  expect(failed.meta).toMatchObject({ error: 'source_missing', source_reason: 'v9_html_missing' });
  expect(LpDigest.run).not.toHaveBeenCalled();
});

test('a v8 version with no slide script says v8_script_missing — never falls back to another version', async () => {
  install(quizFor('v8-20260816T1650'), []);
  const r = await Gen.process('q-9', {});
  expect(r).toMatchObject({ failed: true, reason: 'source_missing' });
  expect(logEvent).toHaveBeenCalledWith('lp_quiz.source_missing', expect.objectContaining({ reason: 'v8_script_missing' }));
  expect(updatesOf().find((u) => u.status === 'failed').meta.source_reason).toBe('v8_script_missing');
  // exact version only: the store was asked for the served triple, nothing else
  supabase.from.callsFor('niete_lp_asset_sources').forEach((calls) => {
    expect(calls).toEqual(expect.arrayContaining([['eq', 'version_stamp', 'v8-20260816T1650']]));
  });
});
