'use strict';
/**
 * The quiz home opened for ONE recorded lesson (ICT "IAB Experience View" row 35): the Digital Coach report's
 * "Create Quick Quiz" opens /quiz/teacher/<token>?session=<coaching session id>, and the page makes the quiz for THAT
 * lesson instead of showing every past session. Behind app_settings `quiz_teacher_home_one_lesson` (JSON true ONLY;
 * default OFF), a page switch: it rides the page-switch read (PAGE_KEYS), no read of its own.
 *
 * ON with a session id (a UUID): the shell is the one-lesson page — its boot carries the id, its script asks the
 * existing "Quiz this" (POST /api/th/quiz/make {kind:'coaching'}) right after paint, and a quiet "See all my lessons"
 * link opens the plain home. ON without an id, or with anything that is not a UUID: today's shell. OFF (absent, false,
 * the string "true", 1, a failed read), with or without the id: today's shell, byte for byte.
 * The session is the token's teacher's or nothing is made: quiz/make answers 404 for another teacher's lesson.
 *
 * The real router, page, token and transcript provider over the in-memory Supabase; only the network boundary is faked.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.SUPABASE_URL = 'https://unit-project.supabase.co';
process.env.WHATSAPP_BOT_NUMBER = ['1555', '000', '1111'].join('');
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/services/first-touch/walk-persona', () => ({ forHome: async (phone, lists) => lists }));
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({}));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const { str } = require('../../shared/services/first-touch/teacher-home.strings');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER } = require('./maker-fixture');

const KEY = 'quiz_teacher_home_one_lesson';
const SESSION = 'e0000000-0000-4000-8000-0000000000c1';
const OTHER = 'a0000000-0000-4000-8000-0000000000f2';

let srv;
let fake;
async function boot() {
  const app = express();
  app.use('/api/internal/th', createRouter({ List: { ...List, loadLessonPage: async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] }) } }));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => new Promise((r) => { if (!srv) { r(); return; } srv.close(r); srv = null; }));
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p) => fetch(url(p), { headers: H() });
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify(body) });

function seed({ value, fail = false } = {}) {
  fake = seedMaker(supabase, { on: true });
  fake.db.users = [{ ...TEACHER, phone_number: 'fixture-phone' }];
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true },
    ...(value === undefined ? [] : [{ key: KEY, value }])];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
  if (fail) require('./maker-fixture').hookPageRead(supabase, { fail: true });
}
const tokenFor = (lang = 'en') => HomeToken.signTeacherHome({ uid: TEACHER.id, lang, via: 'portal' });
/** The shell for `path` (after the token), the token masked so two shells compare by their bytes alone. */
async function shell(opts, path = '', lang = 'en') {
  seed(opts);
  await boot();
  const t = tokenFor(lang);
  const res = await get(`/quiz/teacher/${t}${path}`);
  expect(res.status).toBe(200);
  const html = (await res.text()).split(t).join('<T>');
  const csp = res.headers.get('content-security-policy');
  await new Promise((r) => srv.close(r));
  srv = null;
  return { html, csp };
}
const bootOf = (html) => JSON.parse(/<script type="application\/json" id="th-boot">([\s\S]*?)<\/script>/.exec(html)[1]);

describe('the switch is a page switch', () => {
  test('it is read with the other page switches (PAGE_KEYS), never on its own', () => {
    expect(Flags.ONE_LESSON_KEY).toBe(KEY);
    expect(Flags.PAGE_KEYS).toContain(KEY);
  });
});

describe('switch ON (JSON true)', () => {
  test.each([['en'], ['ur']])('%s: ?session=<uuid> → the one-lesson page: its id in the boot, its words, the link to the whole home', async (lang) => {
    const { html, csp } = await shell({ value: true }, `?session=${SESSION}`, lang);
    const b = bootOf(html);
    expect(b.one).toBe(SESSION);
    expect(b.s['th.one.say']).toBe(str('th.one.say', lang));
    expect(html).toContain('data-screen="teacher_home_one"');
    expect(html).toContain(`<a class="th-link" id="th-one-all" data-tap="one_all" href="/quiz/teacher/<T>">${str('th.one.all', lang)}</a>`);
    expect(html).toContain('function one(){');
    // the page's own script, allowed by its own hash
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    expect(csp).toContain(`'sha256-${require('crypto').createHash('sha256').update(script, 'utf8').digest('base64')}'`);
  });

  test('a bilingual link opened in English keeps the session on its language switch, and its "all lessons" link keeps English', async () => {
    const { html } = await shell({ value: true }, `?lang=en&session=${SESSION}`, 'bi');
    expect(html).toContain(`href="/quiz/teacher/<T>?lang=ur&amp;session=${SESSION}"`);
    expect(html).toContain('id="th-one-all" data-tap="one_all" href="/quiz/teacher/<T>?lang=en"');
  });

  test.each([['no session', ''], ['a session that is not a uuid', '?session=lsn_lp_v8_abc'], ['an empty session', '?session=']])('%s → today\'s shell', async (_n, path) => {
    const today = await shell({ value: true }, '');
    const got = await shell({ value: true }, path);
    expect(got).toEqual(today);
    expect(got.html).not.toContain('th-one-all');
    expect(bootOf(got.html)).not.toHaveProperty('one');
  });
});

describe.each([['absent', {}], ['false', { value: false }], ['the string "true"', { value: 'true' }], ['1', { value: 1 }], ['a failed read', { value: true, fail: true }]])('switch %s: today', (_n, opts) => {
  test('?session=<uuid> is ignored: the shell is exactly the one without it', async () => {
    const today = await shell(opts, '');
    const got = await shell(opts, `?session=${SESSION}`);
    expect(got).toEqual(today);
    expect(got.html).not.toContain('th-one-all');
    expect(got.html).not.toContain('function one(){');
  });
});

describe('the session is the teacher\'s own, checked on the server', () => {
  test('quiz/make for a lesson recorded by another teacher → 404, and no quiz row is written', async () => {
    seed({ value: true });
    fake.db.coaching_sessions = [{ id: SESSION, user_id: OTHER, status: 'completed', observation_type: null, transcript_text: 'x'.repeat(2000), analysis_data: { topic: 'Plants' } }];
    const before = fake.db.quizzes.length;
    await boot();
    const res = await post('/api/th/quiz/make', { t: tokenFor(), kind: 'coaching', id: SESSION });
    expect(res.status).toBe(404);
    expect(fake.db.quizzes.length).toBe(before);
    expect(logEvent).toHaveBeenCalledWith('teacher_home.quiz_make', expect.objectContaining({ kind: 'coaching', outcome: 'not_found' }));
  });
});

describe('the step', () => {
  test('the one-lesson page\'s open is a known step (204), so the rate can be read', async () => {
    seed({ value: true });
    await boot();
    const res = await post('/api/th/step', { t: tokenFor(), step: 'one_lesson' });
    expect(res.status).toBe(204);
    expect(logEvent).toHaveBeenCalledWith('teacher_home.step', expect.objectContaining({ step: 'one_lesson' }));
  });
});
