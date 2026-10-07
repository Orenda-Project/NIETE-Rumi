'use strict';
/**
 * A link preview's facts, kept in the bot (one process), so every portal worker can answer a preview fetch
 * without a quiz render. The portal runs several worker processes; a fact one of them learned was invisible to
 * the others, so most preview fetches still waited 2-3 s for the whole quiz.
 *
 *   GET /og/:code   the few fields a preview's head needs (language, topic, question count, class label,
 *                   challenger, picture ids, brand), from memory; on a miss, from one quiz load, then kept.
 *   GET /quiz/:code (every child's page load) teaches it as a side effect.
 *
 * Supabase, SQS, Redis and WhatsApp are the boundaries and are faked; the service and the routes run for real.
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
// The figure engine pulls in openchemlib (ESM); the repo's CJS stand-in lets a figure really draw here.
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
// E2 asks for the quiz's read-aloud clips in the background; publishing has its own suite
// (web-quiz-publish.test.js, network mocked at its edge), so here only the ask is observed.
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Og = require('../../../shared/services/quiz/web-quiz-og');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID_A = '44444444-4444-4444-8444-444444444444';
const KID_B = '55555555-5555-4555-8555-555555555555';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
// A moment that is always "today" in Pakistan, never in the future: the live counts are per PKT day,
// so a fixed "N hours ago" seed stops counting as today for part of every day.
const todayPkt = () => new Date(Date.now() - 60000).toISOString();

let fake;
function seed() {
  const questions = [1, 2, 3, 4].map((n) => ({
    id: qid(n), quiz_id: QUIZ, external_id: `tq:${n}`, sort_order: n,
    question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null,
    correct_option: 'B', explanation: `Because ${n}`,
    option_feedback: { wrong: { 0: 'Roots hold the plant.' } },
    media: n === 1 ? { question_image: 'https://example.org/q1.png', option_images: [{ b64: Buffer.from('jpegbytes').toString('base64') }] } : {},
    render_pattern: 'P1',
  }));
  fake = makeFake({
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: 'sc-old', code: 'OLD111', quiz_id: QUIZ, teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: ago(1), invited_by_student_id: null, parent_share_code_id: null, created_at: ago(800) },
    ],
    quizzes: [{ id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript' }],
    quiz_questions: questions,
    quiz_sessions: [
      // KID_A played on WhatsApp earlier today (has a phone row): a chip, and today's one finisher.
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Example', user_id: null,
        status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75,
        completed_at: todayPkt(), created_at: todayPkt(), invited_by_student_id: null, device_ref: null, parent_phone: '0000', source: 'share_link' },
      // The teacher's own run — never a chip, never on the board.
      { id: 's-t', quiz_id: QUIZ, share_code_id: SC, student_id: null, student_name: 'Ms Example Teacher', user_id: TEACHER,
        status: 'completed', correct_answers: 4, total_questions_answered: 4, mastery_percentage: 100,
        completed_at: ago(19), created_at: ago(19), invited_by_student_id: null },
    ],
    students: [{ id: KID_A, student_name: 'Zara Example', self_reported_class: '3', phone: '0000' }],
    quiz_answers: [],
  });
  let reads = 0;
  Object.assign(supabase, { from: (t) => { reads += 1; return fake.from(t); }, rpc: fake.rpc });
  supabase.__reads = () => reads;
}


let server; let base;
const KEY = { 'x-api-key': 'og-key' };
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'og-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { seed(); Og._reset(); });

const og = async (code) => { const r = await fetch(`${base}/og/${code}`, { headers: KEY }); return { status: r.status, body: await r.json() }; };

test("a child's page load teaches the bot; the preview's facts then come from memory with no database read", async () => {
  expect((await fetch(`${base}/quiz/AB12CD`, { headers: KEY })).status).toBe(200);
  const before = supabase.__reads();
  const r = await og('AB12CD');
  expect(r.status).toBe(200);
  expect(supabase.__reads()).toBe(before);
  expect(r.body.quiz).toEqual({ lang: 'en', topic: 'Parts of a plant', n: 4 });
  expect(r.body.art).toEqual(expect.objectContaining({ class: expect.stringMatching(/^l\./) }));
});

test('a code nobody has opened is learned once (one quiz load), then answered from memory', async () => {
  const first = await og('AB12CD');
  expect(first.status).toBe(200);
  const before = supabase.__reads();
  const again = await og('ab12cd');
  expect(again.status).toBe(200);
  expect(supabase.__reads()).toBe(before);
  expect(again.body).toEqual(first.body);
});

test('the facts carry no question, roster, chip or child (only what a preview head shows)', async () => {
  const r = await og('AB12CD');
  expect(Object.keys(r.body).sort()).toEqual(['art', 'brand', 'challenge', 'cls', 'invited', 'quiz']);
  expect(JSON.stringify(r.body)).not.toMatch(/Zara|Question 1|Root|chips/);
});

test('an expired or unknown code keeps its answer (410 / 404) and is never kept', async () => {
  expect((await og('OLD111')).status).toBe(410);
  expect((await og('NOPE99')).status).toBe(404);
  expect(Og._size()).toBe(0);
});

test('no key: 401', async () => {
  expect((await fetch(`${base}/og/AB12CD`)).status).toBe(401);
});
