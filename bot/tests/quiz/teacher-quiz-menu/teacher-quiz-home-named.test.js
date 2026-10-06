'use strict';
/**
 * A user the pilot list NAMES (app_settings teacher_report_teachers = [their id])
 * gets the teacher /quiz home even when their role has no quiz of its own (a
 * coach). That is how the operator — a coach on production — walks the teacher
 * path. "all" never lifts the role gate: every other coach, leader and AEO keeps
 * their own menu. Handset routing is ON here (production's default).
 * The real openQuizMenu runs; supabase, whatsapp.service and the role menu's
 * sender are the faked boundaries.
 */
delete process.env.QUIZ_MENU_HANDSET_ROUTING;
process.env.WEB_QUIZ_BASE_URL = 'https://portal.example';

const { fakeDb } = require('./fake-db');

const COACH = { id: 'coach-1', phone_number: '923000000009', preferred_language: 'en', role: 'coach' };

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
const mockMenu = jest.fn(async () => true);
jest.mock('../../../shared/services/menu.service', () => ({ sendMenu: (...a) => mockMenu(...a) }));
jest.mock('../../../shared/services/quiz/video-quiz.service', () => ({ getActiveState: jest.fn(async () => null) }));

const { openQuizMenu } = require('../../../shared/services/quiz/quiz-menu-entry.service');
const Settings = require('../../../shared/services/quiz/teacher-report-gate');

function world(setting) {
  mockDb = fakeDb({ app_settings: [{ key: 'teacher_report_teachers', value: setting }], coaching_sessions: [], quizzes: [], quiz_sessions: [] });
}
const homeIds = () => {
  const b = mockSent.find((m) => m.kind === 'buttons');
  return b ? b.p.buttons.map((x) => x.id) : [];
};

beforeEach(() => { mockSent.length = 0; mockMenu.mockClear(); Settings._resetCache(); });

test('a coach the pilot list names by id gets the teacher home, not the coach menu', async () => {
  world(JSON.stringify([COACH.id]));
  const route = await openQuizMenu({ user: COACH, from: COACH.phone_number, language: 'en' });
  expect(route).toBe('teacher_menu');
  expect(homeIds()).toEqual(['tqh_make', 'tqh_reports', 'tqh_class']);
  expect(mockMenu).not.toHaveBeenCalled();
});

test('"all" never lifts the role gate: a coach keeps the coach menu', async () => {
  world('all');
  const route = await openQuizMenu({ user: COACH, from: COACH.phone_number, language: 'en' });
  expect(route).toBe('role_menu');
  expect(mockMenu).toHaveBeenCalledTimes(1);
  expect(homeIds()).toEqual([]);
});

test('a coach the list does not name keeps the coach menu', async () => {
  world(JSON.stringify(['someone-else']));
  const route = await openQuizMenu({ user: COACH, from: COACH.phone_number, language: 'en' });
  expect(route).toBe('role_menu');
  expect(mockMenu).toHaveBeenCalledTimes(1);
});
