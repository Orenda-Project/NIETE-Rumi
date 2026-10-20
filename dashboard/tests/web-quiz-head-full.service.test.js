/**
 * web_quiz_head_full (app_settings, default OFF): a head the edge guesses (the fast first page, web_quiz_fast on)
 * never says less than the page's real head.
 * Today a class code whose facts name the class link's picture is remembered 120 s; after that (or on a copy that never
 * saw the code) the guessed head says English with a blank title ("· Class quiz"), even for an Urdu quiz. A phone's
 * page fixes its own tab when the bot answers, but anything that reads the head without running the page (a link
 * preview whose fetcher is not on the preview list, a plain fetch) keeps the blank, English head.
 * ON: (1) the code's title and language are remembered the hour, apart from its picture (still 120 s); (2) only a
 * browser gets a guessed head; any other fetcher waits for the bot and gets the real head.
 * OFF: every page is today's, byte for byte.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const PHONE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const TEACH = 't.UR12CD.v1bw_tRX32tq';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  };
}
const URDU = () => ({
  quiz: {
    id: 'q-1', code: 'UR12CD', topic: 'Proper Fraction', lang: 'ur', dir: 'rtl', grade: '3', subject: 'Maths', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'کون سا؟', options: [{ slot: 'A', text: 'ایک' }, { slot: 'B', text: 'دو' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  art: { teach: TEACH, teach_v: '0a1b2c3d' },
  brand: 'niete',
  rt: false,
  fast: true,
  ui: { ur2: true },
});

let srv;
let t;
let calls;
async function boot(on) {
  t = 1_800_000_000_000; calls = [];
  const opts = { botUrl: BOT, apiKey: KEY, now: () => t, fetchImpl: async (u) => { calls.push(String(u)); return jsonRes(200, URDU()); } };
  if (on !== undefined) opts.headFullOn = async () => on;
  const app = express(); app.set('trust proxy', 1); app.use(createWebQuizRouter(opts));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())).then(() => { srv = null; }));

/** GET path as `ua`; the first chunk (what went before the bot answered, on a streamed page) and the whole body. */
const get = (path, ua) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, headers: { host: 'portal.example', 'user-agent': ua } }, (res) => {
    const chunks = []; res.setEncoding('utf8');
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, first: chunks[0] || '', body: chunks.join('') }));
  });
  r.on('error', reject); r.end();
});
const headOf = (html) => {
  const lang = /<html lang="(\w+)"/.exec(html);
  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  return { lang: lang && lang[1], title: title && title[1] };
};
// another code's open teaches this copy the fast page (its facts are that code's only)
const prime = () => get('/q/ZZ99ZZ', PHONE);
// the page's first open teaches this copy the code; the second comes after the picture's 120 s
async function learnThenWait(ua) {
  await get('/q/UR12CD', PHONE);
  t += 121000;
  return get('/q/UR12CD', ua);
}

describe('ON: a guessed head never says less than the real head', () => {
  test('a phone\'s head after the picture\'s 120 s: the quiz\'s language and title, not English and blank', async () => {
    await boot(true);
    const res = await learnThenWait(PHONE);
    const head = headOf(res.first);
    expect(head.lang).toBe('ur');
    expect(head.title).toContain('Proper Fraction');
  });

  test('the picture itself is still not named after its 120 s', async () => {
    await boot(true);
    const res = await learnThenWait(PHONE);
    expect(res.first).not.toContain('/art/teach.png');
  });

  test.each([
    ['a plain fetch', 'curl/8.7.1'],
    ['a preview fetcher not on the list', 'WhatsApp/2.24.20.80 W'],
    ['no user agent', ''],
  ])('%s on a copy that never saw the code: the real head (waits for the bot)', async (_n, ua) => {
    await boot(true);
    await prime();
    const res = await get('/q/UR12CD', ua);
    expect(res.status).toBe(200);
    const head = headOf(res.body);
    expect(head.lang).toBe('ur');
    expect(head.title).toContain('Proper Fraction');
    expect(res.body.match(/<title>/g)).toHaveLength(1);
    expect(res.body).not.toContain('document.title=');
  });

  test('a phone on a copy that never saw the code still gets the fast first page (the head before the bot)', async () => {
    await boot(true);
    await prime();
    const res = await get('/q/UR12CD', PHONE);
    expect(res.status).toBe(200);
    // the guess went first; the bot's answer sets the tab's title before any script runs
    expect(res.body).toMatch(/document\.title="[^"]*Proper Fraction/);
  });

  test('a phone within the 120 s: the same head as today', async () => {
    await boot(undefined);
    await get('/q/UR12CD', PHONE);
    const today = await get('/q/UR12CD', PHONE);
    srv.close(); srv = null;
    await boot(true);
    await get('/q/UR12CD', PHONE);
    const on = await get('/q/UR12CD', PHONE);
    expect(on.body).toBe(today.body);
  });
});

describe('OFF: today\'s pages, byte for byte', () => {
  test.each([
    ['a phone after 120 s', PHONE, true],
    ['a plain fetch, never seen', 'curl/8.7.1', false],
  ])('%s', async (_n, ua, wait) => {
    await boot(undefined);
    const today = wait ? await learnThenWait(ua) : await prime().then(() => get('/q/UR12CD', ua));
    srv.close(); srv = null;
    await boot(false);
    const off = wait ? await learnThenWait(ua) : await prime().then(() => get('/q/UR12CD', ua));
    expect(off.body).toBe(today.body);
    expect(off.first).toBe(today.first);
  });
});
