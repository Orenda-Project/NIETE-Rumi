'use strict';
/**
 * The lesson-plan survey answered inside the teacher app (the bar at the end of the plan viewer).
 *
 * One row per teacher per plan in lp_feedback, written with trigger_mode 'in_app':
 *   - the first tap (Useful / Not useful) inserts it;
 *   - the In class choice and the one-line reason UPDATE that same row, never a second one;
 *   - any later first tap for the same plan answers `already_answered` with the row's state.
 * The band rule decides the column: grades 1-5 → lesson_plan_id (a lesson_plans row recorded with surface 'app'),
 * grades 6-12 → lp612_segment_id. A grades 1-5 lesson id that arrives as 'g612' (her own / shelf plans) is a 1-5 plan.
 *
 * Driven through the REAL service and the REAL lesson_plans writer; only the database and the cache are in memory.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase({});
const mockRedis = createMemoryRedis();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendInteractiveButtons: jest.fn(), sendDocumentByLink: jest.fn(), sendReaction: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const InApp = require('../../bot/shared/services/lp-in-app-feedback.service');

const lessonRow = (i) => ({
  lesson_id: `grade_1_english_ch1_seg${i}`, segment_index: i, lp_type: 'content',
  day_label: `Day ${i}`, section: 'Diving Deeper', section_short: 'Diving Deeper',
  topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
  row: { title: 'Diving Deeper', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
});
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 2 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 1, title: 'Hello World!', title_short: 'Hello World!', lessons: [lessonRow(3), lessonRow(4)] }],
  }],
};
const LESSON = 'grade_1_english_ch1_seg3';
const OTHER_LESSON = 'grade_1_english_ch1_seg4';
const SEGMENT = 'g7_science_ch2_s1';
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const OTHER = '7a2d3b8f-1c9e-4d66-8b62-3e8f1f4c0d21';

function seed(extra = {}) {
  mockDb.reset({
    users: [{ id: TEACHER, role: 'teacher' }, { id: OTHER, role: 'teacher' }],
    niete_lp_assets: [],
    lesson_plans: [],
    lp_feedback: [],
    niete_lp612_segments: [{
      segment_id: SEGMENT, grade: 7, subject: 'science', curriculum: 'fbise', chapter_number: 2,
      subtopic_title: 'Cells', menu_title: 'Cells',
    }],
    ...extra,
  });
}

// lesson_plans rows get a uuid, as the real table mints one.
const realFrom = mockDb.from.getMockImplementation();
let planSeq = 0;
mockDb.from.mockImplementation((table) => {
  const b = realFrom(table);
  if (table !== 'lesson_plans') return b;
  const insert = b.insert;
  b.insert = (p) => insert({ id: `00000000-0000-4000-8000-${String((planSeq += 1)).padStart(12, '0')}`, ...p });
  return b;
});

const feedback = () => mockDb.rows('lp_feedback');

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));
beforeEach(() => { jest.clearAllMocks(); mockRedis.reset(); seed(); });

describe('parse', () => {
  test('takes a uuid user, a known kind, a plan ref and at least one answer; refuses anything else', () => {
    expect(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: true })).toEqual({
      userId: TEACHER, kind: 'k5', ref: LESSON, lang: null, useful: true, usedInClass: null, reasonText: null,
    });
    expect(InApp.parse({ userId: TEACHER, kind: 'g612', ref: SEGMENT, lang: 'ur', usedInClass: 'not_yet' }))
      .toMatchObject({ kind: 'g612', lang: 'ur', useful: null, usedInClass: 'not_yet' });
    expect(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, reasonText: '  too long for my class  ' }).reasonText)
      .toBe('too long for my class');
    for (const bad of [
      {}, { userId: 'x', kind: 'k5', ref: LESSON, useful: true },
      { userId: TEACHER, kind: 'fln', ref: '1', useful: true },
      { userId: TEACHER, kind: 'k5', ref: '', useful: true },
      { userId: TEACHER, kind: 'k5', ref: LESSON },
      { userId: TEACHER, kind: 'k5', ref: LESSON, useful: 'yes' },
      { userId: TEACHER, kind: 'k5', ref: LESSON, usedInClass: 'maybe' },
      { userId: TEACHER, kind: 'k5', ref: LESSON, reasonText: 'x'.repeat(301) },
      { userId: TEACHER, kind: 'k5', ref: LESSON, reasonText: '   ' },
    ]) {
      expect(InApp.parse(bad)).toBeNull();
    }
  });
});

describe('grades 1-5', () => {
  test('a first Useful inserts ONE in_app row on a lesson_plans row recorded with surface app', async () => {
    const out = await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: true }));
    expect(out).toEqual({ outcome: 'saved', feedback: { useful: true, usedInClass: null } });
    expect(feedback()).toHaveLength(1);
    const [row] = feedback();
    const plan = mockDb.rows('lesson_plans').find((p) => p.id === row.lesson_plan_id);
    expect(plan.content.v8).toMatchObject({ lesson_id: LESSON, surface: 'app' });
    expect(row).toMatchObject({
      user_id: TEACHER, useful: true, trigger_mode: 'in_app', useful_component: 'lp_only',
      lp_variant: 'niete_v8_segment', grade: 1, subject: 'english', chapter_number: 1, segment_number: 3,
    });
    expect(row.lp612_segment_id).toBeUndefined();
  });

  test('In class updates the SAME row; a second Useful for the plan is already_answered', async () => {
    await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: true }));
    const out = await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, usedInClass: 'taught' }));
    expect(out).toEqual({ outcome: 'saved', feedback: { useful: true, usedInClass: 'taught' } });
    expect(feedback()).toHaveLength(1);
    expect(feedback()[0].used_in_class).toBe('taught');

    const again = await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: false }));
    expect(again).toEqual({ outcome: 'already_answered', feedback: { useful: true, usedInClass: 'taught' } });
    const change = await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, usedInClass: 'not_yet' }));
    expect(change.outcome).toBe('already_answered');
    expect(feedback()).toHaveLength(1);
    expect(feedback()[0]).toMatchObject({ useful: true, used_in_class: 'taught' });
    expect(mockDb.rows('lesson_plans')).toHaveLength(1);
  });

  test('Not useful, then the reason: one row, disliked, its language read from the words', async () => {
    await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: false }));
    const out = await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, reasonText: 'سرگرمی بہت لمبی تھی' }));
    expect(out.outcome).toBe('saved');
    expect(feedback()).toHaveLength(1);
    expect(feedback()[0]).toMatchObject({
      useful: false, reason_text: 'سرگرمی بہت لمبی تھی', reason_polarity: 'disliked', reason_language: 'ur',
    });
    expect(feedback()[0].reason_received_at).toEqual(expect.any(String));
    // A second reason and an In class on a Not useful row change nothing.
    expect((await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, reasonText: 'again' }))).outcome).toBe('already_answered');
    expect((await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, usedInClass: 'taught' }))).outcome).toBe('already_answered');
    expect(feedback()[0].reason_text).toBe('سرگرمی بہت لمبی تھی');
    expect(feedback()[0].used_in_class).toBeUndefined();
  });

  test('a WhatsApp answer for the same plan counts: the app answer is already_answered, no new row', async () => {
    seed({
      lesson_plans: [{ id: 'lp-wa-1', user_id: TEACHER, content: { v8: { lesson_id: LESSON } } }],
      lp_feedback: [{ id: 'fb-wa-1', user_id: TEACHER, lesson_plan_id: 'lp-wa-1', useful: true, trigger_mode: 'after_pdf_only', created_at: '2026-11-18T08:00:00Z' }],
    });
    expect(await InApp.state({ userId: TEACHER, kind: 'k5', ref: LESSON })).toEqual({ useful: true, usedInClass: null });
    expect((await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: true }))).outcome).toBe('already_answered');
    // ...and her In class answer goes on that WhatsApp row.
    expect((await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, usedInClass: 'planned' }))).outcome).toBe('saved');
    expect(feedback()).toHaveLength(1);
    expect(feedback()[0]).toMatchObject({ id: 'fb-wa-1', used_in_class: 'planned' });
  });

  // Sceptic pass: app first, then the delayed WhatsApp prompt of the WhatsApp copy of the same plan → still ONE answer.
  test('an app answer counts for a later WhatsApp tap on the same plan: no second row', async () => {
    const WA_PLAN = '00000000-0000-4000-8000-0000000000aa';
    mockDb.rows('lesson_plans').push({ id: WA_PLAN, user_id: TEACHER, topic: 'Topic 3', content: { v8: { lesson_id: LESSON, surface: 'whatsapp' } } });
    await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: true }));
    const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
    await LpFeedback.handleFeedbackButton(`lp_feedback_no_${WA_PLAN}`, '923000000000');
    expect(feedback()).toHaveLength(1);
    expect(feedback()[0]).toMatchObject({ trigger_mode: 'in_app', useful: true });
  });

  test('answers are per teacher and per plan: another teacher or another plan starts fresh', async () => {
    await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: true }));
    expect(await InApp.state({ userId: OTHER, kind: 'k5', ref: LESSON })).toBeNull();
    expect(await InApp.state({ userId: TEACHER, kind: 'k5', ref: OTHER_LESSON })).toBeNull();
    expect((await InApp.save(InApp.parse({ userId: OTHER, kind: 'k5', ref: LESSON, usedInClass: 'taught' }))).outcome).toBe('no_answer');
    expect(feedback()).toHaveLength(1);
    expect(feedback()[0].used_in_class).toBeUndefined();
  });

  test('an unknown lesson is unknown_plan and writes nothing', async () => {
    const out = await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: 'grade_9_nothing', useful: true }));
    expect(out).toEqual({ outcome: 'unknown_plan' });
    expect(feedback()).toHaveLength(0);
    expect(mockDb.rows('lesson_plans')).toHaveLength(0);
  });
});

describe('grades 6-12 and the band rule', () => {
  test('a 6-12 plan writes lp612_segment_id, never lesson_plan_id', async () => {
    const out = await InApp.save(InApp.parse({ userId: TEACHER, kind: 'g612', ref: SEGMENT, lang: 'en', useful: true }));
    expect(out.outcome).toBe('saved');
    const [row] = feedback();
    expect(row).toMatchObject({
      user_id: TEACHER, lp612_segment_id: SEGMENT, useful: true, trigger_mode: 'in_app', useful_component: 'lp_only',
      lp_variant: 'lp612_en', grade: 7, subject: 'science', chapter_number: 2, topic: 'Cells',
    });
    expect(row.lesson_plan_id).toBeUndefined();
    expect(mockDb.rows('lesson_plans')).toHaveLength(0);
    expect(await InApp.state({ userId: TEACHER, kind: 'g612', ref: SEGMENT })).toEqual({ useful: true, usedInClass: null });
  });

  test('a grades 1-5 lesson id sent as g612 is a 1-5 plan (lesson_plan_id)', async () => {
    await InApp.save(InApp.parse({ userId: TEACHER, kind: 'g612', ref: LESSON, useful: true }));
    const [row] = feedback();
    expect(row.lesson_plan_id).toEqual(expect.any(String));
    expect(row.lp612_segment_id).toBeUndefined();
    expect(await InApp.state({ userId: TEACHER, kind: 'k5', ref: LESSON })).toEqual({ useful: true, usedInClass: null });
  });

  test('an unknown segment is unknown_plan', async () => {
    expect(await InApp.save(InApp.parse({ userId: TEACHER, kind: 'g612', ref: 'nope', useful: true }))).toEqual({ outcome: 'unknown_plan' });
    expect(feedback()).toHaveLength(0);
  });
});

describe('logs', () => {
  test('ids only: never the reason text', async () => {
    await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, useful: false }));
    await InApp.save(InApp.parse({ userId: TEACHER, kind: 'k5', ref: LESSON, reasonText: 'private words here' }));
    const calls = logEvent.mock.calls.filter((c) => c[0] === 'lp.in_app_feedback');
    expect(calls.length).toBe(2);
    expect(JSON.stringify(calls)).not.toContain('private words here');
    expect(calls[0][1]).toMatchObject({ outcome: 'saved', userId: TEACHER, kind: 'k5', ref: LESSON, useful: false });
  });

  test('a failed read throws (the route answers 500), never "no answer yet"', async () => {
    const realFrom2 = mockDb.from.getMockImplementation();
    mockDb.from.mockImplementationOnce(() => {
      const b = realFrom2('lp_feedback');
      b.then = (res) => Promise.resolve({ data: null, error: { message: 'down' } }).then(res);
      return b;
    });
    await expect(InApp.state({ userId: TEACHER, kind: 'g612', ref: SEGMENT })).rejects.toThrow('down');
  });
});
