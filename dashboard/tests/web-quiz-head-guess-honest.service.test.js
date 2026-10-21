/**
 * web_quiz_head_guess_honest (app_settings, JSON true only, default OFF; read only while web_quiz_head_full is on, for
 * a page that streams): a head the edge guesses for a phone's browser before the bot answers never says what it does
 * not know.
 * Today, with nothing kept for the code, the guessed head says " · Class quiz" and "0 questions", and for a friend's
 * challenge it drops the challenge line. A link-preview bot that sends a phone's user agent shows that card.
 * ON: (1) no question count it does not know (never "0 questions"), in English and Urdu; (2) no kind label it does not
 * know ("Class quiz"): the generic quiz words; (3) a code whose facts are kept: today's head.
 * OFF (absent, false, "true", 1): every page is today's, byte for byte.
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked but the database client in the
 * switch-read rows.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const PHONE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
  };
}
const questions = (n) => Array.from({ length: n }, (_, i) => ({ qid: `x${i}`, i: i + 1, text: `Which one ${i}?`, options: [{ slot: 'A', text: '6' }, { slot: 'B', text: '12' }], correct_slot: 'B' }));
const CLASS = () => ({
  quiz: { id: 'q-1', code: 'LC12MD', topic: 'Least Common Multiple (LCM)', lang: 'en', dir: 'ltr', grade: '4', subject: 'Maths', n: 6, questions: questions(6) },
  cls: { label: 'Class 4', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  art: {},
  brand: 'niete',
  rt: false,
  fast: true,
});
const CHALLENGE = () => ({
  ...CLASS(),
  quiz: { ...CLASS().quiz, code: 'CH34EF', topic: 'LCM' },
  challenge: { first: 'Asha Testwala', correct: 4, total: 6 },
  art: { invite: 'i.CH34EF.abcdefghijkl' },
  invited: true,
});
const ANSWERS = { LC12MD: CLASS, CH34EF: CHALLENGE, ZZ99ZZ: CLASS };

let srv;
let reads;
// full: web_quiz_head_full's value; honest: this switch's value (undefined: no reader passed, today's router)
async function boot({ full, honest } = {}) {
  reads = { full: 0, honest: 0 };
  const opts = {
    botUrl: BOT,
    apiKey: KEY,
    fetchImpl: async (u) => {
      const m = /\/wq\/quiz\/([A-Z0-9]+)/.exec(String(u));
      return m && ANSWERS[m[1]] ? jsonRes(200, ANSWERS[m[1]]()) : jsonRes(404, { error: 'not_found' });
    },
  };
  if (full !== undefined) opts.headFullOn = async () => { reads.full += 1; return full; };
  if (honest !== undefined) opts.headGuessHonestOn = async () => { reads.honest += 1; return honest; };
  const app = express(); app.set('trust proxy', 1); app.use(createWebQuizRouter(opts));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const close = () => new Promise((r) => (srv ? srv.close(r) : r())).then(() => { srv = null; });
afterEach(close);

/** GET path as `ua`; the first chunk (what went before the bot answered, on a streamed page) and the whole body. */
const get = (path, ua = PHONE, method = 'GET') => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, headers: { host: 'portal.example', 'user-agent': ua } }, (res) => {
    const chunks = []; res.setEncoding('utf8');
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, first: chunks[0] || '', body: chunks.join('') }));
  });
  r.on('error', reject); r.end();
});
const unesc = (t) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const headOf = (html) => {
  const m = (rx) => { const x = rx.exec(html); return x ? unesc(x[1]) : null; };
  return {
    lang: m(/<html lang="(\w*)"/),
    title: m(/<title>([\s\S]*?)<\/title>/),
    ogTitle: m(/<meta property="og:title" content="([^"]*)">/),
    desc: m(/<meta property="og:description" content="([^"]*)">/),
  };
};
// another code's open teaches this copy the fast page (its facts are that code's only)
const prime = () => get('/q/ZZ99ZZ');

describe('ON: a guessed head with nothing kept says no fact it does not know', () => {
  test('a class code, a phone browser: no "0 questions" (the real page says 6)', async () => {
    await boot({ full: true, honest: true });
    await prime();
    const res = await get('/q/LC12MD');
    expect(res.status).toBe(200);
    const guess = headOf(res.first);
    expect(guess.desc).not.toMatch(/\d+ questions?/);
    expect(guess.desc).toBe('Jugnu reads it with you');
    expect(guess.title).not.toMatch(/^ · /);
    // the page itself still gets the real title before any script runs
    expect(res.body).toContain('document.title="Least Common Multiple (LCM) · Class 4 quiz"');
  });

  test('a challenge code, a phone browser: no "Class quiz", no "0 questions"', async () => {
    await boot({ full: true, honest: true });
    await prime();
    for (let i = 0; i < 2; i += 1) {
      // twice: the second open is answered from what the first kept (the challenge line)
      const res = await get('/q/CH34EF');
      const guess = headOf(res.first);
      if (i === 0) {
        expect(guess.title).not.toMatch(/Class/);
        expect(guess.ogTitle).not.toMatch(/Class/);
        expect(guess.desc).not.toMatch(/\d+ questions?/);
        expect(guess.title).toBe('Quiz');
      } else {
        expect(guess.title).toBe("Can you beat Asha Testwala's 4/6? · LCM");
        expect(guess.desc).toBe('Play the same quiz and see!');
      }
    }
  });

  test('every word of the guess is in the real head (or there is no such fact)', async () => {
    await boot({ full: true, honest: true });
    await prime();
    const res = await get('/q/LC12MD');
    const real = headOf(await get('/q/LC12MD', 'curl/8.7.1').then((r) => r.body));
    const guess = headOf(res.first);
    expect(real.desc).toContain(guess.desc);
    expect(real.title.toLowerCase()).toContain(guess.title.toLowerCase());
  });

  test('an Urdu link (?lang=ur), nothing kept: the guess in Urdu, with no count', async () => {
    await boot({ full: true, honest: true });
    await prime();
    const res = await get('/q/LC12MD?lang=ur');
    const guess = headOf(res.first);
    expect(guess.lang).toBe('ur');
    expect(guess.title).toBe('کوئز');
    expect(guess.desc).toBe('جگنو کے ساتھ پڑھیں');
    expect(guess.desc).not.toMatch(/سوال/);
    // the bot's English page sets its own language before any script runs
    expect(res.body).toContain('h.lang="en"');
  });

  test('a code whose facts are kept: today\'s head', async () => {
    await boot({ full: true, honest: undefined });
    await get('/q/CH34EF');
    const today = await get('/q/CH34EF');
    await close();
    await boot({ full: true, honest: true });
    await get('/q/CH34EF');
    const on = await get('/q/CH34EF');
    expect(on.body).toBe(today.body);
    expect(on.first).toBe(today.first);
    expect(headOf(on.first).title).toBe("Can you beat Asha Testwala's 4/6? · LCM");
  });
});

describe('OFF: today\'s pages, byte for byte', () => {
  const walk = async () => {
    const out = [];
    await prime();
    for (const [path, ua] of [['/q/LC12MD', PHONE], ['/q/CH34EF', PHONE], ['/q/LC12MD?lang=ur', PHONE], ['/q/CH34EF', PHONE], ['/q/LC12MD', 'curl/8.7.1'], ['/q/CH34EF', 'WhatsApp/2.24.20.80 A']]) {
      const r = await get(path, ua);
      out.push([r.status, r.first, r.body]);
    }
    return out;
  };
  test.each([
    [false], ['true'], [1], [null],
  ])('the switch %p (head_full on and off)', async (value) => {
    for (const full of [true, false]) {
      await boot({ full, honest: undefined });
      const today = await walk();
      await close();
      await boot({ full, honest: value });
      const off = await walk();
      await close();
      expect(off).toEqual(today);
    }
  });
});

describe('the switch is read only while head_full is on, for a page that streams', () => {
  test('head_full off: never read', async () => {
    await boot({ full: false, honest: true });
    await prime();
    await get('/q/LC12MD');
    await get('/q/CH34EF');
    expect(reads.honest).toBe(0);
  });

  test('head_full on: read for a phone\'s streamed page, not for a plain fetch, a preview fetch, or the class view', async () => {
    await boot({ full: true, honest: true });
    await get('/q/ZZ99ZZ', 'curl/8.7.1');
    await get('/q/LC12MD', 'curl/8.7.1');
    await get('/q/LC12MD', 'WhatsApp/2.24.20.80 A');
    await get('/q/LC12MD', PHONE, 'HEAD');
    await get('/q/LC12MD/class');
    await get('/q/LC12MD?nf=1');
    expect(reads.honest).toBe(0);
    await get('/q/LC12MD');
    expect(reads.honest).toBe(1);
  });
});

describe('the switch\'s own read: JSON true only', () => {
  afterEach(() => { jest.resetModules(); jest.dontMock('../config/supabase'); });
  const reader = (value) => {
    jest.resetModules();
    jest.doMock('../config/supabase', () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value } }) }) }) }) }));
    return require('../routes/web-quiz-story-assets').flagReader({ now: () => 0, key: 'web_quiz_head_guess_honest', jsonTrue: true });
  };
  test.each([
    [true, true], [undefined, false], [false, false], ['true', false], [1, false], ['yes', false], [null, false],
  ])('%p → %p', async (value, on) => {
    expect(await reader(value)()).toBe(on);
  });
});
