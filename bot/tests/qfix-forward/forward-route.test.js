'use strict';
/**
 * The one-tap forward on the teacher home's bot router (/api/internal/th), end to end over the in-memory Supabase:
 *   GET /quiz/teacher/<qf token>/fwd → 302 wa.me/?text=<the class message>, quiz_forward_tap logged with the code id;
 *   the teacher home's own send tap (share_tap, the /send route) → quiz_forward_tap { surface: teacher_home } too.
 * Only the network boundary is stood in for (Supabase, Redis, WhatsApp, the loggers); every home module runs for real.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.PORTAL_URL = 'https://portal.example';
process.env.WHATSAPP_BOT_NUMBER = '15550001111';
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('../first-touch/_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('../first-touch/_ingress-mocks').whatsappMock(jest));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const WebQuizToken = require('../../shared/services/quiz/web-quiz-token');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER, qid } = require('../first-touch/maker-fixture');

const OTHER = 'a0000000-0000-4000-8000-0000000000f2';
const OWN_QUIZ = 'c0000000-0000-4000-8000-0000000000a1';
const OWN_CODE = 'f0000000-0000-4000-8000-0000000000a1';
const MESSAGE = 'Class, play this quiz: https://portal.example/q/ABCDEF';
const b64 = (uuid) => Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
// the qf token's shape (quiz-forward.js), minted by hand so this test does not lean on the module it checks
const qf = (o = {}) => WebQuizToken.sign({ k: 'qf', q: b64(OWN_QUIZ), s: 'h', l: 'en', exp: Math.floor(Date.now() / 1000) + 3600, ...o });

let srv;
let fake;
async function boot() {
  const app = express();
  app.use('/api/internal/th', createRouter(null));
  await new Promise((r) => { srv = app.listen(0, r); });
}
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p, ua = null) => fetch(url(p), { headers: { ...H(), ...(ua ? { 'user-agent': ua } : {}) }, redirect: 'manual' });
// WhatsApp's own browser (in-app-browser-whatsapp §8: "WA4A/<v>", not "; wv)") and Chrome on the same phone
const WA_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36 WA4A/2.24.25.78';
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
const taps = () => logEvent.mock.calls.filter(([n]) => n === 'quiz_forward_tap').map(([, f]) => f);

function seed({ owner = TEACHER.id, settings = [] } = {}) {
  fake = seedMaker(supabase, { on: true, extra: { coaching_sessions: [], quiz_sessions: [] } });
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true }, ...settings];
  const at = new Date().toISOString();
  fake.db.quizzes.push({
    id: OWN_QUIZ, teacher_id: owner, quiz_source: 'lp_v8', status: 'sent', topic: 'Photosynthesis', subject: 'Science', created_at: at,
    meta: { student_message: MESSAGE, share_code_id: OWN_CODE, share_code: 'ABCDEF' },
  });
  fake.db.quiz_share_codes.push({ id: OWN_CODE, code: 'ABCDEF', quiz_id: OWN_QUIZ, teacher_user_id: owner, active: true, expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: at, invited_by_student_id: null });
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Bank._resetCache();
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

describe('GET /quiz/teacher/<qf>/fwd — the one tap from a WhatsApp message', () => {
  test('the teacher\'s own quiz: 302 → wa.me/?text=<its class message + the return line>, quiz_forward_tap with the code id', async () => {
    seed();
    await boot();
    const res = await get(`/quiz/teacher/${qf()}/fwd`);
    expect(res.status).toBe(302);
    const loc = res.headers.get('location');
    expect(loc.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(loc.slice('https://wa.me/?text='.length)).startsWith(MESSAGE)).toBe(true);
    expect(taps()).toEqual([expect.objectContaining({ w: 's', share_code_id: OWN_CODE, surface: 'wa_handout', method: 'wa_me', origin: 'lesson_plan', stale: false })]);
    // ids only: no phone, no name, no message text in the event
    expect(JSON.stringify(taps()[0])).not.toMatch(/Photosynthesis|Amina|portal\.example|\+?92\d/);
  });

  test("opened in WhatsApp's own browser: 302 → whatsapp://send?text=<the same message> (the app's picker, not the wa.me web page), method wa_scheme", async () => {
    seed();
    await boot();
    const res = await get(`/quiz/teacher/${qf()}/fwd`, WA_UA);
    expect(res.status).toBe(302);
    const loc = res.headers.get('location');
    expect(loc.startsWith('whatsapp://send?text=')).toBe(true);
    expect(decodeURIComponent(loc.slice('whatsapp://send?text='.length)).startsWith(MESSAGE)).toBe(true);
    expect(taps()).toEqual([expect.objectContaining({ surface: 'wa_handout', method: 'wa_scheme', share_code_id: OWN_CODE })]);
  });

  test('opened in Chrome: wa.me as before (Chrome hands wa.me to the app itself), method wa_me', async () => {
    seed();
    await boot();
    const res = await get(`/quiz/teacher/${qf()}/fwd`, CHROME_UA);
    expect(res.headers.get('location').startsWith('https://wa.me/?text=')).toBe(true);
    expect(taps()).toEqual([expect.objectContaining({ method: 'wa_me' })]);
  });

  test('the surface letter is spelled out: n → wa_nudge', async () => {
    seed();
    await boot();
    expect((await get(`/quiz/teacher/${qf({ s: 'n' })}/fwd`)).status).toBe(302);
    expect(taps()[0]).toMatchObject({ surface: 'wa_nudge' });
  });

  test('a quiz that is not live any more (code ended): the error page, no redirect, no tap', async () => {
    seed();
    fake.db.quiz_share_codes[fake.db.quiz_share_codes.length - 1].active = false;
    await boot();
    const res = await get(`/quiz/teacher/${qf()}/fwd`);
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    expect(taps()).toEqual([]);
  });

  test('a forged token, or a teacher-home token on the fwd path: 404, nothing logged; an expired one: the stale page, a stale tap', async () => {
    seed();
    await boot();
    const forged = `${qf().split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA`;
    expect((await get(`/quiz/teacher/${forged}/fwd`)).status).toBe(404);
    const th = HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });
    expect((await get(`/quiz/teacher/${th}/fwd`)).status).toBe(404);
    expect(taps()).toEqual([]);
    const old = await get(`/quiz/teacher/${qf({ exp: Math.floor(Date.now() / 1000) - 60 })}/fwd`);
    expect(old.status).toBe(200);
    expect(old.headers.get('location')).toBeNull();
    expect(taps()).toEqual([expect.objectContaining({ stale: true, surface: 'wa_handout' })]);
  });
});

describe('the teacher home\'s own send tap is a forward tap (the meter is never switched)', () => {
  test('share_tap on the teacher\'s own quiz → teacher_send as today AND quiz_forward_tap { surface: teacher_home, share_code_id }', async () => {
    seed();
    await boot();
    const t = HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });
    expect((await post('/api/th/step', { t, step: 'share_tap', kind: 'again', id: OWN_QUIZ, origin: 'again' })).status).toBe(204);
    expect(logEvent).toHaveBeenCalledWith('teacher_send', expect.objectContaining({ kind: 'quiz', origin: 'again' }));
    expect(taps()).toEqual([expect.objectContaining({ surface: 'teacher_home', method: 'wa_me', share_code_id: OWN_CODE })]);
  });

  test('the library send route (/send?c) → quiz_forward_tap with that code', async () => {
    seed();
    await boot();
    const t = HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });
    const home = await (await get(`/api/th/home?t=${t}&g=4`)).json();
    const c = home.library && home.library.pick ? home.library.pick.send.c : home.primary.send.c;
    expect((await get(`/quiz/teacher/${t}/send?c=${c}&o=library`)).status).toBe(302);
    expect(taps()).toEqual([expect.objectContaining({ surface: 'teacher_home', share_code_id: c, origin: 'library' })]);
  });

  test('another teacher\'s quiz: teacher_send as today, the tap carries no code id', async () => {
    seed({ owner: OTHER });
    await boot();
    const t = HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });
    await post('/api/th/step', { t, step: 'share_tap', kind: 'again', id: OWN_QUIZ, origin: 'again' });
    expect(taps()).toEqual([expect.objectContaining({ surface: 'teacher_home', share_code_id: null })]);
  });

  test('the native share sheet (switch on, page only): fwd_native → a native tap; fwd_result → quiz_forward_result', async () => {
    seed({ settings: [{ key: 'quiz_forward_button', value: true }] });
    await boot();
    const t = HomeToken.signTeacherHome({ uid: TEACHER.id, lang: 'en', via: 'go' });
    expect((await post('/api/th/step', { t, step: 'fwd_native', kind: 'again', id: OWN_QUIZ, origin: 'again' })).status).toBe(204);
    expect((await post('/api/th/step', { t, step: 'fwd_result', kind: 'again', id: OWN_QUIZ, r: 'dismissed' })).status).toBe(204);
    expect(taps()).toEqual([expect.objectContaining({ surface: 'teacher_home', method: 'native', share_code_id: OWN_CODE })]);
    expect(logEvent).toHaveBeenCalledWith('quiz_forward_result', expect.objectContaining({ surface: 'teacher_home', result: 'dismissed', share_code_id: OWN_CODE }));
    // a native tap is not a teacher_send (the WhatsApp link's tap is)
    expect(logEvent.mock.calls.filter(([n]) => n === 'teacher_send')).toHaveLength(0);
  });
});
