'use strict';
/**
 * Picture options a child can tell apart.
 *
 * A video-bank question ("Which picture goes with this one?") offered three near-identical grey
 * bins whose only difference was a small heap on top (glass, food scraps, plastic bags); at 360 px
 * a child could not tell them apart. When a set of picture options is the same picture except for
 * one small region, the page now shows each option cropped to that region, so the difference is
 * the picture. Options that already differ as wholes (an apple, a bus, a cat) are left alone.
 *
 * Supabase is the boundary and is faked; the payload, the media endpoint and sharp run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const qid = (n) => `9999999${n}-9999-4999-8999-999999999999`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();

const S = 170;
/** A grey bin (the same in every option) with a small coloured heap on top. */
async function bin(heap) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    <rect width="${S}" height="${S}" fill="#fff"/>
    <rect x="30" y="55" width="110" height="110" fill="#666"/>
    <rect x="22" y="48" width="126" height="12" fill="#888"/>
    <ellipse cx="85" cy="40" rx="45" ry="14" fill="${heap}"/></svg>`;
  return (await sharp(Buffer.from(svg)).jpeg().toBuffer()).toString('base64');
}
/** Whole different pictures: a big disc, a big bar, a big triangle. */
async function whole(shape) {
  const body = shape === 'disc' ? '<circle cx="85" cy="85" r="70" fill="#e33"/>'
    : shape === 'bar' ? '<rect x="10" y="50" width="150" height="70" fill="#36c"/>'
      : '<polygon points="85,10 160,160 10,160" fill="#2a2"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" fill="#fff"/>${body}</svg>`;
  return (await sharp(Buffer.from(svg)).jpeg().toBuffer()).toString('base64');
}

function row(n, b64s, extra = {}) {
  return {
    id: qid(n), quiz_id: QUIZ, external_id: `vb:${n}`, sort_order: n,
    question_text: 'Which picture goes with this one?', option_a: 'Picture 1', option_b: 'Picture 2', option_c: 'Picture 3', option_d: null,
    correct_option: 'B', explanation: null, option_feedback: null, render_pattern: 'P5',
    media: { question_image: 'https://r2/q.png', option_images: b64s.map((b64, index) => ({ b64, index })) }, ...extra,
  };
}

function seed(questions) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Cleanliness', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Cleanliness', grade: '1', subject: 'General Knowledge', language: 'en', meta: {}, quiz_source: 'video' }],
    quiz_questions: questions,
    quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; });
afterAll(() => { process.env = SAVED; });

/** Share of the picture's pixels that are the heap colour (red-ish). */
async function heapShare(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let p = 0; p < data.length; p += 3) if (data[p] > 170 && data[p + 1] < 90 && data[p + 2] < 90) n += 1;
  return n / (info.width * info.height);
}

describe('near-identical picture options are shown cropped to what differs', () => {
  test('the bins: every option is served zoomed, and the zoomed picture is mostly the heap', async () => {
    const heaps = ['#dd2222', '#22aa22', '#2244dd'];
    seed([row(1, await Promise.all(heaps.map(bin)))]);
    const out = await WQ.getQuiz('AB12CD', {});
    const q = out.quiz.questions[0];
    expect(q.options).toHaveLength(3);
    for (const o of q.options) expect(o.img).toMatch(/[?&]z=1\b/);

    const red = q.options.find((o) => o.slot === 'A');
    const full = await WQ.media('AB12CD', qid(1), { k: 'A' });
    const zoomed = await WQ.media('AB12CD', qid(1), { k: 'A', z: '1' });
    expect(zoomed.bytes).toBeTruthy();
    expect(zoomed.contentType).toMatch(/^image\//);
    // The heap fills a far bigger share of the picture: the difference is now the picture.
    expect(await heapShare(zoomed.bytes)).toBeGreaterThan(3 * (await heapShare(full.bytes)));
    expect(red.img).toContain('k=A');
  });

  test('options that differ as whole pictures are not zoomed', async () => {
    seed([row(2, await Promise.all(['disc', 'bar', 'tri'].map(whole)))]);
    const out = await WQ.getQuiz('AB12CD', {});
    for (const o of out.quiz.questions[0].options) expect(o.img).not.toMatch(/[?&]z=1\b/);
  });

  test('a question about size (tall, big, more…) is never zoomed: the crop would make every option the same size', async () => {
    const heaps = ['#dd2222', '#22aa22', '#2244dd'];
    seed([row(4, await Promise.all(heaps.map(bin)), { question_text: 'Which bin is the TALLEST?' })]);
    const out = await WQ.getQuiz('AB12CD', {});
    for (const o of out.quiz.questions[0].options) expect(o.img).not.toMatch(/[?&]z=1\b/);
  });

  test('a picture that cannot be read never breaks the quiz (no zoom, plain picture)', async () => {
    seed([row(3, ['/9j/4AAQSkZJRgABAQ', '/9j/4AAQSkZJRgABAQ', '/9j/4AAQSkZJRgABAQ'])]);
    const out = await WQ.getQuiz('AB12CD', {});
    for (const o of out.quiz.questions[0].options) expect(o.img).not.toMatch(/[?&]z=1\b/);
    const plain = await WQ.media('AB12CD', qid(3), { k: 'A', z: '1' });
    expect(plain.bytes).toBeTruthy();
  });
});
