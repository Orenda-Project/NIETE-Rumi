'use strict';
/**
 * The make (FIRST_QUIZ §6) through POST /api/ft/make: ONE quiz_share_codes row through today's mintCode (teacher =
 * the token's uid), the bank's quizzes rows untouched, a second POST reuses the code, nothing is sent on WhatsApp and
 * the "which class?" chat question is never asked; the message is today's vqClassMessage, exactly, plus the
 * question-language line only when quizzes.language is known.
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
const { resolveUx } = require('../../shared/config/ux-strings');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const HandoutClass = require('../../shared/services/quiz/handout-class.service');
const MakerToken = require('../../shared/services/first-touch/maker.token');
const Bank = require('../../shared/services/first-touch/maker.bank');
const { str } = require('../../shared/services/first-touch/maker.strings');
const { seedMaker, TEACHER, PHONE, qid, vid, fixturePhone } = require('./maker-fixture');

const BOT_NO = fixturePhone(990);
const UK = '0123456789abcdef';
const tokenFor = (o = {}) => MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu', uk: UK, ...o });
const SAVED = { ...process.env };

let srv;
let fake;
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/ft${p}`;
const make = (body) => fetch(url('/api/ft/make'), {
  method: 'POST', headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const MATHS = { grade: '4', subject: 'maths', quizId: qid(2) };

beforeEach(async () => {
  process.env = { ...SAVED, WHATSAPP_BOT_NUMBER: BOT_NO, INTERNAL_API_KEY: SAVED.INTERNAL_API_KEY };
  jest.clearAllMocks();
  fake = seedMaker(supabase);
  IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
  require('../../shared/services/quiz/web-quiz-link')._resetCache();
  jest.spyOn(HandoutClass, 'askAfterHandout');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/ft', require('../../shared/services/first-touch/maker.routes'));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));
afterAll(() => { process.env = SAVED; });

const TEST_WORD = /\b(test|exam|assessment)\b|امتحان|ٹیسٹ/i;

test('one quiz_share_codes row for the token\'s teacher; quizzes rows byte-identical; nothing sent; no class question', async () => {
  const before = JSON.stringify(fake.db.quizzes);
  const res = await make({ t: tokenFor(), ...MATHS });
  expect(res.status).toBe(200);
  const out = await res.json();
  expect(fake.db.quiz_share_codes).toHaveLength(1);
  const row = fake.db.quiz_share_codes[0];
  expect(row).toMatchObject({ quiz_id: qid(2), teacher_user_id: TEACHER.id, video_id: vid(2), teacher_name: TEACHER.name, topic: 'Fractions', language: 'en' });
  expect(out).toEqual({ shareCodeId: row.id, message: expect.any(String), qlang: null, preview: 'First question of Fractions' });
  expect(JSON.stringify(fake.db.quizzes)).toBe(before);
  const writes = fake.calls.filter((c) => c.op !== 'select').map((c) => `${c.op}:${c.table}`);
  expect(writes).toEqual(['insert:quiz_share_codes']);
  for (const fn of Object.values(WhatsAppService)) if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  expect(HandoutClass.askAfterHandout).not.toHaveBeenCalled();
});

test('the message: today\'s exact vqClassMessage, no cta_url, no test word, ≤ 1,024 code points; NULL language → no line', async () => {
  const { message } = await (await make({ t: tokenFor(), ...MATHS })).json();
  const code = fake.db.quiz_share_codes[0].code;
  const today = resolveUx('vqClassMessage', { language: 'en', params: { teacher: TEACHER.name, topic: 'Fractions', link: `https://wa.me/${BOT_NO}?text=QUIZ-${code}` } });
  expect(message).toBe(today);
  expect(message).not.toMatch(/cta_url/);
  expect(message).not.toMatch(TEST_WORD);
  expect([...message].length).toBeLessThanOrEqual(1024);
});

test('language en on the quiz → the message ends with "The questions are in English."', async () => {
  fake.db.quizzes.find((q) => q.id === qid(2)).language = 'en';
  Bank._resetCache();
  const out = await (await make({ t: tokenFor(), ...MATHS })).json();
  expect(out.qlang).toBe('en');
  expect(out.message.endsWith(`\n\n${str('class.lang.en', 'en')}`)).toBe(true);
  expect(out.message.endsWith('The questions are in English.')).toBe(true);
});

test('the Urdu page → the Urdu class message, the code minted in Urdu, the Urdu language line', async () => {
  fake.db.quizzes.find((q) => q.id === qid(11)).language = 'ur';
  const out = await (await make({ t: tokenFor({ lang: 'bi' }), grade: '5', subject: 'science', quizId: qid(11) })).json();
  const row = fake.db.quiz_share_codes[0];
  expect(row.language).toBe('ur');
  const today = resolveUx('vqClassMessage', { language: 'ur', params: { teacher: TEACHER.name, topic: 'Magnets', link: `https://wa.me/${BOT_NO}?text=QUIZ-${row.code}` } });
  expect(out.message).toBe(`${today}\n\n${str('class.lang.ur', 'ur')}`);
  expect(out.message).not.toMatch(TEST_WORD);
});

test('a double POST → one row, the same code', async () => {
  const t = tokenFor();
  const a = await (await make({ t, ...MATHS })).json();
  const b = await (await make({ t, ...MATHS })).json();
  expect(fake.db.quiz_share_codes).toHaveLength(1);
  expect(b.shareCodeId).toBe(a.shareCodeId);
  expect(b.message).toBe(a.message);
});

test('today\'s video_quiz.share_code_minted once (fresh mint only), and onboard.maker{made} without the code or a phone', async () => {
  const t = tokenFor();
  await make({ t, ...MATHS });
  await make({ t, ...MATHS });
  const code = fake.db.quiz_share_codes[0].code;
  const minted = logEvent.mock.calls.filter(([e]) => e === 'video_quiz.share_code_minted');
  expect(minted).toEqual([['video_quiz.share_code_minted', { userId: TEACHER.id, quizId: qid(2), code, classBound: false }]]);
  const made = logEvent.mock.calls.filter(([e, f]) => e === 'onboard.maker' && f.step === 'made').map(([, f]) => f);
  expect(made).toHaveLength(2);
  expect(made[0]).toEqual({ step: 'made', grade: 'grade_4', subject: 'maths', qlang: null, lang: 'en', via: 'menu', quiz_id: qid(2), ukey: UK });
  const flat = JSON.stringify(made);
  expect(flat).not.toContain(code);
  expect(flat).not.toContain(PHONE);
});

test('a tampered quiz id → 400 {error:"mk.error"}, nothing minted', async () => {
  const res = await make({ t: tokenFor(), grade: '4', subject: 'maths', quizId: qid(6) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'mk.error' });
  expect(fake.db.quiz_share_codes).toHaveLength(0);
});

test('a stale token → 410 {error:"mk.stale"}, nothing minted', async () => {
  const old = MakerToken.signMaker({ uid: TEACHER.id, lang: 'en', tour: 0, via: 'menu' }, { now: Date.now() - 25 * 3600 * 1000 });
  const res = await make({ t: old, ...MATHS });
  expect(res.status).toBe(410);
  expect(await res.json()).toEqual({ error: 'mk.stale' });
  expect(fake.db.quiz_share_codes).toHaveLength(0);
});
