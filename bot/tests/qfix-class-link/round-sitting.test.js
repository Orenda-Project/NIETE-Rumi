'use strict';
/**
 * An evening round plays as the child's OWN set (5 lesson items + the 2 recall items whose originals this child
 * missed), never as the whole pool. The set is chosen in the sitting seam (web-quiz.service sittingQuestions), which
 * the start reply's order, the answers and the finish all go through, so the three agree on what the child was asked.
 * The page (wq.js applyOrder) plays only the qids the start reply's order.q lists.
 *   - web_quiz_order_seed on: the child's set in the sitting's seeded order;
 *   - web_quiz_order_seed off (production today), web_quiz_evening_round on: the child's set in the round's own order;
 *   - both off: the round plays as an ordinary quiz everywhere (no order on the page, every item accepted).
 * Any other quiz: today's reply, byte for byte.
 *
 * Runs the real service (start, resume, answers, finish); Supabase is the fake at the boundary.
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
function world({ seed = false, round = false } = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_enabled', value: true },
      ...(seed ? [{ key: 'web_quiz_order_seed', value: true }] : []),
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
    students: [{ id: ZARA, student_name: 'Zara Test', self_reported_class: null }],
    // Zara finished the teacher's plain quiz three days ago: the class's name chips offer her on the round's code
    quiz_sessions: [{ id: '5e550000-0000-4000-8000-0000000000a1', quiz_id: PLAIN_Q, student_id: ZARA, student_name: 'Zara Test', user_id: null, share_code_id: PLAIN_SC,
      status: 'completed', invited_by_student_id: null, device_ref: 'd-old', created_at: ago(3), completed_at: ago(3), correct_answers: 3, total_questions_answered: 4 }],
    quiz_answers: [],
  };
  const fake = makeFake(db);
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

describe.each([
  ['web_quiz_order_seed on', { seed: true, round: false }],
  ['web_quiz_order_seed off, web_quiz_evening_round on', { seed: false, round: true }],
])('a round with %s: the child plays their own 5 + 2', (_label, sw) => {
  beforeEach(() => world(sw));

  test('the start reply lists exactly the child\'s 7 qids (5 lesson + the 2 recall items whose originals they missed)', async () => {
    const a = await asZara();
    expect(a.order).toBeDefined();
    expect([...a.order.q].sort()).toEqual([...ZARA_SET].sort());
  });

  test('answers outside the set are not recorded (as any qid the sitting does not serve); finish counts the 7', async () => {
    const a = await asZara();
    const out = await answerAll(a.st, ALL_ROUND);
    expect([...out.recorded].sort()).toEqual([...ZARA_SET].sort());
    expect([...out.unknown].sort()).toEqual([rid(1), rid(3), rid(4), rid(6)].sort());
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(7);
    expect(fin.review.map((r) => r.qid).sort()).toEqual([...ZARA_SET].sort());
  });

  test('half the child\'s set is enough to finish (need = 4 of 7, not 6 of 11)', async () => {
    const a = await asZara();
    await answerAll(a.st, ZARA_SET.slice(0, 4));
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(4);
  });

  test('a resume gets the same set back', async () => {
    const a = await asZara();
    const again = await WQ.startSession({ code: 'RND234', resume_st: a.st });
    expect(again.order).toEqual(a.order);
  });
});

describe('web_quiz_order_seed off, web_quiz_evening_round on', () => {
  beforeEach(() => world({ seed: false, round: true }));

  test('the round\'s own order (lesson items by sort order, then the recall picks), no option moves, no seed on the start event', async () => {
    const a = await asZara();
    expect(a.order).toEqual({ q: ZARA_SET, o: {} });
    const ev = started().pop();
    expect(ev.order_seed).toBeUndefined();
    expect(ev.pinned_n).toBeUndefined();
  });

  test('any other quiz: the start reply carries no order (today\'s reply), a second start reads its questions no more', async () => {
    const a = await WQ.startSession({ code: 'PLAIN1', new: { name: 'Ali Test', force: true } });
    expect(a.order).toBeUndefined();
    expect(Object.keys(a).sort()).toEqual(['child', 'counted', 'device_ref', 'resume', 'st']);
  });
});

describe('both switches off', () => {
  beforeEach(() => world({ seed: false, round: false }));

  test('a round plays as an ordinary quiz everywhere: no order on the page, every item accepted, finish counts what was played', async () => {
    const a = await asZara();
    expect(a.order).toBeUndefined();
    const out = await answerAll(a.st, ALL_ROUND);
    expect(out.recorded).toHaveLength(11);
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(11);
  });

  test('any other quiz: today\'s reply', async () => {
    const a = await WQ.startSession({ code: 'PLAIN1', new: { name: 'Ali Test', force: true } });
    expect(a.order).toBeUndefined();
  });
});
