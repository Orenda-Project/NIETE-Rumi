'use strict';
/**
 * The 15:00 offer only offers a lesson a quiz can be made from.
 *
 * A K-5 lesson-plan quiz is written from the slide script of the EXACT version
 * the teacher was served (lesson_id, version_stamp, content_hash). /quiz lists a
 * lesson only when that version has a script (lp-v8-lesson-provider
 * resolvableVersions); the 15:00 cohort must use the same check, or it offers a
 * lesson whose quiz then fails with "could not open the lesson plan".
 *
 * The supabase stub really filters; the lesson provider is the REAL module, so
 * the rule under test is the one /quiz runs.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('m-1'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);

function download(over = {}) {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    user_id: T1,
    lesson_id: 'g4_maths_c02_seg001',
    asset_id: 'asset-lesson-1',
    version_stamp: 'v8.2026-08-20',
    content_hash: 'hash-aug',
    grade: 4,
    subject: 'maths',
    chapter_number: 2,
    segment_index: 1,
    status: 'sent',
    created_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    ...over,
  };
}

function teacher(id) {
  return {
    id,
    role: 'teacher',
    is_test_user: false,
    deleted_at: null,
    school_id: 'school-1',
    region: 'Sihala',
    phone_number: id === T1 ? '923001112222' : '923003334444',
    preferred_language: 'en',
    last_message_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
  };
}

function install(over = {}) {
  const db = makeSupabase({
    niete_lp_downloads: [
      download(),
      // T2 was served the newer push of a lesson; only the August version has a script.
      download({
        user_id: T2, lesson_id: 'g3_english_c04_seg002', asset_id: 'asset-lesson-2',
        version_stamp: 'ch37_2Oct', content_hash: 'hash-oct', grade: 3, subject: 'english',
      }),
    ],
    niete_lp_assets: [
      { id: 'asset-lesson-1', asset_kind: 'lesson' },
      { id: 'asset-lesson-2', asset_kind: 'lesson' },
    ],
    niete_lp_asset_sources: [
      { lesson_id: 'g4_maths_c02_seg001', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug' },
      { lesson_id: 'g3_english_c04_seg002', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug-2' },
    ],
    users: [teacher(T1), teacher(T2)],
    schools: [{ id: 'school-1', region: 'Sihala' }],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
    ...over,
  });
  supabase.from.mockImplementation(db.from);
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
});

describe('15:00 cohort: the same quiz-source check as /quiz', () => {
  test('a lesson whose served version has no slide script is skipped as no_quiz_source; one that has a script is offered', async () => {
    install();
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });

    expect(res.inserted).toBe(1);
    expect(res.skipped).toEqual({ no_quiz_source: 1 });

    const t1 = mockStore.rows.find((r) => r.user_id === T1);
    const t2 = mockStore.rows.find((r) => r.user_id === T2);
    expect(t1.status).toBe('pending');
    expect(t1.context.classes[0].lessons.map((l) => l.lesson_id)).toEqual(['g4_maths_c02_seg001']);
    expect(t2.status).toBe('skipped');
    expect(t2.context.skip_reason).toBe('no_quiz_source');

    expect(logEvent).toHaveBeenCalledWith('lp_quiz.cohort_built', expect.objectContaining({
      inserted: 1, skipped: { no_quiz_source: 1 },
    }));
  });

  test('a class keeps only its lessons that have a script; the teacher is still offered', async () => {
    install({
      niete_lp_downloads: [
        download(),
        download({ lesson_id: 'g4_maths_c02_seg002', version_stamp: 'ch37_2Oct', content_hash: 'hash-oct' }),
      ],
      users: [teacher(T1)],
    });
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(1);
    expect(mockStore.rows[0].context.classes[0].lessons.map((l) => l.lesson_id))
      .toEqual(['g4_maths_c02_seg001']);
  });

  test('a teacher with no lesson at all is still no_lesson, not no_quiz_source', async () => {
    install({
      niete_lp_downloads: [download({ lesson_id: 'g4_maths_c02_seg995' })],
      users: [teacher(T1)],
    });
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.skipped).toEqual({ no_lesson: 1 });
  });
});
