'use strict';
/**
 * web_quiz_order_seed_pct on an evening round: a link in the pct arm plays exactly as with web_quiz_order_seed on (the
 * child's own 5 + 2, seeded), at start, answers, finish and resume alike; a link out of the arm, with
 * web_quiz_evening_round off, plays the round as an ordinary quiz (today's reply). The arm is the LINK's
 * (OrderSeed.onFor -> HubFlags.inPct), read from the session's share_code_id on every path.
 *
 * Runs the real service; Supabase is the fake at the boundary. The fixture is the evening round's own
 * (bot/tests/qfix-class-link/round-sitting.test.js), with the pct row in place of the global switch.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => false,
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Pulse = require('../../shared/services/quiz/web-quiz-pulse');
const T = require('../../shared/services/quiz/web-quiz-token');
const Recall = require('../../shared/services/quiz/web-quiz-evening-round-recall');
const WQ = require('../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-1111111111e1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const DAY = '2026-11-24';
const KEY = `${CLASS}|${DAY}`;
const ROUND_Q = '22222222-2222-4222-8222-2222222222e1';
const ROUND_SC = '33333333-3333-4333-8333-3333333333e1';
const PLAIN_Q = '22222222-2222-4222-8222-2222222222e2';
const PLAIN_SC = '33333333-3333-4333-8333-3333333333e2';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const SANA = 'c0000001-0000-4000-8000-0000000000e3';
const REF = { cl: 'K7Q2MXTRAB', rc: 'RND234' };
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

const lid = (n) => `4e550000-0000-4000-8000-00000000000${n}`;
const rid = (n) => `4ec00000-0000-4000-8000-00000000000${n}`;
const base = (over) => ({
  option_a: 'One', option_b: 'Two', option_c: 'Three', option_d: 'Four', correct_option: 'B', explanation: 'Because.',
  option_feedback: {}, render_pattern: 'P1', ...over,
});
const lesson = (n) => base({
  id: lid(n), quiz_id: ROUND_Q, external_id: `tq:${ROUND_Q}:S1:${n}`, sort_order: n, question_text: `Lesson question ${n}?`,
  media: { round: 'lesson', round_key: KEY, round_ref: REF },
});
// recall items: R1 missed by Ali and Sana (the class's most-missed), R2 and R5 by Zara, the rest by one other child each
const recall = (rank, kids) => base({
  id: rid(rank), quiz_id: ROUND_Q, external_id: `tq:rc${rank}:recall:0a0b0c0${rank}`, sort_order: 100 + rank,
  question_text: `Recall question ${rank}?`, correct_option: 'A',
  media: { round: 'recall', round_key: KEY, round_ref: REF, recall: { of: `0f000000-0000-4000-8000-00000000000${rank}`, rank, kids: kids.map((k) => Recall.kidKey(KEY, k)), chips: [] } },
});
const ROUND_ROWS = [1, 2, 3, 4, 5].map(lesson).concat([
  recall(1, [ALI, SANA]), recall(2, [ZARA]), recall(3, [ALI]), recall(4, [SANA]), recall(5, [ZARA]), recall(6, [ALI]),
]);
const ZARA_SET = [lid(1), lid(2), lid(3), lid(4), lid(5), rid(2), rid(5)];
const ALL_ROUND = ROUND_ROWS.map((q) => q.id);
const PLAIN_ROWS = [1, 2, 3, 4].map((n) => base({ id: `91a10000-0000-4000-8000-00000000000${n}`, quiz_id: PLAIN_Q, external_id: `tq:${PLAIN_Q}:S1:${n}`, sort_order: n, question_text: `Plain question ${n}?`, media: {} }));

let db;
let fake;
function world({ pct = null, round = false } = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_enabled', value: true },
      ...(pct != null ? [{ key: 'web_quiz_order_seed_pct', value: { pct } }] : []),
      ...(round ? [{ key: 'web_quiz_evening_round', value: true }] : [])],
    quiz_share_codes: [
      { id: ROUND_SC, code: 'RND234', quiz_id: ROUND_Q, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher', topic: 'Fractions', language: 'en',
        active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, class_id: CLASS, created_at: ago(0) },
      { id: PLAIN_SC, code: 'PLAIN1', quiz_id: PLAIN_Q, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher', topic: 'Plants', language: 'en',
        active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, class_id: null, created_at: ago(3) },
    ],
    quizzes: [
      { id: ROUND_Q, teacher_id: TEACHER, topic: 'Fractions', grade: '3', subject: 'Maths', language: 'en', quiz_source: 'lp_v8', status: 'ready',
        meta: { source: 'evening_round', class_id: CLASS, round_day: DAY, class_link_code: REF.cl, round_code: REF.rc, share_code_id: ROUND_SC } },
      { id: PLAIN_Q, teacher_id: TEACHER, topic: 'Plants', grade: '3', subject: 'Science', language: 'en', quiz_source: 'transcript', status: 'sent', meta: {} },
    ],
    quiz_questions: [...ROUND_ROWS, ...PLAIN_ROWS].map((q) => ({ ...q, media: JSON.parse(JSON.stringify(q.media)) })),
    students: [{ id: ZARA, student_name: 'Zara Test', self_reported_class: null }, { id: ALI, student_name: 'Ali Test', self_reported_class: null }],
    // Zara finished the teacher's plain quiz three days ago: the class's name chips offer her on the round's code
    quiz_sessions: [{ id: '5e550000-0000-4000-8000-0000000000a1', quiz_id: PLAIN_Q, student_id: ZARA, student_name: 'Zara Test', user_id: null, share_code_id: PLAIN_SC,
      status: 'completed', invited_by_student_id: null, device_ref: 'd-old', created_at: ago(3), completed_at: ago(3), correct_answers: 3, total_questions_answered: 4 },
    { id: '5e550000-0000-4000-8000-0000000000a2', quiz_id: PLAIN_Q, student_id: ALI, student_name: 'Ali Test', user_id: null, share_code_id: PLAIN_SC,
      status: 'completed', invited_by_student_id: null, device_ref: 'd-old2', created_at: ago(3), completed_at: ago(3), correct_answers: 2, total_questions_answered: 4 }],
    quiz_answers: [],
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  HubFlags._resetCache();
  Pulse._reset();
  logEvent.mockClear();
});
afterAll(() => { process.env = SAVED; });

const asZara = (extra = {}) => WQ.startSession({ code: 'RND234', chip: T.chipId(ROUND_SC, ZARA), ...extra });
const answerAll = (st, ids, slot = (id) => (id.startsWith('4ec0') ? 'A' : 'B')) => WQ.recordAnswers({ st, a: ids.map((qid) => ({ qid, slot: slot(qid) })) });
const started = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.session_started').map(([, d]) => d);
const OrderSeed = require('../../shared/services/quiz/web-quiz-order-seed');
const ROUND_BUCKET = HubFlags.bucketOf(HubFlags.ORDER_SEED_PCT_KEY, ROUND_SC);

describe('a round link IN the pct arm (pct 100): the child plays their own 5 + 2, seeded, as with the global switch', () => {
  beforeEach(() => world({ pct: 100 }));

  test('the start reply lists exactly the child\'s 7 qids, and the start event carries the seed', async () => {
    const a = await asZara();
    expect(a.order).toBeDefined();
    expect([...a.order.q].sort()).toEqual([...ZARA_SET].sort());
    expect(started().pop().order_seed).toEqual(expect.any(Number));
  });

  test('answers outside the set are not recorded; finish counts the 7', async () => {
    const a = await asZara();
    const out = await answerAll(a.st, ALL_ROUND);
    expect([...out.recorded].sort()).toEqual([...ZARA_SET].sort());
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(7);
  });

  test('a resume gets the same set and order back', async () => {
    const a = await asZara();
    const again = await WQ.startSession({ code: 'RND234', resume_st: a.st });
    expect(again.order).toEqual(a.order);
  });
});

describe('a round link OUT of the pct arm, web_quiz_evening_round off: an ordinary quiz everywhere', () => {
  // pct = the link's own bucket: bucket < pct is false, so this link is out while lower buckets are in
  beforeEach(() => world({ pct: ROUND_BUCKET }));

  test('the arm is really the link\'s: out at pct = its bucket, in at pct = its bucket + 1', () => {
    expect(OrderSeed.onFor({ orderSeedPct: ROUND_BUCKET }, ROUND_SC)).toBe(false);
    expect(OrderSeed.onFor({ orderSeedPct: ROUND_BUCKET + 1 }, ROUND_SC)).toBe(true);
  });

  test('no order on the page, every item accepted, finish counts what was played', async () => {
    const a = await asZara();
    expect(a.order).toBeUndefined();
    const out = await answerAll(a.st, ALL_ROUND);
    expect(out.recorded).toHaveLength(11);
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(11);
  });
});
