'use strict';
/**
 * The maker page's three branch cards and its forward line (cards.page.js + POST /api/ft/tour card|forward):
 *   - each card pre-types the REAL word its feature's door matches, through the REAL matchers (lp-intent BARE, the
 *     coaching trigger, the handler's /assessment list); "AI coaching" matches nothing (the regression that keeps
 *     the label out of the composer);
 *   - each card is https://wa.me/<this bot>?text=<word>, by the page's language; the exam card's title is the REAL
 *     menu row title; the forward line opens WhatsApp's picker with a text that carries no token, no uid, no share
 *     code and ends in the bot's own ?text=quiz link;
 *   - no bot number configured → no cards and no forward line (never a dead link);
 *   - the beacon route logs card_<card> with its screen / forward_tap, 204, writes nothing, sends nothing;
 *   - switch OFF → /api/ft/tour 404 {off:true}.
 * Only the network boundary is mocked (supabase via the door fixture's fake, logger, whatsapp, redis).
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const express = require('express');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const { resolveUx } = require('../../shared/config/ux-strings');
const { matchDetail } = require('../../shared/utils/lp-intent');
const { COACHING_TRIGGER_RX } = require('../../shared/handlers/coaching-trigger');
const { isQuizMenuRequest } = require('../../shared/services/quiz/quiz-menu-request');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Cards = require('../../shared/services/first-touch/cards.page');
const { str, fill } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER, PHONE, fixturePhone } = require('./maker-fixture');

const BOT_NO = fixturePhone(990);
const UK = '0123456789abcdef';
const SAVED = { ...process.env };
const LANGS = ['en', 'ur'];
const tokenFor = (o = {}) => MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 1, via: 'menu', uk: UK, ...o });

/**
 * The /assessment command list exactly as the text handler holds it (an inline array, not exported; the handler is
 * not changed by this feature). Read from the handler's source at the one place it is used — the line that guards
 * the "assessment command" door — so the test follows the list when it changes and never carries a copy of it.
 */
function assessmentCommands() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'handlers', 'text-message.handler.js'), 'utf8');
  expect(src).toContain('const trimmedMessage = messageBody.trim().toLowerCase();');
  const m = /if \(\[([^\]]*)\]\.includes\(trimmedMessage\)\) \{\s*logToFile\('📝 assessment command'/.exec(src);
  expect(m).not.toBeNull();
  const list = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  expect(list.length).toBeGreaterThan(0);
  return list;
}
/** The handler's own normalisation before every door below it (text-message.handler.js trimmedMessage). */
const asTyped = (w) => w.trim().toLowerCase();

const hrefs = (html, sel) => [...html.matchAll(new RegExp(`<a [^>]*${sel}[^>]*href="([^"]+)"`, 'g'))].map((x) => x[1].replace(/&amp;/g, '&'));

describe('card_words_match_their_doors (the REAL matchers)', () => {
  test.each(LANGS)('lesson plans (%s) → lp-intent BARE', (l) => {
    const r = matchDetail(asTyped(str('mk.card.lp.word', l)));
    expect(r.matched).toBe(true);
    expect(r.tier).toBe('bare');
  });
  test.each(LANGS)('AI coaching (%s) → the coaching trigger', (l) => {
    expect(COACHING_TRIGGER_RX.test(str('mk.card.coach.word', l))).toBe(true);
  });
  test('"AI coaching" — and either card LABEL — matches the coaching trigger NOT AT ALL', () => {
    expect(COACHING_TRIGGER_RX.test('AI coaching')).toBe(false);
    LANGS.forEach((l) => expect(COACHING_TRIGGER_RX.test(str('mk.card.coach', l))).toBe(false));
  });
  test.each(LANGS)('test paper (%s) → the handler\'s /assessment command list', (l) => {
    expect(assessmentCommands()).toContain(asTyped(str('mk.card.exam.word', l)));
  });
  test('the forward line\'s bot link word opens the /quiz door: "quiz" and «کوئز» are menu requests', () => {
    expect(isQuizMenuRequest('quiz')).toBe(true);
    expect(isQuizMenuRequest('کوئز')).toBe(true);
  });
});

describe('the cards addon (render)', () => {
  test.each(LANGS)('each card (%s) is wa.me/<the configured bot>?text=<the page language\'s word>, in ready AND foot', (l) => {
    const a = Cards.cardsAddon({ lang: l, bot: BOT_NO });
    for (const [part, at] of [[a.ready, 'ready'], [a.foot, 'foot']]) {
      for (const card of ['lp', 'coach', 'exam']) {
        const hs = hrefs(part, `data-card="${card}" data-at="${at}"`);
        expect(hs).toHaveLength(1);
        const u = new URL(hs[0]);
        expect(`${u.origin}${u.pathname}`).toBe(`https://wa.me/${BOT_NO}`);
        expect(u.searchParams.get('text')).toBe(str(`mk.card.${card}.word`, l));
        expect(hs[0]).toBe(`https://wa.me/${BOT_NO}?text=${encodeURIComponent(str(`mk.card.${card}.word`, l))}`);
      }
    }
  });

  test('the Urdu page pre-types the Urdu words; a bi token\'s Urdu page too', () => {
    const ur = Cards.cardsFor({ lang: 'ur', bot: BOT_NO });
    expect(ur.map((c) => c.word)).toEqual(['لیسن پلان', 'کوچنگ', '/assessment']);
    expect(Cards.cardsFor({ lang: 'bi', bot: BOT_NO })).toEqual(ur);
    expect(Cards.cardsFor({ lang: 'en', bot: BOT_NO }).map((c) => c.word)).toEqual(['lesson plan', 'coaching', '/assessment']);
  });

  test.each(LANGS)('titles (%s): mk.card.lp, mk.card.coach, and the exam card = resolveUx(menuRowAssessmentTitle)', (l) => {
    const list = Cards.cardsFor({ lang: l, bot: BOT_NO });
    expect(list.map((c) => c.title)).toEqual([str('mk.card.lp', l), str('mk.card.coach', l), resolveUx('menuRowAssessmentTitle', { language: l })]);
    const a = Cards.cardsAddon({ lang: l, bot: BOT_NO });
    expect(a.ready).toContain(`>${resolveUx('menuRowAssessmentTitle', { language: l })}</a>`);
  });

  test.each(LANGS)('fwd_line_has_no_token (%s): the picker link\'s text is mk.fwd ending in the bot\'s ?text=quiz', (l) => {
    const a = Cards.cardsAddon({ lang: l, bot: BOT_NO });
    const hs = hrefs(a.foot, 'data-fwd');
    expect(hs).toHaveLength(1);
    expect(hs[0].startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(hs[0].slice('https://wa.me/?text='.length));
    expect(text).toBe(fill('mk.fwd', l, { bot: BOT_NO }));
    expect(text.endsWith(`https://wa.me/${BOT_NO}?text=quiz`)).toBe(true);
    for (const bad of ['/m/', '/f/', TEACHER.id, 'QUIZ-', '{bot}']) expect(text).not.toContain(bad);
    expect(a.foot).toContain(`>${str('mk.fwd.btn', l)}</a>`);
    expect(a.ready).not.toContain('data-fwd');
  });

  test.each([null, undefined, '', 'not-a-number', '12345'])('bot number %p → the addon is empty (no cards, no forward line)', (bot) => {
    expect(Cards.cardsAddon({ lang: 'en', bot })).toEqual({});
    expect(Cards.cardsFor({ lang: 'en', bot })).toBeNull();
  });
});

describe('the cards script (the page\'s own inline code, run in a sandbox)', () => {
  function run(bootT = 'tok.en') {
    const beacons = [];
    let onClick = null;
    const ctx = {
      JSON, Blob,
      document: {
        getElementById: (id) => (id === 'mk-boot' ? { textContent: JSON.stringify({ t: bootT }) } : null),
        addEventListener: (type, fn, capture) => { if (type === 'click') { onClick = fn; expect(capture).toBe(true); } },
      },
      navigator: { sendBeacon: (u, blob) => { beacons.push({ u, blob }); return true; } },
      fetch: () => { throw new Error('fetch must not be needed when the beacon is taken'); },
    };
    vm.runInNewContext(Cards.SCRIPT, ctx);
    const anchor = (attrs) => ({ hasAttribute: (k) => k in attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null) });
    const tap = (attrs) => {
      const ev = { target: { closest: (sel) => (attrs && /a\[data-card\]/.test(sel) ? anchor(attrs) : null) }, preventDefault: jest.fn(), stopPropagation: jest.fn() };
      onClick(ev);
      return ev;
    };
    return { beacons, tap };
  }
  const body = async (b) => JSON.parse(await b.blob.text());

  test('a card tap → ONE beacon {t, action:card, card, screen}; the link is never stopped', async () => {
    const { beacons, tap } = run();
    const ev = tap({ 'data-card': 'coach', 'data-at': 'foot' });
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ev.stopPropagation).not.toHaveBeenCalled();
    expect(beacons).toHaveLength(1);
    expect(beacons[0].u).toBe('/api/ft/tour');
    expect(await body(beacons[0])).toEqual({ t: 'tok.en', action: 'card', card: 'coach', screen: 'foot' });
  });
  test('the forward line → {t, action:forward}; a tap elsewhere → nothing', async () => {
    const { beacons, tap } = run();
    tap({ 'data-fwd': '' });
    tap(null);
    expect(beacons).toHaveLength(1);
    expect(await body(beacons[0])).toEqual({ t: 'tok.en', action: 'forward' });
  });
});

// ── through the real router (needs the page addons hook and tour.routes.js in place) ──
let srv;
let fake;
async function boot() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p) => fetch(url(p), { headers: H(), redirect: 'manual' });
const post = (p, b) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(b), redirect: 'manual' });
const sends = () => Object.values(WhatsAppService).filter((f) => jest.isMockFunction(f) && f !== WhatsAppService.startContinuousTypingIndicator)
  .reduce((n, f) => n + f.mock.calls.length, 0);
const makerEvents = () => logEvent.mock.calls.filter(([e]) => e === 'onboard.maker').map(([, f]) => f);
const writes = () => fake.calls.filter((c) => c.op !== 'select');

function seed(opts) {
  fake = seedMaker(supabase, opts);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
}

describe('the maker page and POST /api/ft/tour (card | forward)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...SAVED, WHATSAPP_BOT_NUMBER: BOT_NO, INTERNAL_API_KEY: SAVED.INTERNAL_API_KEY };
    await boot();
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  afterAll(() => { process.env = SAVED; });

  test.each(LANGS)('the page (%s) carries the cards in the ready screen and the foot, the forward line, the script by its hash', async (l) => {
    seed();
    const t = tokenFor({ lang: l });
    const res = await get(`/m/${t}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const at of ['ready', 'foot']) {
      expect(hrefs(html, `data-at="${at}"`)).toEqual(Cards.cardsFor({ lang: l, bot: BOT_NO }).map((c) => c.href));
    }
    // the ready cards sit inside the ready screen, after mk.next
    const ready = html.slice(html.indexOf('<section data-screen="ready"'), html.indexOf('</section>', html.indexOf('<section data-screen="ready"')));
    expect(ready.indexOf('data-at="ready"')).toBeGreaterThan(ready.indexOf('data-id="mk.next"'));
    const fwd = hrefs(html, 'data-fwd');
    expect(fwd).toHaveLength(1);
    // no wa.me link on the page carries the token, the uid or a share code
    for (const h of [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map((x) => decodeURIComponent(x[1].replace(/&amp;/g, '&')))) {
      expect(h).not.toContain(t);
      expect(h).not.toContain(TEACHER.id);
      expect(h).not.toMatch(/\/m\/|\/f\/|QUIZ-/);
    }
    const hash = crypto.createHash('sha256').update(Cards.SCRIPT, 'utf8').digest('base64');
    expect(html).toContain(`<script>${Cards.SCRIPT}</script>`);
    expect(res.headers.get('content-security-policy')).toContain(`'sha256-${hash}'`);
    expect(html).toContain(`&#39;sha256-${hash}&#39;`); // the <meta> copy (attribute-escaped)
  });

  test('bot number unset → no cards, no forward line, no wa.me link at all; the page still 200', async () => {
    seed();
    delete process.env.WHATSAPP_BOT_NUMBER;
    delete process.env.REFERRAL_BOT_NUMBER;
    const res = await get(`/m/${tokenFor()}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('data-card=');
    expect(html).not.toContain('data-fwd');
    expect(html).not.toContain('wa.me');
    expect(html).not.toContain(`<script>${Cards.SCRIPT}</script>`);
  });

  test.each([
    [{ action: 'card', card: 'lp', screen: 'ready' }, 'card_lp', 'ready'],
    [{ action: 'card', card: 'coach', screen: 'foot' }, 'card_coach', 'foot'],
    [{ action: 'card', card: 'exam', screen: 'ready' }, 'card_exam', 'ready'],
  ])('beacon %p → 204, one onboard.maker %s with its screen, no phone/uid, no write', async (b, step, screen) => {
    seed();
    const res = await post('/api/ft/tour', { t: tokenFor(), ...b });
    expect(res.status).toBe(204);
    const ev = makerEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual(expect.objectContaining({ step, screen, lang: 'en', via: 'menu', ukey: UK }));
    const flat = JSON.stringify(ev[0]);
    expect(flat).not.toContain(PHONE);
    expect(flat).not.toContain(TEACHER.id);
    for (const k of ['kid', 'dk', 'phone', 'uid', 'how']) expect(ev[0]).not.toHaveProperty(k);
    expect(writes()).toEqual([]);
    expect(fake.calls.filter((c) => c.table === 'user_feature_first_use')).toEqual([]);
  });

  test('forward → 204, one forward_tap with no screen; no write', async () => {
    seed();
    const res = await post('/api/ft/tour', { t: tokenFor(), action: 'forward' });
    expect(res.status).toBe(204);
    const ev = makerEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].step).toBe('forward_tap');
    expect(ev[0]).not.toHaveProperty('screen');
    expect(writes()).toEqual([]);
  });

  test.each([
    [{ action: 'card', card: 'lp', screen: 'top' }],
    [{ action: 'card', card: 'lp' }],
    [{ action: 'card', card: 'video', screen: 'ready' }],
    [{ action: 'card', screen: 'foot' }],
  ])('a card beacon outside the sets %p → 400, no event', async (b) => {
    seed();
    const res = await post('/api/ft/tour', { t: tokenFor(), ...b });
    expect(res.status).toBe(400);
    expect(makerEvents()).toEqual([]);
  });

  test('a forged token → 404, no event', async () => {
    seed();
    const res = await post('/api/ft/tour', { t: 'garbage.garbagegarbagegarbage00', action: 'card', card: 'lp', screen: 'ready' });
    expect(res.status).toBe(404);
    expect(makerEvents()).toEqual([]);
  });

  test('cards_send_nothing: the page GET and every card / forward beacon → 0 WhatsApp sends', async () => {
    seed();
    const t = tokenFor();
    await (await get(`/m/${t}`)).text();
    for (const b of [{ action: 'card', card: 'lp', screen: 'ready' }, { action: 'card', card: 'coach', screen: 'foot' },
      { action: 'card', card: 'exam', screen: 'foot' }, { action: 'forward' }]) {
      expect((await post('/api/ft/tour', { t, ...b })).status).toBe(204);
    }
    expect(sends()).toBe(0);
  });

  test('switch OFF → POST /api/ft/tour card|forward 404 {off:true}, no event', async () => {
    seed({ on: false });
    const t = tokenFor();
    for (const b of [{ action: 'card', card: 'lp', screen: 'ready' }, { action: 'forward' }]) {
      const res = await post('/api/ft/tour', { t, ...b });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ off: true });
    }
    expect(makerEvents()).toEqual([]);
  });
});
