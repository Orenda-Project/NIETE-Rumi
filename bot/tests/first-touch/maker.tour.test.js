'use strict';
/**
 * The maker page's one tour banner (TOUR.md §1-§5): shown iff the token says tour:0 AND no quiz_tour row exists
 * (one read on the unique key at page GET; a read error hides it), the SHOW write once (a no-op when the row exists),
 * the DISMISS write that lands even without a SHOW row, "How it works" that replays with no write, the first grade
 * chip / the pre-fill's "Use it" that dismiss it, and the never-again-on-any-browser goldens. 0 messages sent.
 * Only the network boundary is faked (supabase through the door fixture, the loggers, the WhatsApp send).
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const crypto = require('crypto');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Keys = require('../../shared/services/first-touch/door.keys');
const Page = require('../../shared/services/first-touch/maker.page');
const { STRINGS } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER } = require('./maker-fixture');
const { TABLE, firstUseReads, writes } = require('./door-fixture');
const { CASES } = require('./maker-golden-cases');
const { loadPage } = require('./_mini-dom');

const UK = '0123456789abcdef';
const tokenFor = (o = {}) => MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu', uk: UK, ...o });
const UA_WEBVIEW = 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36';
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

let srv;
let fake;
async function boot() {
  const app = express();
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
const H = (ua = UA_WEBVIEW) => ({ 'x-api-key': process.env.INTERNAL_API_KEY, 'user-agent': ua });
const get = (p, ua) => fetch(url(p), { headers: H(ua), redirect: 'manual' });
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const tour = (t, action, extra = {}) => post('/api/ft/tour', { t, action, ...extra });

function seed(opts) {
  fake = seedMaker(supabase, opts);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
}
const row = () => (fake.db[TABLE] || []).find((r) => r.user_id === TEACHER.id && r.feature === 'quiz_tour');
const events = (step) => logEvent.mock.calls.filter(([e, f]) => e === 'onboard.maker' && (!step || f.step === step)).map(([, f]) => f);
/** The banner as rendered: up (shown on load) / hidden (markup present, for the replay) / absent. */
function banner(html) {
  const m = /<div class="mk-tour" id="mk-tour"[^>]*>/.exec(html);
  if (!m) return 'absent';
  return / hidden/.test(m[0]) ? 'hidden' : 'up';
}
const sends = () => Object.values(WhatsAppService).filter((f) => typeof f === 'function' && f.mock).reduce((n, f) => n + f.mock.calls.length, 0);

beforeEach(async () => { jest.clearAllMocks(); jest.restoreAllMocks(); await boot(); });
afterEach(() => new Promise((r) => srv.close(r)));

describe('§1 — no tour in chat', () => {
  test('tour_never_sends_a_message: the page GET and show / dismiss / replay → 0 WhatsApp calls', async () => {
    seed();
    const t = tokenFor();
    expect((await get(`/m/${t}`)).status).toBe(200);
    expect((await tour(t, 'show')).status).toBe(204);
    expect((await tour(t, 'dismiss', { how: 'ok' })).status).toBe(204);
    expect((await tour(t, 'replay')).status).toBe(204);
    expect(sends()).toBe(0);
  });
});

describe('§2 — one banner, at most once per person', () => {
  test('quiz_tour_shown_once: GET → banner up; show → count 1, one tour_shown; the SAME token again → no banner; show again → still 1', async () => {
    seed();
    const t = tokenFor();
    const first = await (await get(`/m/${t}`)).text();
    expect(banner(first)).toBe('up');
    expect(first).toContain(STRINGS['mk.tour'].en);
    expect((await tour(t, 'show')).status).toBe(204);
    expect(row()).toMatchObject({ intro_shown_count: 1, video_shown_at: expect.any(String), feature_used_at: null });
    expect(events('tour_shown')).toHaveLength(1);
    const again = await (await get(`/m/${t}`)).text();
    expect(banner(again)).toBe('hidden');
    expect((await tour(t, 'show')).status).toBe(204);
    expect(row().intro_shown_count).toBe(1);
    expect(events('tour_shown')).toHaveLength(1);
    expect(fake.db[TABLE].filter((r) => r.feature === 'quiz_tour')).toHaveLength(1);
  });

  test('the Urdu page carries the signed Urdu words, byte-identical', async () => {
    seed();
    const html = await (await get(`/m/${tokenFor({ lang: 'ur' })}`)).text();
    expect(banner(html)).toBe('up');
    for (const id of ['mk.tour', 'mk.tour.ok', 'mk.tour.replay']) expect(html).toContain(STRINGS[id].ur);
    expect(STRINGS['mk.tour'].ur).toBe('تین قدم: جماعت، مضمون اور موضوع چنیں، پھر بھیج دیں۔ تقریباً ایک منٹ لگے گا۔');
    expect(STRINGS['mk.tour.ok']).toEqual({ en: 'Got it', ur: 'ٹھیک ہے' });
    expect(STRINGS['mk.tour.replay']).toEqual({ en: 'How it works', ur: 'یہ کیسے کام کرتا ہے' });
    expect(STRINGS['mk.tour'].en).toBe('3 taps: grade, subject and topic. Then send. About a minute.');
  });

  test('quiz_tour_dismiss_without_show_row: no row, dismiss → the row with video_shown_at AND feature_used_at, count 0', async () => {
    seed();
    expect(row()).toBeUndefined();
    expect((await tour(tokenFor(), 'dismiss', { how: 'ok' })).status).toBe(204);
    expect(row()).toMatchObject({ video_shown_at: expect.any(String), feature_used_at: expect.any(String), intro_shown_count: 0 });
    expect(events('tour_dismissed')).toEqual([expect.objectContaining({ how: 'ok' })]);
  });

  test('dismiss on an existing row leaves video_shown_at and the count unchanged', async () => {
    seed();
    const t = tokenFor();
    await tour(t, 'show');
    row().video_shown_at = '2026-10-01T08:00:00.000Z';
    await tour(t, 'dismiss', { how: 'chip' });
    expect(row()).toMatchObject({ video_shown_at: '2026-10-01T08:00:00.000Z', intro_shown_count: 1, feature_used_at: expect.any(String) });
  });

  test('quiz_tour_token_flag_honoured: tour:1 → no banner and ZERO user_feature_first_use reads', async () => {
    seed();
    const html = await (await get(`/m/${tokenFor({ tour: 1 })}`)).text();
    expect(banner(html)).toBe('hidden');
    expect(firstUseReads(fake)).toBe(0);
  });

  test('quiz_tour_read_error_hides_banner: the row read throws → no banner, page 200', async () => {
    seed({ throwOn: TABLE });
    const res = await get(`/m/${tokenFor()}`);
    expect(res.status).toBe(200);
    expect(banner(await res.text())).toBe('hidden');
  });

  test('show with a failing row read writes nothing and logs no tour_shown', async () => {
    seed({ throwOn: TABLE });
    expect((await tour(tokenFor(), 'show')).status).toBe(204);
    expect(writes(fake)).toEqual([]);
    expect(events('tour_shown')).toEqual([]);
  });
});

describe('§3 — never again on any browser (the Chrome-reopen goldens)', () => {
  test('tour_chrome_reopen_same_token: T minted before the dismiss; GET T in Chrome, no cookies → no banner, count still 1', async () => {
    seed();
    const t = tokenFor();
    expect(banner(await (await get(`/m/${t}`, UA_WEBVIEW)).text())).toBe('up');
    await tour(t, 'show');
    await tour(t, 'dismiss', { how: 'ok' });
    const res = await get(`/m/${t}`, UA_CHROME);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(banner(await res.text())).toBe('hidden');
    expect(row().intro_shown_count).toBe(1);
  });

  test('tour_chrome_reopen_fresh_token: after the dismiss a NEW token (tour:0, as makerCta mints) → no banner (the row decides)', async () => {
    seed();
    await tour(tokenFor(), 'dismiss', { how: 'ok' });
    const fresh = tokenFor({ tour: 0, via: 'empty' });
    expect(banner(await (await get(`/m/${fresh}`, UA_CHROME)).text())).toBe('hidden');
  });
});

describe('§5 — "How it works" replays, never resets', () => {
  test('tour_replay_writes_nothing: the row is byte-identical after replay; one tour_replayed', async () => {
    seed();
    const t = tokenFor();
    await tour(t, 'show');
    await tour(t, 'dismiss', { how: 'ok' });
    const before = JSON.stringify(row());
    const callsBefore = fake.calls.length;
    expect((await tour(t, 'replay')).status).toBe(204);
    expect(JSON.stringify(row())).toBe(before);
    expect(fake.calls.slice(callsBefore).filter((c) => c.table === TABLE)).toEqual([]);
    expect(events('tour_replayed')).toHaveLength(1);
  });

  test('the replay link is at the foot of every page render, with the banner up or hidden', async () => {
    seed();
    for (const t of [tokenFor(), tokenFor({ tour: 1 })]) {
      const html = await (await get(`/m/${t}`)).text();
      expect(html).toMatch(/<p class="mk-foot"><button type="button" class="mk-link" id="mk-tour-replay"[^>]*>How it works<\/button><\/p>\n<\/main>/);
    }
  });
});

describe('§4 — the first maker input dismisses (the page\'s REAL scripts, in a vm DOM)', () => {
  const html = async (o) => (await (await get(`/m/${tokenFor(o)}`)).text());
  const tourPosts = (p) => p.posts.filter((x) => x.path === '/api/ft/tour').map((x) => x.body);

  test('on load the first-time banner posts {action:show} once; a hidden one posts nothing', async () => {
    seed();
    const up = loadPage(await html());
    expect(tourPosts(up)).toEqual([{ t: expect.any(String), action: 'show' }]);
    const down = loadPage(await html({ tour: 1 }));
    expect(tourPosts(down)).toEqual([]);
  });

  test('first_chip_dismisses_tour: grade 4 with the banner up → hidden + ONE dismiss how:chip; a second chip → no second post', async () => {
    seed();
    const p = loadPage(await html());
    expect(p.q('#mk-tour').hidden).toBe(false);
    p.click(p.q('[data-grade="4"]'));
    expect(p.q('#mk-tour').hidden).toBe(true);
    expect(p.q('[data-screen="subject"]').hidden).toBe(false);          // the chip still did its job
    p.click(p.q('[data-grade="5"]'));
    expect(tourPosts(p)).toEqual([{ t: expect.any(String), action: 'show' }, { t: expect.any(String), action: 'dismiss', how: 'chip' }]);
    expect(p.posts.find((x) => x.path === '/api/ft/tour' && x.body.action === 'dismiss').keepalive).toBe(true);
  });

  test('the dismiss post lands on the server: the row has feature_used_at without "Got it"', async () => {
    seed();
    const p = loadPage(await html());
    p.click(p.q('[data-grade="4"]'));
    for (const x of tourPosts(p)) await tour(x.t, x.action, x.how ? { how: x.how } : {});
    expect(row()).toMatchObject({ intro_shown_count: 1, feature_used_at: expect.any(String) });
  });

  test('prefill_keep_dismisses_tour: "Use it" → hidden + ONE dismiss how:prefill', async () => {
    seed();
    const p = loadPage(await html({ pf: 'grade_4|maths' }));
    expect(p.q('[data-screen="prefill"]').hidden).toBe(false);
    p.click(p.q('[data-pf="keep"]'));
    expect(p.q('#mk-tour').hidden).toBe(true);
    expect(p.q('[data-screen="topic"]').hidden).toBe(false);
    p.click(p.q('[data-pf="keep"]'));
    expect(tourPosts(p).filter((b) => b.action === 'dismiss')).toEqual([{ t: expect.any(String), action: 'dismiss', how: 'prefill' }]);
  });

  test('"Got it" → hidden + dismiss how:ok; "How it works" → shown + replay; its "Got it" just hides (no post)', async () => {
    seed();
    const p = loadPage(await html());
    p.click(p.q('#mk-tour-ok'));
    expect(p.q('#mk-tour').hidden).toBe(true);
    p.click(p.q('#mk-tour-replay'));
    expect(p.q('#mk-tour').hidden).toBe(false);
    p.click(p.q('#mk-tour-ok'));
    expect(p.q('#mk-tour').hidden).toBe(true);
    p.click(p.q('[data-grade="4"]'));
    expect(tourPosts(p).map((b) => [b.action, b.how])).toEqual([['show', undefined], ['dismiss', 'ok'], ['replay', undefined]]);
  });

  test('a page with the banner hidden: the first chip posts nothing; replay shows it, its "Got it" posts nothing', async () => {
    seed();
    const p = loadPage(await html({ tour: 1 }));
    p.click(p.q('[data-grade="4"]'));
    p.click(p.q('#mk-tour-replay'));
    expect(p.q('#mk-tour').hidden).toBe(false);
    p.click(p.q('#mk-tour-ok'));
    expect(tourPosts(p)).toEqual([{ t: expect.any(String), action: 'replay' }]);
  });

  test('the banner script never builds HTML and is allowed by its own hash (header AND meta)', async () => {
    seed();
    const res = await get(`/m/${tokenFor()}`);
    const page = await res.text();
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(2);
    expect(scripts[1]).toBe(Page.SCRIPT);                                   // the banner's runs BEFORE the page's
    expect(scripts[0]).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    const hashes = scripts.map((s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`);
    for (const csp of [res.headers.get('content-security-policy'), /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page)[1].replace(/&#39;/g, "'")]) {
      expect(csp).toContain(`script-src ${hashes.join(' ')};`);
      const style = /<style>([\s\S]*?)<\/style>/.exec(page)[1];
      expect(csp).toContain(`style-src 'sha256-${crypto.createHash('sha256').update(style, 'utf8').digest('base64')}'`);
    }
  });
});

describe('the route', () => {
  test('stale → 410, forged → 404, unknown action → 400, dismiss without a known how → 400 (nothing written)', async () => {
    seed();
    const stale = MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu' }, { now: Date.now() - 2 * MakerToken.MAKER_TTL_S * 1000 });
    expect((await tour(stale, 'show')).status).toBe(410);
    expect((await tour('forged.token', 'show')).status).toBe(404);
    expect((await tour(tokenFor(), 'reset')).status).toBe(400);
    expect((await tour(tokenFor(), 'dismiss')).status).toBe(400);
    expect((await tour(tokenFor(), 'dismiss', { how: 'swipe' })).status).toBe(400);
    expect(writes(fake)).toEqual([]);
    expect(events()).toEqual([]);
  });

  test('a throw → 503 {error:"mk.error"}', async () => {
    seed();
    jest.spyOn(Keys, 'markTourDismissed').mockRejectedValue(new Error('down'));
    const res = await tour(tokenFor(), 'dismiss', { how: 'ok' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'mk.error' });
  });

  test('switch OFF → POST /api/ft/tour 404 {off:true}; nothing read but the switch', async () => {
    seed({ on: false });
    for (const action of ['show', 'dismiss', 'replay']) {
      const res = await tour(tokenFor(), action, { how: 'ok' });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ off: true });
    }
    expect(fake.calls.filter((c) => c.table !== 'app_settings')).toEqual([]);
    expect(events()).toEqual([]);
  });

  test('events: exactly maker.routes\' fields, how only on tour_dismissed, never a phone / uid / kid / dk', async () => {
    seed();
    const t = tokenFor({ via: 'door' });
    await tour(t, 'show');
    await tour(t, 'dismiss', { how: 'prefill' });
    await tour(t, 'replay');
    const base = { grade: null, subject: null, qlang: null, lang: 'en', via: 'door', quiz_id: null, ukey: UK, w: 's' };
    expect(events()).toEqual([
      { step: 'tour_shown', ...base },
      { step: 'tour_dismissed', ...base, how: 'prefill' },
      { step: 'tour_replayed', ...base },
    ]);
    const flat = JSON.stringify(events());
    expect(flat).not.toContain(TEACHER.id);
    for (const k of ['phone', 'uid', 'kid', 'dk', 'user_id']) expect(flat).not.toContain(`"${k}"`);
  });
});

describe('the addon hook', () => {
  const GOLDEN = {
    en_menu: 'e28291c5bc29236d65addd13aafdc26c691c5f7cf33264913f550411b08b646f',
    ur_door: 'bbd0e463fb6a699b3b488672bb2a40925fe1636e01c1d78c8e2aa5a15296f880',
    bi_switch: '9275f16ac978a3752af9f0988d7988261a5d24c97603bb903f263a66f4690154',
    en_prefill: '42b110de58a70cffbefede64edda7eb7347ababe790e3e6520b7beedd8ad6c00',
    ur_ready: 'c7403c4506896798b74f3095eb920baa0f1a819445b2238672673e7782262e0a',
    en_view: '32328781a3944efb36bfe116296945f64943b5a98f5328a71034d429b46d6331',
  };
  test.each(Object.keys(GOLDEN))('addons empty → the page (HTML + CSP) byte-identical to the page before the hook: %s', (k) => {
    for (const extra of [{}, { addons: [] }]) {
      const b = Page.buildMakerPage({ ...CASES[k], ...extra });
      expect(crypto.createHash('sha256').update(`${b.html}\n${b.csp}`).digest('hex')).toBe(GOLDEN[k]);
    }
  });

  test('a ready addon lands inside .mk-ready after mk.next; a foot addon after the existing foot', () => {
    const b = Page.buildMakerPage({ ...CASES.ur_door, addons: [{ ready: '<p id="x-ready"></p>', foot: '<p id="x-foot"></p>' }] });
    expect(b.html).toMatch(/data-id="mk\.next">[^<]*<\/p>\n<p id="x-ready"><\/p>\n<\/div>\n<\/section>/);
    expect(b.html).toMatch(/<\/form><p id="x-foot"><\/p>\n<\/main>/);
  });

  test('the stale and error pages carry no banner', async () => {
    seed();
    const stale = MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu' }, { now: Date.now() - 2 * MakerToken.MAKER_TTL_S * 1000 });
    for (const p of [`/m/${stale}`, '/m/forged.token']) expect(banner(await (await get(p)).text())).toBe('absent');
  });
});
