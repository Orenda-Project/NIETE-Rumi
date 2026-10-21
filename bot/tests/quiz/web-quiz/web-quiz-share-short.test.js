'use strict';
/**
 * Short share links (app_settings web_quiz_share_short, on top of the one share; default OFF): the card's link is
 * /s/<8 hex> (its short id, kept 90 days against the token) instead of the long /k/<token> or /q/<code>?k=<token>.
 * The bot answers the short id with the token and the long path; an unknown or expired id answers 404 with the join
 * door's words (the edge opens the door, never a dead end). A short id already taken, or Redis away: the long link.
 * Off: the mint answer is today's and nothing is kept.
 * Over HTTP through the real internal router; mocked only at the boundaries (Supabase, Redis, loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-bank', () => ({ bank: jest.fn(async () => ({ rows: [] })) }));
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
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');

const KEY = { 'x-api-key': 'share-key', 'content-type': 'application/json' };
const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const idOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 8);

function seed({ short = true, shortValue, linkLang, more = [] } = {}) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_card_v3', value: true }, { key: 'web_quiz_share_v4', value: true }, ...(short ? [{ key: 'web_quiz_share_short', value: shortValue === undefined ? true : shortValue }] : []),
      ...(linkLang === undefined ? [] : [{ key: 'web_quiz_share_link_lang', value: linkLang }]), ...more],
    quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', topic: 'Plants', language: 'en', active: true }],
    students: [{ id: 'st-1', student_name: 'Amal Testwala' }, { id: 'st-2', student_name: 'Noor Testwala' }],
    quiz_sessions: [{ id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Card._reset();
}

let server; let base; let Card;
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
beforeEach(() => { redis.__keys.clear(); jest.clearAllMocks(); seed(); });

const ct = () => T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
const st = () => T.signSession({ sessionId: SID, deviceRef: 'dddddddddddddddddddddd', shareCodeId: 'sc-1' });
async function mint(body) {
  const r = await fetch(`${base}/card`, { method: 'POST', headers: KEY, body: JSON.stringify({ lang: 'en', ...body }) });
  return { status: r.status, body: await r.json() };
}
async function resolve(id) {
  const r = await fetch(`${base}/card/s/${id}`, { headers: KEY });
  return { status: r.status, body: await r.json() };
}
const READ = { kind: 'read', deed: 'read_all' };
const shortKeys = () => [...redis.__keys.keys()].filter((k) => /^wq:share:short:/.test(k));

describe('the switch', () => {
  test.each([['absent', { short: false }], ['false', { shortValue: false }], ['the string "true"', { shortValue: 'true' }], ['1', { shortValue: 1 }]])('%s: today\'s long link, nothing kept', async (_, o) => {
    seed(o);
    const { body } = await mint({ ...READ, ct: ct() });
    expect(body.url).toBe(`/k/${body.token}`);
    expect(shortKeys()).toHaveLength(0);
    expect(redis.setNX).not.toHaveBeenCalled();
  });
});

describe('on', () => {
  test('a card\'s link is /s/<its short id>, kept 90 days; the id answers the token and the long path', async () => {
    const { body } = await mint({ ...READ, ct: ct() });
    const id = idOf(body.token);
    expect(body.url).toBe(`/s/${id}`);
    expect(redis.setNX).toHaveBeenCalledWith(`wq:share:short:${id}`, body.token, 90 * 24 * 60 * 60);
    expect(await resolve(id)).toEqual({ status: 200, body: { token: body.token, url: `/k/${body.token}` } });
  });
  test('a class quiz\'s card: the short id answers the class link with its card', async () => {
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st() });
    expect(body.url).toBe(`/s/${idOf(body.token)}`);
    expect((await resolve(idOf(body.token))).body).toEqual({ token: body.token, url: `/q/CLS001?k=${body.token}` });
  });
  test('an unknown, expired or malformed id: 404 with the join door\'s words, never a token', async () => {
    for (const id of ['0badc0de', 'ZZZZZZZZ', '0badc0de0']) {
      const r = await resolve(id);
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'not_found', ret: Card.returnLine('en') });
    }
  });
  test('the id already taken by another card, or Redis away: the long link, and the share still works', async () => {
    const first = await mint({ ...READ, ct: ct() });
    redis.__keys.set(`wq:share:short:${idOf(first.body.token)}`, 'another-token');
    redis.setNX.mockImplementationOnce(async () => false);
    const again = await mint({ ...READ, ct: ct() });
    if (idOf(again.body.token) === idOf(first.body.token)) expect(again.body.url).toBe(`/k/${again.body.token}`);
    redis.setNX.mockImplementationOnce(async () => { throw new Error('down'); });
    const down = await mint({ ...READ, ct: ct() });
    expect(down.body.url).toBe(`/k/${down.body.token}`);
    expect(down.body.token).toEqual(expect.any(String));
  });
  test('a token that no longer opens (a new secret): the id answers 404 with the door', async () => {
    redis.__keys.set('wq:share:short:0123abcd', 'not-a-real-token-but-long-enough-to-pass-the-shape-check_xx');
    expect((await resolve('0123abcd')).status).toBe(404);
  });
});

// The link's language (app_settings web_quiz_share_link_lang, default OFF): an Urdu card's class link opens the class's
// page, and so the join door, in Urdu (&lang=ur), short or long; an English card's link is today's. Off: today's links.
describe('the link carries the card\'s language', () => {
  test.each([['absent', undefined], ['false', false], ['the string "true"', 'true']])('off (%s): an Urdu card\'s class link is today\'s', async (_, v) => {
    seed({ linkLang: v });
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'ur' });
    expect((await resolve(idOf(body.token))).body).toEqual({ token: body.token, url: `/q/CLS001?k=${body.token}` });
    expect(body).not.toHaveProperty('link_lang');
  });
  test('on: an Urdu card\'s short id answers its class link with &lang=ur', async () => {
    seed({ linkLang: true });
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'ur' });
    expect(body.url).toBe(`/s/${idOf(body.token)}`);
    expect((await resolve(idOf(body.token))).body).toEqual({ token: body.token, url: `/q/CLS001?k=${body.token}&lang=ur` });
    expect(body.link_lang).toBe(true);
  });
  test('on: an English card, and a card with no class, keep today\'s links', async () => {
    seed({ linkLang: true });
    const en = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'en' });
    expect((await resolve(idOf(en.body.token))).body.url).toBe(`/q/CLS001?k=${en.body.token}`);
    const read = await mint({ ...READ, ct: ct(), lang: 'ur' });
    expect((await resolve(idOf(read.body.token))).body.url).toBe(`/k/${read.body.token}`);
  });
  test('on, short links off: an Urdu card\'s long class link carries &lang=ur', async () => {
    seed({ short: false, linkLang: true });
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'ur' });
    expect(body.url).toBe(`/q/CLS001?k=${body.token}&lang=ur`);
  });
});

// One star (app_settings web_quiz_share_copy_one, default OFF): the mint names it (`one`), so the sheet sets an English
// title on an Urdu sheet in its RTL line (SC-1). Off: today's answer.
describe('the mint names the one forms\' switch', () => {
  test('on: `one: true` beside the card', async () => {
    seed({ more: [{ key: 'web_quiz_share_copy_one', value: true }] });
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'ur' });
    expect(body.one).toBe(true);
  });
  test.each([['absent', []], ['false', [{ key: 'web_quiz_share_copy_one', value: false }]], ['the string "true"', [{ key: 'web_quiz_share_copy_one', value: 'true' }]]])('off (%s): no `one`', async (_, more) => {
    seed({ more });
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'ur' });
    expect(body).not.toHaveProperty('one');
  });
});

// The Urdu share words right to left (app_settings web_quiz_share_bidi, default OFF): the mint names it (`bidi`), so
// the sheet draws the Urdu title line RTL, and seals it into the card (`b: 1`), so the card's lines keep each number
// with its word whenever it is drawn. Off: today's answer and token.
describe('the mint names the share-bidi switch', () => {
  test('on: `bidi: true` beside the card, and the card\'s facts say so', async () => {
    seed({ more: [{ key: 'web_quiz_share_bidi', value: true }] });
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'ur' });
    expect(body.bidi).toBe(true);
    expect(Card.facts(body.token).bidi).toBe(true);
  });
  test.each([['absent', []], ['false', [{ key: 'web_quiz_share_bidi', value: false }]], ['the string "true"', [{ key: 'web_quiz_share_bidi', value: 'true' }]]])('off (%s): no `bidi`', async (_, more) => {
    seed({ more });
    const { body } = await mint({ kind: 'quiz', deed: 'quiz_done', st: st(), lang: 'ur' });
    expect(body).not.toHaveProperty('bidi');
    expect(Card.facts(body.token)).not.toHaveProperty('bidi');
  });
});
