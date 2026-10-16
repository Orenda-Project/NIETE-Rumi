'use strict';
/**
 * "Send to class group" (FIRST_QUIZ §7.1): GET /m/:token/send?c=<shareCodeId> rebuilds the class message on the
 * server exactly as POST /api/ft/make built it and answers 302 → https://wa.me/?text=<the message>, never stored;
 * another teacher's share code → 404; a stale token → the stale page; a forged token → 404; switch OFF → 404
 * {off:true}; onboard.maker{share_tap} carries no phone and no share code.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const { str } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER, PHONE, qid, fixturePhone } = require('./maker-fixture');

const BOT_NO = fixturePhone(990);
const UK = '0123456789abcdef';
const OTHER = 'a0000000-0000-4000-8000-0000000000f2';
const tokenFor = (o = {}) => MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu', uk: UK, ...o });
const SAVED = { ...process.env };

let srv;
let fake;
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const make = (body) => fetch(url('/api/ft/make'), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const send = (t, c) => fetch(url(`/m/${t}/send?c=${c}`), { headers: H(), redirect: 'manual' });
const MATHS = { grade: '4', subject: 'maths', quizId: qid(2) };
const WA = 'https://wa.me/?text=';

function seed(opts) {
  fake = seedMaker(supabase, opts);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
  require('../../shared/services/quiz/web-quiz-link')._resetCache();
}

beforeEach(async () => {
  process.env = { ...SAVED, WHATSAPP_BOT_NUMBER: BOT_NO, INTERNAL_API_KEY: SAVED.INTERNAL_API_KEY };
  jest.clearAllMocks();
  seed();
  const app = express();
  app.use(express.json());
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));
afterAll(() => { process.env = SAVED; });

const decoded = (res) => {
  const loc = res.headers.get('location') || '';
  expect(loc.startsWith(WA)).toBe(true);
  return decodeURIComponent(loc.slice(WA.length));
};

test('302 → wa.me/?text= whose text decodes to exactly the /api/ft/make message; never stored', async () => {
  const t = tokenFor();
  const made = await (await make({ t, ...MATHS })).json();
  const res = await send(t, made.shareCodeId);
  expect(res.status).toBe(302);
  expect(res.headers.get('cache-control')).toMatch(/no-store/);
  expect(decoded(res)).toBe(made.message);
  for (const fn of Object.values(WhatsAppService)) if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
});

test('the Urdu page with a quiz in English: the same Urdu message with its language line', async () => {
  fake.db.quizzes.find((q) => q.id === qid(2)).language = 'en';
  Bank._resetCache();
  const t = tokenFor({ lang: 'ur' });
  const made = await (await make({ t, ...MATHS })).json();
  expect(made.message.endsWith(str('class.lang.en', 'ur'))).toBe(true);
  expect(decoded(await send(t, made.shareCodeId))).toBe(made.message);
});

test('the send writes nothing: quiz_share_codes and quizzes byte-identical across it', async () => {
  const t = tokenFor();
  const made = await (await make({ t, ...MATHS })).json();
  const before = JSON.stringify([fake.db.quiz_share_codes, fake.db.quizzes]);
  const n = fake.calls.filter((c) => c.op !== 'select').length;
  await send(t, made.shareCodeId);
  expect(JSON.stringify([fake.db.quiz_share_codes, fake.db.quizzes])).toBe(before);
  expect(fake.calls.filter((c) => c.op !== 'select').length).toBe(n);
});

test('another teacher\'s share code → 404 and no wa.me', async () => {
  const made = await (await make({ t: tokenFor(), ...MATHS })).json();
  const res = await send(tokenFor({ uid: OTHER }), made.shareCodeId);
  expect(res.status).toBe(404);
  expect(res.headers.get('location')).toBeNull();
});

test('an expired or switched-off share code of this teacher → 404 and no wa.me (never a dead link to the class)', async () => {
  const made = await (await make({ t: tokenFor(), ...MATHS })).json();
  const row = fake.db.quiz_share_codes.find((c) => c.id === made.shareCodeId);
  row.expires_at = '2020-01-01T00:00:00Z';
  let res = await send(tokenFor(), made.shareCodeId);
  expect(res.status).toBe(404);
  expect(res.headers.get('location')).toBeNull();
  row.expires_at = null; row.active = false;
  res = await send(tokenFor(), made.shareCodeId);
  expect(res.status).toBe(404);
});

test('an unknown or malformed share code id → 404', async () => {
  expect((await send(tokenFor(), 'f0000000-0000-4000-8000-000000000000')).status).toBe(404);
  expect((await send(tokenFor(), 'nope')).status).toBe(404);
});

test('a stale token → the stale page (200, mk.stale); a forged one → 404', async () => {
  const t = tokenFor();
  const made = await (await make({ t, ...MATHS })).json();
  const old = MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu' }, { now: Date.now() - 25 * 3600 * 1000 });
  const stale = await send(old, made.shareCodeId);
  expect(stale.status).toBe(200);
  expect(stale.headers.get('location')).toBeNull();
  expect(await stale.text()).toContain('This link has expired.');
  const forged = await send(`${t.slice(0, -3)}AAA`, made.shareCodeId);
  expect(forged.status).toBe(404);
});

test('switch OFF → 404 {off:true}, nothing read but the switch', async () => {
  const t = tokenFor();
  const made = await (await make({ t, ...MATHS })).json();
  fake.db.app_settings = [];
  IdFlags._resetCache();
  const reads = fake.calls.length;
  const res = await send(t, made.shareCodeId);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ off: true });
  expect(fake.calls.slice(reads).filter((c) => c.table !== 'app_settings')).toEqual([]);
});

test('onboard.maker{share_tap}: the contract fields, no phone, no share code, no name', async () => {
  const t = tokenFor();
  const made = await (await make({ t, ...MATHS })).json();
  logEvent.mockClear();
  await send(t, made.shareCodeId);
  const taps = logEvent.mock.calls.filter(([e, f]) => e === 'onboard.maker' && f.step === 'share_tap').map(([, f]) => f);
  expect(taps).toEqual([{ step: 'share_tap', grade: 'grade_4', subject: 'maths', qlang: made.qlang, lang: 'en', via: 'menu', quiz_id: qid(2), ukey: UK, w: 's' }]);
  const flat = JSON.stringify(logEvent.mock.calls);
  expect(flat).not.toContain(PHONE);
  expect(flat).not.toContain(made.shareCodeId);
  expect(flat).not.toContain(fake.db.quiz_share_codes[0].code);
  expect(flat).not.toContain(TEACHER.name);
});

test('POST /api/ft/step {share_copy} → 204 and one onboard.maker{share_copy}', async () => {
  const t = tokenFor();
  const res = await fetch(url('/api/ft/step'), {
    method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify({ t, step: 'share_copy', ...MATHS }),
  });
  expect(res.status).toBe(204);
  const copies = logEvent.mock.calls.filter(([e, f]) => e === 'onboard.maker' && f.step === 'share_copy');
  expect(copies).toHaveLength(1);
  expect(copies[0][1]).toMatchObject({ grade: 'grade_4', subject: 'maths', quiz_id: qid(2), via: 'menu' });
});
