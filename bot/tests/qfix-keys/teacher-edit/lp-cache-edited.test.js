'use strict';
/**
 * A quiz its teacher edited never donates its rows to another teacher's quiz on the same lesson (lp-quiz-cache
 * eligibleDonor): the edits are that teacher's own choices for their class, and a removed question would hand the next
 * teacher a short quiz. Every other donor check is unchanged.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
const Cache = require('../../../shared/services/quiz/lp-quiz-cache');

const NOW = new Date('2026-11-26T09:00:00Z');
const lesson = { lesson_id: 'L1', version_stamp: 'v3', content_hash: 'h1' };
function donor(meta = {}) {
  return {
    id: 'd1', quiz_source: 'lp_v8', language: 'ur', status: 'sent', created_at: '2026-11-20T09:00:00Z',
    meta: { lessons: [lesson], key_verify: { status: 'clean' }, key_check: { status: 'passed' }, digest: { x: 1 }, question_count: 8, ...meta },
  };
}
const key = Cache.cacheKey({ quiz_source: 'lp_v8', meta: { lessons: [lesson] } }, 'ur');

test('an authored, checked, unedited quiz still donates', () => {
  expect(Cache.eligibleDonor(donor(), key, { now: NOW })).toBe(true);
});

test('a quiz its teacher edited does not', () => {
  expect(Cache.eligibleDonor(donor({ edit_v: 1, teacher_edited: { at: '2026-11-25T10:00:00Z', v: 1, by: 'teacher' } }), key, { now: NOW })).toBe(false);
});
