'use strict';
/**
 * bd-xxl9i — a day whose cohort writes no row is built ONCE, not on every tick.
 *
 * The build's only short-circuit was a count of the day's teacher_nudges rows.
 * A day with no lesson downloads, or whose every candidate is filtered out
 * before a row is scheduled (a coach, a test user), writes nothing, so that
 * count stays 0 and the whole cohort query re-ran on every sweeper tick on
 * every replica: staging logged `lp_quiz.cohort_built {candidates:0}` 770
 * times on 10 Nov 2026. The build is documented as "at most once a day"; an
 * empty day is now remembered for that day.
 *
 * Each test uses its own school day, so the per-day memory cannot leak
 * between tests.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const T1 = '11111111-1111-4111-8111-111111111111';

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

function download(date, over = {}) {
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    user_id: T1,
    lesson_id: 'g4_maths_c02_seg001',
    asset_id: 'asset-lesson-1',
    version_stamp: 'v8.2026-09-01',
    content_hash: 'hash-aaa',
    grade: 4,
    subject: 'maths',
    chapter_number: 2,
    segment_index: 1,
    status: 'sent',
    phone: '923001112222',
    created_at: pkt(date, 9, 30).toISOString(),
    ...over,
  };
}

function world(over = {}) {
  return {
    niete_lp_downloads: [],
    niete_lp_assets: [{ id: 'asset-lesson-1', asset_kind: 'lesson' }],
    niete_lp_asset_sources: [],
    users: [],
    schools: [{ id: 'school-1', region: 'Sihala' }],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
    ...over,
  };
}

/** Installs the tables and counts every read of the given table. */
function install(tables, counted) {
  const db = makeSupabase(tables);
  const reads = { n: 0 };
  supabase.from.mockImplementation((t) => {
    if (t === counted) reads.n += 1;
    return db.from(t);
  });
  return reads;
}

const built = () => logEvent.mock.calls.filter(([e]) => e === 'lp_quiz.cohort_built').length;

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
});

afterEach(() => {
  delete process.env.LP_QUIZ_OFFER_ENABLED;
  delete process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT;
  delete process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT;
  delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
});

describe('bd-xxl9i — an empty cohort day is built once', () => {
  test('a day with no lesson downloads is not re-read on the next tick', async () => {
    const DAY = '2026-09-23'; // Wednesday
    const reads = install(world(), 'niete_lp_downloads');

    const first = await Offer.prepare({ now: pkt(DAY, 15, 0) });
    const readsAfterFirst = reads.n;
    const second = await Offer.prepare({ now: pkt(DAY, 15, 1) });

    expect(first.built).toBe(true);
    expect(readsAfterFirst).toBeGreaterThan(0);
    expect(second.built).toBe(false);
    expect(reads.n).toBe(readsAfterFirst);
    expect(built()).toBe(1);
  });

  test('a day whose only candidate is filtered out (a coach) is not rebuilt', async () => {
    const DAY = '2026-09-24'; // Thursday
    const reads = install(world({
      niete_lp_downloads: [download(DAY)],
      users: [{ id: T1, role: 'coach', deleted_at: null, school_id: 'school-1' }],
    }), 'users');

    const first = await Offer.buildCohort({ nudgeDate: DAY, now: pkt(DAY, 15, 0) });
    const readsAfterFirst = reads.n;
    const second = await Offer.buildCohort({ nudgeDate: DAY, now: pkt(DAY, 15, 1) });

    expect(first).toMatchObject({ built: true, inserted: 0 });
    expect(second).toMatchObject({ built: false, inserted: 0 });
    expect(reads.n).toBe(readsAfterFirst);
    expect(built()).toBe(1);
    expect(mockStore.rows).toHaveLength(0);
  });

  test('an empty day does not stop the NEXT day from building', async () => {
    const EMPTY = '2026-09-28'; // Monday
    const NEXT = '2026-09-29'; // Tuesday
    install(world({
      niete_lp_downloads: [download(NEXT)],
      niete_lp_asset_sources: [{ lesson_id: 'g4_maths_c02_seg001', version_stamp: 'v8.2026-09-01', content_hash: 'hash-aaa' }],
      users: [{
        id: T1, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 'school-1',
        region: 'Sihala', phone_number: '923001112222', preferred_language: 'en',
        last_message_at: pkt(NEXT, 10, 0).toISOString(),
      }],
    }), null);

    const empty = await Offer.buildCohort({ nudgeDate: EMPTY, now: pkt(EMPTY, 15, 0) });
    const next = await Offer.buildCohort({ nudgeDate: NEXT, now: pkt(NEXT, 15, 0) });

    expect(empty).toMatchObject({ built: true, inserted: 0 });
    expect(next).toMatchObject({ built: true, inserted: 1 });
  });
});
