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
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
}
afterEach(() => new Promise((r) => { if (!srv) { r(); return; } srv.close(r); srv = null; }));
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const H = () => ({ 'x-api-key': process.env.INTERNAL_API_KEY });
const get = (p) => fetch(url(p), { headers: H() });

function seed({ value, fail = false, lp = null, lpRead = null } = {}) {
  fake = seedMaker(supabase, { on: true });
  fake.db.users = [{ ...TEACHER, phone_number: 'fixture-phone' }];
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true },
    ...(value === undefined ? [] : [{ key: KEY, value }])];
  // the lesson-plan tables the lp_v8 provider's own get() reads (A74's title): deliveries, assets, ingested versions
  if (lp) Object.assign(fake.db, { niete_lp_downloads: lp, niete_lp_assets: lp.map((r) => ({ id: r.asset_id, asset_kind: 'lesson' })),
    niete_lp_asset_sources: lp.map((r) => ({ lesson_id: r.lesson_id, version_stamp: r.version_stamp, content_hash: r.content_hash })), niete_lp_opens: [] });
  if (lpRead) hookLpRead(lpRead);
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
  if (fail) require('../first-touch/maker-fixture').hookPageRead(supabase, { fail: true });
}
/** The delivery-row read only: 'hang' never answers, 'fail' answers an error; every other read as seeded. */
function hookLpRead(mode) {
  const from0 = supabase.from;
  supabase.from = (t) => {
    const b = from0(t);
    if (t !== 'niete_lp_downloads') return b;
    b.maybeSingle = () => (mode === 'hang' ? { then: () => {} } : Promise.resolve({ data: null, error: { message: 'downloads down' } }));
    return b;
  };
}
const tokenFor = (lang = 'en') => HomeToken.signTeacherHome({ uid: TEACHER.id, lang, via: 'portal' });
/** The shell for `path` (after the token), the token masked so two shells compare by their bytes alone. */
async function shell(opts, path = '', lang = 'en') {
  seed(opts);
  await boot();
  const t = tokenFor(lang);
  // a 404 here once (1 run in 5, 22 Nov): say so at the source if the token could not be signed
  expect(typeof t === 'string' && t.length > 20 ? 'signed' : `unsigned token: ${t}`).toBe('signed');
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

/**
 * A74 (lead 20261122T144336): the one-lesson page NAMES its lesson. Under "Quiz from this lesson" / «اس سبق کا کوئز», one
 * line with the lesson's name, read on the server by the lp_v8 provider's own get(teacher, ref): the delivery row behind
 * `lsn_lp_v8_<deliveryRowId>`, only when it is this teacher's and makeable, named from the K-5 catalog (the name the home's
 * list and the 15:00 offer print, in the lesson's own language). No name (another teacher's row, an unknown ref, a failed or
 * slow read): today's one-lesson page byte for byte. The real provider runs over the in-memory tables.
 */
describe('A74: the one-lesson page names its lesson', () => {
  const Page = require('../../shared/services/first-touch/teacher-home.page');
  const row = (over = {}) => ({ id: 'dl-a74-1', user_id: TEACHER.id, lesson_id: 'grade_1_english_ch1_seg1', asset_id: 'as-a74-1',
    version_stamp: 'v-a74', content_hash: 'h-a74', grade: '1', subject: 'english', status: 'sent', created_at: '2026-11-20T05:00:00.000Z', ...over });
  const OWN = 'lsn_lp_v8_dl-a74-1';
  const scriptOf = (html) => /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const hashOf = (s) => `'sha256-${require('crypto').createHash('sha256').update(s, 'utf8').digest('base64')}'`;

  test.each([['en', row(), 'All About Me: Key Words'], ['ur', row(), 'All About Me: Key Words'],
    ['ur', row({ lesson_id: 'grade_1_urdu_ch4_seg1', subject: 'urdu' }), 'پسندیدہ کھیل اور جسمانی اعضا پر زبانی گفتگو']])(
    '%s: the teacher\'s own delivery → the boot carries its catalog name, and the titled script draws it under the say line', async (lang, r, name) => {
      const { html, csp } = await shell({ value: true, lp: [r] }, `?lesson=${OWN}`, lang);
      const b = bootOf(html);
      expect(b.one).toBe(OWN);
      expect(b.ot).toBe(name);
      const script = scriptOf(html);
      expect(script).toContain("var ot=el('p','th-sub');ot.appendChild(topic(b.ot));c.appendChild(ot)");
      expect(script).toBe(Page.ONE_LESSON_TITLED_SCRIPT);
      expect(csp).toContain(hashOf(script));
    });

  test.each([['another teacher\'s delivery', { lp: [row({ user_id: 'someone-else' })] }],
    ['no such delivery', { lp: [row({ id: 'dl-other' })] }], ['a row not sent', { lp: [row({ status: 'queued' })] }],
    ['the delivery read fails', { lp: [row()], lpRead: 'fail' }]])('%s → today\'s one-lesson page, byte for byte', async (_n, opts) => {
    const today = await shell({ value: true }, `?lesson=${OWN}`);
    const got = await shell({ value: true, ...opts }, `?lesson=${OWN}`);
    expect(got).toEqual(today);
    expect(bootOf(got.html)).not.toHaveProperty('ot');
    expect(scriptOf(got.html)).toBe(Page.ONE_LESSON_SCRIPT);
  });

  test('a delivery read that never answers: the page comes within the title wait, untitled', async () => {
    const t0 = Date.now();
    const got = await shell({ value: true, lp: [row()], lpRead: 'hang' }, `?lesson=${OWN}`);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(bootOf(got.html)).not.toHaveProperty('ot');
    expect(scriptOf(got.html)).toBe(Page.ONE_LESSON_SCRIPT);
  });

  test('?session= never reads a lesson name: byte for byte what it was', async () => {
    const before = await shell({ value: true }, `?session=${SESSION}`);
    const got = await shell({ value: true, lp: [row()] }, `?session=${SESSION}&lesson=${OWN}`);
    expect(got).toEqual(before);
    expect(fake.calls.filter((c) => c.table === 'niete_lp_downloads')).toHaveLength(0);
  });

  test('buildShell: forward on → the titled forward script; a ?session= page and a blank name are untitled', () => {
    const b = (o) => Page.buildShell({ token: 'a.b', lang: 'en', ...o });
    const fwd = b({ lesson: OWN, lessonTitle: 'All About Me: Key Words', forward: true });
    expect(scriptOf(fwd.html)).toBe(Page.ONE_LESSON_TITLED_SCRIPT_FWD);
    expect(fwd.csp).toContain(hashOf(Page.ONE_LESSON_TITLED_SCRIPT_FWD));
    expect(b({ one: SESSION, lessonTitle: 'All About Me: Key Words' })).toEqual(b({ one: SESSION }));
    expect(b({ lesson: OWN, lessonTitle: '   ' })).toEqual(b({ lesson: OWN }));
  });

  test('a lesson under religious review (Urdu ch1-3, Islamiyat) is never named, as it is never opened or made', async () => {
    const untitled = await shell({ value: true }, `?lesson=${OWN}`);
    const got = await shell({ value: true, lp: [row({ lesson_id: 'grade_1_urdu_ch1_seg1', subject: 'urdu' })] }, `?lesson=${OWN}`);
    expect(got).toEqual(untitled);
  });

  test('switch off: no name read at all, today\'s shell', async () => {
    const today = await shell({}, '');
    const got = await shell({ lp: [row()] }, `?lesson=${OWN}`);
    expect(got).toEqual(today);
    expect(fake.calls.filter((c) => c.table === 'niete_lp_downloads')).toHaveLength(0);
  });
});
