'use strict';
/**
 * A shared card lands a NEW child on its item (app_settings web_quiz_share_v4, default OFF): the shared link's landing
 * types a short ref of the item after the return words; the bot reads those words as today's menu request, keeps the
 * item for that phone (24 h, the phone hashed), and the home link it sends next (join, pick, or a known child's hub
 * reply) opens it once. Switch off: the landing's words, the menu and the home link are today's.
 * Over HTTP through the real internal router; mocked only at the boundaries (Supabase, Redis, the screenshot, loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn() }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const m = new Map();
  return { _m: m, set: jest.fn(async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); return true; }), get: jest.fn(async (k) => (m.has(k) ? m.get(k) : null)), delete: jest.fn(async (k) => m.delete(k)) };
});

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { bank } = require('../../../shared/services/quiz/web-quiz-bank');
const T = require('../../../shared/services/quiz/web-quiz-token');
const { isQuizMenuRequest } = require('../../../shared/services/quiz/quiz-menu-request');

const BOOK = '3b9c1e2a-7d4f-4a1b-9c2d-5e6f7a8b9c0d';
const DRAFT = '4c0d2f3b-8e5a-4b2c-8d3e-6f7a8b9c0d1e';
const VID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
const PHONE = '15550002222';
const KEY = { 'x-api-key': 'share-key', 'content-type': 'application/json' };

function seed({ card = true, share = false } = {}) {
  return {
    app_settings: [...(card ? [{ key: 'web_quiz_card_v3', value: true }] : []), ...(share ? [{ key: 'web_quiz_share_v4', value: true }] : [])],
    quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', topic: 'Plants', language: 'en', active: true }],
    students: [{ id: 'st-1', student_name: 'Amal Testwala' }, { id: 'st-2', student_name: 'Zarvish Testwala' }],
    quiz_sessions: [{ id: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed' }],
    story_books: [{ id: BOOK, status: 'ready', title: 'The lost kite' }, { id: DRAFT, status: 'draft', title: 'Not yet' }],
  };
}

let server; let base; let Card; let Open;
function useDb(o) {
  const fake = makeFake(seed(o));
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Card._reset();
}
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'share-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  process.env.WHATSAPP_BOT_NUMBER = '15550001111';
  Card = require('../../../shared/services/quiz/web-quiz-card-image');
  Open = require('../../../shared/services/quiz/web-quiz-share-open');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  useDb({ share: true });
  redis._m.clear();
  bank.mockResolvedValue({ rows: [{ id: VID, r2_url: 'x' }] });
});

const ct = () => T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
const st = () => T.signSession({ sessionId: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', deviceRef: 'dddddddddddddddddddddd', shareCodeId: 'sc-1' });
async function mint(body) {
  const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ ct: ct(), lang: 'en', ...body }) });
  return { status: r.status, body: await r.json() };
}
async function landing(token) { return (await fetch(`${base}/card/${token}`, { headers: KEY })).json(); }

describe('the landing types the item\'s ref into the join words', () => {
  test('the landing types the item\'s short ref after the return words (never the whole id); en and ur', async () => {
    const { body } = await mint({ kind: 'book', deed: 'book_read', item: { type: 'book', id: BOOK } });
    const l = await landing(body.token);
    expect(l).toMatchObject({ v4: true, mark: 'Storybook', ref: 'jb3b9c1e2a' });
    expect(l.ret.words).toBe('quiz please jb3b9c1e2a');
    expect(l.ret.href).toBe('https://wa.me/15550001111?text=quiz%20please%20jb3b9c1e2a');
    expect(l.ret.href).not.toContain(BOOK);
    // the bot reads those words as the menu request
    expect(await Open.refMenu(l.ret.words)).toBe(true);
    const ur = await mint({ kind: 'video', deed: 'video_watched', lang: 'ur', item: { type: 'video', id: VID } });
    const lu = await landing(ur.body.token);
    expect(lu.ret.words).toBe('کوئز دکھائیں jva1b2c3d4');
    expect(await Open.refMenu(lu.ret.words)).toBe(true);
    expect(lu.mark).toBe('ویڈیو');
  });
  test('a Jugnu read, story or game has no item of its own: the friend lands on the Games door (jg00000000)', async () => {
    for (const [kind, deed] of [['game', 'game_done'], ['read', 'read_all'], ['listen', 'listen_done'], ['story', 'story_read']]) {
      const { body } = await mint({ kind, deed });
      const l = await landing(body.token);
      expect(l.ret.words).toBe('quiz please jg00000000');
      expect(await Open.refMenu(l.ret.words)).toBe(true);
    }
    expect((await landing((await mint({ kind: 'game', deed: 'game_done' })).body.token)).mark).toBe('Game');
  });
  test('a video card with no video named: no ref, today\'s return words', async () => {
    const { body } = await mint({ kind: 'video', deed: 'video_watched' });
    const l = await landing(body.token);
    expect(l.ref).toBeUndefined();
    expect(l.ret).toEqual(Card.returnLine('en'));
  });
});

describe('the bot keeps the item for the friend\'s phone and the home link opens it', () => {
  test('refOf: one ref token, any case; two refs or none: null', () => {
    expect(Open.refOf('quiz please jb3b9c1e2a')).toBe('jb3b9c1e2a');
    expect(Open.refOf('کوئز دکھائیں JVA1B2C3D4')).toBe('jva1b2c3d4');
    expect(Open.refOf('quiz please')).toBeNull();
    expect(Open.refOf('quiz jb3b9c1e2a jva1b2c3d4')).toBeNull();
  });
  test('note → hashFor: the book once, as #story/<id>; then nothing', async () => {
    expect(await Open.note(PHONE, 'quiz please jb3b9c1e2a')).toBe(true);
    expect([...redis._m.keys()][0]).not.toContain(PHONE);
    expect(await Open.hashFor(`+${PHONE}`)).toBe(`#story/${BOOK}`);
    expect(await Open.hashFor(PHONE)).toBe('');
  });
  test('a video ref → #watch/<vid>; withOpen adds it to a home link only', async () => {
    await Open.note(PHONE, 'quiz please jva1b2c3d4');
    expect(await Open.withOpen(PHONE, 'https://portal.example/quiz/go/abc')).toBe('https://portal.example/quiz/go/abc');
    expect(await Open.withOpen(PHONE, 'https://portal.example/h/tok123?lang=en')).toBe(`https://portal.example/h/tok123?lang=en#watch/${VID}`);
  });
  test('the Games door ref → #games', async () => {
    await Open.note(PHONE, 'quiz please jg00000000');
    expect(await Open.hashFor(PHONE)).toBe('#games');
    expect(await Open.note(PHONE, 'quiz please jg00000001')).toBe(false);
  });
  test('a ref to a book that is not ready, or to two books, keeps nothing', async () => {
    expect(await Open.note(PHONE, 'quiz please jb4c0d2f3b')).toBe(false);
    expect(await Open.note(PHONE, 'quiz please jbffffffff')).toBe(false);
    expect(redis.set).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'never');
    expect(redis._m.size).toBe(0);
  });
  test('switch off: nothing kept; a home link reads no setting (one Redis miss) and is unchanged', async () => {
    useDb({ share: false });
    expect(await Open.note(PHONE, 'quiz please jb3b9c1e2a')).toBe(false);
    expect(redis._m.size).toBe(0);
    const shareOn = jest.spyOn(Card, 'shareOn');
    expect(await Open.withOpen(PHONE, '/h/tok?from=join')).toBe('/h/tok?from=join');
    expect(shareOn).not.toHaveBeenCalled();
    shareOn.mockRestore();
  });
  test('an item kept before the switch went off is dropped, never opened', async () => {
    await Open.note(PHONE, 'quiz please jb3b9c1e2a');
    useDb({ share: false });
    expect(await Open.withOpen(PHONE, '/h/tok?from=join')).toBe('/h/tok?from=join');
    expect(redis._m.size).toBe(0);
  });
  test('a message with no ref, or a malformed one, reads nothing at all', async () => {
    const shareOn = jest.spyOn(Card, 'shareOn');
    for (const w of ['quiz please', 'quiz please jb3b9c1e2', 'quiz jbzzzzzzzz', 'quiz jb3b9c1e2a jva1b2c3d4', '', null]) expect(await Open.note(PHONE, w)).toBe(false);
    expect(shareOn).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    shareOn.mockRestore();
  });
});

describe('the words', () => {
  test('today\'s menu words are still the menu; with the share: one ref among them too; a ref alone, two refs or a ref-like word never', async () => {
    for (const w of ['quiz', 'quiz please', 'کوئز دکھائیں', '/quiz', 'mera quiz']) expect(isQuizMenuRequest(w)).toBe(true);
    for (const w of ['jb3b9c1e2a', 'quiz jb3b9c1e2a jva1b2c3d4', 'quiz jb3b9c1e2', 'quiz on fractions', 'stop quiz']) {
      expect(isQuizMenuRequest(w)).toBe(false);
      expect(await Open.refMenu(w)).toBe(false);
    }
    expect(isQuizMenuRequest('quiz please jb3b9c1e2a')).toBe(false);
    expect(await Open.refMenu('quiz please jb3b9c1e2a')).toBe(true);
    useDb({ share: false });
    expect(await Open.refMenu('quiz please jb3b9c1e2a')).toBe(false);
  });
});
