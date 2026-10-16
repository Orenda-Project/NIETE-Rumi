'use strict';
/**
 * The pre-fill wired end to end (FIRST_QUIZ §5.3-5.4): makerCta computes the token's `pf` with maker.prefill's
 * prefillFor (hasCell from the bank's chip tree) when it mints; the page with a `pf` whose cell exists opens on
 * "Last time: Grade 4, Mathematics" with "Use it" / "Change"; two grades → no pre-fill; a `pf` whose cell has gone
 * → no pre-fill (the grade chips, as today).
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
const Ledger = require('../../shared/services/quiz/message-ledger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Cta = require('../../shared/services/first-touch/maker.cta');
const { seedMaker, TEACHER, PHONE, qid } = require('./maker-fixture');

const SAVED = { ...process.env };
const BASE = 'https://portal.example.test';
let fake;
let srv;

function seed({ grades = ['4', 'grade_4'], subjects = ['maths'] } = {}) {
  fake = seedMaker(supabase);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache(); Ledger._resetCap();
  fake.db.lesson_plans = grades.map((g, i) => ({ id: `lp-${i}`, user_id: TEACHER.id, grade: g, subject: subjects[i % subjects.length], created_at: '2026-09-01T00:00:00.000Z' }));
}
async function mintedPf() {
  jest.spyOn(Ledger, 'record').mockResolvedValue(true);
  WhatsAppService.sendCtaUrl.mockResolvedValue(true);
  await Cta.makerCta({ uid: TEACHER.id, lang: 'en', who: 'known', via: 'empty', phone: PHONE });
  const { url } = WhatsAppService.sendCtaUrl.mock.calls[0][1];
  return { token: url.slice(`${BASE}/m/`.length), pf: MakerToken.verifyMaker(url.slice(`${BASE}/m/`.length)).ok.pf };
}
const H = { 'x-api-key': process.env.INTERNAL_API_KEY };
const page = async (t) => (await fetch(`http://127.0.0.1:${srv.address().port}/api/internal/ft/m/${t}`, { headers: H })).text();
const shown = (html, screen) => new RegExp(`<section data-screen="${screen}">`).test(html);

beforeEach(async () => {
  process.env = { ...SAVED, WEB_QUIZ_BASE_URL: BASE, WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret' };
  jest.clearAllMocks(); jest.restoreAllMocks();
  const app = express();
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));
afterAll(() => { process.env = SAVED; });

test("{'4', grade_4, maths} → the token's pf = grade_4|maths and the page opens on the pre-fill", async () => {
  seed();
  const { token, pf } = await mintedPf();
  expect(pf).toBe('grade_4|maths');
  const html = await page(token);
  expect(shown(html, 'prefill')).toBe(true);
  expect(shown(html, 'grade')).toBe(false);
  expect(html).toContain('Last time: Grade 4, Mathematics');
  expect(html).toContain('>Use it<');
  expect(html).toContain('>Change<');
  expect(html).toMatch(/data-pf="keep"/);
  expect(html).toMatch(/data-pf="change"/);
});

test('the Urdu pre-fill: «پچھلی بار: جماعت ۴، ریاضی» with «یہی رکھیں» / «تبدیل کریں»', async () => {
  seed();
  const t = MakerToken.signMaker({ uid: TEACHER.id, lang: 'ur', tour: 0, via: 'empty', pf: 'grade_4|maths' });
  const html = await page(t);
  expect(html).toContain('پچھلی بار: جماعت ۴، ریاضی');
  expect(html).toContain('یہی رکھیں');
  expect(html).toContain('تبدیل کریں');
});

test("{'4','5'} → no pf, the page opens on the grade chips", async () => {
  seed({ grades: ['4', '5'] });
  const { token, pf } = await mintedPf();
  expect(pf).toBeUndefined();
  const html = await page(token);
  expect(shown(html, 'grade')).toBe(true);
  expect(html).not.toContain('data-pf="keep"');
});

test('a pf whose cell is gone → no pre-fill', async () => {
  seed();
  const t = MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'empty', pf: 'grade_4|maths' });
  fake.db.quizzes.filter((q) => q.grade === '4').forEach((q) => { q.status = 'failed'; });
  const html = await page(t);
  expect(shown(html, 'grade')).toBe(true);
  expect(html).not.toContain('data-pf="keep"');
  expect(html).not.toContain('Last time');
});

test('a cell with no bank quiz → no pf minted', async () => {
  seed({ grades: ['2'], subjects: ['english'] });
  const { pf } = await mintedPf();
  expect(pf).toBeUndefined();
});

test('prefill_kept / prefill_changed: 204 and onboard.maker with the pf cell', async () => {
  seed();
  const t = MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'empty', pf: 'grade_4|maths' });
  const post = (b) => fetch(`http://127.0.0.1:${srv.address().port}/api/internal/ft/api/ft/step`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ t, ...b }),
  });
  expect((await post({ step: 'prefill_kept' })).status).toBe(204);
  expect((await post({ step: 'prefill_changed' })).status).toBe(204);
  const steps = logEvent.mock.calls.filter(([e]) => e === 'onboard.maker').map(([, f]) => [f.step, f.grade, f.subject]);
  expect(steps).toEqual([['prefill_kept', 'grade_4', 'maths'], ['prefill_changed', 'grade_4', 'maths']]);
});
