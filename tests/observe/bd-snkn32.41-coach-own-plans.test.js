'use strict';
/**
 * bd-snkn32.41 — a coach's Check and send lists the teacher's own "Make my own" plans beside the plans she
 * downloaded, and a picked one goes into the observation as its plan file (lesson_plan_r2_key, extraction
 * pending), exactly as an uploaded "Their own plan" does, so Section B is scored from it.
 */
const Own = require('../../bot/shared/services/observe/observe-own-plans');

const SVC = '../../bot/shared/services/observe/portal-observe.service';
const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const TEACHER_UID = '7eac0000-0000-4000-8000-000000000003';
const OWN_ID = '0e0e0000-0000-4000-8000-0000000000aa';
const KEY = `classroom_audio/${COACH}/2026-11/portal_abc123.webm`;
const URL = (k) => `https://r2.example/bucket/${k}`;
const ayesha = { teacher_ext_id: '923120004471', user_id: TEACHER_UID };

const summary = (over = {}) => ({
  ownId: OWN_ID, rootId: OWN_ID, lesson: 'grade_3_english_ch4_seg1', band: 'k5', status: 'ready', round: 0,
  createdAt: '2026-11-12T08:00:00Z', grade: 3, subject: 'english', chapter: '4', title: 'Describing words', ...over,
});

describe('observe-own-plans (pure)', () => {
  test('ownPick: only { ownId } with a uuid is an own pick; anything else is not one', () => {
    expect(Own.ownPick({ ownId: OWN_ID })).toEqual({ ownId: OWN_ID });
    expect(Own.ownPick({ ownId: 'x;drop' })).toEqual({ bad: true });
    expect(Own.ownPick({ ownId: OWN_ID, assetId: 'a' })).toEqual({ bad: true });
    expect(Own.ownPick({ assetId: 'a' })).toBeNull();
    expect(Own.ownPick(null)).toBeNull();
  });

  test('mergeRecent: newest first across both, own rows labelled, within the cap', () => {
    const dl = [
      { assetId: 'a1', topic: 'Fractions', downloadedAt: '2026-11-13T08:00:00Z' },
      { assetId: 'a2', topic: 'Old', downloadedAt: '2026-11-01T08:00:00Z' },
    ];
    const own = [Own.toPortalPlan(summary())];
    const out = Own.mergeRecent(dl, own, 2);
    expect(out.map((p) => p.assetId || p.ownId)).toEqual(['a1', OWN_ID]);
    expect(out[1]).toMatchObject({ own: true, ownId: OWN_ID, topic: 'Describing words', grade: 3, subject: 'english', chapterNumber: '4', madeAt: '2026-11-12T08:00:00Z' });
  });

  test('listForTeacher: her ready plans only (a plan still being written is left out)', async () => {
    const listRecent = jest.fn().mockResolvedValue([summary(), summary({ ownId: 'p2', status: 'generating' })]);
    const out = await Own.listForTeacher(TEACHER_UID, { listRecent });
    expect(listRecent).toHaveBeenCalledWith(TEACHER_UID);
    expect(out.map((p) => p.ownId)).toEqual([OWN_ID]);
  });

  test('resolveKey: her row, ready, by id → its PDF key; filters user_id + status', async () => {
    const filters = {};
    const q = {
      select: () => q, eq: (c, v) => { filters[c] = v; return q; },
      maybeSingle: async () => ({ data: { r2_key: 'lp612/own-k5/en/x/1.pdf' }, error: null }),
    };
    const supabase = { from: (t) => { filters.table = t; return q; } };
    expect(await Own.resolveKey({ userId: TEACHER_UID, ownId: OWN_ID }, { supabase })).toBe('lp612/own-k5/en/x/1.pdf');
    expect(filters).toEqual({ table: 'niete_lp612_own_plans', id: OWN_ID, user_id: TEACHER_UID, status: 'ready' });
  });

  test('resolveKey: no row → null', async () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
    expect(await Own.resolveKey({ userId: TEACHER_UID, ownId: OWN_ID }, { supabase: { from: () => q } })).toBeNull();
  });
});

// ── through portal-observe ──────────────────────────────────────────────────

function fakeSupabase() {
  const inserts = [];
  const from = (table) => {
    const t = { inserted: null };
    const self = {
      select: () => self, eq: () => self, limit: () => self, order: () => self, in: () => self,
      insert: (row) => { t.inserted = row; inserts.push({ table, row }); return self; },
      update: () => self,
      single: async () => ({ data: t.inserted ? { id: 'cs-1', ...t.inserted } : null, error: null }),
      maybeSingle: async () => ({
        data: table === 'users' ? { id: COACH, phone_number: '923333232533', role: 'coach', preferred_language: 'en' } : null,
        error: null,
      }),
      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return self;
  };
  return { from, inserts };
}

function deps(over = {}) {
  return {
    supabase: fakeSupabase(),
    r2: { headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 9_000_000 }), buildR2PublicUrl: URL },
    queue: { queueTranscription: jest.fn().mockResolvedValue('m1') },
    leaderSource: { resolveTeacher: jest.fn().mockResolvedValue(ayesha) },
    resolveOwner: jest.fn().mockResolvedValue(TEACHER_UID),
    schedule: { markDone: jest.fn().mockResolvedValue(true) },
    library: {
      resolveAsset: jest.fn(), readyRender: jest.fn(), link: jest.fn(),
      recent: jest.fn().mockResolvedValue([{ asset_id: 'a1', lesson_id: 'l1', topic: 'Fractions', grade: 4, created_at: '2026-11-13T09:00:00Z' }]),
    },
    ownPlans: {
      list: jest.fn().mockResolvedValue([Own.toPortalPlan(summary())]),
      resolveKey: jest.fn().mockResolvedValue('lp612/own-k5/en/grade_3_english_ch4_seg1/abc.pdf'),
    },
    rubric: { decideV6: jest.fn().mockResolvedValue(null), fdeOn: jest.fn().mockResolvedValue(false), createLessonForm: jest.fn() },
    log: jest.fn(),
    now: () => new Date('2026-11-13T10:00:00Z'),
    ...over,
  };
}

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

describe('teacherRecentPlans — her downloads and her own plans, one list', () => {
  test('her own plans are listed for the TEACHER, labelled own, newest first', async () => {
    const d = deps();
    const out = await Svc.teacherRecentPlans({ userId: COACH, teacherExtId: ayesha.teacher_ext_id }, d);
    expect(d.ownPlans.list).toHaveBeenCalledWith(TEACHER_UID);
    expect(out.status).toBe('ok');
    expect(out.plans.map((p) => p.assetId || p.ownId)).toEqual(['a1', OWN_ID]);
    expect(out.plans[1]).toMatchObject({ own: true, ownId: OWN_ID });
  });

  test('own plans failing to load leave her downloads (never an error)', async () => {
    const d = deps({ ownPlans: { list: jest.fn().mockRejectedValue(new Error('db')), resolveKey: jest.fn() } });
    const out = await Svc.teacherRecentPlans({ userId: COACH, teacherExtId: ayesha.teacher_ext_id }, d);
    expect(out.plans.map((p) => p.assetId)).toEqual(['a1']);
  });
});

describe('startPortalObservation — her own plan goes in as the plan file', () => {
  const start = (args, d) => Svc.startPortalObservation({ userId: COACH, teacherExtId: ayesha.teacher_ext_id, key: KEY, ...args }, d);

  test('{ ownId } → her PDF key on the row, extraction pending, like an uploaded plan', async () => {
    const d = deps();
    expect(await start({ lessonPlan: { ownId: OWN_ID } }, d)).toEqual({ status: 'ok', coachingSessionId: 'cs-1' });
    expect(d.ownPlans.resolveKey).toHaveBeenCalledWith({ userId: TEACHER_UID, ownId: OWN_ID });
    const row = d.supabase.inserts.find((w) => w.table === 'coaching_sessions').row;
    const key = 'lp612/own-k5/en/grade_3_english_ch4_seg1/abc.pdf';
    expect(row).toMatchObject({
      has_lesson_plan: true, lesson_plan_r2_key: key, lesson_plan_url: URL(key),
      lesson_plan_format: 'pdf', lesson_plan_extraction_status: 'pending',
    });
    expect(d.library.resolveAsset).not.toHaveBeenCalled();
    expect(d.library.link).not.toHaveBeenCalled();
  });

  test('not her plan, or not ready → plan_not_found, nothing written', async () => {
    const d = deps({ ownPlans: { list: jest.fn(), resolveKey: jest.fn().mockResolvedValue(null) } });
    expect(await start({ lessonPlan: { ownId: OWN_ID } }, d)).toEqual({ status: 'invalid', reason: 'plan_not_found' });
    expect(d.supabase.inserts).toHaveLength(0);
  });

  test('a bad own id is refused; an own plan with an uploaded one is two plans', async () => {
    expect(await start({ lessonPlan: { ownId: 'nope' } }, deps())).toEqual({ status: 'invalid', reason: 'bad_lesson_plan' });
    expect(await start({ lessonPlan: { ownId: OWN_ID }, lessonPlanKey: `lesson_plans/${COACH}/portal_p.pdf` }, deps()))
      .toEqual({ status: 'invalid', reason: 'two_lesson_plans' });
  });
});
