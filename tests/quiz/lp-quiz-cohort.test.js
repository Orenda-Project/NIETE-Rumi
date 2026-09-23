'use strict';
/**
 * R8 lane B · 5.1 — who is offered an LP-born quiz at 15:00, and for which
 * lessons.
 *
 * The cohort is the only place the afternoon offer decides anything: after it
 * runs, a teacher either has a pending row with their classes in it or a skipped
 * row saying why not. Everything asserted here is a rule from PLAN R8 §5.1 —
 * D2 (a lesson planned after 14:00 belongs to the next school day), D9
 * (assessment segments out, revision segments in), D10 (pilot sectors), and
 * the pre-checks that keep the day's message budget (D5).
 *
 * The supabase stub really filters (helpers/filtering-chain), so a read that
 * forgets `.eq('status','sent')` or reads one page instead of looping fails
 * here instead of building a cohort out of the wrong teachers.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const PREV_DATE = '2026-09-21';           // Monday
const FRIDAY = '2026-09-18';
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

// Lane N's store is mocked at its contract (PLAN R8 §2.2) with an in-memory
// table that carries the UNIQUE; pkt-time is the real module.
let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');

/** A PKT wall-clock instant as the UTC Date the code sees. */
const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);

function download(over = {}) {
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
    created_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    ...over,
  };
}

function teacher(over = {}) {
  return {
    id: T1,
    role: 'teacher',
    is_test_user: false,
    deleted_at: null,
    school_id: 'school-1',
    region: 'Sihala',
    phone_number: '923001112222',
    preferred_language: 'en',
    last_message_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
    ...over,
  };
}

function world(over = {}) {
  return {
    niete_lp_downloads: [download()],
    niete_lp_assets: [
      { id: 'asset-lesson-1', asset_kind: 'lesson' },
      { id: 'asset-lesson-2', asset_kind: 'lesson' },
      { id: 'asset-lesson-3', asset_kind: 'lesson' },
      { id: 'asset-key-1', asset_kind: 'answer_key' },
    ],
    users: [teacher()],
    schools: [{ id: 'school-1', region: 'Sihala' }, { id: 'school-2', region: 'Tarnol' }],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
    ...over,
  };
}

let db;
function install(tables) {
  db = makeSupabase(tables);
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

afterEach(() => {
  delete process.env.LP_QUIZ_OFFER_ENABLED;
  delete process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT;
  delete process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT;
  delete process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT;
  delete process.env.LP_QUIZ_OFFER_SECTORS;
});

// ── cohortRuleDate (D2) ──────────────────────────────────────────────────────

describe('cohortRuleDate — the 14:00 rule', () => {
  test('a lesson planned before the cutoff counts for that same day', () => {
    expect(Offer.cohortRuleDate(pkt(NUDGE_DATE, 9, 30))).toBe(NUDGE_DATE);
    expect(Offer.cohortRuleDate(pkt(NUDGE_DATE, 13, 59))).toBe(NUDGE_DATE);
  });

  test('14:00 itself already belongs to the next school day', () => {
    expect(Offer.cohortRuleDate(pkt(NUDGE_DATE, 14, 0))).toBe('2026-09-23');
  });

  test('a Friday afternoon lesson is offered on Monday', () => {
    expect(Offer.cohortRuleDate(pkt(FRIDAY, 15, 10))).toBe('2026-09-21');
  });

  test('the cutoff hour is configurable and read at call time', () => {
    process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '12';
    expect(Offer.cohortRuleDate(pkt(NUDGE_DATE, 13, 0))).toBe('2026-09-23');
  });
});

// ── classKey / groupLessons ──────────────────────────────────────────────────

describe('classKey and groupLessons', () => {
  test('a class key is the grade and the subject slug', () => {
    expect(Offer.classKey(4, 'maths')).toBe('g4_maths');
    expect(Offer.classKey('5', 'General Knowledge')).toBe('g5_general_knowledge');
    expect(Offer.classKey(5, 'general_science')).toBe('g5_general_science');
  });

  test('a class key never carries a character that would split a list row id', () => {
    expect(Offer.classKey(3, 'Social Studies / Civics')).not.toMatch(/[^a-z0-9_]/);
  });

  test('a class key is a choice the store will record — class:<key> admits only [A-Za-z0-9_]', () => {
    // The pick is stored as `class:<key>` (teacher-nudges.store CHOICE_RE). A
    // hyphen in the key makes recordAnswer throw on the very tap it records.
    const RealStore = jest.requireActual('../../bot/shared/services/nudges/teacher-nudges.store');
    expect(RealStore).toBeTruthy();
    for (const [g, s] of [[5, 'general_science'], [3, 'Social Studies / Civics'], [1, 'general knowledge']]) {
      expect(`class:${Offer.classKey(g, s)}`).toMatch(/^class:[A-Za-z0-9_]+$/);
    }
  });

  test('lessons group by teacher, then by class, oldest first', () => {
    const rows = [
      download({ lesson_id: 'g4_maths_c02_seg002', created_at: pkt(NUDGE_DATE, 11, 0).toISOString() }),
      download({ lesson_id: 'g4_maths_c02_seg001', created_at: pkt(NUDGE_DATE, 9, 0).toISOString() }),
      download({ lesson_id: 'g5_urdu_c01_seg001', grade: 5, subject: 'urdu' }),
      download({ user_id: T2, lesson_id: 'g1_english_c01_seg001', grade: 1, subject: 'english' }),
    ];
    const grouped = Offer.groupLessons(rows);
    expect(grouped.map((g) => g.userId).sort()).toEqual([T1, T2].sort());
    const one = grouped.find((g) => g.userId === T1);
    expect(one.classes.map((c) => c.key).sort()).toEqual(['g4_maths', 'g5_urdu']);
    const maths = one.classes.find((c) => c.key === 'g4_maths');
    expect(maths.lessons.map((l) => l.lesson_id)).toEqual(['g4_maths_c02_seg001', 'g4_maths_c02_seg002']);
    expect(maths.grade).toBe(4);
    expect(maths.subject).toBe('maths');
    expect(maths.lessons[0]).toMatchObject({
      asset_id: 'asset-lesson-1', version_stamp: 'v8.2026-09-01', content_hash: 'hash-aaa',
    });
  });
});

// ── preChecks ────────────────────────────────────────────────────────────────

describe('preChecks — every reason, in a fixed order', () => {
  const ok = {
    isSchoolDay: true, sectorAllowed: true, lessonCount: 1,
    coachingYesToday: false, coachedToday: false, offeredToday: false,
    sentToday: false, windowOpen: true,
  };

  test('a teacher who planned a lesson and did nothing else passes', () => {
    expect(Offer.preChecks(ok)).toBeNull();
  });

  test.each([
    ['not_school_day', { isSchoolDay: false }],
    ['sector_not_piloted', { sectorAllowed: false }],
    ['no_lesson', { lessonCount: 0 }],
    ['coaching_yes_today', { coachingYesToday: true }],
    ['coached_today', { coachedToday: true }],
    ['offered_today', { offeredToday: true }],
    ['sent_today', { sentToday: true }],
    ['window_closed', { windowOpen: false }],
  ])('%s', (reason, patch) => {
    expect(Offer.preChecks({ ...ok, ...patch })).toBe(reason);
  });

  test('the calendar is checked before the sector, and the sector before the lessons', () => {
    expect(Offer.preChecks({ ...ok, isSchoolDay: false, sectorAllowed: false, lessonCount: 0 }))
      .toBe('not_school_day');
    expect(Offer.preChecks({ ...ok, sectorAllowed: false, lessonCount: 0 })).toBe('sector_not_piloted');
  });

  test('every reason it can return is one the store will accept', () => {
    for (const reason of Offer.SKIP_REASONS_USED) {
      expect(mockStore.SKIP_REASONS).toContain(reason);
    }
  });
});

// ── buildCohort ──────────────────────────────────────────────────────────────

describe('buildCohort', () => {
  test('one pending row per teacher, carrying their classes and the 15:00 send time', async () => {
    install(world());
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });

    expect(res.inserted).toBe(1);
    expect(mockStore.rows).toHaveLength(1);
    const row = mockStore.rows[0];
    expect(row.kind).toBe('lp_quiz_offer');
    expect(row.user_id).toBe(T1);
    expect(row.nudge_date).toBe(NUDGE_DATE);
    expect(row.status).toBe('pending');
    expect(row.scheduled_at).toBe(pkt(NUDGE_DATE, 15, 0).toISOString());
    expect(row.context.classes).toEqual([expect.objectContaining({
      key: 'g4_maths', grade: 4, subject: 'maths',
    })]);
    expect(row.context.classes[0].lessons[0]).toMatchObject({
      lesson_id: 'g4_maths_c02_seg001', asset_id: 'asset-lesson-1',
      version_stamp: 'v8.2026-09-01', content_hash: 'hash-aaa',
    });
  });

  test('a lesson taken after 14:00 yesterday counts for today', async () => {
    install(world({
      niete_lp_downloads: [download({ created_at: pkt(PREV_DATE, 16, 0).toISOString() })],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(1);
    expect(mockStore.rows[0].context.classes[0].lessons).toHaveLength(1);
  });

  test('a lesson taken after 14:00 TODAY is held back for tomorrow', async () => {
    install(world({
      niete_lp_downloads: [download({ created_at: pkt(NUDGE_DATE, 14, 30).toISOString() })],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(0);
  });

  test('an assessment segment is not quizzed; a revision segment is (D9)', async () => {
    install(world({
      niete_lp_downloads: [
        download({ lesson_id: 'g4_maths_c02_seg995' }),
        download({ lesson_id: 'g4_maths_c02_seg990', asset_id: 'asset-lesson-2' }),
      ],
    }));
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    const lessons = mockStore.rows[0].context.classes[0].lessons;
    expect(lessons.map((l) => l.lesson_id)).toEqual(['g4_maths_c02_seg990']);
  });

  test('a teacher whose only download was an assessment gets a no_lesson row, not silence', async () => {
    install(world({
      niete_lp_downloads: [download({ lesson_id: 'g4_maths_c02_seg995' })],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.skipped.no_lesson).toBe(1);
    expect(mockStore.rows[0].status).toBe('skipped');
    expect(mockStore.rows[0].context.skip_reason).toBe('no_lesson');
  });

  test('the answer key that rides with an assessment is never a quiz source', async () => {
    install(world({
      niete_lp_downloads: [
        download({ asset_id: 'asset-key-1', lesson_id: 'g4_maths_c02_seg990' }),
        download({ asset_id: 'asset-lesson-2', lesson_id: 'g4_maths_c02_seg001' }),
      ],
    }));
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    const lessons = mockStore.rows[0].context.classes[0].lessons;
    expect(lessons.map((l) => l.asset_id)).toEqual(['asset-lesson-2']);
  });

  test('a failed download is not a planned lesson', async () => {
    install(world({ niete_lp_downloads: [download({ status: 'failed' })] }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(0);
  });

  test.each([
    ['a coach', { role: 'coach' }],
    ['a test account', { is_test_user: true }],
    ['a deleted account', { deleted_at: '2026-09-01T00:00:00Z' }],
  ])('%s is never in the cohort', async (_label, patch) => {
    install(world({ users: [teacher(patch)] }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(0);
  });

  test('the users read never names deleted_at to PostgREST — the column is not in the repo schema', async () => {
    // A select naming a column the table lacks makes PostgREST refuse the WHOLE
    // read (a dropped `users.grade` once failed every quiz offer for hours).
    // `deleted_at` is live on one environment and absent from the checked-in
    // schema, so it is read with `*` and filtered in code.
    install(world());
    const named = [];
    const real = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      const chain = real(table);
      if (table !== 'users') return chain;
      const select = chain.select;
      const is = chain.is;
      chain.select = (cols, opts) => { named.push(String(cols)); return select(cols, opts); };
      chain.is = (col, v) => { named.push(col); return is(col, v); };
      return chain;
    });
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(n).not.toMatch(/deleted_at/);
  });

  test('with pilot sectors set, a teacher outside them gets sector_not_piloted (D10)', async () => {
    process.env.LP_QUIZ_OFFER_SECTORS = 'Sihala, Urban-II';
    install(world({
      niete_lp_downloads: [download(), download({ user_id: T2, asset_id: 'asset-lesson-2' })],
      users: [teacher(), teacher({ id: T2, school_id: 'school-2', region: 'Tarnol' })],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(1);
    expect(res.skipped.sector_not_piloted).toBe(1);
    const skipped = mockStore.rows.find((r) => r.user_id === T2);
    expect(skipped.context.skip_reason).toBe('sector_not_piloted');
  });

  test('the sector falls back to users.region when the school row has none', async () => {
    process.env.LP_QUIZ_OFFER_SECTORS = 'Nilore';
    install(world({
      users: [teacher({ school_id: null, region: 'Nilore' })],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(1);
  });

  test('an empty LP_QUIZ_OFFER_SECTORS means every sector (sandbox)', async () => {
    process.env.LP_QUIZ_OFFER_SECTORS = '';
    install(world({ users: [teacher({ region: 'Barakahu', school_id: null })] }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(1);
  });

  test.each([
    ['coached_today', { coaching_sessions: [{ id: 'cs-1', user_id: T1, created_at: pkt(NUDGE_DATE, 8, 0).toISOString() }] }],
    ['offered_today', { quizzes: [{ id: 'q-1', teacher_id: T1, created_at: pkt(NUDGE_DATE, 8, 0).toISOString() }] }],
  ])('%s is recorded as a skipped row so the funnel can count it', async (reason, patch) => {
    install(world(patch));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(0);
    expect(res.skipped[reason]).toBe(1);
    expect(mockStore.rows[0].context.skip_reason).toBe(reason);
  });

  test('a teacher who said yes to the coaching ask today is not also offered (D5)', async () => {
    mockStore = makeStore([{
      id: 'nudge-a', user_id: T1, kind: 'coaching_after_lp', nudge_date: NUDGE_DATE,
      status: 'sent', choice: 'yes',
    }]);
    install(world({
      teacher_nudges: [{
        id: 'nudge-a', user_id: T1, kind: 'coaching_after_lp', nudge_date: NUDGE_DATE,
        status: 'sent', choice: 'yes',
      }],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.skipped.coaching_yes_today).toBe(1);
  });

  test('yesterday\'s coaching session does not block today\'s offer', async () => {
    install(world({
      coaching_sessions: [{ id: 'cs-1', user_id: T1, created_at: pkt(PREV_DATE, 8, 0).toISOString() }],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(1);
  });

  test('the second build of the day inserts nothing and reads no downloads', async () => {
    install(world());
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    const firstReads = db.reads.filter((t) => t === 'niete_lp_downloads').length;
    expect(firstReads).toBeGreaterThan(0);

    // The rows the first build wrote are now in the table the count query reads.
    install(world({
      teacher_nudges: mockStore.rows.map((r) => ({ id: r.id, user_id: r.user_id, kind: r.kind, nudge_date: r.nudge_date })),
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 30) });
    expect(res.inserted).toBe(0);
    expect(db.reads).not.toContain('niete_lp_downloads');
  });

  test('a build racing another replica is a no-op, not a second row (the UNIQUE)', async () => {
    install(world());
    await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    install(world());                       // teacher_nudges still empty → the count guard misses
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(1);
  });

  test('a non-school day builds nothing at all', async () => {
    install(world());
    const res = await Offer.buildCohort({ nudgeDate: '2026-09-26', now: pkt('2026-09-26', 15, 0) });
    expect(res.inserted).toBe(0);
    expect(res.skipped.not_school_day).toBe(1);
    expect(db.reads).not.toContain('niete_lp_downloads');
  });

  test('the flag unset is a kill switch — no reads, no rows', async () => {
    delete process.env.LP_QUIZ_OFFER_ENABLED;
    install(world());
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(0);
    expect(res.skipped.disabled).toBe(1);
    expect(db.reads).toEqual([]);
  });

  test('two teachers, two classes each, one row apiece', async () => {
    install(world({
      niete_lp_downloads: [
        download(),
        download({ lesson_id: 'g5_urdu_c01_seg001', grade: 5, subject: 'urdu', asset_id: 'asset-lesson-2' }),
        download({ user_id: T2, lesson_id: 'g1_english_c01_seg001', grade: 1, subject: 'english', asset_id: 'asset-lesson-3' }),
      ],
      users: [teacher(), teacher({ id: T2, phone_number: '923004445555' })],
    }));
    const res = await Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
    expect(res.inserted).toBe(2);
    expect(mockStore.rows.find((r) => r.user_id === T1).context.classes).toHaveLength(2);
    expect(mockStore.rows.find((r) => r.user_id === T2).context.classes).toHaveLength(1);
  });
});

// ── prepare (the sweeper's per-tick hook) ────────────────────────────────────

describe('prepare — the sweeper hook that owns the daily build', () => {
  test('nothing is built before the send minute', async () => {
    install(world());
    const res = await Offer.prepare({ now: pkt(NUDGE_DATE, 14, 59) });
    expect(res.built).toBe(false);
    expect(db.reads).toEqual([]);
  });

  test('the build runs at the send minute and is safe on every later tick', async () => {
    install(world());
    const first = await Offer.prepare({ now: pkt(NUDGE_DATE, 15, 0) });
    expect(first.built).toBe(true);
    expect(first.inserted).toBe(1);

    install(world({
      teacher_nudges: mockStore.rows.map((r) => ({ id: r.id, user_id: r.user_id, kind: r.kind, nudge_date: r.nudge_date })),
    }));
    const second = await Offer.prepare({ now: pkt(NUDGE_DATE, 15, 5) });
    expect(second.inserted).toBe(0);
    expect(mockStore.rows).toHaveLength(1);
  });

  test('a send minute past the hour is honoured', async () => {
    process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '30';
    install(world());
    expect((await Offer.prepare({ now: pkt(NUDGE_DATE, 15, 29) })).built).toBe(false);
    expect((await Offer.prepare({ now: pkt(NUDGE_DATE, 15, 30) })).built).toBe(true);
  });
});
