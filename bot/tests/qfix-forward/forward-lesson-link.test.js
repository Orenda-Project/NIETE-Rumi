'use strict';
/**
 * The quiz home opened for ONE lesson PLAN: /quiz/teacher/<token>?lesson=<the /quiz list's lesson key, lsn_<source>_<ref>>,
 * the twin of the coaching report's ?session=. It rides the same page switch, app_settings `quiz_teacher_home_one_lesson`
 * (no new switch). ON with a key a registered lesson provider can parse: the one-lesson page, its boot carrying the key and
 * its script making THAT lesson's quiz (POST /api/th/quiz/make {kind:'lesson'}, the provider checks it is the teacher's).
 * A key no provider parses, an empty one, or the switch off: today's shell, byte for byte. ?session= keeps winning, and the
 * ?session= page is byte for byte what it was.
 *
 * The real router, page, token and providers over the in-memory Supabase; only the network boundary is faked.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.SUPABASE_URL = 'https://unit-project.supabase.co';
process.env.WHATSAPP_BOT_NUMBER = ['1555', '000', '1111'].join('');
process.env.WEB_QUIZ_KID_KEY = 'unit-kid-key-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('../first-touch/_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('../first-touch/_ingress-mocks').whatsappMock(jest));
jest.mock('../../shared/services/first-touch/walk-persona', () => ({ forHome: async (phone, lists) => lists }));
jest.mock('../../shared/services/first-touch/one-door.service', () => ({}));
jest.mock('../../shared/services/first-touch/optional-modules', () => ({}));

const express = require('express');
const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const { str } = require('../../shared/services/first-touch/teacher-home.strings');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER } = require('../first-touch/maker-fixture');

const KEY = 'quiz_teacher_home_one_lesson';
const SESSION = 'e0000000-0000-4000-8000-0000000000c1';

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

function seed({ value, fail = false } = {}) {
  fake = seedMaker(supabase, { on: true });
  fake.db.users = [{ ...TEACHER, phone_number: 'fixture-phone' }];
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true },
    ...(value === undefined ? [] : [{ key: KEY, value }])];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
  if (fail) require('../first-touch/maker-fixture').hookPageRead(supabase, { fail: true });
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

const LESSON = 'lsn_lp_v8_g4-math-ch5-seg2';

describe('switch ON (JSON true)', () => {
  test.each([['en'], ['ur']])('%s: ?lesson=<key> → the one-lesson page for that plan: the key in the boot, the lesson script, its own hash allowed', async (lang) => {
    const { html, csp } = await shell({ value: true }, `?lesson=${LESSON}`, lang);
    const b = bootOf(html);
    expect(b.one).toBe(LESSON);
    expect(b.s['th.one.say']).toBe(str('th.one.say', lang));
    expect(html).toContain(`<a class="th-link" id="th-one-all" data-tap="one_all" href="/quiz/teacher/<T>">${str('th.one.all', lang)}</a>`);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    expect(script).toContain("make:'lesson',id:b.one");
    expect(csp).toContain(`'sha256-${require('crypto').createHash('sha256').update(script, 'utf8').digest('base64')}'`);
  });

  test('a bilingual link opened in English keeps the lesson on its language switch', async () => {
    const { html } = await shell({ value: true }, `?lang=en&lesson=${LESSON}`, 'bi');
    expect(html).toContain(`href="/quiz/teacher/<T>?lang=ur&amp;lesson=${LESSON}"`);
  });

  test.each([['a source no provider has', '?lesson=lsn_nope_abc'], ['not a lesson key', '?lesson=abc'], ['an empty key', '?lesson='],
    ['a key with no lesson ref', '?lesson=lsn_lp_v8_'], ['a key with a space', '?lesson=lsn_lp_v8_a%20b']])('%s → today\'s shell', async (_n, path) => {
    const today = await shell({ value: true }, '');
    const got = await shell({ value: true }, path);
    expect(got).toEqual(today);
    expect(bootOf(got.html)).not.toHaveProperty('one');
  });

  test('?session= and ?lesson= together: the session page, byte for byte as with ?session= alone', async () => {
    const session = await shell({ value: true }, `?session=${SESSION}`);
    const both = await shell({ value: true }, `?session=${SESSION}&lesson=${LESSON}`);
    expect(both).toEqual(session);
    expect(/<script>([\s\S]*?)<\/script>/.exec(session.html)[1]).toContain("make:'coaching',id:b.one");
  });
});

describe.each([['absent', {}], ['false', { value: false }], ['the string "true"', { value: 'true' }], ['1', { value: 1 }], ['a failed read', { value: true, fail: true }]])('switch %s: today', (_n, opts) => {
  test('?lesson=<key> is ignored: the shell is exactly the one without it', async () => {
    const today = await shell(opts, '');
    const got = await shell(opts, `?lesson=${LESSON}`);
    expect(got).toEqual(today);
    expect(got.html).not.toContain('function one(){');
  });
});
