'use strict';
/**
 * The family door: GET /f/<token>, POST /api/ft/code, GET /f/<token>/teacher.
 *
 *   a genuine family token → 200, every fd.* string in the token's language (`bi` → Urdu with an "English" switch),
 *     no maker link, no /api/ft/door, no "Change my choice", no test word, no kid/dk, no phone number in the markup;
 *   a genuine but expired token → 200, the same page with mk.stale; a forged token → 403, never 404 or 500;
 *   a QUIZ- code in any of its typed forms → 302 /q/<six characters> (the path /q/ serves today); a JUGNU- code,
 *     junk, empty → 200 with fd.bad (the page is not the chat: never the binder); never a 500;
 *   the teacher escape → 302 wa.me/<the share's bot number>?text=<looksLikeTeacherClaim's phrase>;
 *   onboard.family_door{step, ukey, w:'s'} — the ukey only from the token's `uk`, never kid, dk, the code or the token.
 * Only the boundary is faked (Supabase via the web quiz tests' fake, Redis, the loggers); the token signer, the family token
 * module and the routes are real, served by a real express app on an ephemeral port.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Token = require('../../shared/services/quiz/web-quiz-token');
const FamilyToken = require('../../shared/services/first-touch/family.token');
const Family = require('../../shared/services/first-touch/family.door');
const Routes = require('../../shared/services/first-touch/family.routes');
const { ukeyOf } = require('../../shared/services/quiz/child-phone-bindings.repo');
const { UNKNOWN_USER, PHONE, OURS_ON, seedDb, fixturePhone } = require('./door-fixture');

const SAVED = { ...process.env };
const BOT = fixturePhone(7);
const UID = UNKNOWN_USER.id;
const pass = (req, res, next) => next();
const PASS = { read: pass, session: pass, badCode: pass };

let server;
let base;
async function start(opts) {
  const app = express();
  const router = express.Router();
  Routes.mount(router, opts);
  app.use(router);
  const s = await new Promise((resolve) => { const x = app.listen(0, () => resolve(x)); });
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

beforeAll(async () => {
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key', WHATSAPP_BOT_NUMBER: BOT };
  ({ s: server, base } = await start({ limiters: PASS }));
});
afterAll(async () => {
  process.env = SAVED;
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  jest.clearAllMocks();
  seedDb(supabase, { settings: OURS_ON });
});

const nowS = () => Math.floor(Date.now() / 1000);
const UKEY = () => ukeyOf(PHONE);
const fresh = (lang = 'ur', ukey = UKEY()) => FamilyToken.mintFamilyToken({ uid: UID, lang, ukey });
const stale = (lang = 'ur') => Token.sign({ k: 'f', uid: UID, lang, uk: UKEY(), exp: nowS() - 60 });
const forged = () => { const t = fresh(); return `${t.slice(0, -4)}${t.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`; };
const makerToken = () => Token.sign({ k: 'm', uid: UID, lang: 'ur', tour: 0, via: 'door', exp: nowS() + 3600 });

const get = (p, headers = {}) => fetch(`${base}${p}`, { redirect: 'manual', headers });
const postForm = (p, fields) => fetch(`${base}${p}`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(fields) });
const postJson = (p, obj) => fetch(`${base}${p}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = (id, lang) => Family.STRINGS[id][lang];
/** The page with every token occurrence cut out (a base64url token can spell anything). */
const withoutTokens = (html, ...tokens) => tokens.reduce((h, t) => h.split(t).join('').split(encodeURIComponent(t)).join(''), html);
/** What a person can read: no style, no tags. */
const visibleText = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const familyEvents = () => logEvent.mock.calls.filter(([e]) => e === 'onboard.family_door').map(([, p]) => p);

const TEST_WORDS = /\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i;
const PAGE_IDS = ['fd.h', 'fd.sub', 'fd.code', 'fd.open', 'fd.none', 'fd.teacher', 'fd.ask.btn'];

function expectCleanPage(html, ...tokens) {
  const h = withoutTokens(html, ...tokens);
  expect(h).not.toContain('/m/');
  expect(h).not.toContain('/api/ft/door');
  expect(h).not.toContain('Change my choice');
  expect(h).not.toContain('اپنا انتخاب بدلیں');
  expect(visibleText(h)).not.toMatch(TEST_WORDS);
  expect(h).not.toMatch(/\bkid\b|\bdk\b/);
  expect(h).not.toContain(BOT);                                   // the bot's number never sits in the markup
  expect(h).not.toMatch(/<input[^>]+name="(?:name|phone|grade|class)"/i);  // the only field is the code
  expect((h.match(/<input[^>]*>/g) || []).filter((i) => !/type="hidden"/.test(i)).length).toBeLessThanOrEqual(1);
}

describe('GET /f/:token', () => {
  test('a Urdu token → 200, every fd.* string in Urdu, right to left, no switch; open event with the ukey only', async () => {
    const t = fresh('ur');
    const r = await get(`/f/${t}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toMatch(/<html lang="ur" dir="rtl">/);
    for (const id of PAGE_IDS) expect(html).toContain(esc(S(id, 'ur')));
    expect(html).not.toContain(esc(S('fd.bad', 'ur')));
    expect(html).not.toContain('?lang=');                          // a Urdu token offers no switch
    expect(html).toContain('action="/api/ft/code"');
    expect(html).toContain(`href="/f/${encodeURIComponent(t)}/teacher?l=ur"`);
    expect(html).toContain(`https://wa.me/?text=${encodeURIComponent(S('fd.ask', 'ur'))}`);
    expect(html).toMatch(/dir="ltr"><span class="fd-pre" aria-hidden="true">QUIZ-<\/span>/);  // the Latin atom, isolated
    expectCleanPage(html, t);
    expect(familyEvents()).toEqual([{ step: 'open', ukey: UKEY(), w: 's' }]);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'/);
  });

  test('a bilingual token → the Urdu page with an "English" switch; ?lang=en → the English page with «اردو»', async () => {
    const t = fresh('bi');
    const ur = await (await get(`/f/${t}`)).text();
    expect(ur).toMatch(/<html lang="ur"/);
    expect(ur).toContain(`href="/f/${encodeURIComponent(t)}?lang=en">${S('mk.lang.switch', 'ur')}</a>`);
    const r = await get(`/f/${t}?lang=en`);
    expect(r.status).toBe(200);
    const en = await r.text();
    expect(en).toMatch(/<html lang="en" dir="ltr">/);
    for (const id of PAGE_IDS) expect(en).toContain(esc(S(id, 'en')));
    expect(en).toContain(`href="/f/${encodeURIComponent(t)}?lang=ur">${S('mk.lang.switch', 'en')}</a>`);
    expect(en).toContain(`https://wa.me/?text=${encodeURIComponent(S('fd.ask', 'en'))}`);
    expectCleanPage(en, t);
  });

  test('a token without a ukey → the open event carries no ukey field at all', async () => {
    const t = fresh('ur', null);
    expect((await get(`/f/${t}`)).status).toBe(200);
    expect(familyEvents()).toEqual([{ step: 'open', w: 's' }]);
  });

  test('a genuine but expired token → 200, the same page with the expiry line (mk.stale), the code box still works', async () => {
    const t = stale('ur');
    const r = await get(`/f/${t}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain(esc(S('mk.stale', 'ur')));
    expect(html).toContain('action="/api/ft/code"');
    expectCleanPage(html, t);
    expect(familyEvents()).toEqual([{ step: 'open', ukey: UKEY(), w: 's' }]);
  });

  test.each([
    ['a forged signature', () => forged()],
    ['a maker token', () => makerToken()],
    ['garbage', () => 'not-a-token'],
    ['an over-long value', () => `${'A'.repeat(1500)}.${'B'.repeat(22)}`],
  ])('%s → 403, the page without the teacher link or the token, no event; never 404/500', async (_, make) => {
    const t = make();
    const r = await get(`/f/${encodeURIComponent(t)}`, { 'accept-language': 'ur-PK' });
    expect(r.status).toBe(403);
    const html = await r.text();
    expect(html).toMatch(/<html lang="ur"/);
    expect(html).not.toContain('/teacher');
    expect(html).not.toContain('name="t"');
    expectCleanPage(html, t);
    expect(familyEvents()).toEqual([]);
  });
});

describe('POST /api/ft/code', () => {
  test.each([
    ['QUIZ-A7K2PQ'], ['quiz-a7k2pq'], ['QUIZ A7K2PQ'], ['  QUIZ-A7K2PQ  '], ['a7k2pq'],
    ['https://quiz.example.org/q/A7K2PQ'], ['https://quiz.example.org/q/QUIZ-A7K2PQ?x=1'], ['⁦QUIZ-A7K2PQ⁩'],
  ])('%j → 302 /q/A7K2PQ (today\'s child page, unchanged) + code_ok with the ukey; the code is never logged', async (code) => {
    const t = fresh('ur');
    const r = await postForm('/api/ft/code', { t, code });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/q/A7K2PQ');
    expect(familyEvents()).toEqual([{ step: 'code_ok', ukey: UKEY(), w: 's' }]);
    expect(JSON.stringify(logEvent.mock.calls)).not.toMatch(/A7K2PQ/i);
  });

  test('a JSON body is read the same way', async () => {
    const r = await postJson('/api/ft/code', { t: fresh('ur'), code: 'quiz-a7k2pq' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/q/A7K2PQ');
  });

  test.each([
    ['a JUGNU- code', 'JUGNU-ABCDE'],
    ['junk', 'hello there!'],
    ['empty', ''],
    ['the prefix alone', 'QUIZ-'],
    ['seven characters', 'QUIZ-A7K2PQX'],
    ['a very long paste', 'x'.repeat(3000)],
  ])('%s → 200 with fd.bad in the page\'s language + code_bad; never the binder, never 500', async (_, code) => {
    const t = fresh('ur');
    const r = await postForm('/api/ft/code', { t, code, l: 'ur' });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain(esc(S('fd.bad', 'ur')));
    expect(html).toContain('aria-invalid="true"');
    expectCleanPage(html, t);
    expect(familyEvents()).toEqual([{ step: 'code_bad', ukey: UKEY(), w: 's' }]);
    expect(JSON.stringify(logEvent.mock.calls)).not.toMatch(/JUGNU/);
    expect(logEvent.mock.calls.some(([e]) => /bind/i.test(e))).toBe(false);
  });

  test('a JUGNU- code is not shown back after the fixed "QUIZ-"; a plain typo is, to fix', async () => {
    const t = fresh('bi');
    const jugnu = await (await postForm('/api/ft/code', { t, code: 'JUGNU-ABCDE', l: 'en' })).text();
    expect(jugnu).toMatch(/<html lang="en"/);
    expect(jugnu).toContain(esc(S('fd.bad', 'en')));
    expect(jugnu).not.toContain('JUGNU');
    const typo = await (await postForm('/api/ft/code', { t, code: 'A7K2P', l: 'en' })).text();
    expect(typo).toContain('value="A7K2P"');
  });

  test('no body, a broken JSON body, an over-cap body → 200 with fd.bad, never 500', async () => {
    const none = await fetch(`${base}/api/ft/code`, { method: 'POST', redirect: 'manual' });
    expect(none.status).toBe(200);
    const broken = await fetch(`${base}/api/ft/code`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: '{"t":' });
    expect(broken.status).toBe(200);
    expect(await broken.text()).toContain(esc(S('fd.bad', 'en')));
    const big = await postForm('/api/ft/code', { t: 'x', code: 'y'.repeat(20000) });
    expect(big.status).toBe(200);
  });

  test('a forged token still gets a valid code\'s redirect (the code is public), but no event is counted for it', async () => {
    const r = await postForm('/api/ft/code', { t: forged(), code: 'QUIZ-A7K2PQ' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/q/A7K2PQ');
    expect(familyEvents()).toEqual([]);
    const bad = await postForm('/api/ft/code', { t: forged(), code: 'JUGNU-ABCDE' });
    expect(bad.status).toBe(200);
    expect(await bad.text()).not.toContain('/teacher');
    expect(familyEvents()).toEqual([]);
  });

  test('a stale token: the code still opens, and the event keeps the ukey', async () => {
    const r = await postForm('/api/ft/code', { t: stale('ur'), code: 'QUIZ-A7K2PQ' });
    expect(r.status).toBe(302);
    expect(familyEvents()).toEqual([{ step: 'code_ok', ukey: UKEY(), w: 's' }]);
  });

  test('the failed-code limiter: after 20 refusals in a minute from one address → 429, never 500; a good code is not counted', async () => {
    const real = await start({});
    try {
      const t = fresh('ur');
      for (let i = 0; i < 5; i += 1) {
        expect((await fetch(`${real.base}/api/ft/code`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ t, code: 'QUIZ-A7K2PQ' }) })).status).toBe(302);
      }
      const codes = [];
      for (let i = 0; i < 21; i += 1) {
        codes.push((await fetch(`${real.base}/api/ft/code`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ t, code: 'nope' }) })).status);
      }
      expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
      expect(codes[20]).toBe(429);
    } finally {
      await new Promise((r) => real.s.close(r));
    }
  });
});

describe('GET /f/:token/teacher — the countable escape to the chat', () => {
  test.each([
    ['ur', 'ur', 'میں ٹیچر ہوں'],
    ['bi', 'en', 'I am a teacher'],
    ['bi', 'ur', 'میں ٹیچر ہوں'],
  ])('a %s token from the %s page → 302 wa.me/<bot>?text=<the claim phrase> + teacher_link', async (tokenLang, l, phrase) => {
    const r = await get(`/f/${fresh(tokenLang)}/teacher?l=${l}`);
    expect(r.status).toBe(302);
    const loc = r.headers.get('location');
    expect(loc.startsWith(`https://wa.me/${BOT}?text=`)).toBe(true);
    expect(decodeURIComponent(loc.split('?text=')[1])).toBe(phrase);
    expect(familyEvents()).toEqual([{ step: 'teacher_link', ukey: UKEY(), w: 's' }]);
  });

  test('the claim phrases are exactly student-mode\'s looksLikeTeacherClaim words', () => {
    const { looksLikeTeacherClaim } = require('../../shared/services/student-mode.service');
    expect(Family.CLAIM).toEqual({ en: 'I am a teacher', ur: 'میں ٹیچر ہوں' });
    expect(looksLikeTeacherClaim(Family.CLAIM.en)).toBe(true);
    expect(looksLikeTeacherClaim(Family.CLAIM.ur)).toBe(true);
  });

  test('a forged token → 403, no event; no bot number configured → back to the page, no event, never 500', async () => {
    expect((await get(`/f/${forged()}/teacher?l=en`)).status).toBe(403);
    expect(familyEvents()).toEqual([]);
    delete process.env.WHATSAPP_BOT_NUMBER;
    delete process.env.REFERRAL_BOT_NUMBER;
    try {
      const t = fresh('ur');
      const r = await get(`/f/${t}/teacher?l=ur`);
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe(`/f/${encodeURIComponent(t)}`);
      expect(familyEvents()).toEqual([]);
    } finally {
      process.env.WHATSAPP_BOT_NUMBER = BOT;
    }
  });
});

describe('the page renderer', () => {
  test('renderFamilyDoor returns the HTML string; the strings are the signed copy, verbatim', () => {
    const html = Family.renderFamilyDoor({ token: fresh('ur'), lang: 'en', state: 'code_bad' });
    expect(typeof html).toBe('string');
    expect(html).toContain(esc(S('fd.bad', 'en')));
    expect(S('fd.teacher', 'en')).toBe("I'm a teacher");
    expect(S('fd.open', 'ur')).toBe('کلاس کا کوئز کھولیں');
    expect(S('mk.stale', 'en')).toBe('This link has expired. For a new one, send “quiz” in the chat.');
    expect(S('mk.stale', 'ur').indexOf('”')).toBeLessThan(S('mk.stale', 'ur').indexOf('“'));  // UR quotes: U+201D first
  });

  test('normaliseCode: the forms the page accepts and the ones it refuses', () => {
    expect(Family.normaliseCode('quiz-a7k2pq')).toBe('A7K2PQ');
    expect(Family.normaliseCode('QUIZ_A7K2PQ')).toBe('A7K2PQ');
    expect(Family.normaliseCode('JUGNU-ABCDE')).toBeNull();
    expect(Family.normaliseCode('JUGNU-ABCDEF')).toBeNull();
    expect(Family.normaliseCode('')).toBeNull();
    expect(Family.normaliseCode(null)).toBeNull();
    expect(Family.normaliseCode({ code: 'QUIZ-A7K2PQ' })).toBeNull();
  });
});
