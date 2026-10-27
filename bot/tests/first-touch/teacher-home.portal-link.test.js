'use strict';
/**
 * The quiz home's way to the portal Home (G4 of the keyword-entry review, 27 Oct 2026), behind
 * app_settings `quiz_teacher_home_portal_link` (JSON true ONLY; default OFF). The quiz home said "portal" 0 times: a
 * teacher who came in from WhatsApp ("quiz") had no way on to the portal's tiles.
 *
 * ON: the home's JSON carries `portalHref`, the /portal command's own signed link (app-login-link 'menu', 24 h:
 * PORTAL_URL/go/<token>), minted on the server for a REGISTERED teacher who did NOT come from the portal (via 'portal':
 * the browser's back is the way there); the shell draws "Open my portal" in its foot and the script fills its href.
 * OFF (absent, false, the string "true", 1, a failed read): the shell and the JSON are today's, byte for byte
 * (teacher-home.grade-fast-off.golden.test.js), and nothing more is read: the switch rides the page read (PAGE_KEYS).
 *
 * The real router, page, token and app-login link over the in-memory Supabase; only the network boundary is faked.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
process.env.SUPABASE_URL = 'https://unit-project.supabase.co';
process.env.PORTAL_URL = 'https://portal.example';
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
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Gate = require('../../shared/services/quiz/teacher-report-gate');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');
const Bank = require('../../shared/services/first-touch/maker.bank');
const Flags = require('../../shared/services/first-touch/teacher-home.flags');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');
const AppLink = require('../../shared/services/app-login-link');
const { str } = require('../../shared/services/first-touch/teacher-home.strings');
const { createRouter } = require('../../shared/services/first-touch/teacher-home.routes');
const { seedMaker, TEACHER } = require('./maker-fixture');

const KEY = 'quiz_teacher_home_portal_link';
const PAGED = 'quiz_teacher_home_paged';

let srv;
let fake;
async function boot() {
  const app = express();
  app.use('/api/internal/th', createRouter({ List: { ...List, loadLessonPage: async () => ({ sessions: [], quizzes: [], counts: {}, lessons: [] }) } }));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
const url = (p) => `http://127.0.0.1:${srv.address().port}/api/internal/th${p}`;
const get = (p) => fetch(url(p), { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } });

function seed({ value, paged = false, user = TEACHER } = {}) {
  fake = seedMaker(supabase, { on: true });
  fake.db.users = [{ ...user }];
  fake.db.app_settings = [...fake.db.app_settings, { key: 'quiz_teacher_home', value: true },
    ...(paged ? [{ key: PAGED, value: true }] : []), ...(value === undefined ? [] : [{ key: KEY, value }])];
  Flags.reset(); IdFlags._resetCache(); HubFlags._resetCache(); Gate._resetCache(); Bank._resetCache();
}
const tokenFor = (via, lang = 'en') => HomeToken.signTeacherHome({ uid: TEACHER.id, lang, via });
async function home(via, opts = {}) {
  seed(opts);
  await boot();
  const res = await get(`/api/th/home?t=${tokenFor(via, opts.lang)}`);
  expect(res.status).toBe(200);
  return res.json();
}
async function shell(opts = {}) {
  seed(opts);
  await boot();
  const res = await get(`/quiz/teacher/${tokenFor('go', opts.lang)}`);
  expect(res.status).toBe(200);
  return res.text();
}

describe.each([['the full answer', false], ['the quick answer (paged)', true]])('switch ON (JSON true), %s', (_n, paged) => {
  // every door the token knows but the portal's own card (the list differs by tier: read it, never retype it)
  test.each(HomeToken.VIAS.filter((v) => v !== 'portal').map((v) => [v]))('via %s: portalHref is the signed /go link to this teacher\'s portal Home', async (via) => {
    const h = await home(via, { value: true, paged });
    expect(h.portalHref).toMatch(/^https:\/\/portal\.example\/go\/[A-Za-z0-9_-]+$/);
    const v = AppLink.verifyAppLink(h.portalHref.split('/go/')[1]);
    expect(v).toEqual(expect.objectContaining({ u: TEACHER.id, f: 'menu' }));
  });

  test('via portal (opened from the portal\'s own card): no portalHref, the browser\'s back is the way', async () => {
    const h = await home('portal', { value: true, paged });
    expect(h).not.toHaveProperty('portalHref');
  });

  test('a teacher who is not registered (no name, no completed form): no portalHref (as /portal asks them to register)', async () => {
    const h = await home('go', { value: true, paged, user: { ...TEACHER, name: null, registration_completed: false } });
    expect(h).not.toHaveProperty('portalHref');
  });
});

describe('switch ON: the shell', () => {
  test.each([['en'], ['ur']])('%s: the foot carries "Open my portal" (hidden until the home answers) and the script fills its href', async (lang) => {
    const html = await shell({ value: true, lang });
    const word = str('th.portal', lang);
    expect(html).toContain(`<a class="th-link" id="th-portal" data-tap="portal" hidden>${word}</a>`);
    expect(html).toContain("q('#th-portal')");
    expect([...word].length).toBeLessThanOrEqual(20);
  });
});

describe.each([['absent', undefined], ['false', false], ['the string "true"', 'true'], ['1', 1]])('switch %s: today', (_n, value) => {
  test('no portalHref, no foot link, no script part', async () => {
    const h = await home('go', { value });
    expect(h).not.toHaveProperty('portalHref');
    const html = await shell({ value });
    expect(html).not.toContain('th-portal');
  });
});

describe('the step', () => {
  test('a tap on the link is a known step (204), so the rate can be read', async () => {
    seed({ value: true });
    await boot();
    const res = await fetch(url('/api/th/step'), {
      method: 'POST', headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ t: tokenFor('go'), step: 'portal' }),
    });
    expect(res.status).toBe(204);
  });
});
