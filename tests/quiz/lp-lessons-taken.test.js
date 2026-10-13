'use strict';
/**
 * "Which K-5 lessons did a teacher take?" — one answer for the 15:00 offer and
 * the /quiz lesson-plan list, whatever surface she took the lesson on.
 *
 * Since the teacher app serves lesson plans, a lesson read in the app leaves a
 * niete_lp_opens row (plan_kind 'k5') and no niete_lp_downloads row. With the
 * app_settings switch `lp_quiz_app_lessons` on, such a lesson counts exactly as
 * a WhatsApp delivery does; with it off (or absent, or unreadable), nothing
 * changes.
 *
 * The supabase stub really filters (helpers/filtering-chain); the catalogue,
 * the source store, the A/B picker and the reader are the REAL modules, so
 * the rules under test are the ones production runs.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const NEXT_DAY = '2026-09-23';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

// Real catalogue lessons (data/lp_catalog.json): grade 4, subject_key 'math'.
const L1 = 'grade_4_math_ch2_seg1';
const L2 = 'grade_4_math_ch2_seg2';
const L4 = 'grade_4_math_ch4_seg1';      // chapter 4: inside the ch3-8 A/B scope
const L_ASSESS = 'grade_4_math_ch2_seg995';
const TOPIC_L1 = 'Adding to 5-digit numbers — mental maths';

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
const { logToFile } = require('../../bot/shared/utils/logger');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');
const Provider = require('../../bot/shared/services/quiz/lp-v8-lesson-provider');
const LpAb = require('../../bot/shared/services/lp-ab-ch310.service');

const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);
const SWITCH_ON = { key: 'lp_quiz_app_lessons', value: true };

function asset(lessonId, over = {}) {
  return {
    id: `asset-${lessonId}`,
    lesson_id: lessonId,
    asset_kind: 'lesson',
    version_stamp: 'v9-20260915',
    content_hash: `hash-${lessonId}`,
    is_current: true,
    created_at: '2026-09-15T00:00:00Z',
    ...over,
  };
}

function source(a) {
  return { lesson_id: a.lesson_id, version_stamp: a.version_stamp, content_hash: a.content_hash };
}

function download(over = {}) {
  const a = asset(over.lesson_id || L1);
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    user_id: T1,
    lesson_id: a.lesson_id,
    asset_id: a.id,
    version_stamp: a.version_stamp,
    content_hash: a.content_hash,
    grade: 4,
    subject: 'math',
    chapter_number: 2,
    segment_index: 1,
    status: 'sent',
    created_at: pkt(NUDGE_DATE, 9, 30).toISOString(),
    ...over,
  };
}

let openSeq = 0;
function open(over = {}) {
  openSeq += 1;
  return {
    id: `0000000${openSeq}-0000-4000-8000-00000000000${openSeq % 10}`,
    user_id: T1,
    plan_kind: 'k5',
    plan_ref: L1,
    lang: null,
    source: 'viewer',
    opened_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
    created_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
    ...over,
  };
}

function teacher(id, over = {}) {
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
    ...over,
  };
}

const ASSETS = [asset(L1), asset(L2), asset(L4), asset(L_ASSESS)];

function install(over = {}) {
  const db = makeSupabase({
    niete_lp_downloads: [],
    niete_lp_opens: [],
    niete_lp_assets: ASSETS,
    niete_lp_asset_sources: ASSETS.map(source),
    users: [teacher(T1), teacher(T2)],
    schools: [{ id: 'school-1', region: 'Sihala' }],
    coaching_sessions: [],
    quizzes: [],
    teacher_nudges: [],
    app_settings: [],
    niete_lp_ab_assignment: [],
    ...over,
  });
  supabase.from.mockImplementation(db.from);
  return db;
}

const build = (date = NUDGE_DATE) => Offer.buildCohort({ nudgeDate: date, now: pkt(date, 15, 0) });
const rowOf = (userId) => mockStore.rows.find((r) => r.user_id === userId);

beforeEach(() => {
  jest.clearAllMocks();
  LpAb.__resetForTests();
  mockStore = makeStore();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
});

describe('15:00 cohort: a lesson taken in the app counts (switch on)', () => {
  test('a teacher whose ONLY lesson today is an app open gets a pending offer for that class and topic', async () => {
    install({ niete_lp_opens: [open()], app_settings: [SWITCH_ON] });
    const res = await build();

    expect(res.inserted).toBe(1);
    const row = rowOf(T1);
    expect(row.status).toBe('pending');
    expect(row.context.classes).toHaveLength(1);
    const cls = row.context.classes[0];
    expect(cls.key).toBe('g4_math');
    expect(cls.lessons).toEqual([expect.objectContaining({
      lesson_id: L1,
      asset_id: `asset-${L1}`,
      version_stamp: 'v9-20260915',
      content_hash: `hash-${L1}`,
      delivered_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
      topic: TOPIC_L1,
    })]);
  });

  test('switch OFF: the same teacher is not in the cohort at all, and niete_lp_opens is never read', async () => {
    const db = install({ niete_lp_opens: [open()] });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(rowOf(T1)).toBeUndefined();
    expect(db.reads).not.toContain('niete_lp_opens');
  });

  test('a switch that cannot be read is OFF, and says so at error level', async () => {
    const db = install({ niete_lp_opens: [open()] });
    const realFrom = db.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      if (table !== 'app_settings') return realFrom(table);
      const broken = {
        select: () => broken, eq: () => broken, in: () => broken,
        maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
        then: (r) => r({ data: null, error: { message: 'boom' } }),
      };
      return broken;
    });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('lp_quiz_app_lessons'),
      expect.anything(), 'error');
  });

  test('switch OFF: the cohort is byte-identical to the WhatsApp-only build, opens or no opens', async () => {
    const downloads = [
      download(),
      download({ user_id: T2, lesson_id: L2, asset_id: `asset-${L2}`, content_hash: `hash-${L2}`, segment_index: 2 }),
      download({ lesson_id: L2, asset_id: `asset-${L2}`, content_hash: `hash-${L2}`, segment_index: 2,
        created_at: pkt(NUDGE_DATE, 11, 0).toISOString() }),
    ];
    // built_at / created_at are wall-clock stamps of the build itself, not cohort content.
    const strip = (rows) => rows.map((r) => ({ ...r, created_at: null, context: { ...r.context, built_at: null } }));

    install({ niete_lp_downloads: downloads, niete_lp_opens: [] });
    await build();
    const before = JSON.stringify(strip(mockStore.rows));

    mockStore = makeStore();
    install({
      niete_lp_downloads: downloads,
      niete_lp_opens: [open({ plan_ref: L4 }), open({ user_id: T2, plan_ref: L1 })],
    });
    await build();
    expect(JSON.stringify(strip(mockStore.rows))).toBe(before);
  });

  test('one class, not two, for a teacher who took one lesson on WhatsApp and another in the app', async () => {
    install({
      niete_lp_downloads: [download()],
      niete_lp_opens: [open({ plan_ref: L2, opened_at: pkt(NUDGE_DATE, 8, 0).toISOString() })],
      app_settings: [SWITCH_ON],
    });
    await build();
    const { classes } = rowOf(T1).context;
    expect(classes.map((c) => c.key)).toEqual(['g4_math']);
    expect(classes[0].lessons.map((l) => l.lesson_id)).toEqual([L2, L1]);
    expect(Offer.classKey(classes[0].grade, classes[0].subject)).toBe('g4_math');
  });

  test('one lesson taken on both surfaces is ONE lesson, dated by the earliest; the WhatsApp row keeps its served version', async () => {
    install({
      niete_lp_downloads: [download({ version_stamp: 'v8-20260820', content_hash: 'hash-aug',
        asset_id: 'asset-aug', created_at: pkt(NUDGE_DATE, 11, 0).toISOString() })],
      niete_lp_opens: [open({ opened_at: pkt(NUDGE_DATE, 9, 0).toISOString() })],
      niete_lp_assets: [...ASSETS, asset(L1, { id: 'asset-aug', version_stamp: 'v8-20260820', content_hash: 'hash-aug', is_current: false })],
      niete_lp_asset_sources: [...ASSETS.map(source), { lesson_id: L1, version_stamp: 'v8-20260820', content_hash: 'hash-aug' }],
      app_settings: [SWITCH_ON],
    });
    await build();
    const { lessons } = rowOf(T1).context.classes[0];
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toEqual(expect.objectContaining({
      lesson_id: L1, asset_id: 'asset-aug', version_stamp: 'v8-20260820',
      delivered_at: pkt(NUDGE_DATE, 9, 0).toISOString(),
    }));
  });

  test('a version pushed between her open and the build does not replace the version she saw', async () => {
    // She opened L1 at 10:00 PKT while the 15 Sep render was current; a new render landed at
    // 12:00 PKT and superseded it. The quiz must come from what the app showed her at 10:00.
    const seen = asset(L1, { id: 'asset-seen', version_stamp: 'v9-20260915', content_hash: 'hash-seen',
      is_current: false, created_at: '2026-09-15T00:00:00Z', superseded_at: pkt(NUDGE_DATE, 12, 0).toISOString() });
    const pushed = asset(L1, { id: 'asset-pushed', version_stamp: 'v10-20260922', content_hash: 'hash-pushed',
      is_current: true, created_at: pkt(NUDGE_DATE, 12, 0).toISOString() });
    install({
      niete_lp_opens: [open({ opened_at: pkt(NUDGE_DATE, 10, 0).toISOString() })],
      niete_lp_assets: [seen, pushed],
      niete_lp_asset_sources: [source(seen), source(pushed)],
      app_settings: [SWITCH_ON],
    });
    await build();
    expect(rowOf(T1).context.classes[0].lessons[0]).toEqual(expect.objectContaining({
      asset_id: 'asset-seen', version_stamp: 'v9-20260915', content_hash: 'hash-seen',
    }));
  });

  test('an app open at 16:00 PKT counts for the NEXT school day, not today', async () => {
    install({
      niete_lp_opens: [open({ opened_at: pkt(NUDGE_DATE, 16, 0).toISOString() })],
      app_settings: [SWITCH_ON],
    });
    const today = await build(NUDGE_DATE);
    expect(today.inserted).toBe(0);
    expect(rowOf(T1)).toBeUndefined();

    const tomorrow = await build(NEXT_DAY);
    expect(tomorrow.inserted).toBe(1);
    expect(rowOf(T1).nudge_date).toBe(NEXT_DAY);
  });

  test('an assessment opened in the app is never a quiz source (no_lesson)', async () => {
    install({ niete_lp_opens: [open({ plan_ref: L_ASSESS })], app_settings: [SWITCH_ON] });
    const res = await build();
    expect(res.skipped).toEqual({ no_lesson: 1 });
  });

  test('an open whose lesson has only an answer key is never a quiz source', async () => {
    install({
      niete_lp_opens: [open({ plan_ref: L2 })],
      niete_lp_assets: [asset(L2, { id: 'key-1', asset_kind: 'answer_key' })],
      niete_lp_asset_sources: [source(asset(L2))],
      app_settings: [SWITCH_ON],
    });
    const res = await build();
    expect(res.inserted).toBe(0);
    expect(mockStore.rows.filter((r) => r.status === 'pending')).toHaveLength(0);
  });

  test('an external open (a link handed to another app) counts the same as the viewer', async () => {
    install({ niete_lp_opens: [open({ source: 'external' })], app_settings: [SWITCH_ON] });
    expect((await build()).inserted).toBe(1);
  });

  test('a 6-12 open is not a K-5 lesson', async () => {
    install({ niete_lp_opens: [open({ plan_kind: 'g612', plan_ref: 'seg-123' })], app_settings: [SWITCH_ON] });
    expect((await build()).inserted).toBe(0);
  });

  test('A/B group A: the app open resolves to the August version the app served', async () => {
    const august = asset(L4, { id: 'asset-l4-aug', version_stamp: 'v8-20260820', content_hash: 'hash-l4-aug', is_current: false });
    install({
      niete_lp_opens: [open({ plan_ref: L4 })],
      niete_lp_assets: [...ASSETS, august],
      niete_lp_asset_sources: [...ASSETS.map(source), source(august)],
      niete_lp_ab_assignment: [{ school_id: 'school-1', ab_group: 'A' }],
      app_settings: [SWITCH_ON, { key: 'ab_lp_ch310_enabled', value: true }],
    });
    await build();
    expect(rowOf(T1).context.classes[0].lessons[0]).toEqual(expect.objectContaining({
      lesson_id: L4, asset_id: 'asset-l4-aug', version_stamp: 'v8-20260820', content_hash: 'hash-l4-aug',
    }));
  });

  test('the build logs the per-surface mix for the watcher', async () => {
    install({
      niete_lp_downloads: [download({ user_id: T2 }), download()],
      niete_lp_opens: [open({ plan_ref: L2 })],
      app_settings: [SWITCH_ON],
    });
    await build();
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.cohort', expect.objectContaining({
      nudgeDate: NUDGE_DATE, wa: 1, app: 0, both: 1, teachers: 2, switch: true,
    }));
  });
});

describe('/quiz "from my lesson plan": a lesson taken in the app is listed (switch on)', () => {
  test('an app-opened lesson appears in the list, and its row opens', async () => {
    const o = open({ opened_at: new Date(Date.now() - 2 * 86400000).toISOString() });
    install({ niete_lp_opens: [o], app_settings: [SWITCH_ON] });
    const items = await Provider.list(T1);
    expect(items.map((i) => i.lessonId)).toEqual([L1]);
    expect(items[0]).toEqual(expect.objectContaining({
      grade: 4, subject: 'math', topic: TOPIC_L1, lessonRef: o.id,
      lesson: expect.objectContaining({ asset_id: `asset-${L1}`, version_stamp: 'v9-20260915' }),
    }));
    const got = await Provider.get(T1, o.id);
    expect(got && got.lessonId).toBe(L1);
    // Owner-filtered: another teacher cannot open her row.
    expect(await Provider.get(T2, o.id)).toBeNull();
  });

  test('switch OFF: the app-opened lesson is not listed', async () => {
    const o = open({ opened_at: new Date(Date.now() - 2 * 86400000).toISOString() });
    install({ niete_lp_opens: [o] });
    expect(await Provider.list(T1)).toEqual([]);
    expect(await Provider.get(T1, o.id)).toBeNull();
  });
});

describe('the A/B picker the reader shares with the app', () => {
  test('pickAsset: group A takes the newest August row (day-1 twin for a split day 2); others take the current row', () => {
    const rows = [
      asset('x_seg4', { id: 'cur', is_current: true, version_stamp: 'v9-20260915' }),
      asset('x_seg4', { id: 'aug-old', is_current: false, version_stamp: 'v8-20260801', created_at: '2026-08-01T00:00:00Z' }),
      asset('x_seg4', { id: 'aug-new', is_current: false, version_stamp: 'v8-20260820', created_at: '2026-08-20T00:00:00Z' }),
    ];
    expect(LpAb.pickAsset({ group: null, lessonId: 'x_seg4', assets: rows }).id).toBe('cur');
    expect(LpAb.pickAsset({ group: 'B', lessonId: 'x_seg4', assets: rows }).id).toBe('cur');
    expect(LpAb.pickAsset({ group: 'A', lessonId: 'x_seg4', assets: rows }).id).toBe('aug-new');
    expect(LpAb.pickAsset({ group: 'A', lessonId: 'x_seg4b', assets: rows }).id).toBe('aug-new');
    expect(LpAb.pickAsset({ group: 'A', lessonId: 'y_seg1', assets: rows })).toBeNull();
    expect(LpAb.pickAsset({ group: null, lessonId: 'x_seg4', assetKind: 'answer_key', assets: rows })).toBeNull();
  });

  test('pickAsset at a moment: the row current then, by created_at and superseded_at; group A ignores rows made later', () => {
    const rows = [
      asset('x_seg4', { id: 'old', is_current: false, version_stamp: 'v9-20260901', created_at: '2026-09-01T00:00:00Z', superseded_at: '2026-09-20T00:00:00Z' }),
      asset('x_seg4', { id: 'cur', is_current: true, version_stamp: 'v9-20260920', created_at: '2026-09-20T00:00:00Z' }),
      asset('x_seg4', { id: 'aug', is_current: false, version_stamp: 'v8-20260820', created_at: '2026-08-20T00:00:00Z', superseded_at: '2026-09-01T00:00:00Z' }),
      asset('x_seg4', { id: 'aug-late', is_current: false, version_stamp: 'v8u-20260825', created_at: '2026-09-25T00:00:00Z', superseded_at: '2026-09-25T00:00:00Z' }),
    ];
    const at = (iso) => ({ lessonId: 'x_seg4', assets: rows, at: iso });
    expect(LpAb.pickAsset({ group: null, ...at('2026-09-10T00:00:00Z') }).id).toBe('old');
    expect(LpAb.pickAsset({ group: 'B', ...at('2026-09-21T00:00:00Z') }).id).toBe('cur');
    expect(LpAb.pickAsset({ group: null, ...at('2026-08-25T00:00:00Z') }).id).toBe('aug');
    expect(LpAb.pickAsset({ group: 'A', ...at('2026-09-21T00:00:00Z') }).id).toBe('aug');
    // Nothing existed yet at that moment (clock skew): the row current now, never nothing.
    expect(LpAb.pickAsset({ group: null, ...at('2026-01-01T00:00:00Z') }).id).toBe('cur');
  });
});
