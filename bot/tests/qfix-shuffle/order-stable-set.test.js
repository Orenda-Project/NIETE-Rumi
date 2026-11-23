'use strict';
/**
 * A resume keeps the sitting's order even when the quiz's served set has changed since the start (web_quiz_order_seed).
 *
 * The served set can change under an open sitting: an answer-key hold set or cleared (quiz_key_hold_on_disagree filters
 * loadQuestions), a quiz edited in the evening. The resume then draws the order again over a different list. When the
 * order was a shuffle of that list, one item leaving or joining reordered nearly all the rest: of 2,000 simulated
 * 15-item sittings with one item gone, 0.2% kept their remaining sequence. Nothing was re-asked (the page skips answered
 * ids), but the child met their unanswered questions in a new order after a reload. Each question's place is now a rank
 * by a hash of the sitting's seed and the question's own id, so the questions both lists share keep their sequence.
 *
 * Runs the real service (start, then resume); Supabase is the only fake.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Pulse = require('../../shared/services/quiz/web-quiz-pulse');
const WQ = require('../../shared/services/quiz/web-quiz.service');
const OrderSeed = require('../../shared/services/quiz/web-quiz-order-seed');
const Render = require('../../shared/services/quiz/video-quiz-render.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-99999999999${n}`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

const single = (n) => ({
  id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n, question_text: `Which part is number ${n}?`,
  option_a: `Root ${n}`, option_b: `Leaf ${n}`, option_c: `Stem ${n}`, option_d: `Flower ${n}`, correct_option: 'B',
  explanation: `Because ${n}`, option_feedback: {}, media: {}, render_pattern: 'P1',
});
const NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(single);
const CHILDREN = ['Sara Testwala', 'Ali Testwala', 'Hina Testwala', 'Omar Testwala', 'Zoya Testwala'];

let db;
function world(questions) {
  db = {
    app_settings: [{ key: 'web_quiz_enabled', value: true }, { key: 'web_quiz_order_seed', value: true }],
    quiz_share_codes: [{ id: SC, code: 'ORDER2', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
      topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
      parent_share_code_id: null, uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: questions.map((q) => ({ ...q })),
    quiz_sessions: [], students: [], quiz_answers: [],
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
});
afterAll(() => { process.env = SAVED; });

const play = (name) => WQ.startSession({ code: 'ORDER2', new: { name, force: true } });
const resume = (st) => WQ.startSession({ code: 'ORDER2', resume_st: st });

describe('a resume after the served set changed keeps the sequence of the questions both lists share', () => {
  test('one item leaves the quiz between start and resume (a hold set): the rest keep their order, for every child', async () => {
    world(NINE.slice(0, 8));
    const starts = [];
    for (const name of CHILDREN) starts.push(await play(name));
    const gone = qid(3);
    db.quiz_questions = db.quiz_questions.filter((q) => q.id !== gone);
    for (const a of starts) {
      const again = await resume(a.st);
      expect(again.order.q).toEqual(a.order.q.filter((id) => id !== gone));
    }
  });

  test('one item joins the quiz between start and resume (a hold cleared): the questions of the start keep their order', async () => {
    world(NINE.slice(0, 8));
    const starts = [];
    for (const name of CHILDREN) starts.push(await play(name));
    db.quiz_questions.push({ ...NINE[8] });
    for (const a of starts) {
      const again = await resume(a.st);
      expect(again.order.q).toContain(qid(9));
      expect(again.order.q.filter((id) => id !== qid(9))).toEqual(a.order.q);
    }
  });

  test('an unchanged set: the resume is the start, options included; a re-sit is a new order', async () => {
    world(NINE.slice(0, 8));
    const a = await play('Sara Testwala');
    expect(await resume(a.st).then((r) => r.order)).toEqual(a.order);
    const seen = new Set([JSON.stringify(a.order.q)]);
    for (const name of CHILDREN.slice(1)) seen.add(JSON.stringify((await play(name)).order.q));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('the question rank itself', () => {
  const ids = NINE.slice(0, 8).map((q) => q.id);
  const rows = NINE.slice(0, 8);
  const pay = rows.map((r) => ({ options: ['A', 'B', 'C', 'D'].map((slot) => ({ slot, text: r[`option_${slot.toLowerCase()}`] })) }));

  test('every question is first about equally often over many sittings (no question favoured by its id)', () => {
    const first = new Map(ids.map((id) => [id, 0]));
    const N = 4000;
    for (let k = 0; k < N; k += 1) {
      const { order } = OrderSeed.sittingOrder(rows, pay, `session-${k}`);
      first.set(order.q[0], first.get(order.q[0]) + 1);
    }
    for (const n of first.values()) {
      expect(n).toBeGreaterThan((N / ids.length) * 0.8);
      expect(n).toBeLessThan((N / ids.length) * 1.2);
    }
  });

  test('the option order is unchanged: each item\'s slots are shuffled from hash32(seed|external_id), as before', () => {
    const before = (slots, seed) => {
      const rnd = Render.mulberry32(seed);
      const out = slots.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    for (const sid of ['s-1', 's-2', 's-3']) {
      const { order, seed } = OrderSeed.sittingOrder(rows, pay, sid);
      expect(seed).toBe(OrderSeed.seedOf(sid));
      rows.forEach((r) => expect(order.o[r.id]).toEqual(before(['A', 'B', 'C', 'D'], Render.hash32(`${seed}|${r.external_id}`))));
    }
  });
});
