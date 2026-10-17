'use strict';
/**
 * The join's completion line names the child by the keyed reference (kid, from the merge-folded id) and the quiz by
 * its key (qk) — never the raw child id, the raw quiz id or the share code id (a quiz id is never logged beside a kid).
 */
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([]),
  remember: jest.fn(),
  touch: jest.fn().mockResolvedValue(undefined),
  normalisePhone: (p) => String(p || '').replace(/\D/g, ''),
}));
jest.mock('../../shared/services/quiz/video-quiz.service', () => ({
  startSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  scheduleForShareCode: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/services/quiz/web-quiz-identity-roster', () => ({
  canonicalStudentId: jest.fn(),
}));

const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const VideoQuiz = require('../../shared/services/quiz/video-quiz.service');
const Roster = require('../../shared/services/quiz/web-quiz-identity-roster');
const Share = require('../../shared/services/quiz/video-quiz-share.service');
const { kid, qk } = require('../../shared/services/quiz/web-quiz-kid');

const SC_ID = '11111111-1111-4111-8111-111111111111';
const QUIZ_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const CANON_ID = '44444444-4444-4444-8444-444444444444';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PHONE = '92' + '000000' + '4321';

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };

async function join() {
  const handled = await Share.handleJoinFlowReply(PHONE, `vqjoin:${SC_ID}`, { student_name: 'Sana Testwala', student_class: '4' });
  await flush();
  expect(handled).toBe(true);
  const calls = logEvent.mock.calls.filter(([e]) => e === 'video_quiz.join_flow_completed');
  expect(calls).toHaveLength(1);
  return calls[0][1];
}

function noRawIds(payload) {
  expect(payload).not.toHaveProperty('studentId');
  expect(payload).not.toHaveProperty('quizId');
  expect(payload).not.toHaveProperty('shareCodeId');
  expect(JSON.stringify(payload)).not.toMatch(UUID);
}

beforeEach(() => {
  jest.clearAllMocks();
  const chain = {
    select: () => chain, eq: () => chain,
    maybeSingle: async () => ({
      data: { id: SC_ID, quiz_id: QUIZ_ID, video_id: 'v1', teacher_user_id: 'u1', teacher_name: 'Teacher', topic: 'Plants', language: 'en' },
    }),
  };
  supabase.from.mockImplementation(() => chain);
});

test('the child by the kid of the merge-folded id, the quiz by qk — no raw ids', async () => {
  StudentIdentity.remember.mockResolvedValue({ id: STUDENT_ID });
  Roster.canonicalStudentId.mockResolvedValue(CANON_ID);
  const ev = await join();
  expect(Roster.canonicalStudentId).toHaveBeenCalledWith(STUDENT_ID);
  expect(ev.kid).toBe(kid(CANON_ID));
  expect(ev.kid).toMatch(/^[0-9a-f]{16}$/);
  expect(ev.qk).toBe(qk(QUIZ_ID));
  expect(ev.qk).toMatch(/^[0-9a-f]{10}$/);
  noRawIds(ev);
  // the child's quiz started before the line, as today
  expect(VideoQuiz.startSession).toHaveBeenCalledTimes(1);
});

test('the fold returns nothing → kid of the child id itself', async () => {
  StudentIdentity.remember.mockResolvedValue({ id: STUDENT_ID });
  Roster.canonicalStudentId.mockResolvedValue(null);
  const ev = await join();
  expect(ev.kid).toBe(kid(STUDENT_ID));
  expect(ev.kid).toMatch(/^[0-9a-f]{16}$/);
  expect(ev.qk).toBe(qk(QUIZ_ID));
  noRawIds(ev);
});

test('the fold throws → kid of the child id itself, and the join still completes', async () => {
  StudentIdentity.remember.mockResolvedValue({ id: STUDENT_ID });
  Roster.canonicalStudentId.mockRejectedValue(new Error('db down'));
  const ev = await join();
  expect(ev.kid).toBe(kid(STUDENT_ID));
  expect(ev.qk).toBe(qk(QUIZ_ID));
  noRawIds(ev);
});

test('no child row → kid null, still no raw ids', async () => {
  StudentIdentity.remember.mockResolvedValue(null);
  Roster.canonicalStudentId.mockResolvedValue(CANON_ID);
  const ev = await join();
  expect(ev.kid).toBeNull();
  expect(ev.qk).toBe(qk(QUIZ_ID));
  noRawIds(ev);
});
