'use strict';
/**
 * lpTakenToday(teacherId, dayPkt) — the lessons ONE teacher took that count for a school day, by the
 * 15:00 cohort's own rule. The class link's evening round is written from it, so it must agree with
 * the offer on every edge the offer already decided: the 14:00 cutoff (a lesson taken at 16:00 is
 * tomorrow's), lesson assets only (never an answer key), no assessment segment, the religious hold,
 * and the exact-version slide-script check.
 *
 * The supabase stub really filters (helpers/filtering-chain); the source store and the hold are the
 * REAL modules, so the rule under test is the one the cohort runs.
 */

const { makeSupabase } = require('../quiz/helpers/filtering-chain');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const DAY = '2026-09-22';          // Tuesday
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
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
    created_at: pkt(DAY, 9, 30).toISOString(),
    ...over,
  };
}

function install(over = {}) {
  const db = makeSupabase({
    niete_lp_downloads: [
      download(),
      // Taken at 16:00: it counts for the NEXT school day, not this one.
      download({ lesson_id: 'g4_maths_c02_seg002', asset_id: 'asset-lesson-2', created_at: pkt(DAY, 16, 0).toISOString() }),
      // An answer key download: never a quiz source.
      download({ lesson_id: 'g4_maths_c02_seg003', asset_id: 'asset-key-3' }),
      // An assessment segment: never offered.
      download({ lesson_id: 'g4_maths_c02_seg995', asset_id: 'asset-lesson-995' }),
      // Another teacher's lesson: never mixed in.
      download({ user_id: T2, lesson_id: 'g3_english_c04_seg002', asset_id: 'asset-lesson-t2', grade: 3, subject: 'english' }),
      // Not sent: never taken.
      download({ lesson_id: 'g4_maths_c02_seg004', asset_id: 'asset-lesson-4', status: 'failed' }),
    ],
    niete_lp_assets: [
      { id: 'asset-lesson-1', asset_kind: 'lesson' },
      { id: 'asset-lesson-2', asset_kind: 'lesson' },
      { id: 'asset-key-3', asset_kind: 'answer_key' },
      { id: 'asset-lesson-995', asset_kind: 'lesson' },
      { id: 'asset-lesson-t2', asset_kind: 'lesson' },
      { id: 'asset-lesson-4', asset_kind: 'lesson' },
    ],
    niete_lp_asset_sources: [
      { lesson_id: 'g4_maths_c02_seg001', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug' },
      { lesson_id: 'g4_maths_c02_seg002', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug' },
      { lesson_id: 'g4_maths_c02_seg003', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug' },
      { lesson_id: 'g4_maths_c02_seg995', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug' },
      { lesson_id: 'g3_english_c04_seg002', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug' },
    ],
    niete_lp_opens: [],
    ...over,
  });
  supabase.from.mockImplementation(db.from);
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
});

describe('lpTakenToday — one teacher, one school day, the cohort rule', () => {
  test('is exported', () => {
    expect(typeof Offer.lpTakenToday).toBe('function');
  });

  test('returns only the lessons that count for the day, grouped by class', async () => {
    install();
    const out = await Offer.lpTakenToday(T1, DAY);
    expect(out.nudgeDate).toBe(DAY);
    expect(out.classes).toHaveLength(1);
    const [cls] = out.classes;
    expect(cls).toMatchObject({ key: 'g4_maths', grade: 4, subject: 'maths' });
    expect(cls.lessons.map((l) => l.lesson_id)).toEqual(['g4_maths_c02_seg001']);
    expect(cls.lessons[0]).toMatchObject({
      asset_id: 'asset-lesson-1', version_stamp: 'v8.2026-08-20', content_hash: 'hash-aug',
    });
  });

  test('the 16:00 lesson counts for the next school day', async () => {
    install();
    const next = pktTime.nextSchoolDay(DAY);
    const out = await Offer.lpTakenToday(T1, next);
    expect(out.classes.flatMap((c) => c.lessons.map((l) => l.lesson_id))).toEqual(['g4_maths_c02_seg002']);
  });

  test('a lesson whose served version has no slide script is left out', async () => {
    install({ niete_lp_asset_sources: [] });
    const out = await Offer.lpTakenToday(T1, DAY);
    expect(out.classes).toEqual([]);
  });

  test('lpTakenFor: many teachers in one pass → a Map per teacher, the same answer as the single call', async () => {
    install();
    expect(typeof Offer.lpTakenFor).toBe('function');
    const T3 = '33333333-3333-4333-8333-333333333333';
    const map = await Offer.lpTakenFor([T1, T2, T3], DAY);
    expect(map).toBeInstanceOf(Map);
    expect(map.get(T1).map((c) => c.key)).toEqual(['g4_maths']);
    expect(map.get(T1)[0].lessons.map((l) => l.lesson_id)).toEqual(['g4_maths_c02_seg001']);
    expect(map.get(T2).map((c) => c.key)).toEqual(['g3_english']);
    expect(map.get(T3)).toEqual([]);
    const single = await Offer.lpTakenToday(T1, DAY);
    expect(single.classes).toEqual(map.get(T1));
  });

  test('lpTakenFor: an app open counts like a download (same reader the cohort uses)', async () => {
    const appRow = download({ user_id: T2, lesson_id: 'g3_english_c04_seg002', asset_id: 'asset-lesson-t2', grade: 3, subject: 'english', via: 'app' });
    const AppOpens = require('../../bot/shared/services/quiz/lp-app-opens.store');
    const spy = jest.spyOn(AppOpens, 'viewerOpensAsDownloads').mockResolvedValue([appRow]);
    install({ niete_lp_downloads: [] });
    const map = await Offer.lpTakenFor([T1, T2], DAY);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(map.get(T2).map((c) => c.key)).toEqual(['g3_english']);
    expect(map.get(T1)).toEqual([]);
    spy.mockRestore();
  });

  test('a teacher with nothing taken → no classes; bad input → no classes, no read', async () => {
    install();
    expect((await Offer.lpTakenToday('33333333-3333-4333-8333-333333333333', DAY)).classes).toEqual([]);
    supabase.from.mockClear();
    expect((await Offer.lpTakenToday(null, DAY)).classes).toEqual([]);
    expect((await Offer.lpTakenToday(T1, '22-09-2026')).classes).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
