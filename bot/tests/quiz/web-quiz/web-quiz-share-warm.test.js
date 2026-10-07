'use strict';
/**
 * A finished child's share pictures are drawn when the quiz FINISHES, not when the scorecard is first looked at.
 *
 * WhatsApp builds a shared link's preview on the child's phone before the message goes. The scorecard warmed its
 * pictures only once it was on screen, and a first draw takes 1-5 s, so a child who tapped Share at once could send
 * the link before its picture existed. Now POST /finish answers as before and then, without holding the answer,
 * draws the card and invite pictures and learns the challenge code's preview facts.
 *
 * Supabase, SQS, Redis, WhatsApp, R2 and the headless-browser renderer are the boundaries and are faked; the
 * routes, the quiz service, the picture service and the og memory run for real.
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

jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })), downloadFromR2: jest.fn(), uploadBuffer: jest.fn(async () => ({})),
  getPresignedUrl: jest.fn(async (u) => u),
}));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));

const express = require('express');
const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Og = require('../../../shared/services/quiz/web-quiz-og');
const Art = require('../../../shared/services/quiz/web-quiz-art');

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
const todayPkt = () => new Date(Math.max(Date.parse(WQ.pktMidnightIso()) + 1000, Date.now() - 60000)).toISOString();

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
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}


let server; let base;
const KEY = { 'x-api-key': 'test-key', 'content-type': 'application/json' };
const SAVED = { ...process.env };
beforeAll(async () => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => { process.env = SAVED; return new Promise((r) => server.close(r)); });

let release;
const draw = (o) => sharp({ create: { width: o.width, height: o.height || o.width, channels: 3, background: '#333748' } }).png().toBuffer();
beforeEach(() => {
  redis.__keys.clear();
  jest.clearAllMocks();
  seed();
  Og._reset();
  Art._resetCache();
  // The renderer is held until the test lets it go: the finish must not wait for it.
  let open; const gate = new Promise((r) => { open = r; });
  release = open;
  htmlToImage.mockImplementation(async (html, o) => { await gate; return draw(o); });
});

async function play() {
  const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Amal Testwala', force: true } });
  await WQ.recordAnswers({ st: s.st, a: [1, 2, 3, 4].map((n) => ({ qid: qid(n), slot: 'B', ms: 2000, seq: n })) });
  return s;
}
const until = async (ok, ms = 4000) => { const t = Date.now(); while (!ok() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); return ok(); };

test('the finish answers at once, then the card and invite pictures are drawn and the challenge code is learned', async () => {
  const s = await play();
  const r = await fetch(`${base}/finish`, { method: 'POST', headers: KEY, body: JSON.stringify({ st: s.st }) });
  expect(r.status).toBe(200);
  const out = await r.json();
  expect(out.art.card).toMatch(/^c\./);
  expect(out.art.invite).toMatch(/^i\./);
  expect(out.challenge_code).toMatch(/^[A-Z0-9]{4,12}$/);
  // The fake has no column defaults: quiz_share_codes.active defaults to true in the database.
  fake.db.quiz_share_codes.forEach((c) => { if (c.active === undefined) c.active = true; });
  // answered while the renderer was still held: at most the first draw has started, none has finished
  expect(htmlToImage.mock.calls.length).toBeLessThanOrEqual(1);
  release();
  expect(await until(() => htmlToImage.mock.calls.length >= 2)).toBe(true);
  expect(await until(() => Boolean(Og.get(out.challenge_code)))).toBe(true);
  // the scorecard's own fetch of the card is now a memory hit: no new draw
  const before = htmlToImage.mock.calls.length;
  await Art.artImage(out.art.card, { size: 'og' });
  expect(htmlToImage.mock.calls.length).toBe(before);
});

test('a finish that fails (too few answers) draws nothing', async () => {
  const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Bilal Testwala', force: true } });
  const r = await fetch(`${base}/finish`, { method: 'POST', headers: KEY, body: JSON.stringify({ st: s.st }) });
  expect(r.status).toBe(409);
  release();
  await new Promise((x) => setTimeout(x, 50));
  expect(htmlToImage).not.toHaveBeenCalled();
});

test('a picture that cannot be drawn never fails the finish', async () => {
  htmlToImage.mockImplementation(async () => { throw new Error('renderer down'); });
  const s = await play();
  const r = await fetch(`${base}/finish`, { method: 'POST', headers: KEY, body: JSON.stringify({ st: s.st }) });
  expect(r.status).toBe(200);
  await new Promise((x) => setTimeout(x, 50));
});
