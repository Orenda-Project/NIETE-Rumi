'use strict';
/**
 * One share for every finish (app_settings web_quiz_share_v4, on top of web_quiz_card_v3; default OFF): the card's
 * token carries the item the child finished (a storybook, a video), checked by the server; the picture gets the
 * activity's ribbon and colour; the shared link's landing shows the mark; a phone the hub does not know still gets a
 * card (one that names nobody), never bare words. Switch off: the field, the token, the picture, the landing and the
 * 403 for another phone are today's, byte for byte.
 * Over HTTP through the real internal router; mocked only at the boundaries (Supabase, Redis, the screenshot, loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn() }));

const crypto = require('crypto');
const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { bank } = require('../../../shared/services/quiz/web-quiz-bank');
const T = require('../../../shared/services/quiz/web-quiz-token');
const { deviceTrusted } = require('../../../shared/services/quiz/web-quiz-hub-device');

const BOOK = '3b9c1e2a-7d4f-4a1b-9c2d-5e6f7a8b9c0d';
const DRAFT = '4c0d2f3b-8e5a-4b2c-8d3e-6f7a8b9c0d1e';
const VID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
const KEY = { 'x-api-key': 'share-key', 'content-type': 'application/json' };
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
// renderCard({kind, deed, lang, first}, {fonts:false}) on origin/sandbox before this change, for every deed
const GOLDEN = { 'quiz|quiz_done|en': '9da3ecde53d8d725', 'quiz|quiz_done|ur': '6a556e889dd62b2c', 'read|read_all|en': '895a9ae3187384b9', 'read|read_all|ur': 'b46c637303523fe5', 'read|read_some|en': '5cfdd3cf470e2691', 'read|read_some|ur': 'aeb32d081d5a1aed', 'read|read_tried|en': 'e9d0098f9a86f61a', 'read|read_tried|ur': 'dcf75c4d75e6297a', 'read|read_practice|en': 'ad3d7e340ab22150', 'read|read_practice|ur': '29201ccf9b28b727', 'read|read_some_practice|en': '9f416c01d8c23f17', 'read|read_some_practice|ur': 'c3c4c59434879a20', 'listen|listen_done|en': '2043abc144ed77eb', 'listen|listen_done|ur': 'a8829f8c8758bf38', 'listen|listen_practice|en': 'd0b349b58ded21b3', 'listen|listen_practice|ur': '7f2139555ed8fa2c', 'story|story_read|en': '5aa72250ff05b1e5', 'story|story_read|ur': 'ba4e276fe47f47fe', 'story|answered|en': '25013364824a188e', 'story|answered|ur': '088904e915cb5317', 'story|read_tried|en': 'e9d0098f9a86f61a', 'story|read_tried|ur': 'dcf75c4d75e6297a', 'story|story_practice|en': 'da2c81cd1f7f51cd', 'story|story_practice|ur': 'ee8ac2a81803eda9', 'game|game_done|en': 'b490bb9ba8143e13', 'game|game_done|ur': '8900181d7c9a1d3f', 'game|game_practice|en': 'f3239356d121d9ac', 'game|game_practice|ur': 'f2d8bc97edfb679b', 'book|book_read|en': 'c08a1918e3593e1c', 'book|book_read|ur': '38dc5c4a82f87b3c', 'book|listen_done|en': '2043abc144ed77eb', 'book|listen_done|ur': 'a8829f8c8758bf38', 'book|read_tried|en': 'e9d0098f9a86f61a', 'book|read_tried|ur': 'dcf75c4d75e6297a', 'video|video_watched|en': '24a4e8ce6b5eb526', 'video|video_watched|ur': '60fa395035053d97' };

function seed({ card = true, share = false } = {}) {
  return {
    app_settings: [...(card ? [{ key: 'web_quiz_card_v3', value: true }] : []), ...(share ? [{ key: 'web_quiz_share_v4', value: true }] : [])],
    quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', topic: 'Plants', language: 'en', active: true }],
    students: [{ id: 'st-1', student_name: 'Amal Testwala' }, { id: 'st-2', student_name: 'Noor Testwala' }],
    quiz_sessions: [{ id: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed' }],
    story_books: [{ id: BOOK, status: 'ready', title: 'The lost kite' }, { id: DRAFT, status: 'draft', title: 'Not yet' }],
  };
}

let server; let base; let Card;
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
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  useDb({ share: true });
  bank.mockResolvedValue({ rows: [{ id: VID, r2_url: 'x' }] });
});

const ct = () => T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
const st = () => T.signSession({ sessionId: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', deviceRef: 'dddddddddddddddddddddd', shareCodeId: 'sc-1' });
async function mint(body) {
  const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ ct: ct(), lang: 'en', ...body }) });
  return { status: r.status, body: await r.json() };
}
async function landing(token) { return (await fetch(`${base}/card/${token}`, { headers: KEY })).json(); }

// ==== the storybook's finishes on the server ====
describe('storybook seal and landing', () => {
  test('settings reads for the book payload field: one read, OFF and ON', async () => {
    for (const share of [false, true]) {
      useDb({ share });
      const from = supabase.from; let n = 0;
      supabase.from = (t) => { if (t === 'app_settings') n += 1; return from(t); };
      const f = await Card.field();
      supabase.from = from;
      expect([share, n]).toEqual([share, 1]);
      if (!share) expect(f).toEqual({ card_v3: true });
    }
  });
  test.each(['en', 'ur'])('%s: every storybook deed seals the book (book_read, listen_done, read_tried)', async (lang) => {
    for (const deed of ['book_read', 'listen_done', 'read_tried']) {
      const { body } = await mint({ kind: 'book', deed, lang, item: { type: 'book', id: BOOK } });
      expect([deed, Card.facts(body.token).item]).toEqual([deed, { type: 'book', id: BOOK }]);
      const l = await landing(body.token);
      expect(l.mark).toBe(lang === 'ur' ? 'کہانی کی کتاب' : 'Storybook');
    }
  });
  test('6d: a storybook finish with only the questions answered (kind story, deed answered) seals the BOOK', async () => {
    const { body } = await mint({ kind: 'story', deed: 'answered', item: { type: 'book', id: BOOK } });
    expect(Card.facts(body.token).item).toEqual({ type: 'book', id: BOOK });
  });
  test('6d landing: that finish wears the Storybook mark', async () => {
    const { body } = await mint({ kind: 'story', deed: 'answered', item: { type: 'book', id: BOOK } });
    expect((await landing(body.token)).mark).toBe('Storybook');
  });
  test.each(['en', 'ur'])('%s: the landing names the book (its title) for a sealed book', async (lang) => {
    const { body } = await mint({ kind: 'book', deed: 'book_read', lang, item: { type: 'book', id: BOOK } });
    const l = await landing(body.token);
    expect(JSON.stringify(l)).toContain('The lost kite');
  });
  test('unready book: dropped, card still mints, landing ok', async () => {
    const { status, body } = await mint({ kind: 'book', deed: 'book_read', item: { type: 'book', id: DRAFT } });
    expect(status).toBe(200); expect(body.item).toBeNull();
    expect((await landing(body.token)).v4).toBe(true);
  });
});
