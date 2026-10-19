'use strict';
/**
 * The class message's return line on the MAKER's sends (one line for every forwarded class message): with
 * quiz_teacher_home ON, the make's message and the wa.me text both end with cm.return; OFF (absent or false) they are
 * exactly today's bytes, the bank's own message.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const { fill } = require('../../shared/services/first-touch/teacher-home.strings');
const { seedMaker, TEACHER, qid } = require('./maker-fixture');

const RETURN_EN = fill('cm.return', 'en', { link: 'https://wa.me/15550001111?text=quiz' });
const RETURN_UR = fill('cm.return', 'ur', { link: 'https://wa.me/15550001111?text=quiz' });
const tokenFor = (o = {}) => MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu', ...o });

let srv;
async function boot() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
const H = { 'x-api-key': process.env.INTERNAL_API_KEY };
const make = (t) => fetch(url('/api/ft/make'), { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ t, grade: '4', subject: 'maths', quizId: qid(2) }) }).then((r) => r.json());
const send = (t, c) => fetch(url(`/m/${t}/send?c=${c}`), { headers: H, redirect: 'manual' });
const textOf = (res) => decodeURIComponent(res.headers.get('location').slice('https://wa.me/?text='.length));

function seed(home) {
  const fake = seedMaker(supabase);
  if (home !== undefined) fake.db.app_settings.push({ key: 'quiz_teacher_home', value: home });
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
  return fake;
}

beforeEach(async () => { jest.clearAllMocks(); await boot(); });
afterEach(() => new Promise((r) => srv.close(r)));

test('ON: the make and the wa.me text end with the return line', async () => {
  seed(true);
  const t = tokenFor();
  const out = await make(t);
  expect(out.message.endsWith(`\n\n${RETURN_EN}`)).toBe(true);
  expect(textOf(await send(t, out.shareCodeId))).toBe(out.message);
});

test('ON, the Urdu page: the Urdu return line', async () => {
  seed(true);
  const out = await make(tokenFor({ lang: 'ur' }));
  expect(out.message.endsWith(`\n\n${RETURN_UR}`)).toBe(true);
});

test.each([['absent', undefined], ['false', false], ['"yes"', 'yes']])('OFF (%s): today\'s bytes, the bank\'s own message', async (_, v) => {
  seed(v);
  const t = tokenFor();
  const out = await make(t);
  const bank = await Bank.shareMessage({ uid: TEACHER.id, lang: 'en', shareCodeId: out.shareCodeId });
  expect(out.message).toBe(bank.message);
  expect(out.message).not.toContain(RETURN_EN);
  expect(textOf(await send(t, out.shareCodeId))).toBe(bank.message);
});
