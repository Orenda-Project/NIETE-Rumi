'use strict';
/**
 * Three share fixes, each behind its own switch (default OFF; off, the answers and the picture keys are today's):
 *
 *   web_quiz_share_first_score   after a practice replay, the card's result is the counted FIRST score (4/6), the one
 *                                the class table and the challenge show, never the replay's (0/6)
 *   web_quiz_share_pic_lang      a share picture asked in the share's language (?l=en|ur) is drawn in it and kept
 *                                apart per language, so an English share never carries the Urdu picture of the same id
 *   web_quiz_share_link_lang_en  an English card's class link says so (&lang=en), short or long, so its preview is English
 *
 * Over HTTP through the real internal router; mocked only at the boundaries (Supabase, Redis, R2, the renderer, loggers).
 */
jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  const cmd = (type) => jest.fn().mockImplementation((input) => ({ type, input }));
  return {
    __send: send,
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    GetObjectCommand: cmd('get'), HeadObjectCommand: cmd('head'), PutObjectCommand: cmd('put'),
    DeleteObjectCommand: cmd('delete'), ListObjectsV2Command: cmd('list'),
  };
});
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../../shared/services/quiz/web-quiz-video-thumb', () => ({ thumb: jest.fn(async () => null), VERSION: '1' }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
  };
});

const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const S3 = require('@aws-sdk/client-s3');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const T = require('../../../shared/services/quiz/web-quiz-token');

const KEY = { 'x-api-key': 'share-key', 'content-type': 'application/json' };
const FIRST = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const REPLAY = '1a2b3c4d-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const idOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 8);

const BASE = [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value: true }, { key: 'web_quiz_share_data', value: true },
  { key: 'web_quiz_share_card_a', value: true }, { key: 'web_quiz_share_short', value: true }];
function seed({ on = [], lang = 'en' } = {}) {
  const fake = makeFake({
    app_settings: [...BASE, ...on.map((key) => ({ key, value: true }))],
    quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', teacher_user_id: 't-1', topic: 'Proper Fraction', language: lang, active: true }],
    quizzes: [{ id: 'qz-1', topic: 'Proper Fraction', grade: '4', subject: 'Maths', language: lang, meta: {} }],
    students: [{ id: 'st-1', student_name: 'Asad Testwala', student_name_urdu: 'اسد' }],
    quiz_sessions: [
      { id: FIRST, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Asad Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 4, total_questions_answered: 6, completed_at: ago(30), created_at: ago(35) },
      { id: REPLAY, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Asad Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 0, total_questions_answered: 6, completed_at: ago(2), created_at: ago(5) },
    ],
    users: [{ id: 't-1', school_id: 'SA' }],
    schools: [{ id: 'SA', name: 'School Alpha', region: 'Sector One', is_active: true, is_probable_test: false }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Card._reset();
  Art._resetCache();
  require('../../../shared/services/quiz/web-quiz-ur-polish')._reset();
  require('../../../shared/services/quiz/web-quiz-schools')._reset();
}

let server; let base; let Card; let Art;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'share-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  process.env.WHATSAPP_BOT_NUMBER = '15550001111';
  Object.assign(process.env, { R2_ENDPOINT: 'https://r2.example.test', R2_ACCESS_KEY_ID: 'test-only', R2_SECRET_ACCESS_KEY: 'test-only' });
  Card = require('../../../shared/services/quiz/web-quiz-card-image');
  Art = require('../../../shared/services/quiz/web-quiz-art');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
let errSpy;
beforeEach(() => {
  redis.__keys.clear();
  S3.__send.mockReset().mockImplementation(async (c) => {
    if (c.type === 'head' || c.type === 'get') throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    return {};
  });
  // a picture's pixels follow its HTML (an English and an Urdu picture are different bytes, as drawn for real)
  htmlToImage.mockReset().mockImplementation(async (h, o) => sharp({ create: { width: o.width, height: o.height || o.width, channels: 3, background: `#${crypto.createHash('md5').update(h).digest('hex').slice(0, 6)}` } }).png().toBuffer());
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

const st = (sid) => T.signSession({ sessionId: sid, deviceRef: 'dddddddddddddddddddddd', shareCodeId: 'sc-1' });
async function mint(body) {
  const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ kind: 'quiz', deed: 'quiz_done', lang: 'en', ...body }) });
  return { status: r.status, body: await r.json() };
}
async function landing(token) { return (await fetch(`${base}/card/${token}`, { headers: KEY })).json(); }
async function resolve(id) { return (await fetch(`${base}/card/s/${id}`, { headers: KEY })).json(); }
async function cardHtml(token) {
  htmlToImage.mockClear();
  const r = await fetch(`${base}/card/${token}.png`, { headers: KEY });
  expect(r.status).toBe(200);
  return htmlToImage.mock.calls.map((c) => c[0]).join('\n');
}

describe('the card after a practice replay (web_quiz_share_first_score)', () => {
  test('on: first play 4/6, replay 0/6: the card\'s result, its landing and its picture say 4/6', async () => {
    seed({ on: ['web_quiz_share_first_score'] });
    const { body } = await mint({ st: st(REPLAY) });
    expect(body.data).toEqual({ r: 4, o: 6, s: 1 });
    expect((await landing(body.token)).result_text.score).toBe('4 out of 6 right');
    const h = await cardHtml(body.token);
    expect(h).toContain('>4<i>/</i>6<');
    expect(h).not.toContain('>0<i>/</i>6<');
  });
  test('on: an Urdu card after the replay says ۶ میں سے ۴', async () => {
    seed({ on: ['web_quiz_share_first_score'] });
    const { body } = await mint({ st: st(REPLAY), lang: 'ur' });
    expect((await landing(body.token)).result_text.score).toBe('۶ میں سے ۴ صحیح');
  });
  test('on: the first play itself is unchanged', async () => {
    seed({ on: ['web_quiz_share_first_score'] });
    expect((await mint({ st: st(FIRST) })).body.data).toEqual({ r: 4, o: 6, s: 1 });
  });
  test('off: the replay\'s own score, as today', async () => {
    seed();
    const { body } = await mint({ st: st(REPLAY) });
    expect(body.data).toEqual({ r: 0, o: 6, s: 0 });
  });
});

describe('a share picture in the share\'s language (web_quiz_share_pic_lang)', () => {
  async function art(id, l) {
    htmlToImage.mockClear();
    const r = await fetch(`${base}/art/${id}${l ? `?l=${l}` : ''}`, { headers: KEY });
    expect(r.status).toBe(200);
    const bytes = Buffer.from(await r.arrayBuffer());
    const html = htmlToImage.mock.calls.length ? htmlToImage.mock.calls[0][0] : null;
    return { md5: crypto.createHash('md5').update(bytes).digest('hex'), html, drawn: htmlToImage.mock.calls.length };
  }
  const langOf = (h) => (/<html[^>]*\blang="(en|ur)"/.exec(h || '') || [])[1];

  for (const [kind, ref] of [['class', () => Art.artId('l', FIRST)], ['card', () => Art.artId('c', FIRST)]]) {
    test(`on, ${kind}: drawn in Urdu first, then asked in English: an English picture, never the Urdu bytes`, async () => {
      seed({ on: ['web_quiz_share_pic_lang'], lang: 'ur' });
      const ur = await art(ref(), 'ur');
      expect(langOf(ur.html)).toBe('ur');
      const en = await art(ref(), 'en');
      expect(en.drawn).toBe(1);
      expect(langOf(en.html)).toBe('en');
      expect(en.md5).not.toBe(ur.md5);
      // each language kept apart: asked again, each answers its own
      expect((await art(ref(), 'ur')).drawn).toBe(0);
      expect((await art(ref(), 'en')).drawn).toBe(0);
    });
  }
  test('off: ?l= is ignored, the code\'s language and the same cached picture, as today', async () => {
    seed({ lang: 'ur' });
    const plain = await art(Art.artId('l', FIRST));
    expect(langOf(plain.html)).toBe('ur');
    const en = await art(Art.artId('l', FIRST), 'en');
    expect(en.drawn).toBe(0);
    expect(en.md5).toBe(plain.md5);
  });
  test('on, no ?l=: the code\'s language, the same key as off', async () => {
    seed({ lang: 'ur' });
    const off = await Art.artImage(Art.artId('l', FIRST), { size: 'og' });
    seed({ on: ['web_quiz_share_pic_lang'], lang: 'ur' });
    const on = await Art.artImage(Art.artId('l', FIRST), { size: 'og' });
    expect(on.key).toBe(off.key);
  });
  test('the page is told (pic_lang) only when on', async () => {
    seed({ on: ['web_quiz_share_pic_lang'] });
    expect(await Card.field()).toMatchObject({ pic_lang: true });
    seed();
    expect(await Card.field()).not.toHaveProperty('pic_lang');
  });
});

describe('an English card\'s link carries its language (web_quiz_share_link_lang_en)', () => {
  test('on: the English card\'s short id answers its class link with &lang=en', async () => {
    seed({ on: ['web_quiz_share_link_lang_en'], lang: 'ur' });
    const { body } = await mint({ st: st(FIRST), lang: 'en' });
    expect(body.url).toBe(`/s/${idOf(body.token)}`);
    expect(await resolve(idOf(body.token))).toEqual({ token: body.token, url: `/q/CLS001?k=${body.token}&lang=en` });
  });
  test('on, short links off: the long link carries &lang=en', async () => {
    seed({ on: ['web_quiz_share_link_lang_en'] });
    Object.assign(supabase, makeFake({
      app_settings: BASE.filter((r) => r.key !== 'web_quiz_share_short').concat([{ key: 'web_quiz_share_link_lang_en', value: true }]),
      quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', topic: 'Proper Fraction', language: 'ur', active: true }],
      students: [{ id: 'st-1', student_name: 'Asad Testwala' }],
      quiz_sessions: [{ id: FIRST, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Asad Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 4, total_questions_answered: 6 }],
    }));
    Card._reset();
    const { body } = await mint({ st: st(FIRST), lang: 'en' });
    expect(body.url).toBe(`/q/CLS001?k=${body.token}&lang=en`);
  });
  test('on: an Urdu card is untouched by it (its own switch)', async () => {
    seed({ on: ['web_quiz_share_link_lang_en'] });
    const { body } = await mint({ st: st(FIRST), lang: 'ur' });
    expect((await resolve(idOf(body.token))).url).toBe(`/q/CLS001?k=${body.token}`);
  });
  test('off: the English card\'s link is today\'s (no lang)', async () => {
    seed({ lang: 'ur' });
    const { body } = await mint({ st: st(FIRST), lang: 'en' });
    expect((await resolve(idOf(body.token))).url).toBe(`/q/CLS001?k=${body.token}`);
  });
});
