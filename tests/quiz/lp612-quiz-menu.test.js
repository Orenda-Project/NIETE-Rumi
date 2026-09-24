'use strict';
/**
 * /quiz with the Grades 6-12 lesson plans in it — through the REAL list service and the REAL
 * provider registry (quiz-lesson-providers.js), not the provider alone.
 *
 * The operator (24 Sep 2026): "the quiz menu shows the quizzes for the LPs but not have them
 * generated unless the teacher requests them (same behaviour as the current transcript)". So:
 * the lessons a teacher received are rows before any quiz exists; listing makes nothing; a tap
 * makes ONE quiz; a second tap is answered once, by the list, with that quiz; after the tap the
 * lesson is its quiz row. QUIZ_LP612_SOURCE off: no 6-12 lesson row, the made quiz still listed.
 *
 * Mocks stop at the network boundary: an in-memory Supabase that remembers writes, a Redis map,
 * WhatsApp and the queue.
 */

const { createMemorySupabase } = require('./helpers/memory-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t), rpc: (n, a) => mockDb.rpc(n, a) }));
const mockSent = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => new Proxy({}, {
  get: (_, fn) => (fn === 'then' ? undefined : async (to, ...args) => { mockSent.push({ fn: String(fn), to, args }); return true; }),
}));
const mockJobs = [];
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn(async (groupId, jobType, payload) => { mockJobs.push({ groupId, jobType, payload }); return 'mid'; }),
}));
const mockKv = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  setNX: async (k) => { if (mockKv.has(k)) return false; mockKv.set(k, 1); return true; },
  delete: async (k) => { mockKv.delete(k); return true; },
  get: async (k) => mockKv.get(k) || null,
  set: async (k, v) => { mockKv.set(k, v); return true; },
  isAvailable: () => true,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../bot/shared/utils/structured-logger');
  return { ...actual, logEvent: (...a) => mockLogEvent(...a) };
});

const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { logToFile } = require('../../bot/shared/utils/logger');

const T = '11111111-1111-4111-8111-111111111111';
const PHONE = '923001234567';
const USER = { id: T, preferred_language: 'en', phone_number: PHONE, role: 'teacher' };
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const MATHS = '11111111-0000-4000-8000-000000000002';
const URDU = '11111111-0000-4000-8000-000000000003';

beforeEach(() => {
  jest.clearAllMocks();
  mockSent.length = 0; mockJobs.length = 0; mockKv.clear();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true';
  process.env.QUIZ_LP612_SOURCE = 'on';
  mockDb = createMemorySupabase({
    niete_lp612_segments: [
      { segment_id: 'grade_8_mathematics.c04.p047-050', grade: 8, subject: 'Mathematics', subtopic_title: 'Inverse proportion', menu_title: 'Inverse proportion', lp_type: 'content', is_religious: false },
      { segment_id: 'grade_7_urdu.c06.p033-034.words', grade: 7, subject: 'Urdu', subtopic_title: 'Words and meanings', menu_title: 'Words and meanings', lp_type: 'content', is_religious: false },
    ],
    niete_lp612_deliveries: [
      { id: MATHS, user_id: T, render_id: 'r-1', segment_id: 'grade_8_mathematics.c04.p047-050', lang: 'en', template_version: 'v9.6', surface: 'whatsapp', delivered_at: ago(3) },
      { id: URDU, user_id: T, render_id: 'r-2', segment_id: 'grade_7_urdu.c06.p033-034.words', lang: 'ur', template_version: 'v9.6', surface: 'whatsapp', delivered_at: ago(5) },
    ],
    quizzes: [],
    coaching_sessions: [],
    niete_lp_downloads: [],
    niete_lp_assets: [],
    niete_lp_asset_sources: [],
    quiz_sessions: [],
    teacher_nudges: [],
    users: [{ id: T, phone_number: PHONE, preferred_language: 'en', role: 'teacher' }],
  });
});
afterEach(() => {
  // A provider that throws costs its rows silently in the menu — so no error-level log is allowed.
  expect(logToFile.mock.calls.filter((c) => c[2] === 'error')).toEqual([]);
});
afterAll(() => { delete process.env.QUIZ_LP612_SOURCE; });

const rows = () => mockSent.filter((m) => m.fn === 'sendInteractiveMessage').slice(-1)[0].args[0].action.sections[0].rows;

describe('/quiz lists the 6-12 lessons a teacher received — and makes nothing until one is tapped', () => {
  test('each lesson is a "From lesson plan" row with no quiz yet; no quiz row, no job', async () => {
    await List.showList(USER, PHONE, 'en', 1);
    expect(rows().map((r) => r.id)).toEqual([`tq_pick_lsn_lp612_${MATHS}`, `tq_pick_lsn_lp612_${URDU}`]);
    const label = resolveUx('tqRowFromLessonPlan', { language: 'en' });
    rows().forEach((r) => expect(r.description.startsWith(`${label} · `)).toBe(true));
    expect(rows()[0].description).toContain('Inverse proportion');
    expect(mockDb.table('quizzes')).toHaveLength(0);
    expect(mockJobs).toHaveLength(0);
  });

  test('a tap makes one lp612 quiz and one job; a second tap is answered once, with that quiz', async () => {
    await List.handleListPick(`tq_pick_lsn_lp612_${URDU}`, PHONE, USER);
    const [quiz] = mockDb.table('quizzes');
    expect(quiz).toEqual(expect.objectContaining({ quiz_source: 'lp612', status: 'generating', teacher_id: T }));
    expect(mockJobs).toHaveLength(1);
    expect(mockLogEvent).toHaveBeenCalledWith('quiz_funnel.accepted', expect.objectContaining({ quiz_id: quiz.id, source: 'lp612', channel: 'quiz_menu' }));

    const before = mockSent.length;
    await List.handleListPick(`tq_pick_lsn_lp612_${URDU}`, PHONE, USER);
    expect(mockDb.table('quizzes')).toHaveLength(1);
    expect(mockJobs).toHaveLength(1);
    const reply = mockSent.slice(before);
    expect(reply).toHaveLength(1);
    expect(reply[0].args[0]).toBe(resolveUx('tqStillMaking', { language: 'en' }));
  });

  test('after the tap the lesson is its quiz row, not a second lesson row', async () => {
    await List.handleListPick(`tq_pick_lsn_lp612_${URDU}`, PHONE, USER);
    const [quiz] = mockDb.table('quizzes');
    await List.showList(USER, PHONE, 'en', 1);
    const ids = rows().map((r) => r.id);
    expect(ids).toContain(`tq_pick_lp_${quiz.id}`);
    expect(ids).not.toContain(`tq_pick_lsn_lp612_${URDU}`);
    expect(ids).toContain(`tq_pick_lsn_lp612_${MATHS}`);
  });

  test('QUIZ_LP612_SOURCE off: no 6-12 lesson row — and the 6-12 quiz already made is still listed', async () => {
    await List.handleListPick(`tq_pick_lsn_lp612_${URDU}`, PHONE, USER);
    const [quiz] = mockDb.table('quizzes');
    process.env.QUIZ_LP612_SOURCE = 'off';
    await List.showList(USER, PHONE, 'en', 1);
    expect(rows().map((r) => r.id)).toEqual([`tq_pick_lp_${quiz.id}`]);
  });
});

describe('a lesson-plan quiz row\'s label', () => {
  test('a plan quiz whose row carries no quiz_source is still "From lesson plan" (the fallback is defined)', () => {
    const label = List.rowLabel({ kind: 'lp', quiz: { id: 'q-1' } }, 'en');
    expect(label).toBe(resolveUx('tqRowFromLessonPlan', { language: 'en' }));
  });

  test('a 6-12 quiz row is "From lesson plan"', () => {
    expect(List.rowLabel({ kind: 'lp', quiz: { id: 'q-2', quiz_source: 'lp612' } }, 'ur'))
      .toBe(resolveUx('tqRowFromLessonPlan', { language: 'ur' }));
  });
});
