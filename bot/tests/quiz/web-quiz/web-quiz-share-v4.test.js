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
    students: [{ id: 'st-1', student_name: 'Amal Testwala' }, { id: 'st-2', student_name: 'Noor Testwala' }, { id: 'st-3', student_name: 'Noor Testwala', list_id: 'list-1' }],
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
  bank.mockResolvedValue({ rows: [{ id: VID, r2_url: 'x', clean_title: 'Parts of a plant' }] });
});

const ct = () => T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
const st = () => T.signSession({ sessionId: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', deviceRef: 'dddddddddddddddddddddd', shareCodeId: 'sc-1' });
async function mint(body) {
  const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ ct: ct(), lang: 'en', ...body }) });
  return { status: r.status, body: await r.json() };
}
async function landing(token) { return (await fetch(`${base}/card/${token}`, { headers: KEY })).json(); }

describe('the switch', () => {
  test('off: the finish and menu field is today\'s {card_v3: true}, and the mint answer gains nothing', async () => {
    useDb({ share: false });
    expect(await Card.field()).toEqual({ card_v3: true });
    const { body } = await mint({ kind: 'book', deed: 'book_read', item: { type: 'book', id: BOOK } });
    expect(Object.keys(body).sort()).toEqual(['img', 'ret', 'token', 'url']);
    expect(Card.facts(body.token)).toEqual({ kind: 'book', deed: 'book_read', lang: 'en', first: 'Noor', code: null });
    const l = await landing(body.token);
    expect(l).toEqual({ kind: 'book', lang: 'en', first: 'Noor', deed_text: Card.COPY.en.book_read, ret: Card.returnLine('en') });
  });
  test('on: the field says share_v4 (the pages read it), only beside the card', async () => {
    expect(await Card.field()).toEqual({ card_v3: true, share_v4: true });
    useDb({ card: false, share: true });
    expect(await Card.field()).toEqual({});
  });
  test('only JSON true is on; a failed read is off', async () => {
    for (const value of ['true', 1, null]) {
      Object.assign(supabase, { from: () => ({ select: () => ({ in: async () => ({ data: [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value }], error: null }) }) }) });
      Card._reset();
      expect(await Card.field()).toEqual({ card_v3: true });
    }
  });
});

describe('the Share button follows the target (a child with no class shares with friends)', () => {
  test('on: the mint says plain for a child with no class, not for a class child or a class quiz', async () => {
    expect((await mint({ kind: 'read', deed: 'read_all' })).body.plain).toBe(true);
    const cls = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ ct: T.signChallenge({ studentId: 'st-3', ex: 'read', runId: 'run-2' }), kind: 'read', deed: 'read_all', lang: 'en' }) });
    expect((await cls.json()).plain).toBe(false);
    const q = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ st: st(), kind: 'quiz', deed: 'quiz_done', lang: 'en' }) });
    expect((await q.json()).plain).toBe(false);
  });
});

describe('the item a share lands on', () => {
  test('a storybook finish with only its questions answered (kind story) still names its book, never the Games door', async () => {
    const { body } = await mint({ kind: 'story', deed: 'answered', item: { type: 'book', id: BOOK } });
    expect(Card.facts(body.token).item).toEqual({ type: 'book', id: BOOK });
    // an unready book: the story's own door, as before
    const d = await mint({ kind: 'story', deed: 'answered', item: { type: 'book', id: DRAFT } });
    expect(Card.facts(d.body.token).item).toEqual({ type: 'door', id: 'games' });
  });
  test('a storybook card seals its ready book; the link is /k/<t>; the answer says v4 and the item kind', async () => {
    const { status, body } = await mint({ kind: 'book', deed: 'book_read', item: { type: 'book', id: BOOK } });
    expect(status).toBe(200);
    expect(body.url).toBe(`/k/${body.token}`);
    expect(body).toMatchObject({ v4: true, item: 'book' });
    expect(Card.facts(body.token)).toMatchObject({ kind: 'book', v4: true, item: { type: 'book', id: BOOK } });
    // sealed: the id is not readable in the link
    expect(Buffer.from(body.token, 'base64url').toString('latin1')).not.toContain(BOOK);
  });
  test('a video card seals a live video', async () => {
    const { body } = await mint({ kind: 'video', deed: 'video_watched', item: { type: 'video', id: VID } });
    expect(Card.facts(body.token).item).toEqual({ type: 'video', id: VID });
  });
  test('an unknown, unready or mismatched item is dropped at seal (never a dead deep link); the card still mints', async () => {
    for (const item of [{ type: 'book', id: DRAFT }, { type: 'book', id: '9' + BOOK.slice(1) }, { type: 'video', id: BOOK }, { type: 'book', id: 'not-a-uuid' }, { type: 'quiz', id: 'CLS001' }, 'x']) {
      const kind = item && item.type === 'video' ? 'video' : 'book';
      const { status, body } = await mint({ kind, deed: kind === 'video' ? 'video_watched' : 'book_read', item });
      expect(status).toBe(200);
      expect(body.item).toBeNull();
      expect(Card.facts(body.token).item).toBeNull();
    }
    // a book named on a video's card
    const { body } = await mint({ kind: 'video', deed: 'video_watched', item: { type: 'book', id: BOOK } });
    expect(body.item).toBeNull();
  });
  test('a class quiz keeps its class link (the class\'s own way in), its code the server\'s', async () => {
    const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ st: st(), kind: 'quiz', deed: 'quiz_done', lang: 'en', item: { type: 'quiz', id: 'EVIL01' } }) });
    const body = await r.json();
    expect(body.url).toBe(`/q/CLS001?k=${body.token}`);
    expect(Card.facts(body.token).item).toEqual({ type: 'quiz', id: 'CLS001' });
  });
  test('a Jugnu read, story or game has no item of its own: the Games door is sealed; the landing shows its mark', async () => {
    for (const [kind, deed] of [['game', 'game_done'], ['read', 'read_all'], ['listen', 'listen_done'], ['story', 'story_read']]) {
      // a page that names a book on a read, a listen or a game is ignored; a Jugnu story names none (a storybook's does)
      const { body } = await mint({ kind, deed, item: kind === 'story' ? undefined : { type: 'book', id: BOOK } });
      expect(body.item).toBe('door');
      expect(Card.facts(body.token).item).toEqual({ type: 'door', id: 'games' });
    }
    expect((await landing((await mint({ kind: 'game', deed: 'game_done' })).body.token)).mark).toBe('Game');
  });
  test('the landing: the mark in its colour, the name of what it lands on, today\'s return words (en and ur)', async () => {
    const { body } = await mint({ kind: 'book', deed: 'book_read', item: { type: 'book', id: BOOK } });
    // the join words carry the item's short ref (the bot lands the new child on it)
    const words = `${Card.CARD_RETURN_WORDS.en} jb3b9c1e2a`;
    expect(await landing(body.token)).toEqual({ kind: 'book', lang: 'en', first: 'Noor', deed_text: Card.COPY.en.book_read, ret: { ...Card.returnLine('en'), words, href: `https://wa.me/15550001111?text=${encodeURIComponent(words)}` }, v4: true, mark: 'Storybook', accent: Card.MARK.book.c, item_title: 'The lost kite', ref: 'jb3b9c1e2a' });
    const ur = await mint({ kind: 'video', deed: 'video_watched', lang: 'ur', item: { type: 'video', id: VID } });
    expect(await landing(ur.body.token)).toMatchObject({ v4: true, mark: 'ویڈیو', ret: { text: Card.returnLine('ur').text, cta: Card.returnLine('ur').cta }, item_title: 'Parts of a plant', ref: 'jva1b2c3d4' });
    // a door finish (a Jugnu read) names no item
    const rd = await mint({ kind: 'read', deed: 'read_all' });
    expect(await landing(rd.body.token)).not.toHaveProperty('item_title');
  });
});

describe('the picture: one theme, one mark per activity', () => {
  test('a token minted with the switch off draws today\'s card, byte for byte, for every deed and language', () => {
    for (const [k, h] of Object.entries(GOLDEN)) {
      const [kind, deed, lang] = k.split('|');
      expect([k, sha(Card.renderCard({ kind, deed, lang, first: lang === 'ur' ? 'امل' : 'Amal' }, { fonts: false }))]).toEqual([k, h]);
    }
  });
  test('a one-share token draws its ribbon and colour; each activity its own', () => {
    const seen = new Set();
    for (const kind of Object.keys(Card.DEEDS)) {
      for (const lang of ['en', 'ur']) {
        const html = Card.renderCard({ kind, deed: Card.DEEDS[kind][0], lang, first: 'Amal', v4: true }, { fonts: false });
        expect(html).toContain(`<div class="rib">${Card.MARK[kind][lang]}</div>`);
        expect(html).toContain(`border-bottom-color:${Card.MARK[kind].c}`);
        expect(html).not.toMatch(/\b(test|exam|assessment)\b|امتحان|ٹیسٹ/i);
      }
      seen.add(Card.MARK[kind].c);
    }
    // quiz, reading, stories, game, video: five colours
    expect(seen.size).toBe(5);
  });
});


describe('a phone the hub does not know (a forwarded link, or opened elsewhere)', () => {
  const hubTok = () => T.signHub(['st-1']);
  async function mintHub(extra = {}) {
    const hub = hubTok();
    const r = await fetch(`${base}/card`, { method: 'POST', headers: { ...KEY, 'x-wq-device': 'dev-x' }, body: JSON.stringify({ hub, kind: 'video', deed: 'video_watched', lang: 'en', item: { type: 'video', id: VID }, ...extra }) });
    return { status: r.status, body: await r.json() };
  }
  beforeEach(() => { deviceTrusted.mockResolvedValue({ ok: false, ids: [] }); });
  test('the one share: still a card and a link — a card that names nobody, the item sealed', async () => {
    const { status, body } = await mintHub();
    expect(status).toBe(200);
    expect(body.url).toBe(`/k/${body.token}`);
    expect(Card.facts(body.token)).toMatchObject({ kind: 'video', first: '', v4: true, item: { type: 'video', id: VID } });
  });
  test('switch off: today\'s 403', async () => {
    useDb({ share: false });
    const { status, body } = await mintHub();
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'other_device' });
  });
  test('a hub token that is not one is still refused (401), switch on', async () => {
    const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ hub: 'nope', kind: 'video', deed: 'video_watched', lang: 'en' }) });
    expect(r.status).toBe(401);
  });
});

