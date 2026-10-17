'use strict';
/**
 * An expired, forged or failed link page is never a dead end (switch web_quiz_closed_way_back ON, default OFF; its own
 * switch, not quiz_one_door): the one door's go.stale /
 * go.error pages, the quiz-maker's mk.stale / mk.error pages and the teacher home's mk.stale / mk.error pages each carry
 * ONE tap back to WhatsApp whose words are the signed sentence
 *   EN "Open WhatsApp and send 'quiz' to Jugnu."
 *   UR «واٹس<U+00A0>ایپ کھولیں اور جگنو کو "کوئز" لکھ کر بھیجیں۔»
 * and whose href is https://wa.me/<digits>?text=quiz when this deployment knows its number, else
 * whatsapp://send?text=quiz (never an empty href, never an <a> without one).
 *
 * The one door's landing only serves while quiz_one_door is ON, so it is ON in every state below and ONLY
 * web_quiz_closed_way_back varies. Way back OFF in every state (absent, false, the string "true", "\"true\"", "yes", a
 * read of that key that throws): every page is byte-identical to today's page with the door ON —
 * sha256(html + "\n" + csp) pinned in __goldens__/way-back-off.json, recorded by running this file on the code before
 * the change (WAY_BACK_RECORD=1). Door OFF: the landing is still 404 {off:true}. Only the network boundary is faked.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const { seedDb } = require('./door-fixture');
const { TEACHER } = require('./maker-fixture');
const OneDoorFlags = require('../../shared/services/first-touch/one-door.flags');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const HomeFlags = require('../../shared/services/first-touch/teacher-home.flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const GoPage = require('../../shared/services/first-touch/go.page');
const MakerPage = require('../../shared/services/first-touch/maker.page');
const { mountGo } = require('../../shared/services/first-touch/go.mount');
const { createRouter: homeRouter } = require('../../shared/services/first-touch/teacher-home.routes');

// the bot's WhatsApp number, built at run time (no phone-shaped literal in the source)
const BOT = ['92', '300', '000', '0000'].join('');
const WA = `https://wa.me/${BOT}?text=quiz`;
const APP = 'whatsapp://send?text=quiz';
const EN = "Open WhatsApp and send 'quiz' to Jugnu.";
const UR = 'واٹس ایپ کھولیں اور جگنو کو "کوئز" لکھ کر بھیجیں۔';

const GOLDEN_FILE = path.join(__dirname, '__goldens__', 'way-back-off.json');
const RECORD = process.env.WAY_BACK_RECORD === '1';
const recorded = {};
const golden = RECORD ? {} : JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
// hex in groups of 8 (no long digit run in the pinned file)
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').match(/.{8}/g).join('-');
/** The case's bytes against the pinned page from before the change (record mode: pin them). */
function expectGolden(key, html, csp) {
  const h = sha(`${html}\n${csp || ''}`);
  if (RECORD) { recorded[key] = h; return; }
  expect({ key, h }).toEqual({ key, h: golden[key] });
}
afterAll(() => {
  if (RECORD) fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(Object.keys(recorded).sort().reduce((o, k) => ({ ...o, [k]: recorded[k] }), {}), null, 2)}\n`);
});

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** Exactly ONE <a> on the page, with a non-empty href equal to `href`, its words holding every one of `sentences`. */
function expectOneTap(html, href, sentences) {
  const opens = html.match(/<a\b[^>]*>/g) || [];
  expect(opens).toHaveLength(1);
  expect(html).not.toContain('href=""');
  const m = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
  expect(m).not.toBeNull();
  expect(decode(m[1])).toBe(href);
  const words = decode(m[2].replace(/<[^>]+>/g, ' '));
  sentences.forEach((s) => expect(words).toContain(s));
  return words;
}

// ── the switch states ──
const WB = 'web_quiz_closed_way_back';
const STATES = {
  on: { quiz_one_door: true, [WB]: true },
  absent: { quiz_one_door: true },
  false: { quiz_one_door: true, [WB]: false },
  string: { quiz_one_door: true, [WB]: 'true' },
  quoted: { quiz_one_door: true, [WB]: '"true"' },
  yes: { quiz_one_door: true, [WB]: 'yes' },
  throws: { quiz_one_door: true, [WB]: true },
  // the door OFF: the landing answers 404 {off:true}; the maker / home pages follow the way-back switch alone
  doorOff: { [WB]: true },
  doorOffWayBackOff: {},
};
let fake;
const resetWayBack = () => { try { require('../../shared/services/first-touch/closed-way-back.flags')._resetCache(); } catch (_) { /* not on this code */ } };
function seed(state) {
  fake = seedDb(supabase, { settings: { quiz_maker_page: true, quiz_teacher_home: true, ...STATES[state] } });
  if (state === 'throws') {
    // only the read of the way-back key fails; every other switch reads as seeded
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const realEq = b.eq;
      const realIn = b.in;
      b.eq = (c, v) => { if (v === WB) throw new Error('app_settings down'); return realEq(c, v); };
      b.in = (c, vs) => { if ([].concat(vs).includes(WB)) throw new Error('app_settings down'); return realIn(c, vs); };
      return b;
    };
  }
  OneDoorFlags._resetCache(); IdFlags._resetCache(); HubFlags._resetCache(); HomeFlags.reset(); resetWayBack();
}
const saved = { W: process.env.WHATSAPP_BOT_NUMBER, R: process.env.REFERRAL_BOT_NUMBER };
function number(on) {
  delete process.env.WHATSAPP_BOT_NUMBER; delete process.env.REFERRAL_BOT_NUMBER;
  if (on) process.env.WHATSAPP_BOT_NUMBER = `+92 300 ${BOT.slice(5)}`;
}
afterAll(() => {
  if (saved.W === undefined) delete process.env.WHATSAPP_BOT_NUMBER; else process.env.WHATSAPP_BOT_NUMBER = saved.W;
  if (saved.R === undefined) delete process.env.REFERRAL_BOT_NUMBER; else process.env.REFERRAL_BOT_NUMBER = saved.R;
});

// ── one app: the one door's landing, the quiz-maker router, the teacher home router ──
let srv;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  expect(mountGo(app)).toBe(true);
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  app.use('/api/internal/th', homeRouter({}));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
});
afterAll(() => new Promise((r) => srv.close(r)));
const H = { 'x-api-key': 'unit-internal-key-not-a-secret' };
async function get(p) {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${p}`, { headers: H, redirect: 'manual' });
  return { status: r.status, csp: r.headers.get('content-security-policy'), html: await r.text() };
}
const makerToken = () => MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'door', uk: ['01234', '56789abcdef'].join('') });

// The dead-end pages served by the bot, by route: [name, path, the page's language].
const MAKER_PAGES = [
  ['maker.stale.en', () => '/api/internal/ft/m/garbage', 'en'],
  ['maker.stale.ur', () => '/api/internal/ft/m/garbage?lang=ur', 'ur'],
  ['maker.error.en', () => `/api/internal/ft/m/${makerToken()}/send?c=not-a-code`, 'en'],
];
const HOME_PAGES = [
  ['home.stale.ur', () => '/api/internal/th/quiz/teacher/garbage?lang=ur', 'ur'],
  ['home.stale.en', () => '/api/internal/th/quiz/teacher/garbage?lang=en', 'en'],
];

describe('switch ON, no number configured: ONE tap, href whatsapp://send?text=quiz, the signed sentence', () => {
  beforeEach(() => number(false));

  test('the one door\'s go.stale page (a forged link): the bilingual tap, Urdu with U+00A0 and English', async () => {
    seed('on');
    const r = await get('/api/internal/go/land/garbage');
    expect(r.status).toBe(200);
    expect(r.html).toContain('data-screen="go.stale"');
    const words = expectOneTap(r.html, APP, [UR, EN]);
    expect(words).toContain('واٹس ایپ');
    expect(words).not.toContain('واٹس ایپ');
    // the existing line stays
    expect(r.html).toContain(GoPage.buildMessagePage({ id: 'go.stale', lang: 'bi' }).html.match(/<p class="msg">[\s\S]*?<\/p>/)[0]);
  });

  test('go.error and go.stale built with the switch on, every language: ONE tap, the app link', () => {
    for (const id of ['go.stale', 'go.error']) {
      expectOneTap(GoPage.buildMessagePage({ id, lang: 'ur', door: true }).html, APP, [UR]);
      expect(GoPage.buildMessagePage({ id, lang: 'ur', door: true }).html).not.toContain(EN);
      expectOneTap(GoPage.buildMessagePage({ id, lang: 'bi', door: true }).html, APP, [UR, EN]);
      expectOneTap(GoPage.buildMessagePage({ id, lang: 'bi', bot: 'not a number', door: true }).html, APP, [UR, EN]);
    }
    // the family words are not a dead end: unchanged
    expect(GoPage.buildMessagePage({ id: 'go.family', lang: 'bi', door: true }).html).toBe(GoPage.buildMessagePage({ id: 'go.family', lang: 'bi' }).html);
  });

  test('the quiz-maker\'s mk.stale / mk.error pages', async () => {
    const state = 'on';
    for (const [, p, lang] of MAKER_PAGES) {
      seed(state);
      const r = await get(p());
      expect([200, 404]).toContain(r.status);
      const words = expectOneTap(r.html, APP, [lang === 'en' ? EN : UR]);
      if (lang === 'ur') expect(words).toContain('واٹس ایپ');
      // the CSP still allows the page's one <style> by its hash
      const style = /<style>([\s\S]*?)<\/style>/.exec(r.html)[1];
      expect(r.csp).toContain(`'sha256-${crypto.createHash('sha256').update(style, 'utf8').digest('base64')}'`);
    }
  });

  test('the teacher home\'s mk.stale pages', async () => {
    for (const [, p, lang] of HOME_PAGES) {
      seed('on');
      const r = await get(p());
      expect(r.status).toBe(404);
      expectOneTap(r.html, APP, [lang === 'en' ? EN : UR]);
      const style = /<style>([\s\S]*?)<\/style>/.exec(r.html)[1];
      expect(r.csp).toContain(`'sha256-${crypto.createHash('sha256').update(style, 'utf8').digest('base64')}'`);
    }
  });
});

describe('the way back rides its own switch', () => {
  test('door OFF, way back ON: the maker / home pages still carry the ONE tap (the landing is off: 404)', async () => {
    number(false);
    for (const [, p, lang] of [...MAKER_PAGES, ...HOME_PAGES]) {
      seed('doorOff');
      const r = await get(p());
      expectOneTap(r.html, APP, [lang === 'en' ? EN : UR]);
    }
  });
});

describe('switch ON, number configured: ONE tap, href https://wa.me/<digits>?text=quiz (no second "Open WhatsApp")', () => {
  beforeEach(() => number(true));

  test('go.stale over the route, go.error built', async () => {
    seed('on');
    const r = await get('/api/internal/go/land/garbage');
    expectOneTap(r.html, WA, [UR, EN]);
    expect(r.html.match(/wa\.me/g)).toHaveLength(1);
    expect(r.html).not.toContain('>Open WhatsApp<');
    const e = GoPage.buildMessagePage({ id: 'go.error', lang: 'bi', bot: BOT, door: true }).html;
    expectOneTap(e, WA, [UR, EN]);
    expect(e.match(/wa\.me/g)).toHaveLength(1);
  });

  test('the quiz-maker and teacher home pages', async () => {
    for (const [, p, lang] of [...MAKER_PAGES, ...HOME_PAGES]) {
      seed('on');
      const r = await get(p());
      expectOneTap(r.html, WA, [lang === 'en' ? EN : UR]);
      expect(r.html.match(/wa\.me/g)).toHaveLength(1);
    }
  });
});

describe('way back OFF in every state (door ON): byte-identical to today\'s page', () => {
  const OFF = ['absent', 'false', 'string', 'quoted', 'yes', 'throws'];

  test.each(OFF)('the quiz-maker and teacher home dead-end pages (way back %s), with and without a number', async (state) => {
    for (const withNumber of [false, true]) {
      number(withNumber);
      for (const [name, p] of [...MAKER_PAGES, ...HOME_PAGES]) {
        seed(state);
        const r = await get(p());
        expectGolden(`${name}|${withNumber ? 'number' : 'none'}`, r.html, r.csp);
      }
    }
  });

  test.each(OFF)('the one door\'s go.stale landing (way back %s), with and without a number', async (state) => {
    for (const withNumber of [false, true]) {
      number(withNumber);
      seed(state);
      const r = await get('/api/internal/go/land/garbage');
      expect(r.status).toBe(200);
      expectGolden(`land.stale|door-on|${withNumber ? 'number' : 'none'}`, r.html, r.csp);
    }
  });

  test.each(['doorOff', 'doorOffWayBackOff'])('the door OFF (%s): the landing stays 404 {off:true}', async (state) => {
    seed(state);
    const r = await get('/api/internal/go/land/garbage');
    expect(r.status).toBe(404);
    expect(JSON.parse(r.html)).toEqual({ off: true });
  });

  test('the door OFF and the way back OFF: the maker / home pages are today\'s', async () => {
    for (const withNumber of [false, true]) {
      number(withNumber);
      for (const [name, p] of [...MAKER_PAGES, ...HOME_PAGES]) {
        seed('doorOffWayBackOff');
        const r = await get(p());
        expectGolden(`${name}|${withNumber ? 'number' : 'none'}`, r.html, r.csp);
      }
    }
  });

  test('the one door\'s message pages built without the switch (absent or false) are the pages from before', () => {
    for (const id of ['go.stale', 'go.error', 'go.family']) {
      for (const lang of ['bi', 'ur']) {
        for (const bot of [null, BOT]) {
          const key = `go.page|${id}|${lang}|${bot ? 'number' : 'none'}`;
          const plain = GoPage.buildMessagePage({ id, lang, bot });
          expectGolden(key, plain.html, plain.csp);
          const off = GoPage.buildMessagePage({ id, lang, bot, door: false });
          expect(off).toEqual(plain);
        }
      }
    }
  });

  test('the quiz-maker\'s own message page with no tap asked for is the page from before', () => {
    for (const id of ['mk.stale', 'mk.error']) {
      for (const lang of ['en', 'ur', 'bi']) {
        const b = MakerPage.buildMessagePage({ lang, id });
        expectGolden(`maker.page|${id}|${lang}`, b.html, b.csp);
      }
    }
  });
});
