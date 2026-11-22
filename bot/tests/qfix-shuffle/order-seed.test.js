'use strict';
/**
 * Each sitting its own order (web_quiz_order_seed). Today every child on a quiz sees one question order and one
 * option order, and a re-sit serves the same again, a few minutes after the answers were shown. With the switch on,
 * the session start answers with the sitting's own order: the questions of the served set re-ordered, and the options
 * of every item whose meaning does not live in its positions re-ordered by slot. A resume gets the same order back; a
 * re-sit gets a new one. Answers are slots, so the score is the same whatever the order.
 *
 * Runs the real service (start, resume, answers, finish, pulse); Supabase is the only fake.
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
const { logEvent } = require('../../shared/utils/structured-logger');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Pulse = require('../../shared/services/quiz/web-quiz-pulse');
const WQ = require('../../shared/services/quiz/web-quiz.service');
const { orderForSession } = require('../../shared/services/quiz/video-quiz.service');
const Render = require('../../shared/services/quiz/video-quiz-render.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-99999999999${n}`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

const single = (n, extra = {}) => ({
  id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n, question_text: `Which part is number ${n}?`,
  option_a: `Root ${n}`, option_b: `Leaf ${n}`, option_c: `Stem ${n}`, option_d: `Flower ${n}`, correct_option: 'B',
  explanation: `Because ${n}`, option_feedback: {}, media: {}, render_pattern: 'P1', ...extra,
});
const QUESTIONS = [
  single(1, { media: { display_order: [2, 0, 3, 1] } }),   // a stored WhatsApp order: the web still gives each sitting its own
  single(2), single(3), single(4),
  // true/false: the page draws ✓ on the first button and ✗ on the second, so the order is the meaning
  single(5, { option_c: null, option_d: null, correct_option: 'A',
    media: { web: { v: 2, type: 'tf', key: 'A', stem: 'A leaf makes food.', options: [{ slot: 'A', text: 'True' }, { slot: 'B', text: 'False' }] } } }),
  // "All of the above" belongs last
  single(6, { option_d: 'All of the above', correct_option: 'D' }),
  // an ordering item: the child rebuilds the sequence; the key is the order
  single(7, { option_d: null, correct_option: 'A',
    media: { web: { v: 2, type: 'order', key: 'C,A,B', stem: 'Put the steps in order.', options: [{ slot: 'A', text: 'Water' }, { slot: 'B', text: 'Grow' }, { slot: 'C', text: 'Plant' }] } } }),
  // a P5 grid: the pictures are already numbered on one image
  single(8, { render_pattern: 'P5' }),
];
const KEY = { 1: 'B', 2: 'B', 3: 'B', 4: 'B', 5: 'A', 6: 'D', 7: 'C,A,B', 8: 'B' };
const PINNED = [5, 6, 7, 8].map(qid);
const SHUFFLED = [1, 2, 3, 4].map(qid);

let fake;
let db;
function world({ seed }) {
  db = {
    app_settings: [{ key: 'web_quiz_enabled', value: true }, ...(seed ? [{ key: 'web_quiz_order_seed', value: true }] : [])],
    quiz_share_codes: [{ id: SC, code: 'ORDER1', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
      topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
      parent_share_code_id: null, uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: QUESTIONS.map((q) => ({ ...q })),
    quiz_sessions: [], students: [], quiz_answers: [],
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

const play = (name) => WQ.startSession({ code: 'ORDER1', new: { name, force: true } });
const allRight = (st) => WQ.recordAnswers({ st, a: Object.entries(KEY).map(([n, slot]) => ({ qid: qid(Number(n)), slot })) });
const started = () => logEvent.mock.calls.filter(([name]) => name === 'web_quiz.session_started').map(([, d]) => d);

describe('switch on: each sitting its own order', () => {
  beforeEach(() => world({ seed: true }));

  test('the start reply carries the sitting order: the same served set, every shuffleable item a permutation of its slots, pinned items left out', async () => {
    const a = await play('Sara Testwala');
    expect(a.order).toBeDefined();
    expect([...a.order.q].sort()).toEqual(QUESTIONS.map((q) => q.id).sort());
    for (const id of SHUFFLED) expect([...a.order.o[id]].sort()).toEqual(['A', 'B', 'C', 'D']);
    for (const id of PINNED) expect(a.order.o[id]).toBeUndefined();
    const ev = started().pop();
    expect(Number.isInteger(ev.order_seed)).toBe(true);
    expect(ev.pinned_n).toBe(4);
  });

  test('two children on one quiz sit different orders', async () => {
    const orders = [];
    for (const name of ['Sara Testwala', 'Ali Testwala', 'Hina Testwala']) orders.push(JSON.stringify((await play(name)).order));
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  test('a resume gets its own order back; a re-sit after finishing gets a new one; the score is the same', async () => {
    const a = await play('Sara Testwala');
    const again = await WQ.startSession({ code: 'ORDER1', resume_st: a.st });
    expect(again.order).toEqual(a.order);
    await allRight(a.st);
    const fin1 = await WQ.finishSession({ st: a.st });
    // re-sit: "play again" as the same child (the page's from_st)
    const seen = new Set([JSON.stringify(a.order)]);
    let st = a.st;
    let fin2;
    for (let k = 0; k < 2; k += 1) {
      const b = await WQ.startSession({ code: 'ORDER1', from_st: st });
      seen.add(JSON.stringify(b.order));
      await allRight(b.st);
      fin2 = await WQ.finishSession({ st: b.st });
      st = b.st;
    }
    expect(seen.size).toBeGreaterThan(1);
    const pct = (f) => (f.result || f).pct;
    expect(pct(fin2)).toBe(pct(fin1));
    expect(db.quiz_answers.every((r) => r.is_correct === true)).toBe(true);
    expect(db.quiz_answers.map((r) => r.selected_option).filter((s) => s === 'C,A,B')).toHaveLength(3);
  });

  test('a right answer in the pulse names its question, so each classmate reads it under their own number', async () => {
    const a = await play('Sara Testwala');
    const b = await play('Ali Testwala');
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(3), slot: 'B' }] });
    const rec = await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(1), slot: 'A' }], since: 0 });
    expect(rec.pulse).toEqual([{ first: 'Sara', qn: 3, qid: qid(3), at: expect.any(Number) }]);
  });
});

describe('switch off: today, byte for byte', () => {
  beforeEach(() => world({ seed: false }));

  test('no order in the start reply, no seed in the event, the pulse as today', async () => {
    const a = await play('Sara Testwala');
    expect(a).not.toHaveProperty('order');
    const again = await WQ.startSession({ code: 'ORDER1', resume_st: a.st });
    expect(again).not.toHaveProperty('order');
    expect(started().pop()).not.toHaveProperty('order_seed');
    const b = await play('Ali Testwala');
    await WQ.recordAnswers({ st: a.st, a: [{ qid: qid(3), slot: 'B' }] });
    const rec = await WQ.recordAnswers({ st: b.st, a: [{ qid: qid(1), slot: 'A' }], since: 0 });
    expect(rec.pulse).toEqual([{ first: 'Sara', qn: 3, at: expect.any(Number) }]);
  });

  test('seed-less callers (WhatsApp card, PDF, transcript card) keep the order they have today', () => {
    const rows = QUESTIONS.map((q) => ({ ...q }));
    expect(orderForSession(rows).map((q) => q.id)).toEqual(QUESTIONS.map((q) => q.id));
    expect(Render.displayOrder(rows[0], Render.optionLabels(rows[0]))).toEqual([2, 0, 3, 1]);
    expect(Render.displayOrder(rows[1], Render.optionLabels(rows[1]))).toEqual(Render.displayOrder({ ...rows[1] }, Render.optionLabels(rows[1])));
  });
});

describe('options whose meaning is their place stay put', () => {
  const OrderSeed = require('../../shared/services/quiz/web-quiz-order-seed');
  const pay = (texts, extra = {}) => ({ options: texts.map((text, k) => ({ slot: 'ABCD'[k], text })), ...extra });
  const row = (texts) => ({ id: 'x', render_pattern: 'P1', option_a: texts[0], option_b: texts[1], option_c: texts[2] || null, option_d: texts[3] || null, correct_option: 'A' });

  test.each([
    [['آم', 'کیلا', 'دونوں']],
    [['آم', 'کیلا', 'سیب', 'ان میں سے کوئی بھی نہیں۔']],
    [['آم', 'کیلا', 'سیب', 'کوئی نہیں']],
    [['آم', 'کیلا', 'سیب', 'مندرجہ بالا تمام']],
    [['Mango', 'Banana', 'Apple', 'None of the above']],
  ])('%j is pinned', (texts) => {
    expect(OrderSeed.pinReason(row(texts), pay(texts))).toBe('anchored');
  });

  test.each([
    [['دونوں کی آواز مختلف ہے', 'آم', 'کیلا']],
    [['سب سے بڑا', 'آم', 'کیلا']],
    [['"Gopi, you will iron all of these clothes," said Master Sahab.', 'b', 'c']],
  ])('%j moves', (texts) => {
    expect(OrderSeed.pinReason(row(texts), pay(texts))).toBe(null);
  });

  test('true/false, ordering, matching and listen items are pinned by kind', () => {
    for (const type of ['tf', 'order', 'match', 'label', 'listen']) expect(OrderSeed.pinReason(row(['a', 'b', 'c']), pay(['a', 'b', 'c'], { type }))).toBe('kind');
  });
});

