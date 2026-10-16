'use strict';
/**
 * "Change my choice" on the maker page: POST /api/ft/door {t}.
 *
 *   a maker token (kind 'm', via 'door', the switch on) → exactly one `quiz_door_child` row through door.keys.js
 *     (upsert, then update), forgetDoorVerdict with both phone forms (the phone read server-side from the token's uid,
 *     never carried), onboard.quiz_door{door:'change', …} + onboard.maker{step:'change_choice', …}, and 302 → /f/<a
 *     family token for the same uid> — 0 replies, nothing sent;
 *   a family token (kind 'f'), a stale or forged maker token, a maker token from the menu or the empty line, the switch
 *     off → 403, no write, no family_door event, never 500;
 *   the family door it lands on carries no /api/ft/door and no /m/ link.
 * Only the boundary is faked (Supabase via the web quiz tests' fake, Redis, the loggers, WhatsApp); the token signer, the
 * family token module, door.keys.js and the routes are real, served by a real express app on an ephemeral port.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const WhatsApp = require('../../shared/services/whatsapp.service');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Token = require('../../shared/services/quiz/web-quiz-token');
const FamilyToken = require('../../shared/services/first-touch/family.token');
const Routes = require('../../shared/services/first-touch/family.routes');
const { ukeyOf } = require('../../shared/services/quiz/child-phone-bindings.repo');
const { TABLE, UNKNOWN_USER, PHONE, PHONE_PLUS, OURS_ON, seedDb, writes } = require('./door-fixture');

const SAVED = { ...process.env };
const UID = UNKNOWN_USER.id;
const pass = (req, res, next) => next();

let server;
let base;
let fake;

beforeAll(async () => {
  process.env = { ...SAVED, WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret', WEB_QUIZ_KID_KEY: 'unit-kid-key' };
  const app = express();
  const router = express.Router();
  Routes.mount(router, { limiters: { read: pass, session: pass, badCode: pass } });
  app.use(router);
  server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  process.env = SAVED;
  await new Promise((r) => server.close(r));
});

function seed(settings = OURS_ON) {
  fake = seedDb(supabase, { settings });
  // the users row the token's uid names: its phone is read on the server, never carried by a token
  Object.assign(fake.db.users[0], { phone: PHONE_PLUS, created_at: new Date(Date.now() - 3600 * 1000).toISOString() });
  IdFlags._resetCache();
  HubFlags._resetCache();
}
beforeEach(() => { jest.clearAllMocks(); seed(); });
afterEach(() => jest.restoreAllMocks());

const nowS = () => Math.floor(Date.now() / 1000);
const maker = (o = {}) => Token.sign({ k: 'm', uid: UID, lang: 'ur', tour: 0, via: 'door', exp: nowS() + 3600, ...o });
const post = (t) => fetch(`${base}/api/ft/door`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(t == null ? {} : { t }) });
const childRows = () => fake.db[TABLE].filter((r) => r.user_id === UID && r.feature === 'quiz_door_child');
const named = (name) => logEvent.mock.calls.filter(([e]) => e === name).map(([, p]) => p);

describe('POST /api/ft/door with a maker token', () => {
  test('→ one quiz_door_child row (upsert then update), the cache forgotten, two events, 302 to the family door', async () => {
    const forget = jest.spyOn(StudentIdentity, 'forgetDoorVerdict');
    const r = await post(maker());
    expect(r.status).toBe(302);

    const loc = r.headers.get('location');
    expect(loc).toMatch(/^\/f\/[A-Za-z0-9_%.-]+$/);
    const family = FamilyToken.verifyFamilyToken(decodeURIComponent(loc.slice(3)));
    expect(family).toMatchObject({ k: 'f', uid: UID, lang: 'ur', uk: ukeyOf(PHONE) });

    expect(childRows()).toHaveLength(1);
    expect(childRows()[0]).toMatchObject({ feature_used_at: expect.any(String) });
    expect(writes(fake)).toEqual([`upsert:${TABLE}`, `update:${TABLE}`]);   // nothing else written; never the users row
    expect(forget).toHaveBeenCalledWith(PHONE_PLUS, PHONE);

    const ukey = ukeyOf(PHONE);
    expect(named('onboard.quiz_door')).toEqual([{
      door: 'change', verdict: 'child', reason: 'child_key', new_phone: true, store: 'child', reply: 'none', tap: 'none',
      lang: 'ur', script: 'none', ukey, w: 's',
    }]);
    expect(named('onboard.maker')).toEqual([{ step: 'change_choice', via: 'door', lang: 'ur', ukey, w: 's' }]);
    expect(named('onboard.family_door')).toEqual([]);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(PHONE);           // no phone in any event
    // 0 replies: nothing is sent to the chat
    for (const fn of Object.values(WhatsApp)) if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  });

  test('a second change → still one row (last tap wins on the same key), 302 again', async () => {
    expect((await post(maker())).status).toBe(302);
    expect((await post(maker())).status).toBe(302);
    expect(childRows()).toHaveLength(1);
  });

  test.each([['the menu row', 'menu'], ['the empty line', 'empty']])('a maker token from %s is accepted too: the route takes any genuine maker token, the PAGE alone hides the link (DOOR §6.1)', async (_, via) => {
    const r = await post(maker({ via }));
    expect(r.status).toBe(302);
    expect(String(r.headers.get('location') || '')).toMatch(/^\/f\//);
    expect(childRows()).toHaveLength(1);
  });

  test('an English maker page lands on the English side of a bilingual family door', async () => {
    const r = await post(maker({ lang: 'en' }));
    expect(r.status).toBe(302);
    const loc = r.headers.get('location');
    expect(loc).toMatch(/\?lang=en$/);
    expect(FamilyToken.verifyFamilyToken(decodeURIComponent(loc.slice(3).split('?')[0])).lang).toBe('bi');
    expect(named('onboard.maker')[0].lang).toBe('en');
  });

  test('the family door the same web view lands on carries no /api/ft/door, no /m/ link, no "Change my choice"', async () => {
    const r = await post(maker());
    const page = await fetch(`${base}${r.headers.get('location')}`, { redirect: 'manual' });
    expect(page.status).toBe(200);
    const token = decodeURIComponent(r.headers.get('location').slice(3));
    const html = (await page.text()).split(token).join('').split(encodeURIComponent(token)).join('');
    expect(html).not.toContain('/api/ft/door');
    expect(html).not.toContain('/m/');
    expect(html).not.toContain('Change my choice');
    expect(html).not.toContain('اپنا انتخاب بدلیں');
  });
});

describe('POST /api/ft/door refuses everything else: 403, no write, no family_door event, never 500', () => {
  test.each([
    ['a family token', () => FamilyToken.mintFamilyToken({ uid: UID, lang: 'ur', ukey: null })],
    ['a stale maker token', () => maker({ exp: nowS() - 60 })],
    ['a forged maker token', () => { const t = maker(); return `${t.slice(0, -4)}${t.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`; }],
    ['a hub token', () => Token.signHub(['e0000000-0000-4000-8000-000000000901'])],
    ['garbage', () => 'not-a-token'],
    ['no token', () => null],
  ])('%s', async (_, make) => {
    const r = await post(make());
    expect(r.status).toBe(403);
    expect(childRows()).toHaveLength(0);
    expect(writes(fake)).toEqual([]);
    expect(named('onboard.family_door')).toEqual([]);
    expect(named('onboard.quiz_door')).toEqual([]);
    expect(named('onboard.maker')).toEqual([]);
  });

  test('the switch off (quiz_first_door absent) → 403, no write', async () => {
    seed({ quiz_maker_page: true });
    const r = await post(maker());
    expect(r.status).toBe(403);
    expect(childRows()).toHaveLength(0);
  });

  test('a broken JSON body → 403, never 500', async () => {
    const r = await fetch(`${base}/api/ft/door`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: '{"t":' });
    expect(r.status).toBe(403);
    expect(childRows()).toHaveLength(0);
  });
});
