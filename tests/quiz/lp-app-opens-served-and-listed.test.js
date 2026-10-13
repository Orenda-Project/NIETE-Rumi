'use strict';
/**
 * A K-5 lesson plan read in the teacher app (lp-app-opens.store), beyond what
 * lp-quiz-app-open-counts.test.js already pins:
 *
 *  - the VERSION it resolves to is the one the app's Open served her. For a teacher whose
 *    school is in A/B group A, inside the ch3-8 scope, with the A/B flag on, that is the
 *    August version (lp-v8-browse lessonPdfUrl → lp-ab-ch310), as it existed when she opened
 *    it. Out of scope, group B, no group or flag off: the row current at the open, as before.
 *  - a download row carries grade as an integer; an app open must land in the SAME class.
 *  - the /quiz "from my lesson plan" list shows a lesson she read in the app, and its row opens.
 *  - the 15:00 build logs how many teachers came from each surface.
 *
 * The supabase stub really filters (helpers/filtering-chain); the catalogue, the source store,
 * the A/B picker and the app-opens store are the REAL modules.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

const NUDGE_DATE = '2026-09-22';          // Tuesday
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

// Real catalogue lessons (data/lp_catalog.json), grade 4 maths.
const L_IN = 'grade_4_math_ch4_seg1';      // chapter 4: inside the ch3-8 A/B scope
const L_IN2 = 'grade_4_math_ch4_seg2';
const L_OUT = 'grade_4_math_ch9_seg1';     // chapter 9: outside it
const TOPIC_IN = 'Divisibility rules for 2, 3, 5 and 10';

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
const Provider = require('../../bot/shared/services/quiz/lp-v8-lesson-provider');
const LpAb = require('../../bot/shared/services/lp-ab-ch310.service');

const pkt = (date, h, m = 0) => pktTime.atPkt(date, h, m);
const OPEN_AT = pkt(NUDGE_DATE, 10, 0).toISOString();

/** v9 render current since 15 Sep; an August version that was current before it. */
function versions(lessonId) {
  return [
    {
      id: `cur-${lessonId}`, lesson_id: lessonId, asset_kind: 'lesson', version_stamp: 'v9-20260915',
      content_hash: `h9-${lessonId}`, is_current: true, superseded_at: null, created_at: '2026-09-15T00:00:00Z',
    },
    {
      id: `aug-${lessonId}`, lesson_id: lessonId, asset_kind: 'lesson', version_stamp: 'v8-20260820T1000',
      content_hash: `h8-${lessonId}`, is_current: false, superseded_at: '2026-09-15T00:00:00Z',
      created_at: '2026-08-20T00:00:00Z',
    },
  ];
}
const sourceOf = (a) => ({ lesson_id: a.lesson_id, version_stamp: a.version_stamp, content_hash: a.content_hash });
const ASSETS = [...versions(L_IN), ...versions(L_IN2), ...versions(L_OUT)];

let n = 0;
function open(over = {}) {
  n += 1;
  return {
    id: `0000000${n % 10}-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    user_id: T1, plan_kind: 'k5', plan_ref: L_IN, lang: null, source: 'viewer',
    opened_at: OPEN_AT, created_at: OPEN_AT, ...over,
  };
}

function teacher(id) {
  return {
    id, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 'school-1', region: 'Sihala',
    phone_number: id === T1 ? '923001112222' : '923003334444', preferred_language: 'en',
    last_message_at: pkt(NUDGE_DATE, 10, 0).toISOString(),
  };
}

const AB_ON = { key: 'ab_lp_ch310_enabled', value: true };

function install(over = {}) {
  const db = makeSupabase({
    niete_lp_downloads: [],
    niete_lp_opens: [],
    niete_lp_assets: ASSETS,
    niete_lp_asset_sources: ASSETS.map(sourceOf),
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

const build = () => Offer.buildCohort({ nudgeDate: NUDGE_DATE, now: pkt(NUDGE_DATE, 15, 0) });
const lessonOf = (userId) => mockStore.rows.find((r) => r.user_id === userId).context.classes[0].lessons[0];

beforeEach(() => {
  jest.clearAllMocks();
  LpAb.__resetForTests();
  mockStore = makeStore();
  process.env.LP_QUIZ_OFFER_ENABLED = 'true';
  process.env.LP_QUIZ_OFFER_SEND_HOUR_PKT = '15';
  process.env.LP_QUIZ_OFFER_SEND_MINUTE_PKT = '0';
  process.env.LP_QUIZ_OFFER_CUTOFF_HOUR_PKT = '14';
  delete process.env.LP_QUIZ_OFFER_SECTORS;
  delete process.env.LP_QUIZ_COUNT_APP_OPENS;
});

describe('the version an app open resolves to = what the app served her', () => {
  const groupA = { niete_lp_ab_assignment: [{ school_id: 'school-1', ab_group: 'A' }], app_settings: [AB_ON] };

  test('group A, in scope (ch3-8), flag on: the August version', async () => {
    install({ niete_lp_opens: [open()], ...groupA });
    await build();
    expect(lessonOf(T1)).toEqual(expect.objectContaining({
      lesson_id: L_IN, asset_id: `aug-${L_IN}`, version_stamp: 'v8-20260820T1000', content_hash: `h8-${L_IN}`,
    }));
  });

  test('group A: an August row made AFTER her open is not the one she saw', async () => {
    const late = {
      id: `aug-late-${L_IN}`, lesson_id: L_IN, asset_kind: 'lesson', version_stamp: 'v8u-20260830',
      content_hash: 'h8-late', is_current: false, superseded_at: pkt(NUDGE_DATE, 12, 0).toISOString(),
      created_at: pkt(NUDGE_DATE, 12, 0).toISOString(),
    };
    install({
      niete_lp_opens: [open()], ...groupA,
      niete_lp_assets: [...ASSETS, late], niete_lp_asset_sources: [...ASSETS, late].map(sourceOf),
    });
    await build();
    expect(lessonOf(T1).asset_id).toBe(`aug-${L_IN}`);
  });

  test('group A, OUT of scope (ch9): the row current at the open, as today', async () => {
    install({ niete_lp_opens: [open({ plan_ref: L_OUT })], ...groupA });
    await build();
    expect(lessonOf(T1).asset_id).toBe(`cur-${L_OUT}`);
  });

  test('group B, in scope: the row current at the open', async () => {
    install({
      niete_lp_opens: [open()],
      niete_lp_ab_assignment: [{ school_id: 'school-1', ab_group: 'B' }], app_settings: [AB_ON],
    });
    await build();
    expect(lessonOf(T1).asset_id).toBe(`cur-${L_IN}`);
  });

  test('group A but the A/B flag off: the row current at the open', async () => {
    install({ niete_lp_opens: [open()], niete_lp_ab_assignment: [{ school_id: 'school-1', ab_group: 'A' }] });
    await build();
    expect(lessonOf(T1).asset_id).toBe(`cur-${L_IN}`);
  });
});

describe('the 15:00 cohort', () => {
  test('a WhatsApp row (grade stored as an integer) and an app open of the same grade/subject are ONE class', async () => {
    install({
      niete_lp_downloads: [{
        id: 'd-1', user_id: T1, lesson_id: L_IN2, asset_id: `cur-${L_IN2}`, version_stamp: 'v9-20260915',
        content_hash: `h9-${L_IN2}`, grade: 4, subject: 'math', chapter_number: 4, segment_index: 2,
        status: 'sent', created_at: pkt(NUDGE_DATE, 11, 0).toISOString(),
      }],
      niete_lp_opens: [open()],
    });
    await build();
    const { classes } = mockStore.rows.find((r) => r.user_id === T1).context;
    expect(classes.map((c) => c.key)).toEqual(['g4_math']);
    expect(classes[0].lessons.map((l) => l.lesson_id).sort()).toEqual([L_IN, L_IN2]);
  });

  test('logs how many teachers took their lessons on each surface', async () => {
    install({
      niete_lp_downloads: [{
        id: 'd-2', user_id: T2, lesson_id: L_IN2, asset_id: `cur-${L_IN2}`, version_stamp: 'v9-20260915',
        content_hash: `h9-${L_IN2}`, grade: 4, subject: 'math', chapter_number: 4, segment_index: 2,
        status: 'sent', created_at: pkt(NUDGE_DATE, 11, 0).toISOString(),
      }, {
        id: 'd-3', user_id: T1, lesson_id: L_IN2, asset_id: `cur-${L_IN2}`, version_stamp: 'v9-20260915',
        content_hash: `h9-${L_IN2}`, grade: 4, subject: 'math', chapter_number: 4, segment_index: 2,
        status: 'sent', created_at: pkt(NUDGE_DATE, 11, 0).toISOString(),
      }],
      niete_lp_opens: [open()],
    });
    await build();
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.cohort', {
      nudgeDate: NUDGE_DATE, wa: 1, app: 0, both: 1, teachers: 2, switch: true,
    });
  });

  test('the surface line says switch:false and counts no app teacher when app opens are off', async () => {
    process.env.LP_QUIZ_COUNT_APP_OPENS = 'off';
    install({ niete_lp_opens: [open()] });
    await build();
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.cohort', {
      nudgeDate: NUDGE_DATE, wa: 0, app: 0, both: 0, teachers: 0, switch: false,
    });
  });
});

describe('/quiz "from my lesson plan"', () => {
  const recent = () => new Date(Date.now() - 2 * 86400000).toISOString();

  test('lists a lesson she read in the app, and its row opens (owner-filtered)', async () => {
    const o = open({ opened_at: recent() });
    install({ niete_lp_opens: [o] });
    const items = await Provider.list(T1);
    expect(items.map((i) => i.lessonId)).toEqual([L_IN]);
    expect(items[0]).toEqual(expect.objectContaining({
      lessonRef: o.id, subject: 'math', topic: TOPIC_IN,
      lesson: expect.objectContaining({ asset_id: `cur-${L_IN}`, version_stamp: 'v9-20260915' }),
    }));
    expect(Offer.classKey(items[0].grade, items[0].subject)).toBe('g4_math');
    const got = await Provider.get(T1, o.id);
    expect(got && got.lessonId).toBe(L_IN);
    expect(await Provider.get(T2, o.id)).toBeNull();
  });

  test('a group-A teacher\'s app lesson is listed with the August version she read', async () => {
    install({
      niete_lp_opens: [open({ opened_at: recent() })],
      niete_lp_ab_assignment: [{ school_id: 'school-1', ab_group: 'A' }], app_settings: [AB_ON],
    });
    const [item] = await Provider.list(T1);
    expect(item.lesson.asset_id).toBe(`aug-${L_IN}`);
  });

  test('a link minted for another app (external) is not listed; nor is anything with app opens off', async () => {
    install({ niete_lp_opens: [open({ opened_at: recent(), source: 'external' })] });
    expect(await Provider.list(T1)).toEqual([]);

    const o = open({ opened_at: recent() });
    install({ niete_lp_opens: [o] });
    process.env.LP_QUIZ_COUNT_APP_OPENS = 'off';
    expect(await Provider.list(T1)).toEqual([]);
    expect(await Provider.get(T1, o.id)).toBeNull();
  });

  test('a lesson taken both ways is listed once', async () => {
    const o = open({ opened_at: recent() });
    install({
      niete_lp_opens: [o],
      niete_lp_downloads: [{
        id: 'dl-1', user_id: T1, lesson_id: L_IN, asset_id: `cur-${L_IN}`, version_stamp: 'v9-20260915',
        content_hash: `h9-${L_IN}`, grade: 4, subject: 'math', status: 'sent', created_at: recent(),
      }],
    });
    const items = await Provider.list(T1);
    expect(items.map((i) => i.lessonId)).toEqual([L_IN]);
  });
});

describe('lp-ab-ch310 pickAsset', () => {
  const rows = [
    { id: 'cur', lesson_id: 'x_seg4', asset_kind: 'lesson', is_current: true, superseded_at: null, version_stamp: 'v9-20260920', created_at: '2026-09-20T00:00:00Z' },
    { id: 'old', lesson_id: 'x_seg4', asset_kind: 'lesson', is_current: false, superseded_at: '2026-09-20T00:00:00Z', version_stamp: 'v9-20260901', created_at: '2026-09-01T00:00:00Z' },
    { id: 'aug', lesson_id: 'x_seg4', asset_kind: 'lesson', is_current: false, superseded_at: '2026-09-01T00:00:00Z', version_stamp: 'v8-20260820', created_at: '2026-08-20T00:00:00Z' },
    { id: 'aug-old', lesson_id: 'x_seg4', asset_kind: 'lesson', is_current: false, superseded_at: '2026-08-20T00:00:00Z', version_stamp: 'v8-20260801', created_at: '2026-08-01T00:00:00Z' },
  ];
  const at = (iso) => ({ lessonId: 'x_seg4', assets: rows, at: iso });

  test('without a moment: A → newest August (day-1 twin for a split day 2), else current', () => {
    expect(LpAb.pickAsset({ group: null, lessonId: 'x_seg4', assets: rows }).id).toBe('cur');
    expect(LpAb.pickAsset({ group: 'A', lessonId: 'x_seg4', assets: rows }).id).toBe('aug');
    expect(LpAb.pickAsset({ group: 'A', lessonId: 'x_seg4b', assets: rows }).id).toBe('aug');
    expect(LpAb.pickAsset({ group: 'A', lessonId: 'y_seg1', assets: rows })).toBeNull();
    expect(LpAb.pickAsset({ group: null, lessonId: 'x_seg4', assetKind: 'answer_key', assets: rows })).toBeNull();
  });

  test('at a moment: the row current then; A only considers August rows that existed then', () => {
    expect(LpAb.pickAsset({ group: null, ...at('2026-09-10T00:00:00Z') }).id).toBe('old');
    expect(LpAb.pickAsset({ group: 'B', ...at('2026-09-21T00:00:00Z') }).id).toBe('cur');
    expect(LpAb.pickAsset({ group: 'A', ...at('2026-08-10T00:00:00Z') }).id).toBe('aug-old');
    expect(LpAb.pickAsset({ group: 'A', ...at('2026-09-21T00:00:00Z') }).id).toBe('aug');
    // Nothing existed at that moment (clock skew): today's rule, never nothing.
    expect(LpAb.pickAsset({ group: null, ...at('2026-01-01T00:00:00Z') }).id).toBe('cur');
  });
});
