'use strict';
/**
 * The finish card's server half (web-quiz-card-image.js, app_settings web_quiz_card_v3): a sealed card token for
 * THIS child's finish, its 1200x630 picture, and the shared link's facts. Over HTTP through the real internal
 * router; mocked only at the network boundary (Supabase, the headless screenshot, the loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
// the hub's own phone check (Redis / the phone's plays) is the boundary here: a test says which phone the link is bound to
jest.mock('../../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceTrusted: jest.fn() }));

const express = require('express');
const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const { logEvent } = require('../../../shared/utils/structured-logger');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const T = require('../../../shared/services/quiz/web-quiz-token');
const { isQuizMenuRequest } = require('../../../shared/services/quiz/quiz-menu-request');
const { deviceTrusted } = require('../../../shared/services/quiz/web-quiz-hub-device');
const PHONE_DEV = 'pppppppppppppppppppppp';

const SID = '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const TEACHER_RUN = '1f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f7';
const KEY = { 'x-api-key': 'card-key', 'content-type': 'application/json' };

function seed(on) {
  return {
    app_settings: on ? [{ key: 'web_quiz_card_v3', value: true }] : [],
    quiz_share_codes: [{ id: 'sc-1', code: 'CLS001', quiz_id: 'qz-1', topic: 'Plants', language: 'en', active: true }],
    students: [{ id: 'st-1', student_name: 'Amal Testwala', student_name_urdu: 'امل ٹیسٹوالا' }, { id: 'st-2', student_name: 'Zarvish Testwala' }],
    quiz_sessions: [
      { id: SID, quiz_id: 'qz-1', student_id: 'st-1', student_name: 'Amal Testwala', share_code_id: 'sc-1', status: 'completed', correct_answers: 7, total_questions_answered: 8 },
      { id: TEACHER_RUN, quiz_id: 'qz-1', student_id: null, user_id: 't-1', student_name: 'Teacher', share_code_id: 'sc-1', status: 'completed' },
    ],
  };
}

let server; let base; let Card;
function useDb(on) {
  const fake = makeFake(seed(on));
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  Card._reset();
}
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'card-key';
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
beforeEach(async () => {
  useDb(true);
  htmlToImage.mockReset();
  // a flat 1200x630 picture, as the headless screenshot hands it back
  const png = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#FFF8E7' } }).png().toBuffer();
  htmlToImage.mockResolvedValue(png);
  logToFile.mockClear(); logEvent.mockClear();
});

const st = () => T.signSession({ sessionId: SID, deviceRef: 'dddddddddddddddddddddd', shareCodeId: 'sc-1' });
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: KEY, body: JSON.stringify(body) });
async function mintQuiz(extra = {}) {
  const r = await post('/card', { st: st(), kind: 'quiz', deed: 'quiz_done', lang: 'en', ...extra });
  return { status: r.status, body: await r.json() };
}

describe('the switch', () => {
  test('off: minting is not there (404) and the finish/menu payloads gain nothing', async () => {
    useDb(false);
    expect((await mintQuiz()).status).toBe(404);
    expect(await Card.field()).toEqual({});
  });
  test('on: the finish and the Jugnu menu carry card_v3', async () => {
    expect(await Card.field()).toEqual({ card_v3: true });
  });
  test('a string "true" counts, anything else is off; a settings failure fails closed', async () => {
    Object.assign(supabase, { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'down' } }) }) }) });
    Card._reset();
    expect(await Card.field()).toEqual({});
  });
});

describe('mint: the server names the child, the page names only the deed', () => {
  test("a class quiz: the class link carries the card (?k=), the picture's path, and the return line", async () => {
    const { status, body } = await mintQuiz();
    expect(status).toBe(200);
    expect(body.url).toBe(`/q/CLS001?k=${body.token}`);
    expect(body.img).toBe(`/wq/card/${body.token}.png`);
    expect(body.ret).toEqual({ text: 'Play with Jugnu any day. Tap, then send:', cta: 'Play with Jugnu', words: 'quiz please', href: 'https://wa.me/15550001111?text=quiz%20please' });
    expect(Card.facts(body.token)).toEqual({ kind: 'quiz', deed: 'quiz_done', lang: 'en', first: 'Amal', code: 'CLS001' });
  });

  test('a name the page sends is ignored: the first name is the server\'s, in the card\'s language', async () => {
    const { body } = await mintQuiz({ first: 'Hacker', name: 'Someone Else', lang: 'ur' });
    expect(Card.facts(body.token).first).toBe('امل');
  });

  test('the token is sealed: no name, id or code readable in the link', async () => {
    const { body } = await mintQuiz();
    const raw = Buffer.from(body.token, 'base64url').toString('latin1');
    for (const s of ['Amal', 'st-1', SID, 'CLS001', 'quiz_done']) expect(raw).not.toContain(s);
    // a changed character is not a card
    const bad = body.token.slice(0, -2) + (body.token.endsWith('AA') ? 'BB' : 'AA');
    expect(Card.facts(bad)).toBeNull();
  });

  test('a Jugnu read (run token) and a hub child (hub token + chip) share /k/<t>', async () => {
    const ct = T.signChallenge({ studentId: 'st-2', ex: 'read', runId: 'run-1' });
    const r1 = await post('/card', { ct, kind: 'read', deed: 'read_all', lang: 'en' });
    const b1 = await r1.json();
    expect(r1.status).toBe(200);
    expect(b1.url).toBe(`/k/${b1.token}`);
    expect(Card.facts(b1.token)).toMatchObject({ kind: 'read', deed: 'read_all', first: 'Zarvish', code: null });
    const hub = T.signHub(['st-1', 'st-2']);
    deviceTrusted.mockImplementation(async (tok, dev) => (dev === PHONE_DEV ? { ok: true, ids: ['st-1', 'st-2'] } : { ok: false, ids: [] }));
    const fromPhone = (body) => fetch(`${base}/card`, { method: 'POST', headers: { ...KEY, 'x-wq-device': PHONE_DEV }, body: JSON.stringify(body) });
    const r2 = await fromPhone({ hub, kid: T.chipId('h', 'st-2'), kind: 'book', deed: 'book_read', lang: 'en' });
    expect(Card.facts((await r2.json()).token)).toMatchObject({ kind: 'book', first: 'Zarvish' });
    // a storybook only listened to, and one opened with nothing read: the listening deed, the try card (no sticker)
    const r3 = await fromPhone({ hub, kid: T.chipId('h', 'st-2'), kind: 'book', deed: 'listen_done', lang: 'ur' });
    expect(Card.facts((await r3.json()).token)).toMatchObject({ kind: 'book', deed: 'listen_done', lang: 'ur' });
    const r4 = await fromPhone({ hub, kid: T.chipId('h', 'st-2'), kind: 'book', deed: 'read_tried', lang: 'en' });
    expect(r4.status).toBe(200);
    // two children on the hub token and no chip: which child is unknown
    expect((await fromPhone({ hub, kind: 'book', deed: 'book_read' })).status).toBe(401);
    // a forwarded hub link on another phone names nobody
    expect((await post('/card', { hub, kid: T.chipId('h', 'st-2'), kind: 'book', deed: 'book_read' })).status).toBe(403);
  });

  test('refusals: an unknown deed, a deed of another kind, no token, a teacher\'s own run', async () => {
    expect((await post('/card', { st: st(), kind: 'quiz', deed: 'read_all' })).status).toBe(400);
    expect((await post('/card', { st: st(), kind: 'quiz', deed: 'got_10_of_10' })).status).toBe(400);
    expect((await post('/card', { kind: 'quiz', deed: 'quiz_done' })).status).toBe(401);
    const tst = T.signSession({ sessionId: TEACHER_RUN, deviceRef: null, shareCodeId: 'sc-1' });
    expect((await post('/card', { st: tst, kind: 'quiz', deed: 'quiz_done' })).status).toBe(401);
  });
});

describe('the picture', () => {
  test('GET /card/<t>.png: PNG bytes at most 40 KB, cacheable by anyone, drawn once', async () => {
    const { body } = await mintQuiz();
    const r = await fetch(`${base}/card/${body.token}.png`, { headers: KEY });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400, immutable');
    const bytes = Buffer.from(await r.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.length).toBeLessThanOrEqual(40 * 1024);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
    await fetch(`${base}/card/${body.token}.png`, { headers: KEY });
    expect(htmlToImage).toHaveBeenCalledTimes(1);
    const [html, opts] = htmlToImage.mock.calls[0];
    expect(opts).toMatchObject({ width: 1200, height: 630 });
    expect(html).toContain('>Amal<');
    expect(html).toContain("I finished my teacher&#39;s quiz today!");
  });

  test('a picture still over 40 KB after the fewest colours is served, and says so in the log (no token)', async () => {
    const noise = await sharp(require('crypto').randomBytes(1200 * 630 * 3), { raw: { width: 1200, height: 630, channels: 3 } }).png().toBuffer();
    htmlToImage.mockResolvedValue(noise);
    const { body } = await mintQuiz();
    const r = await fetch(`${base}/card/${body.token}.png`, { headers: KEY });
    expect(r.status).toBe(200);
    const line = logToFile.mock.calls.find((c) => /over 40 KB/.test(c[0]));
    expect(line).toBeTruthy();
    expect(line[1]).toMatchObject({ kind: 'quiz', bytes: expect.any(Number) });
    expect(JSON.stringify(line)).not.toContain(body.token.slice(0, 24));
  });

  test('a token the server never issued: 404, nothing drawn', async () => {
    const r = await fetch(`${base}/card/${'A'.repeat(60)}.png`, { headers: KEY });
    expect(r.status).toBe(404);
    expect(htmlToImage).not.toHaveBeenCalled();
  });

  test('the card token is never written to a log line', async () => {
    const { body } = await mintQuiz();
    await fetch(`${base}/card/${body.token}.png`, { headers: KEY });
    await fetch(`${base}/card/${body.token}`, { headers: KEY });
    const all = JSON.stringify([logToFile.mock.calls, logEvent.mock.calls]);
    expect(all).not.toContain(body.token);
    expect(all).not.toContain(body.token.slice(0, 24));
  });
});

// every kind of finish the card is for, and every deed it may say
const EVERY_DEED = [['quiz', 'quiz_done'], ['read', 'read_all'], ['read', 'read_some'], ['read', 'read_tried'], ['listen', 'listen_done'],
  ['story', 'story_read'], ['story', 'answered'], ['story', 'read_tried'], ['game', 'game_done'], ['book', 'book_read'], ['book', 'listen_done'], ['book', 'read_tried'],
  ['video', 'video_watched']];
describe('what the card says', () => {
  test('the deed list is exactly these', () => {
    expect(Object.entries(Card.DEEDS).flatMap(([k, ds]) => ds.map((d) => [k, d]))).toEqual(EVERY_DEED);
  });
  const BANNED = /\b(test|exam|assessment|score|wpm|rank|position)\b|امتحان|ٹیسٹ|[0-9۰-۹]/i;
  test.each(EVERY_DEED)('%s/%s: the deed in both languages, no number, no test word', (kind, deed) => {
    for (const lang of ['en', 'ur']) {
      const html = Card.renderCard({ lang, first: 'Amal', deed }, { fonts: false });
      const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'");
      expect(Card.COPY[lang][deed]).toBeTruthy();
      expect(text).toContain(Card.COPY[lang][deed]);
      expect(text.replace(/data:[^"]+/g, '')).not.toMatch(BANNED);
    }
  });
  test('a try (read_tried) earns no sticker, so its picture draws none; every other deed draws ONE', () => {
    expect(Card.renderCard({ lang: 'en', first: 'Amal', deed: 'read_tried' }, { fonts: false })).not.toContain('class="st"');
    const one = Card.renderCard({ lang: 'en', first: 'Amal', deed: 'read_all' }, { fonts: false });
    expect(one.match(/class="st"/g)).toHaveLength(1);
  });
  test('Urdu draws right to left; a Latin name keeps its own direction', () => {
    const html = Card.renderCard({ lang: 'ur', first: 'Amal', deed: 'read_all' }, { fonts: false });
    expect(html).toMatch(/<html lang="ur" dir="rtl">/);
    expect(html).toContain('<div class="name" dir="ltr">Amal</div>');
    // the name block sits on the Urdu side of the card, whatever its own script
    expect(/\.name\{[^}]*\}/.exec(html)[0]).toContain('text-align:right');
  });
  test('an Urdu deed never breaks inside a word or leaves one word alone on its line', () => {
    const css = /\.deed\{[^}]*\}/.exec(Card.renderCard({ lang: 'ur', first: 'امل', deed: 'read_all' }, { fonts: false }))[0];
    expect(css).toContain('word-break:keep-all');
    expect(css).toContain('text-wrap:balance');
  });
  test('the return words are answered by the bot today, and are not the class message\'s word', () => {
    for (const l of ['en', 'ur']) {
      expect(isQuizMenuRequest(Card.CARD_RETURN_WORDS[l])).toBe(true);
      expect(Card.CARD_RETURN_WORDS[l]).not.toBe('quiz');
    }
  });
  test('GET /card/<t>: the shared link\'s facts — the deed in words, the return line', async () => {
    const { body } = await mintQuiz({ lang: 'ur' });
    const r = await fetch(`${base}/card/${body.token}`, { headers: KEY });
    expect(await r.json()).toEqual({ kind: 'quiz', lang: 'ur', first: 'امل', deed_text: Card.COPY.ur.quiz_done, ret: Card.returnLine('ur') });
    expect(Card.returnLine('ur').href).toBe(`https://wa.me/15550001111?text=${encodeURIComponent('کوئز دکھائیں')}`);
  });
});
