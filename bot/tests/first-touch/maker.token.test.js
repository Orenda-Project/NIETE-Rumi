'use strict';
/**
 * The maker token (kind 'm'): six fields signed through the hub's signer, 24 hours; a genuine-but-expired token is
 * the stale page (HTTP 200, mk.stale), a forged one the same page with HTTP 404; `lang:'bi'` opens the Urdu page with
 * the "English" link (?lang=en), which re-renders in English with no write.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const WebQuizToken = require('../../shared/services/quiz/web-quiz-token');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const { str } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER } = require('./maker-fixture');

const UK = '0123456789abcdef';
const FIELDS = { uid: TEACHER.id, lang: 'en', tour: 0, pf: 'grade_4|maths', via: 'door', uk: UK };

let srv;
async function boot() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const get = (path) => fetch(`http://127.0.0.1:${srv.address().port}/api/internal/ft${path}`, {
  headers: { 'x-api-key': process.env.INTERNAL_API_KEY }, redirect: 'manual',
});

beforeEach(async () => {
  jest.clearAllMocks();
  seedMaker(supabase);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
  await boot();
});
afterEach(() => new Promise((r) => srv.close(r)));

describe('signMaker / verifyMaker', () => {
  test('the six fields are signed under kind m, expiring in 24 hours', () => {
    const t0 = Math.floor(Date.now() / 1000);
    const t = MakerToken.signMaker(FIELDS);
    const raw = WebQuizToken.verify(t, 'm');
    expect(raw).toMatchObject({ k: 'm', ...FIELDS });
    expect(raw.exp - t0).toBeGreaterThanOrEqual(24 * 3600 - 2);
    expect(raw.exp - t0).toBeLessThanOrEqual(24 * 3600 + 2);
    expect(MakerToken.verifyMaker(t)).toEqual({ ok: expect.objectContaining(FIELDS) });
  });

  test('expired → { stale }; forged or another kind → null', () => {
    const old = MakerToken.signMaker(FIELDS, { now: Date.now() - 25 * 3600 * 1000 });
    expect(MakerToken.verifyMaker(old)).toEqual({ stale: expect.objectContaining({ uid: TEACHER.id }) });
    const t = MakerToken.signMaker(FIELDS);
    const forged = `${t.slice(0, -3)}${t.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    expect(MakerToken.verifyMaker(forged)).toBeNull();
    expect(MakerToken.verifyMaker(WebQuizToken.sign({ k: 'f', uid: TEACHER.id, exp: 9999999999 }))).toBeNull();
    expect(MakerToken.verifyMaker('junk')).toBeNull();
  });

  test('a field outside its set is refused at signing (no token)', () => {
    expect(MakerToken.signMaker({ ...FIELDS, lang: 'fr' })).toBeNull();
    expect(MakerToken.signMaker({ ...FIELDS, via: 'elsewhere' })).toBeNull();
    expect(MakerToken.signMaker({ ...FIELDS, tour: 2 })).toBeNull();
    expect(MakerToken.signMaker({ ...FIELDS, uid: '' })).toBeNull();
    const noPf = MakerToken.verifyMaker(MakerToken.signMaker({ ...FIELDS, pf: undefined, uk: null }));
    expect(noPf.ok).not.toHaveProperty('pf');
    expect(noPf.ok).not.toHaveProperty('uk');
  });
});

describe('GET /m/:token by token state', () => {
  test('stale → 200 with mk.stale in the token\'s language', async () => {
    const old = MakerToken.signMaker({ ...FIELDS, lang: 'ur' }, { now: Date.now() - 25 * 3600 * 1000 });
    const res = await get(`/m/${old}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(str('mk.stale', 'ur'));
    expect(html).not.toContain('data-grade');
  });

  test('forged → the same page with 404', async () => {
    const t = MakerToken.signMaker(FIELDS);
    const res = await get(`/m/${t.slice(0, -2)}xx`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(str('mk.stale', 'en'));
  });

  test('lang bi → the Urdu page with the "English" link (?lang=en); following it re-renders in English with no write', async () => {
    const t = MakerToken.signMaker({ ...FIELDS, lang: 'bi' });
    const ur = await (await get(`/m/${t}`)).text();
    expect(ur).toMatch(/<html lang="ur" dir="rtl">/);
    expect(ur).toContain(`href="/m/${encodeURIComponent(t)}?lang=en"`);
    expect(ur).toContain(`>${str('mk.lang.switch', 'ur')}</a>`);
    const fake = seedMaker(supabase);
    Bank._resetCache();
    const en = await (await get(`/m/${t}?lang=en`)).text();
    expect(en).toMatch(/<html lang="en" dir="ltr">/);
    expect(en).toContain(str('mk.h', 'en'));
    expect(en).toContain(`>${str('mk.lang.switch', 'en')}</a>`);
    expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('lang en / ur tokens get no switch link', async () => {
    const en = await (await get(`/m/${MakerToken.signMaker(FIELDS)}`)).text();
    expect(en).not.toContain('?lang=');
  });
});
