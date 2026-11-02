'use strict';
/**
 * bd-pw1ccr.26 — a held topic nudge (window shut, retry booked) stops once she acts without it:
 *  - the retry skips as `made_paper` if she made a paper for that chapter since taking the plan;
 *  - the portal card's tap skips her pending retries as `card_used` (store.skipPendingForTopic).
 * Same harness as topic-end-nudge.test.js: real service + real store over an in-memory Supabase.
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');

const SCHOOL_B = 'b0000000-0000-4000-8000-00000000000b';
const USER = {
  id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'en',
  role: 'teacher', school_id: SCHOOL_B, last_message_at: '2026-10-30T03:00:00Z',
};

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => new Proxy({}, { get: (_, k) => mockDb[k] }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendCtaUrl: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/app-login-link', () => ({ signAppLink: jest.fn(() => 'TOK') }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.test/' }));
jest.mock('../../bot/shared/services/app-redirect.service', () => ({ isOnTeacherApp: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/assessment/topics/topics.repo', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/topics/topics.repo'),
  listChapterTopics: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { listChapterTopics } = require('../../bot/shared/services/assessment/topics/topics.repo');
const { lessonById } = require('../../bot/shared/services/lp-v8-catalog.service');
const Nudge = require('../../bot/shared/services/nudges/topic-end-nudge.service');
const Arm = require('../../bot/shared/services/nudges/topic-end-arm');
const store = require('../../bot/shared/services/nudges/teacher-nudges.store');

const seg = (i) => ({ lesson_id: `grade_1_english_ch4_seg${i}`, segment_index: i });
const CHAPTER = { number: 4, lessons: [1, 2, 3, 4, 5, 6, 7, 8].map(seg).concat(seg(995)) };
const MON_9AM = '2026-11-02T04:00:00Z';
const MON_1430 = new Date('2026-11-02T09:30:00Z');
const TUE_1430 = new Date('2026-11-03T09:30:00Z');

function seed(requests = []) {
  mockDb = createMemorySupabase({
    app_settings: [{ key: 'topic_end_nudge_enabled', value: true }],
    users: [USER],
    niete_topic_nudge_ab_assignment: [{ school_id: SCHOOL_B, ab_group: 'B' }],
    teacher_nudges: [],
    niete_lp_opens: [],
    assessment_requests: requests,
  }, { unique: { teacher_nudges: ['user_id', 'nudge_date', 'kind'] } });
}
const nudges = async () => (await mockDb.from('teacher_nudges').select('*')).data;
/** The column default ('pending') the in-memory table does not apply. */
const defaultPending = () => mockDb.from('teacher_nudges').update({ status: 'pending' }).is('status', null);
const paper = (over = {}) => ({
  id: 'r1', user_id: USER.id, grade_code: 'grade_1', subject_code: 'english', chapter_number: 4,
  created_at: '2026-11-02T10:00:00Z', ...over,
});

/** Book Monday's nudge, let Monday's send find the window shut, and return Tuesday's retry row. */
async function heldRetry() {
  await Nudge.onLessonDelivered({ userId: USER.id, lessonId: 'grade_1_english_ch4_seg5', deliveredAt: MON_9AM });
  const [first] = await nudges();
  await Nudge.send(first, { now: MON_1430 });
  await mockDb.from('teacher_nudges').update({ status: 'skipped' }).eq('id', first.id); // what the sweeper writes
  return (await nudges()).find((r) => r.nudge_date === '2026-11-03');
}

beforeEach(() => {
  jest.clearAllMocks();
  Arm._resetCache();
  seed();
  lessonById.mockImplementation((id) => {
    const lesson = CHAPTER.lessons.find((l) => l.lesson_id === id);
    return lesson ? { lesson, chapter: CHAPTER, book: { grade: 1, subject_key: 'english' } } : null;
  });
  listChapterTopics.mockResolvedValue([
    { topicId: 'a', name: 'Poem', days: [27, 28] },
    { topicId: 'b', name: 'Plurals', days: [29, 30, 31] },
    { topicId: 'c', name: 'ABC Order', days: [32, 33, 34] },
  ]);
});

describe('the retry stops if she made the paper herself', () => {
  test('a paper for the chapter since she took the plan: skipped as made_paper, nothing sent', async () => {
    const retry = await heldRetry();
    await mockDb.from('assessment_requests').insert(paper());
    expect(await Nudge.send(retry, { now: TUE_1430 })).toEqual(expect.objectContaining({ skipped: 'made_paper' }));
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
  });

  test('a paper for another chapter, or one made before she took the plan, does not stop it', async () => {
    const retry = await heldRetry();
    await mockDb.from('assessment_requests').insert(paper({ id: 'r2', chapter_number: 5 }));
    await mockDb.from('assessment_requests').insert(paper({ id: 'r3', created_at: '2026-11-01T10:00:00Z' }));
    await mockDb.from('users').update({ last_message_at: '2026-11-03T08:00:00Z' }).eq('id', USER.id);
    expect(await Nudge.send(retry, { now: TUE_1430 })).toEqual(expect.objectContaining({ sent: true }));
  });
});

describe('store.skipPendingForTopic (the card tap)', () => {
  test('skips her pending rows for that topic as card_used; sent rows and other topics stay', async () => {
    const retry = await heldRetry();
    await store.schedule({ userId: USER.id, kind: Nudge.KIND, nudgeDate: '2026-11-04', scheduledAt: '2026-11-04T09:30:00Z', context: { topic_id: 'other' } });
    await defaultPending();
    expect(await store.skipPendingForTopic({ userId: USER.id, kind: Nudge.KIND, topicId: 'b', reason: 'card_used' })).toBe(1);
    const rows = await nudges();
    expect(rows.find((r) => r.id === retry.id)).toEqual(expect.objectContaining({ status: 'skipped', context: expect.objectContaining({ skip_reason: 'card_used' }) }));
    expect(rows.find((r) => r.nudge_date === '2026-11-04').status).toBe('pending');
  });

  test('an unknown reason throws before touching a row', async () => {
    await heldRetry();
    await expect(store.skipPendingForTopic({ userId: USER.id, kind: Nudge.KIND, topicId: 'b', reason: 'nope' })).rejects.toThrow(/SKIP_REASONS/);
  });

  test('the new reasons are registered', () => {
    expect(store.SKIP_REASONS).toEqual(expect.arrayContaining(['made_paper', 'card_used']));
  });
});
