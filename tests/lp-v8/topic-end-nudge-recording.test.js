'use strict';
/**
 * bd-pw1ccr.11 — the topic-end nudge's second trigger: she records herself teaching.
 *
 * A group B teacher's own recording (not a leader observation) finishes analysis. The lesson it was taught from is
 * the plan linked to the session (lesson_plan_structured._fidelity_ref.lesson_id); with none linked, her latest
 * K-5 plan taken in the 24 hours before the recording (WhatsApp download or app open). If that lesson is the last
 * day of a topic, or the day before it, the same nudge is booked, with trigger 'recording' in its context.
 * One nudge a teacher a topic still holds across both triggers.
 *
 * Driven through the REAL recording hook, the REAL nudge service and the REAL teacher_nudges store over an
 * in-memory Supabase; only the catalogue, the topics read and the app check are faked.
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');

const SCHOOL_B = 'b0000000-0000-4000-8000-00000000000b';
const USER = {
  id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '923001234567', preferred_language: 'en',
  role: 'teacher', school_id: SCHOOL_B, last_message_at: '2026-11-02T03:00:00Z',
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

const { listChapterTopics } = require('../../bot/shared/services/assessment/topics/topics.repo');
const { lessonById } = require('../../bot/shared/services/lp-v8-catalog.service');
const Nudge = require('../../bot/shared/services/nudges/topic-end-nudge.service');
const Recording = require('../../bot/shared/services/nudges/topic-end-recording');
const Arm = require('../../bot/shared/services/nudges/topic-end-arm');

const seg = (i) => ({ lesson_id: `grade_1_english_ch4_seg${i}`, segment_index: i });
const CHAPTER = { number: 4, lessons: [1, 2, 3, 4, 5, 6, 7, 8].map(seg).concat(seg(995)) };
const BOOK = { grade: 1, subject_key: 'english' };
const TOPICS = [
  { topicId: 'a', name: 'Poem', days: [27, 28] },
  { topicId: 'b', name: 'Plurals', days: [29, 30, 31] },
  { topicId: 'c', name: 'ABC Order', days: [32, 33, 34] },
];
const LAST_OF_B = 'grade_1_english_ch4_seg5';
const EARLY_IN_B = 'grade_1_english_ch4_seg3';
const MON_11AM = '2026-11-02T06:00:00Z'; // Mon 2 Nov, 11:00 PKT — recorded after teaching

const session = (over = {}) => ({
  id: 'cs-1', user_id: USER.id, observation_type: null, created_at: MON_11AM, lesson_plan_structured: null, ...over,
});
const linked = (lessonId) => ({ _fidelity_ref: { lesson_id: lessonId } });

function seed({ on = true, group = 'B', downloads = [], opens = [] } = {}) {
  mockDb = createMemorySupabase({
    app_settings: [{ key: 'topic_end_nudge_enabled', value: on }],
    users: [USER],
    niete_topic_nudge_ab_assignment: group ? [{ school_id: SCHOOL_B, ab_group: group }] : [],
    teacher_nudges: [],
    niete_lp_downloads: downloads,
    niete_lp_opens: opens,
  }, { unique: { teacher_nudges: ['user_id', 'nudge_date', 'kind'] } });
}
const nudges = async () => (await mockDb.from('teacher_nudges').select('*')).data;
const dl = (lessonId, at, status = 'sent') => ({ user_id: USER.id, lesson_id: lessonId, status, created_at: at });
const op = (lessonId, at, kind = 'k5') => ({ user_id: USER.id, plan_ref: lessonId, plan_kind: kind, opened_at: at });

beforeEach(() => {
  jest.clearAllMocks();
  Arm._resetCache();
  seed();
  lessonById.mockImplementation((id) => {
    const lesson = CHAPTER.lessons.find((l) => l.lesson_id === id);
    return lesson ? { lesson, chapter: CHAPTER, book: BOOK } : null;
  });
  listChapterTopics.mockResolvedValue(TOPICS);
});

describe('which lesson the recording was taught from', () => {
  test('the plan linked to the session: books the nudge, trigger recording, from the recording time', async () => {
    const out = await Recording.onRecording({ session: session({ lesson_plan_structured: linked(LAST_OF_B) }) });
    expect(out).toEqual(expect.objectContaining({ scheduled: true }));
    const [row] = await nudges();
    expect(row).toEqual(expect.objectContaining({ kind: 'topic_end_nudge', nudge_date: '2026-11-02', scheduled_at: '2026-11-02T09:30:00.000Z' }));
    expect(row.context).toEqual(expect.objectContaining({
      topic_id: 'b', lesson_id: LAST_OF_B, trigger: 'recording', taken_at: new Date(MON_11AM).toISOString(),
    }));
  });

  test('no plan linked: her latest K-5 plan from the 24 hours before the recording', async () => {
    seed({
      downloads: [
        dl(EARLY_IN_B, '2026-11-01T06:00:00Z'), // over 24h before: ignored
        dl(LAST_OF_B, '2026-11-02T03:00:00Z'), // the one she taught from
        dl(EARLY_IN_B, '2026-11-02T03:30:00Z', 'failed'), // never reached her
        dl(EARLY_IN_B, '2026-11-02T07:00:00Z'), // after the recording: ignored
      ],
    });
    expect(await Recording.onRecording({ session: session() })).toEqual(expect.objectContaining({ scheduled: true }));
    expect((await nudges())[0].context).toEqual(expect.objectContaining({ lesson_id: LAST_OF_B, trigger: 'recording' }));
  });

  test('an app open later than the last download wins; a 6-12 open is not a K-5 plan', async () => {
    seed({
      downloads: [dl(EARLY_IN_B, '2026-11-02T02:00:00Z')],
      opens: [op(LAST_OF_B, '2026-11-02T04:00:00Z'), op(EARLY_IN_B, '2026-11-02T05:00:00Z', 'g612')],
    });
    await Recording.onRecording({ session: session() });
    expect((await nudges())[0].context.lesson_id).toBe(LAST_OF_B);
  });

  test('no plan at all: nothing booked', async () => {
    expect(await Recording.onRecording({ session: session() })).toEqual({ scheduled: false, reason: 'no_plan' });
    expect(await nudges()).toEqual([]);
  });

  test('a lesson early in the topic: nothing booked', async () => {
    const out = await Recording.onRecording({ session: session({ lesson_plan_structured: linked(EARLY_IN_B) }) });
    expect(out).toEqual({ scheduled: false, reason: 'topic_continues' });
  });
});

describe('who it is for', () => {
  test('a leader observation is not her recording: nothing, and no plan read', async () => {
    const out = await Recording.onRecording({ session: session({ observation_type: 'leader_observation', lesson_plan_structured: linked(LAST_OF_B) }) });
    expect(out).toEqual({ scheduled: false, reason: 'not_self_recording' });
    expect(lessonById).not.toHaveBeenCalled();
  });

  test('switch off, or a control (group A) school: nothing', async () => {
    seed({ on: false });
    expect(await Recording.onRecording({ session: session({ lesson_plan_structured: linked(LAST_OF_B) }) }))
      .toEqual({ scheduled: false, reason: 'disabled' });
    Arm._resetCache();
    seed({ group: 'A' });
    expect(await Recording.onRecording({ session: session({ lesson_plan_structured: linked(LAST_OF_B) }) }))
      .toEqual({ scheduled: false, reason: 'not_in_group_b' });
    expect(await nudges()).toEqual([]);
  });

  test('no session, or a plan read that fails: nothing, and never throws', async () => {
    expect(await Recording.onRecording({})).toEqual({ scheduled: false, reason: 'not_self_recording' });
    const from = mockDb.from.bind(mockDb);
    mockDb.from = (t) => { if (t === 'niete_lp_downloads') throw new Error('db down'); return from(t); };
    expect(await Recording.onRecording({ session: session() })).toEqual({ scheduled: false, reason: 'guard_unavailable' });
  });
});

describe('one nudge a teacher a topic, across both triggers', () => {
  test('the plan pull booked today already: the recording is not a second message', async () => {
    await Nudge.onLessonDelivered({ userId: USER.id, lessonId: LAST_OF_B, deliveredAt: '2026-11-02T03:00:00Z' });
    const out = await Recording.onRecording({ session: session({ lesson_plan_structured: linked(LAST_OF_B) }) });
    expect(out).toEqual(expect.objectContaining({ scheduled: false, reason: 'already_nudged_today' }));
    expect(await nudges()).toHaveLength(1);
  });

  test('nudged on the plan pull yesterday: the recording row today is skipped at send', async () => {
    await Nudge.onLessonDelivered({ userId: USER.id, lessonId: 'grade_1_english_ch4_seg4', deliveredAt: '2026-11-02T03:00:00Z' });
    const [first] = await nudges();
    await mockDb.from('teacher_nudges').update({ status: 'sent' }).eq('id', first.id);
    await Recording.onRecording({ session: session({ created_at: '2026-11-03T06:00:00Z', lesson_plan_structured: linked(LAST_OF_B) }) });
    const again = (await nudges()).find((r) => r.nudge_date === '2026-11-03');
    expect(again.context.trigger).toBe('recording');
    expect(await Nudge.send(again, { now: new Date('2026-11-03T09:30:00Z') }))
      .toEqual(expect.objectContaining({ skipped: 'already_nudged_topic' }));
  });
});
