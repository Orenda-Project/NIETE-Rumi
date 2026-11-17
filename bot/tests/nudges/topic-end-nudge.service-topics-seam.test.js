'use strict';
/**
 * The topic-end nudge (topic-end-nudge.service.js) against the REAL topics.repo: the chapter's topics come from
 * assessment_topics through listChapterTopics, so the curriculum filter, is_current and sort_order decide which topic a
 * lesson ends. Real: the nudge service, its arm, the teacher_nudges store, topics.repo and its row mapper. Faked: the
 * database (an in-memory Supabase), the catalogue lookup and the loggers.
 */
const { createMemorySupabase } = require('../../../tests/fixtures/memory-supabase');

let mockDb;
jest.mock('../../shared/config/supabase', () => new Proxy({}, { get: (_, k) => mockDb[k] }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn() }));

const { lessonById } = require('../../shared/services/lp-v8-catalog.service');
const Topics = require('../../shared/services/assessment/topics/topics.repo');
const Nudge = require('../../shared/services/nudges/topic-end-nudge.service');
const Arm = require('../../shared/services/nudges/topic-end-arm');

const SCHOOL = 'b0000000-0000-4000-8000-00000000000b';
const USER = { id: '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10', phone_number: '920000000000', role: 'teacher', school_id: SCHOOL };
const seg = (i) => ({ lesson_id: `grade_1_english_ch4_seg${i}`, segment_index: i });
const CHAPTER = { number: 4, lessons: [1, 2, 3, 4, 5, 6].map(seg) };
const topic = (id, name, sort, days, extra = {}) => ({
  topic_id: id, grade: 1, subject: 'english', chapter_number: 4, chapter_title: 'Ch 4', name, heading: null, heading_order: null,
  sort_order: sort, pages: [], slo_codes: [], slo_descriptions: [], days, is_current: true, curriculum: 'ict', ...extra,
});

function seed(book, topics) {
  mockDb = createMemorySupabase({
    app_settings: [{ key: 'topic_end_nudge_enabled', value: true }],
    users: [USER],
    niete_topic_nudge_ab_assignment: [{ school_id: SCHOOL, ab_group: 'B' }],
    teacher_nudges: [],
    niete_lp_opens: [],
    assessment_topics: topics,
  }, { unique: { teacher_nudges: ['user_id', 'nudge_date', 'kind'] } });
  lessonById.mockImplementation((id) => {
    const lesson = CHAPTER.lessons.find((l) => l.lesson_id === id);
    return lesson ? { lesson, chapter: CHAPTER, book } : null;
  });
}
const take = (n) => Nudge.onLessonDelivered({ userId: USER.id, lessonId: `grade_1_english_ch4_seg${n}`, deliveredAt: '2026-11-02T04:00:00Z' });
const booked = async () => (await mockDb.from('teacher_nudges').select('*')).data;

beforeEach(() => { jest.clearAllMocks(); Arm._resetCache(); });

test('the repo reads this chapter\'s current ICT topics in sort order, mapped to camelCase', async () => {
  seed({ grade: 1, subject_key: 'english' }, [
    topic('b', 'Plurals', 2, [4, 5, 6]), topic('a', 'Poem', 1, [1, 2, 3]),
    topic('old', 'Old Plurals', 3, [4, 5, 6], { is_current: false }), topic('nbf', 'NBF topic', 1, [1, 2, 3], { curriculum: 'nbf_snc' }),
  ]);
  expect((await Topics.listChapterTopics(1, 'english', 4)).map((t) => [t.topicId, t.sortOrder])).toEqual([['a', 1], ['b', 2]]);
});

test('the last day of a topic, as the real repo reads it, books the nudge carrying that topic', async () => {
  seed({ grade: 1, subject_key: 'english' }, [topic('a', 'Poem', 1, [1, 2, 3]), topic('b', 'Plurals', 2, [4, 5, 6])]);
  expect(await take(3)).toEqual(expect.objectContaining({ scheduled: true }));
  expect((await booked()).map((r) => [r.context.topic_id, r.context.topic_name])).toEqual([['a', 'Poem']]);
});

test('a topic\'s first day books nothing', async () => {
  seed({ grade: 1, subject_key: 'english' }, [topic('a', 'Poem', 1, [1, 2, 3]), topic('b', 'Plurals', 2, [4, 5, 6])]);
  expect(await take(1)).toEqual(expect.objectContaining({ scheduled: false }));
  expect(await booked()).toEqual([]);
});

test('an NBF book reads NBF\'s topics through the repo, never ICT\'s for the same chapter', async () => {
  seed({ grade: 1, subject_key: 'english', curriculum: 'nbf_snc' }, [
    topic('ict', 'ICT topic', 1, [1, 2, 3]), topic('ict2', 'ICT two', 2, [4, 5, 6]),
    topic('nbf', 'NBF topic', 1, [1, 2, 3], { curriculum: 'nbf_snc' }), topic('nbf2', 'NBF two', 2, [4, 5, 6], { curriculum: 'nbf_snc' }),
  ]);
  expect(await take(3)).toEqual(expect.objectContaining({ scheduled: true }));
  expect((await booked()).map((r) => r.context.topic_id)).toEqual(['nbf']);
});

test('a database error on the topics read books nothing (never read as "no topics" and guessed)', async () => {
  seed({ grade: 1, subject_key: 'english' }, []);
  const from = mockDb.from;
  mockDb.from = (t) => (t === 'assessment_topics'
    ? { select: () => { const c = { eq: () => c, order: async () => ({ data: null, error: { message: 'boom' } }) }; return c; } }
    : from(t));
  await expect(Topics.listChapterTopics(1, 'english', 4)).rejects.toThrow('boom');
  expect(await take(3)).toEqual(expect.objectContaining({ scheduled: false, reason: 'guard_unavailable' }));
  expect(await booked()).toEqual([]);
});
