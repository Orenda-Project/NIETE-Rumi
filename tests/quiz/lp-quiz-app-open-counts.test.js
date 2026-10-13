'use strict';
/**
 * bd-qvevax.3 — a lesson plan opened in the teacher app counts as a lesson plan TAKEN, for every
 * lesson-plan quiz door.
 *
 * Since 12 Oct 2026 01:53 PKT every registered teacher who asks for a plan gets an "Open in app"
 * button; the app writes niete_lp_opens and NOT niete_lp_downloads. Both doors that offer a
 * lesson-plan quiz read niete_lp_downloads (status 'sent') as "she took this plan":
 *   - the 15:00 afternoon offer (lp-quiz-offer buildCohort), and
 *   - /quiz's lesson-plan rows (lp-v8-lesson-provider list/get/start; lp612.provider for 6-12),
 * so lp_v8 quizzes fell from 34-64 a day to 9 and 6 while plan use held.
 *
 * The rule under test: a viewer open is the same fact as a WhatsApp delivery. Everything else the
 * offer knows stays as it was (the 14:00 next-school-day rule, _seg995 out / _seg990 in, answer keys
 * never a source, no slide script -> no_quiz_source, one offer a day, covered lessons not re-offered).
 *
 * The supabase stub really filters; the source store, the catalogue and the providers are real.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-10-13';          // Tuesday
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const L1 = 'grade_4_math_ch1_seg1';
const L2 = 'grade_4_math_ch1_seg2';
const L_ASSESSMENT = 'grade_4_math_ch1_seg995';
const L_REVISION = 'grade_4_math_ch1_seg990';

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
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);

/** An asset row of one lesson, version `stamp`, made at `createdAt`. */
function asset(over = {}) {
  return {
    id: 'asset-1', lesson_id: L1, asset_kind: 'lesson', catalog_version: 'v8',
    version_stamp: 'elec_9Oct', content_hash: 'hash-oct9', is_current: true, superseded_at: null,
    created_at: '2026-10-09T17:31:00Z', ...over,
  };
}

function appOpen(over = {}) {
  return {
    id: `o-${Math.random().toString(36).slice(2, 8)}`,
    user_id: T1, plan_kind: 'k5', plan_ref: L1, lang: null, source: 'viewer',
    opened_at: pkt(NUDGE_DATE, 9, 30).toISOString(), ...over,
  };
}

function download(over = {}) {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    user_id: T1, lesson_id: L1, asset_id: 'asset-1', version_stamp: 'elec_9Oct', content_hash: 'hash-oct9',
    grade: '4', subject: 'math', chapter_number: 1, segment_index: 1, status: 'sent',
    created_at: pkt(NUDGE_DATE, 9, 0).toISOString(), ...over,
  };
}

function teacher(id) {
  return {
    id, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 'school-1', region: 'Sihala',
    phone_number: id === T1 ? '923001112222' : '923003334444', preferred_language: 'en',
    last_message_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
  };
}

const SOURCES = [
  { lesson_id: L1, version_stamp: 'elec_9Oct', content_hash: 'hash-oct9' },
  { lesson_id: L2, version_stamp: 'elec_9Oct', content_hash: 'hash-oct9-2' },
  { lesson_id: L_REVISION, version_stamp: 'elec_9Oct', content_hash: 'hash-rev' },
  { lesson_id: L_ASSESSMENT, version_stamp: 'elec_9Oct', content_hash: 'hash-ass' },
];

function install(over = {}) {
  const db = makeSupabase({
    niete_lp_downloads: [],
    niete_lp_opens: [],
    niete_lp_assets: [
      asset(),
      asset({ id: 'asset-2', lesson_id: L2, content_hash: 'hash-oct9-2' }),
      asset({ id: 'asset-rev', lesson_id: L_REVISION, content_hash: 'hash-rev' }),
      asset({ id: 'asset-ass', lesson_id: L_ASSESSMENT, content_hash: 'hash-ass' }),
      asset({ id: 'asset-key', lesson_id: L1, asset_kind: 'answer_key', content_hash: 'hash-key', is_current: true }),
    ],
    niete_lp_asset_sources: SOURCES,
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

const build = () => Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
const lessonsOf = (row) => row.context.classes.flatMap((c) => c.lessons.map((l) => l.lesson_id));

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
  delete process.env.LP_QUIZ_COUNT_APP_OPENS;
});

describe('15:00 cohort: a plan opened in the teacher app is a plan taken', () => {
  test('a teacher whose only plan today was opened in the app is offered, with the version served', async () => {
    install({ niete_lp_opens: [appOpen()] });
    const res = await build();

    expect(res.inserted).toBe(1);
    const row = mockStore.rows.find((r) => r.user_id === T1);
    expect(row.status).toBe('pending');
    const [cls] = row.context.classes;
    expect(cls.grade).toBe('4');
    expect(cls.subject).toBe('math');
    expect(cls.lessons).toEqual([expect.objectContaining({
      lesson_id: L1, asset_id: 'asset-1', version_stamp: 'elec_9Oct', content_hash: 'hash-oct9',
      delivered_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    })]);
  });

  test('an open of a link minted for another app (source external) is not a plan read', async () => {
    install({ niete_lp_opens: [appOpen({ source: 'external' })] });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(0);
  });

  test('a g612 open is not a K-5 lesson (the cohort is K-5 only)', async () => {
    install({ niete_lp_opens: [appOpen({ plan_kind: 'g612', plan_ref: 'grade_8_mathematics.c04.p047-050' })] });
    const res = await build();
    expect(res.inserted).toBe(0);
  });

  test('the same plan delivered on WhatsApp AND opened in the app is one lesson, one offer', async () => {
    install({ niete_lp_downloads: [download()], niete_lp_opens: [appOpen(), appOpen()] });
    const res = await build();
    expect(res.inserted).toBe(1);
    expect(mockStore.rows).toHaveLength(1);
    expect(lessonsOf(mockStore.rows[0])).toEqual([L1]);
  });

  test('a WhatsApp plan and a different plan opened in the app land in the same class', async () => {
    install({
      niete_lp_downloads: [download()],
      niete_lp_opens: [appOpen({ plan_ref: L2, opened_at: pkt(NUDGE_DATE, 11, 0).toISOString() })],
    });
    await build();
    expect(mockStore.rows).toHaveLength(1);
    expect(mockStore.rows[0].context.classes).toHaveLength(1);
    expect(lessonsOf(mockStore.rows[0])).toEqual([L1, L2]);
  });

  test('the 14:00 rule holds for an open: an open at 16:00 counts for the NEXT school day', async () => {
    install({ niete_lp_opens: [appOpen({ opened_at: pkt('2026-10-12', 16, 0).toISOString() })] });
    // Monday 16:00 -> Tuesday's offer.
    const tue = await Offer.buildCohort({ nudgeDate: '2026-10-13', now: pkt('2026-10-13', 15, 0) });
    expect(tue.inserted).toBe(1);

    mockStore = makeStore();
    install({ niete_lp_opens: [appOpen({ opened_at: pkt(NUDGE_DATE, 16, 0).toISOString() })] });
    // Tuesday 16:00 does NOT count for Tuesday's own offer.
    const same = await build();
    expect(same.inserted).toBe(0);
  });

  test('an assessment day (_seg995) opened in the app is not a lesson; a revision day (_seg990) is', async () => {
    install({
      niete_lp_opens: [
        appOpen({ user_id: T1, plan_ref: L_ASSESSMENT }),
        appOpen({ user_id: T2, plan_ref: L_REVISION }),
      ],
    });
    const res = await build();
    const t1 = mockStore.rows.find((r) => r.user_id === T1);
    const t2 = mockStore.rows.find((r) => r.user_id === T2);
    // T1's only lesson was the assessment: skipped, never offered.
    expect(t1 === undefined || t1.status === 'skipped').toBe(true);
    expect(t2.status).toBe('pending');
    expect(lessonsOf(t2)).toEqual([L_REVISION]);
    expect(res.inserted).toBe(1);
  });

  test('an answer key is never a source: only the lesson asset is read for an open', async () => {
    install({ niete_lp_opens: [appOpen()] });
    await build();
    const [lesson] = mockStore.rows[0].context.classes[0].lessons;
    expect(lesson.asset_id).toBe('asset-1');
    expect(lesson.content_hash).not.toBe('hash-key');
  });

  test('the version served is the one current when she opened it, not a later push', async () => {
    install({
      niete_lp_assets: [
        asset({ id: 'asset-old', version_stamp: 'ch37_2Oct', content_hash: 'hash-oct2', is_current: false,
          created_at: '2026-10-02T18:40:00Z', superseded_at: '2026-10-09T17:31:00Z' }),
        asset({ id: 'asset-new', version_stamp: 'elec_9Oct', content_hash: 'hash-oct9', is_current: true,
          created_at: '2026-10-09T17:31:00Z' }),
      ],
      niete_lp_asset_sources: [
        { lesson_id: L1, version_stamp: 'ch37_2Oct', content_hash: 'hash-oct2' },
        { lesson_id: L1, version_stamp: 'elec_9Oct', content_hash: 'hash-oct9' },
      ],
      // Opened 5 Oct (the old version was what she read) — for the 6 Oct offer.
      niete_lp_opens: [appOpen({ opened_at: pkt('2026-10-06', 9, 0).toISOString() })],
    });
    await Offer.buildCohort({ nudgeDate: '2026-10-06', now: pkt('2026-10-06', 15, 0) });
    const [lesson] = mockStore.rows[0].context.classes[0].lessons;
    expect(lesson).toEqual(expect.objectContaining({ asset_id: 'asset-old', version_stamp: 'ch37_2Oct', content_hash: 'hash-oct2' }));
  });

  test('no slide script for the served version -> skipped as no_quiz_source, like a WhatsApp plan', async () => {
    install({ niete_lp_asset_sources: [], niete_lp_opens: [appOpen()] });
    const res = await build();
    expect(res.skipped).toEqual({ no_quiz_source: 1 });
    expect(mockStore.rows[0].context.skip_reason).toBe('no_quiz_source');
  });

  test('a lesson an lp_v8 quiz already covers is not offered again', async () => {
    install({
      niete_lp_opens: [appOpen()],
      quizzes: [{
        id: 'q-1', teacher_id: T1, quiz_source: 'lp_v8', created_at: pkt('2026-10-12', 12, 0).toISOString(),
        lessons: [{ lesson_id: L1 }], meta: { lessons: [{ lesson_id: L1 }] },
      }],
    });
    const res = await build();
    expect(res.inserted).toBe(0);
  });

  test('one offer per teacher per day: a second build writes nothing new (teacher_nudges UNIQUE)', async () => {
    install({ niete_lp_opens: [appOpen()] });
    await build();
    const again = await build();
    expect(again.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(1);
  });

  test('LP_QUIZ_COUNT_APP_OPENS=off puts the cohort back to WhatsApp-delivered plans only', async () => {
    process.env.LP_QUIZ_COUNT_APP_OPENS = 'off';
    install({ niete_lp_opens: [appOpen()] });
    const res = await build();
    expect(res.inserted).toBe(0);
  });
});
