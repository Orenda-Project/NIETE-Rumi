'use strict';
/**
 * bd-ehz254.14: a teacher's own run of a quiz (the preview; quiz_sessions.user_id = the teacher) has no share card.
 * web-quiz-art's cardFacts refuses a user_id session (not_found), so a card id handed out at its finish could never
 * be drawn: the finish warm logged 'share picture not drawn at finish' (prod 13 Nov: 25 in 24 h, one per teacher run)
 * and the shared ?a= link previewed with no picture. The finish names no card for it; a child's finish still does.
 * Supabase, Redis, SQS and the senders are the boundaries and are faked; the service and the art ids run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Art = require('../../../shared/services/quiz/web-quiz-art');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

function seed() {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
      topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
      parent_share_code_id: null, uses_count: 0, created_at: new Date(Date.now() - 3600000).toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: [1, 2, 3].map((n) => ({
      id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n, question_text: `Question ${n}`,
      option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null, correct_option: 'B', explanation: `Because ${n}`, media: {}, render_pattern: 'P1',
    })),
    quiz_sessions: [],
    students: [],
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

async function playToFinish(start) {
  const s = await WQ.startSession({ code: 'AB12CD', ...start });
  for (const n of [1, 2, 3]) await WQ.recordAnswers({ st: s.st, a: [{ qid: qid(n), slot: 'B', ms: 1000 }] });
  return { s, out: await WQ.finishSession({ st: s.st }) };
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  seed();
});
afterAll(() => { process.env = SAVED; });

describe("a teacher's own run has no share card (bd-ehz254.14)", () => {
  test("the teacher's finish names no card picture id", async () => {
    const { out } = await playToFinish({ p: T.signPreview({ shareCodeId: SC, teacherUserId: TEACHER }) });
    expect(out.score).toMatchObject({ correct: 3, total: 3 });
    expect(out.art.card).toBeNull();
  });

  test("a child's finish still names their card", async () => {
    const { s, out } = await playToFinish({ new: { name: 'Sana Example', force: true } });
    expect(Art.parseArtId(out.art.card)).toEqual({ kind: 'c', ref: T.verify(s.st, 's').sid });
  });
});
