'use strict';
/**
 * The hub's Challenge card obeys the same rollout gate as the Challenge itself: with web_quiz_challenge a list of
 * teacher ids, only a child of a listed teacher sees the card. Supabase is the faked boundary; the hub, its flags
 * and the gate run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendCtaUrl: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Gate = require('../../../shared/services/quiz/web-quiz-challenge-gate');

const KID = '44444444-4444-4444-8444-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const OTHER_T = '11111111-1111-4111-8111-000000000009';

function seed(flag) {
  Object.assign(supabase, makeFake({
    app_settings: [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_challenge', value: flag }],
    students: [{ id: KID, student_name: 'Sana Testwala', self_reported_class: '3', list_id: LIST, is_active: true }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A' }],
    quiz_share_codes: [], quiz_sessions: [], quizzes: [], video_bank: [],
  }));
  Hub._resetCache();
  Gate._resetCache();
}
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; });

test.each([
  [true, true], ['all', true], [false, false],
])('flag %p → card %p', async (flag, card) => {
  seed(flag);
  expect(Boolean((await Hub.hub(T.signHub([KID]))).challenge)).toBe(card);
});

test('a list: the card only for a child of a listed teacher', async () => {
  seed([TEACHER]);
  expect((await Hub.hub(T.signHub([KID]))).challenge).toMatchObject({ on: true });
  seed([OTHER_T]);
  expect((await Hub.hub(T.signHub([KID]))).challenge).toBeNull();
});
