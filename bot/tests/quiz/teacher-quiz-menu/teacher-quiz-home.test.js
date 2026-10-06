'use strict';
/**
 * The teacher's /quiz HOME (W37 M3a, SPEC §1): three reply buttons — Make a
 * quiz / My quiz reports / Class progress — shown only to teachers that
 * app_settings `teacher_report_teachers` covers. Absent setting = today's
 * /quiz exactly (the Flow, or the list).
 *
 * The real openQuizMenu runs; only supabase and whatsapp.service are mocked.
 */

process.env.QUIZ_MENU_HANDSET_ROUTING = 'off';
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';
process.env.QUIZ_MENU_LESSON_ROWS = 'off';

const { fakeDb } = require('./fake-db');

const TEACHER = { id: 'teacher-1', phone_number: '923000000001', preferred_language: 'en', role: 'teacher' };
const FROM = TEACHER.phone_number;
const LONG = 'x'.repeat(5000);

let mockDb;
jest.mock('../../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
const mockSent = [];
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockSent.push({ kind: 'text', to, text }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, p) => { mockSent.push({ kind: 'buttons', to, p }); return true; }),
  sendInteractiveMessage: jest.fn(async (to, p) => { mockSent.push({ kind: 'list', to, p }); return true; }),
  sendFlow: jest.fn(async (to, f) => { mockSent.push({ kind: 'flow', to, f }); return true; }),
  sendTemplate: jest.fn(async () => true),
}));
const mockEvents = [];
jest.mock('../../../shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../../shared/utils/structured-logger'),
  logEvent: jest.fn((name, props) => { mockEvents.push({ name, props }); }),
}));

const { openQuizMenu } = require('../../../shared/services/quiz/quiz-menu-entry.service');
const Settings = require('../../../shared/services/quiz/teacher-report-gate');
const { resolveUx } = require('../../../shared/config/ux-strings');

const cp = (s) => [...String(s)].length;

function world(setting) {
  const app_settings = setting === undefined ? [] : [{ key: 'teacher_report_teachers', value: setting }];
  mockDb = fakeDb({
    app_settings,
    coaching_sessions: [{
      id: 'cs-1', user_id: TEACHER.id, observation_type: null, status: 'completed',
      created_at: '2026-10-01T09:00:00Z', transcript_text: LONG, analysis_data: { topic: 'Fractions', subject: 'Maths' },
    }],
    quizzes: [],
    quiz_sessions: [],
  });
}

beforeEach(() => {
  mockSent.length = 0;
  mockEvents.length = 0;
  Settings._resetCache();
  process.env.TRANSCRIPT_QUIZ_FLOW_ID = 'flow-123';
});

describe('the home is gated per teacher; absent setting = today exactly', () => {
  test('no setting → the /quiz Flow, exactly as before, and no home', async () => {
    world(undefined);
    await openQuizMenu({ user: TEACHER, from: FROM, language: 'en' });
    expect(mockSent.map((s) => s.kind)).toEqual(['flow']);
    expect(mockSent[0].f.flowId).toBe('flow-123');
    expect(mockEvents.find((e) => e.name === 'quiz_menu.home_shown')).toBeUndefined();
  });

  test('no setting, no Flow id → the lesson list, exactly as before', async () => {
    world(undefined);
    delete process.env.TRANSCRIPT_QUIZ_FLOW_ID;
    await openQuizMenu({ user: TEACHER, from: FROM, language: 'en' });
    expect(mockSent.map((s) => s.kind)).toEqual(['list']);
    expect(mockSent[0].p.action.sections[0].rows[0].id).toMatch(/^tq_pick_/);
  });

  test('a list that does not hold this teacher → today\'s Flow', async () => {
    world(JSON.stringify(['someone-else']));
    await openQuizMenu({ user: TEACHER, from: FROM, language: 'en' });
    expect(mockSent.map((s) => s.kind)).toEqual(['flow']);
  });

  test('"all" → three reply buttons, ids tqh_make / tqh_reports / tqh_class', async () => {
    world('all');
    await openQuizMenu({ user: TEACHER, from: FROM, language: 'en' });
    expect(mockSent.map((s) => s.kind)).toEqual(['buttons']);
    expect(mockSent[0].p.buttons.map((b) => b.id)).toEqual(['tqh_make', 'tqh_reports', 'tqh_class']);
    expect(mockEvents.find((e) => e.name === 'quiz_menu.home_shown').props).toEqual({ userId: TEACHER.id });
  });

  test('a list holding this teacher (JSON array) → the home', async () => {
    world([TEACHER.id]);
    await openQuizMenu({ user: TEACHER, from: FROM, language: 'en' });
    expect(mockSent[0].kind).toBe('buttons');
  });

  test('the settings read is cached (one app_settings read for two /quiz)', async () => {
    world('all');
    await openQuizMenu({ user: TEACHER, from: FROM, language: 'en' });
    await openQuizMenu({ user: TEACHER, from: FROM, language: 'en' });
    expect(mockDb.reads.filter((r) => r.table === 'app_settings')).toHaveLength(1);
  });
});

describe('the home message fits WhatsApp, in both languages', () => {
  test.each(['en', 'ur'])('%s: buttons ≤20 cp, body ≤1024 cp', async (lang) => {
    world('all');
    await openQuizMenu({ user: { ...TEACHER, preferred_language: lang }, from: FROM, language: lang });
    const p = mockSent[0].p;
    p.buttons.forEach((b) => expect(cp(b.title)).toBeLessThanOrEqual(20));
    expect(cp(p.body)).toBeLessThanOrEqual(1024);
    expect(p.buttons[0].title).toBe(resolveUx('tqhMake', { language: lang }));
  });
});

describe('tqh_make is today\'s Make-a-quiz path', () => {
  const Home = require('../../../shared/services/quiz/teacher-quiz-home.service');

  test('tap → the /quiz Flow (the same one /quiz mockSent before the home existed)', async () => {
    world('all');
    expect(await Home.handleHomeButton('tqh_make', FROM, TEACHER)).toBe(true);
    expect(mockSent.map((s) => s.kind)).toEqual(['flow']);
    expect(mockEvents.find((e) => e.name === 'quiz_menu.choice').props).toEqual({ userId: TEACHER.id, choice: 'make' });
  });

  test('an id the home does not own is not handled', async () => {
    world('all');
    expect(await Home.handleHomeButton('tq_link_abc', FROM, TEACHER)).toBe(false);
    expect(mockSent).toHaveLength(0);
  });
});
