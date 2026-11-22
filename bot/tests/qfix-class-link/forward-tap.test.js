'use strict';
/**
 * The teacher card's Forward / Copy of the standing class link (web-quiz-class-link.js forwardHref) logs the forward
 * lane's event, web_quiz.quiz_forward_tap { share_code_id: null, surface: 'class_link', method: 'wa_me' | 'copy',
 * origin: 'class_link', stale: false, cls }, and no longer the retired class_link_forwarded. The forwarded URL carries
 * ?f=1, so the landing counts the open as via 'forward'. Faked: Supabase (in memory), Redis, the loggers, the event key.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));
jest.mock('../../shared/services/quiz/web-quiz-kid', () => ({
  kid: (id) => `kid:${String(id).slice(-4)}`, dk: () => 'dk', cls: () => 'clshash00000', envelope: (f) => ({ ev_v: 2, ...f }),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const CL = require('../../shared/services/quiz/web-quiz-class-link');

const T1 = '7e000000-0000-4000-8000-0000000000e1';
const C1 = 'c1a55000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';

let db;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'forward-test-secret';
  process.env.WEB_QUIZ_BASE_URL = 'https://quiz.example.org';
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }, { key: 'web_quiz_challenge_v2', value: true }, { key: 'web_quiz_class_link', value: true }],
    class_teachers: [{ class_id: C1, teacher_user_id: T1, is_active: true }],
    classes: [{ id: C1, is_active: true }],
    class_enrollments: [{ class_id: C1, student_id: ZARA, is_active: true }],
    class_links: [],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  require('../../shared/services/quiz/web-quiz-class-link-flags')._resetCache();
});
afterEach(() => { delete process.env.WEB_QUIZ_BASE_URL; });

const taps = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.quiz_forward_tap').map(([, f]) => f);
const retired = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.class_link_forwarded');

test('Forward: wa.me with the link + ?f=1; quiz_forward_tap{surface class_link, method wa_me}; no class_link_forwarded', async () => {
  const out = await CL.forwardHref({ teacherId: T1, classId: C1 });
  const code = db.class_links[0].code;
  expect(decodeURIComponent(out.replace(/^https:\/\/wa\.me\/\?text=/, ''))).toBe(`https://quiz.example.org/j/${code}?f=1`);
  expect(taps()).toEqual([{ ev_v: 2, w: 's', cls: 'clshash00000', share_code_id: null, surface: 'class_link', method: 'wa_me', origin: 'class_link', stale: false }]);
  expect(retired()).toHaveLength(0);
});

test('Copy: quiz_forward_tap{method copy}; no class_link_forwarded', async () => {
  const out = await CL.forwardHref({ teacherId: T1, classId: C1, how: 'copy', reportBase: '/r/tok.sig' });
  expect(out).toBe(`/r/tok.sig?tab=class&cl_open=${C1}#class-link`);
  expect(taps()).toEqual([{ ev_v: 2, w: 's', cls: 'clshash00000', share_code_id: null, surface: 'class_link', method: 'copy', origin: 'class_link', stale: false }]);
  expect(retired()).toHaveLength(0);
});
