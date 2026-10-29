'use strict';
/**
 * bd-pw1ccr.4.2 — the topic-end nudge. A group B teacher takes the plan for the last day of a topic; at 14:30 PKT
 * (after she has taught it) the bot offers one button that opens the paper generator on Topics for that chapter.
 *
 * Driven through the REAL service and the REAL teacher_nudges store over an in-memory Supabase (the table's
 * UNIQUE (user_id, nudge_date, kind) enforced); only the catalogue, the topics read, the link signer and
 * WhatsApp are faked.
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');

const SCHOOL_B = 'b0000000-0000-4000-8000-00000000000b';
const SCHOOL_A = 'a0000000-0000-4000-8000-00000000000a';
const USER = {
  id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'en',
  role: 'teacher', school_id: SCHOOL_B, last_message_at: '2026-11-02T03:00:00Z',
};

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => new Proxy({}, { get: (_, k) => mockDb[k] }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendCtaUrl: jest.fn() }));
jest.mock('../../bot/shared/services/app-login-link', () => ({ signAppLink: jest.fn(() => 'TOK') }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.test/' }));
jest.mock('../../bot/shared/services/app-redirect.service', () => ({ isOnTeacherApp: jest.fn(async () => true) }));
jest.mock('../../bot/shared/services/assessment/topics/topics.repo', () => ({ listChapterTopics: jest.fn() }));
jest.mock('../../bot/shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { signAppLink } = require('../../bot/shared/services/app-login-link');
const { isOnTeacherApp } = require('../../bot/shared/services/app-redirect.service');
const { listChapterTopics } = require('../../bot/shared/services/assessment/topics/topics.repo');
const { lessonById } = require('../../bot/shared/services/lp-v8-catalog.service');
const Nudge = require('../../bot/shared/services/nudges/topic-end-nudge.service');
const Arm = require('../../bot/shared/services/nudges/topic-end-arm');

const seg = (i) => ({ lesson_id: `grade_1_english_ch4_seg${i}`, segment_index: i });
const CHAPTER = { number: 4, lessons: [1, 2, 3, 4, 5, 6, 7, 8].map(seg).concat(seg(995)) };
const BOOK = { grade: 1, subject_key: 'english' };
const TOPICS = [
  { topicId: 'a', name: 'Poem', days: [27, 28] },
  { topicId: 'b', name: 'Plurals', days: [29, 30, 31] },
  { topicId: 'c', name: 'ABC Order', days: [32, 33, 34] },
];
const LAST_DAY_OF_B = 'grade_1_english_ch4_seg5';
const MON_9AM = '2026-11-02T04:00:00Z'; // Mon 2 Nov, 09:00 PKT
const MON_1430 = new Date('2026-11-02T09:30:00Z');

function seed({ on = true, group = 'B', user = USER } = {}) {
  mockDb = createMemorySupabase({
    app_settings: [{ key: 'topic_end_nudge_enabled', value: on }],
    users: [user],
    niete_topic_nudge_ab_assignment: group ? [{ school_id: SCHOOL_B, ab_group: group }] : [],
    teacher_nudges: [],
    niete_lp_opens: [],
  }, { unique: { teacher_nudges: ['user_id', 'nudge_date', 'kind'] } });
}
const nudges = async () => (await mockDb.from('teacher_nudges').select('*')).data;

beforeEach(() => {
  jest.clearAllMocks();
  Arm._resetCache();
  seed();
  lessonById.mockImplementation((id) => {
    const lesson = CHAPTER.lessons.find((l) => l.lesson_id === id);
    return lesson ? { lesson, chapter: CHAPTER, book: BOOK } : null;
  });
  listChapterTopics.mockResolvedValue(TOPICS);
  WhatsAppService.sendCtaUrl.mockResolvedValue(true);
});

describe('booking (onLessonDelivered)', () => {
  const take = (lessonId = LAST_DAY_OF_B, at = MON_9AM) => Nudge.onLessonDelivered({ userId: USER.id, lessonId, deliveredAt: at });

  test('the last day of a topic books a nudge for 14:30 that day, carrying the topic', async () => {
    expect(await take()).toEqual(expect.objectContaining({ scheduled: true }));
    const [row] = await nudges();
    expect(row).toEqual(expect.objectContaining({ kind: 'topic_end_nudge', nudge_date: '2026-11-02', scheduled_at: MON_1430.toISOString() }));
    expect(row.context).toEqual(expect.objectContaining({ topic_id: 'b', topic_name: 'Plurals', grade: 1, subject: 'english', chapter: 4, lesson_id: LAST_DAY_OF_B }));
    expect(listChapterTopics).toHaveBeenCalledWith(1, 'english', 4);
  });

  test('a day inside a topic books nothing', async () => {
    expect(await take('grade_1_english_ch4_seg4')).toEqual({ scheduled: false, reason: 'topic_continues' });
    expect(await nudges()).toEqual([]);
  });

  test('switch off: nothing, and the topics are not read', async () => {
    seed({ on: false });
    expect(await take()).toEqual({ scheduled: false, reason: 'disabled' });
    expect(listChapterTopics).not.toHaveBeenCalled();
  });

  test('group A school, or a school outside the draw: nothing', async () => {
    seed({ group: 'A' });
    expect(await take()).toEqual({ scheduled: false, reason: 'not_in_group_b' });
    Arm._resetCache();
    seed({ group: null });
    expect(await take()).toEqual({ scheduled: false, reason: 'not_in_group_b' });
    expect(await nudges()).toEqual([]);
  });

  test('an answer key, an unknown plan, a subject without topics: nothing', async () => {
    expect(await Nudge.onLessonDelivered({ userId: USER.id, lessonId: LAST_DAY_OF_B, assetKind: 'answer_key' }))
      .toEqual({ scheduled: false, reason: 'not_a_lesson' });
    expect(await take('nope')).toEqual({ scheduled: false, reason: 'unknown_plan' });
    lessonById.mockReturnValue({ lesson: seg(5), chapter: CHAPTER, book: { grade: 1, subject_key: 'islamiat' } });
    expect(await take()).toEqual({ scheduled: false, reason: 'no_topics' });
  });

  test('a topics read that fails books nothing and does not throw', async () => {
    listChapterTopics.mockRejectedValue(new Error('db down'));
    expect(await take()).toEqual({ scheduled: false, reason: 'guard_unavailable' });
  });

  test('a second topic ending the same day is not a second message', async () => {
    await take();
    expect(await take('grade_1_english_ch4_seg8')).toEqual(expect.objectContaining({ scheduled: false, reason: 'already_nudged_today' }));
    expect(await nudges()).toHaveLength(1);
  });
});

describe('a plan read in the app (onAppOpen)', () => {
  const open = (over = {}) => ({ id: '11111111-1111-4111-8111-000000000001', user_id: USER.id, plan_kind: 'k5', plan_ref: LAST_DAY_OF_B, opened_at: MON_9AM, ...over });

  test('books the same nudge from the open time', async () => {
    mockDb = createMemorySupabase({ ...seedTables(), niete_lp_opens: [open()] }, { unique: { teacher_nudges: ['user_id', 'nudge_date', 'kind'] } });
    expect(await Nudge.onAppOpen({ openId: open().id, now: new Date(MON_9AM) })).toEqual(expect.objectContaining({ scheduled: true }));
  });

  test('a 6-12 plan or a stale open books nothing', async () => {
    mockDb = createMemorySupabase({ ...seedTables(), niete_lp_opens: [open({ plan_kind: 'g612' })] });
    expect(await Nudge.onAppOpen({ openId: open().id, now: new Date(MON_9AM) })).toEqual({ scheduled: false, reason: 'not_k5' });
    mockDb = createMemorySupabase({ ...seedTables(), niete_lp_opens: [open()] });
    expect(await Nudge.onAppOpen({ openId: open().id, now: new Date('2026-11-02T12:00:00Z') })).toEqual({ scheduled: false, reason: 'stale_open' });
  });

  function seedTables() {
    return {
      app_settings: [{ key: 'topic_end_nudge_enabled', value: true }],
      users: [USER],
      niete_topic_nudge_ab_assignment: [{ school_id: SCHOOL_B, ab_group: 'B' }],
      teacher_nudges: [],
    };
  }
});

describe('send', () => {
  async function booked(at = MON_9AM) {
    await Nudge.onLessonDelivered({ userId: USER.id, lessonId: LAST_DAY_OF_B, deliveredAt: at });
    const all = await nudges();
    return all[all.length - 1];
  }

  test('inside the window: one button to the paper generator, signed in, on Topics for the chapter', async () => {
    const row = await booked();
    const out = await Nudge.send(row, { now: MON_1430 });
    expect(out).toEqual(expect.objectContaining({ sent: true }));
    expect(signAppLink).toHaveBeenCalledWith(USER.id, 'assessment_topic_nudge', null, { grade: 1, subject: 'english', chapter: 4 });
    const [to, msg] = WhatsAppService.sendCtaUrl.mock.calls[0];
    expect(to).toBe(USER.phone_number);
    expect(msg.url).toBe('https://portal.test/go/TOK');
    expect(msg.body).toContain('Plurals');
    expect(msg.buttonText).toBe('Make my paper');
  });

  test('Urdu teacher gets the Urdu button', async () => {
    seed({ user: { ...USER, preferred_language: 'ur' } });
    const row = await booked();
    await Nudge.send(row, { now: MON_1430 });
    expect(WhatsAppService.sendCtaUrl.mock.calls[0][1].buttonText).toBe('پرچہ بنائیں');
  });

  test('window shut on Monday: skipped, and booked again for Tuesday 14:30', async () => {
    seed({ user: { ...USER, last_message_at: '2026-10-30T03:00:00Z' } });
    const row = await booked();
    expect(await Nudge.send(row, { now: MON_1430 })).toEqual(expect.objectContaining({ skipped: 'window_closed', context: expect.objectContaining({ retry_date: '2026-11-03' }) }));
    expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
    const retry = (await nudges()).find((r) => r.nudge_date === '2026-11-03');
    expect(retry).toEqual(expect.objectContaining({ kind: 'topic_end_nudge', scheduled_at: '2026-11-03T09:30:00.000Z' }));
    expect(retry.context).toEqual(expect.objectContaining({ topic_id: 'b', retry_of: row.id }));
  });

  test('window shut on Friday: skipped, no retry', async () => {
    seed({ user: { ...USER, last_message_at: '2026-11-01T03:00:00Z' } });
    const row = await booked('2026-11-06T04:00:00Z');
    expect(await Nudge.send(row, { now: new Date('2026-11-06T09:30:00Z') })).toEqual(expect.objectContaining({ skipped: 'window_closed' }));
    expect((await nudges()).filter((r) => r.nudge_date > '2026-11-06')).toEqual([]);
  });

  test('a topic she was already nudged about is not sent twice', async () => {
    const first = await booked();
    await Nudge.send(first, { now: MON_1430 });
    await mockDb.from('teacher_nudges').update({ status: 'sent' }).eq('id', first.id);
    const again = await booked('2026-11-03T04:00:00Z');
    expect(await Nudge.send(again, { now: new Date('2026-11-03T09:30:00Z') })).toEqual(expect.objectContaining({ skipped: 'already_nudged_topic' }));
    expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
  });

  test('switched off since booking, or no longer on the teacher app: skipped', async () => {
    const row = await booked();
    await mockDb.from('app_settings').update({ value: false }).eq('key', 'topic_end_nudge_enabled');
    Arm._resetCache();
    expect(await Nudge.send(row, { now: MON_1430 })).toEqual(expect.objectContaining({ skipped: 'disabled' }));
    await mockDb.from('app_settings').update({ value: true }).eq('key', 'topic_end_nudge_enabled');
    Arm._resetCache();
    isOnTeacherApp.mockResolvedValueOnce(false);
    expect(await Nudge.send(row, { now: MON_1430 })).toEqual(expect.objectContaining({ skipped: 'not_on_app' }));
  });

  test('a send Meta refuses throws, so the sweeper marks the row failed', async () => {
    WhatsAppService.sendCtaUrl.mockResolvedValue(false);
    await expect(Nudge.send(await booked(), { now: MON_1430 })).rejects.toThrow(/not delivered/);
  });
});

test('the kind is registered with the sweeper and the store knows its skip reasons', () => {
  const store = require('../../bot/shared/services/nudges/teacher-nudges.store');
  expect(store.KINDS.TOPIC_END_NUDGE).toBe('topic_end_nudge');
  expect(store.SKIP_REASONS).toEqual(expect.arrayContaining(['already_nudged_topic', 'not_on_app']));
  expect(Nudge.KIND).toBe('topic_end_nudge');
});
