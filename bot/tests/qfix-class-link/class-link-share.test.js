'use strict';
/**
 * bd-pdwwk4.6.20 — "Share with your class" (switch web_quiz_class_link_share, OFF by default, under web_quiz_class_link).
 * Teachers almost never forwarded the standing class link (3 forwards since 26 Nov, 0 for the 25 evening-round classes):
 * the teacher app's card sat last on Home and the quiz home had none. With the switch on:
 *   - forApp says `top: true`, so the teacher app draws the card above the tiles while a class's link is unsent;
 *   - the teacher's quiz home (/quiz/teacher/<token>) carries a "Share with your class" section right under its top card:
 *     each class, its link and one tap "Send to class group" (a server link that logs the forward and 302s to wa.me).
 * Off: forApp has no `top` key, the quiz home's shell has no section and its script is today's, byte for byte.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
  };
});
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`, dk: () => 'dk', cls: () => 'clshash00000', qk: () => 'qk00000000', envelope: (f) => ({ ev_v: 2, ...f }),
}));
jest.mock('../../shared/services/quiz/web-quiz-class-link-canary', () => ({ inCanary: jest.fn(async () => true) }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');

const A = '7e000000-0000-4000-8000-0000000000a1';
const C1 = 'c1a55000-0000-4000-8000-0000000000c1';
const C2 = 'c1a55000-0000-4000-8000-0000000000c2';
const C9 = 'c1a55000-0000-4000-8000-0000000000c9';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const NOW = new Date('2026-11-24T13:00:00Z');
const ON = (k) => ({ key: k, value: true });
const LINK_ON = [ON('web_quiz_challenge'), ON('web_quiz_challenge_v2'), ON('web_quiz_class_link')];

let db;
function seed(settings) {
  db = {
    app_settings: settings,
    classes: [
      { id: C1, school_id: 's1', grade_code: 'grade_3', section: 'A', is_active: true },
      { id: C2, school_id: 's1', grade_code: 'grade_5', section: null, is_active: true },
      { id: C9, school_id: 's1', grade_code: 'grade_2', section: null, is_active: true },
    ],
    class_teachers: [{ class_id: C1, teacher_user_id: A, is_active: true }, { class_id: C2, teacher_user_id: A, is_active: true }],
    class_enrollments: [{ class_id: C1, student_id: ZARA, is_active: true }, { class_id: C2, student_id: ZARA, is_active: true }],
    students: [{ id: ZARA, student_name: 'Zara Test', is_active: true }],
    class_links: [], quizzes: [], quiz_share_codes: [], quiz_sessions: [],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
  require('../../shared/services/quiz/web-quiz-evening-round-flags')._resetCache();
}
const App = () => require('../../shared/services/quiz/web-quiz-class-link-app');
const Share = () => require('../../shared/services/first-touch/teacher-home.classlink');
const Page = () => require('../../shared/services/first-touch/teacher-home.page');

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'class-link-share-test-secret';
  process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.org';
});

describe('the switch', () => {
  test('off: forApp has no top key', async () => {
    seed(LINK_ON);
    const out = await App().forApp(A, { now: NOW });
    expect(out.classes).toHaveLength(2);
    expect(out).not.toHaveProperty('top');
  });

  test('on: forApp says top: true', async () => {
    seed([...LINK_ON, ON('web_quiz_class_link_share')]);
    expect((await App().forApp(A, { now: NOW })).top).toBe(true);
  });

  test('on without the class link itself: nothing (the share switch never turns the class link on)', async () => {
    seed([ON('web_quiz_class_link_share')]);
    expect(await App().forApp(A, { now: NOW })).toBeNull();
    expect(await require('../../shared/services/quiz/web-quiz-class-link-flags').shareOn()).toBe(false);
  });
});

describe('the quiz home: data', () => {
  test('forHome: off -> null', async () => {
    seed(LINK_ON);
    expect(await Share().forHome(A, 'en', { now: NOW })).toBeNull();
  });

  test('forHome: on -> each class with its label, its link shown without the scheme, and whether it went out', async () => {
    seed([...LINK_ON, ON('web_quiz_class_link_share')]);
    const out = await Share().forHome(A, 'ur', { now: NOW });
    const codes = Object.fromEntries(db.class_links.map((l) => [l.class_id, l.code]));
    expect(out).toEqual({ classes: [
      { classId: C1, label: 'کلاس 3 A', shown: `quiz.example.org/j/${codes[C1]}`, sent: false },
      { classId: C2, label: 'کلاس 5', shown: `quiz.example.org/j/${codes[C2]}`, sent: false },
    ] });
    expect(JSON.stringify(out)).not.toMatch(/Zara/);
  });

  test('send: logs the forward, marks the class sent and answers the wa.me link; not their class -> null', async () => {
    seed([...LINK_ON, ON('web_quiz_class_link_share')]);
    const href = await Share().sendHref({ uid: A, classId: C1, ua: 'jest' });
    expect(href).toMatch(/^https:\/\/wa\.me\/\?text=https%3A%2F%2Fquiz\.example\.org%2Fj%2F/);
    expect((await Share().forHome(A, 'en', { now: NOW })).classes[0]).toMatchObject({ classId: C1, label: 'Class 3 A', sent: true });
    expect(await Share().sendHref({ uid: A, classId: C9, ua: 'jest' })).toBeNull();
    expect(await Share().sendHref({ uid: A, classId: 'not-a-uuid', ua: 'jest' })).toBeNull();
  });
});

describe('the quiz home: page', () => {
  const T = 'tok.en';
  test('off: no section, today\'s script byte for byte', () => {
    const off = Page().buildShell({ token: T, lang: 'en' });
    expect(off.html).not.toMatch(/th-cl/);
    expect(off.html).toContain(`<script>${Page().SCRIPT}</script>`);
  });

  test('on: the section sits right under the top card, its words in both languages, its script under its own hash', () => {
    for (const lang of ['en', 'ur']) {
      const on = Page().buildShell({ token: T, lang, classLink: true });
      const top = on.html.indexOf('id="th-top"');
      const cl = on.html.indexOf('id="th-cl"');
      expect(top).toBeGreaterThan(0);
      expect(cl).toBeGreaterThan(top);
      expect(cl).toBeLessThan(on.html.indexOf('id="th-confirm"'));
      expect(on.html).toContain(require('../../shared/services/first-touch/teacher-home.strings').str('th.cl.head', lang));
      const script = /<script>([\s\S]*?)<\/script>/.exec(on.html)[1];
      expect(script).toContain("function cls(){");
      expect(script).toContain('top();cls();under();');
      expect(on.csp).toContain(Page().sha(script));
    }
  });

  test('on composes with the quiz reports section and the other page switches', () => {
    const on = Page().buildShell({ token: T, lang: 'en', classLink: true, reports: true, paged: true, early: true, portal: true, forward: true });
    expect(on.html).toMatch(/id="th-cl"/);
    expect(on.html).toMatch(/id="th-rp"/);
    expect(on.html).toContain('top();cls();under();reps();');
  });

  test('never on the one-lesson page', () => {
    const one = Page().buildShell({ token: T, lang: 'en', classLink: true, one: '5c000000-0000-4000-8000-000000000051' });
    expect(one.html).not.toMatch(/th-cl/);
  });

  test('every word exists in both languages, from the catalog', () => {
    const { str } = require('../../shared/services/first-touch/teacher-home.strings');
    for (const id of ['th.cl.head', 'th.cl.sub', 'th.cl.send', 'th.cl.sent', 'th.cl.again']) {
      expect(str(id, 'en')).toMatch(/[A-Za-z]/);
      expect(str(id, 'ur')).toMatch(/[؀-ۿ]/);
    }
    expect(Share().labelOf(3, 'A', 'en')).toBe('Class 3 A');
    expect(Share().labelOf(5, null, 'ur')).toBe('کلاس 5');
  });
});
