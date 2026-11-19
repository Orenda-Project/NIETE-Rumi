'use strict';
/**
 * The pure shaper of the twice-a-day teacher activity job (bot/shared/services/teacher-activity/teacher-journey.service.js):
 * one teacher_activity_batch row → the stored per-teacher value (docs/teacher-activity-store.md), and the shaped values →
 * the team summary. No Redis, no database: every input is a plain object.
 */
const J = require('../../bot/shared/services/teacher-activity/teacher-journey.service');
const C = require('../../bot/shared/config/teacher-activity-contract');

// 19 Nov 2026, 14:30 Pakistan time (09:30 UTC). The 30-day window starts 21 Oct 00:00 PKT = 20 Oct 19:00 UTC.
const NOW = Date.parse('2026-11-19T09:30:00.000Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();
const UID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const UID2 = '1b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';

const tiles = () => ({
  plans_opened: { now: 2, prev: 1 }, taught: { now: 1, prev: 0 }, coached: { now: 1, prev: 2 },
  quizzes: { now: 0, prev: 0 }, exams: { now: 0, prev: 1 },
});
const ind = (id, score, name = `Indicator ${id}`) => ({ id, name, score });
const report = (sid, days, indicators, framework = 'fico') => ({ session_id: sid, at: ago(days), framework, indicators });
const row = (over = {}) => ({ user_id: UID, tiles: tiles(), journey: [], reports: [], latest: null, ...over });
const shape = (over, opts = {}) => J.shapeTeacher(row(over), { now: NOW, slot: 'day', teacher: { level: ['PRIMARY'] }, ...opts });

describe('windowStart', () => {
  test('the 30-day window starts at Pakistan midnight 29 days before today', () => {
    expect(new Date(J.windowStart(NOW, 30)).toISOString()).toBe('2026-10-20T19:00:00.000Z');
    expect(new Date(J.windowStart(NOW, 1)).toISOString()).toBe('2026-11-18T19:00:00.000Z');
  });
});

describe('shapeTeacher', () => {
  test('passes the contract check, carries the tiles, slot and time', () => {
    const v = shape({});
    expect(C.checkTeacherActivity(v, NOW)).toEqual(v);
    expect(v).toMatchObject({ slot: 'day', updated_at: new Date(NOW).toISOString(), tiles: tiles(), trend: [], tip: null, journey: [], furthest_step: null });
  });

  test('bad tiles, a missing tile or a bad slot → null (the previous value stays)', () => {
    expect(shape({ tiles: { ...tiles(), taught: { now: -1, prev: 0 } } })).toBeNull();
    expect(shape({ tiles: { plans_opened: { now: 1, prev: 1 } } })).toBeNull();
    expect(shape({}, { slot: 'noon' })).toBeNull();
    expect(J.shapeTeacher(null, { now: NOW, slot: 'day' })).toBeNull();
  });

  test('journey: newest first, times as ISO, a report keeps a band not its mark, a plan gets its grade and subject', () => {
    const v = shape({ journey: [
      { kind: 'plan_opened', at: '2026-11-10T10:00:00+05:00', ref_id: 'grade_3_math_ch2_seg1', meta: { plan_kind: 'k5', via: 'portal' } },
      { kind: 'report', at: ago(1), ref_id: 's1', meta: { topic: 'Fractions', pct: 72.4, opened_at: ago(0.5) } },
      { kind: 'plan_opened', at: ago(3), ref_id: 'grade_7_general_science.c03.p033-034', meta: { plan_kind: 'g612', via: 'whatsapp' } },
      { kind: 'visited', at: ago(2), ref_id: 'x', meta: {} },
      { kind: 'quiz', at: 'not a time', ref_id: 'q', meta: {} },
    ] });
    expect(v.journey.map((s) => s.kind)).toEqual(['report', 'plan_opened', 'plan_opened']);
    expect(v.journey[0].meta).toEqual({ topic: 'Fractions', band: 'good', opened_at: ago(0.5) });
    expect(v.journey[1].meta).toEqual({ plan_kind: 'g612', via: 'whatsapp', grade: 7, subject: 'general_science' });
    expect(v.journey[2]).toEqual({ kind: 'plan_opened', at: '2026-11-10T05:00:00.000Z', ref_id: 'grade_3_math_ch2_seg1', meta: { plan_kind: 'k5', via: 'portal', grade: 3, subject: 'math' } });
    expect(JSON.stringify(v)).not.toContain('pct');
  });

  test('the journey is capped at the contract maximum', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ kind: 'quiz', at: ago(i / 10), ref_id: `q${i}`, meta: {} }));
    expect(shape({ journey: many }).journey).toHaveLength(C.MAX_JOURNEY);
  });

  test('tip: the latest report\'s text, else none', () => {
    expect(shape({ latest: { session_id: 's9', at: ago(2), tip: ' Ask two children why. ' } }).tip)
      .toEqual({ session_id: 's9', text: 'Ask two children why.', at: ago(2) });
    expect(shape({ latest: { session_id: 's9', at: ago(2), tip: null } }).tip).toBeNull();
    expect(shape({ latest: { session_id: 's9', at: ago(2), tip: '  ' } }).tip).toBeNull();
  });

  test('grade band from her level, else her registration grades, else none', () => {
    expect(shape({}, { teacher: { level: ['PRIMARY', 'MIDDLE'] } }).grade_band).toBe('k5');
    expect(shape({}, { teacher: { level: ['HIGH'] } }).grade_band).toBe('g612');
    expect(shape({}, { teacher: { level: null, grades: '["grade_2","grade_7"]' } }).grade_band).toBe('k5');
    expect(shape({}, { teacher: { level: null, grades: '["grade_8"]' } }).grade_band).toBe('g612');
    expect(shape({}, { teacher: { level: [], grades: 'not json' } }).grade_band).toBeNull();
    expect(shape({}, { teacher: undefined }).grade_band).toBeNull();
  });
});

describe('furthest step (last 30 days)', () => {
  const step = (kind, days, meta = {}) => ({ kind, at: ago(days), ref_id: `${kind}${days}`, meta });
  test.each([
    ['nothing', [], null],
    ['a plan', [step('plan_opened', 3)], 'plan_opened'],
    ['a plan and a quiz', [step('plan_opened', 3), step('quiz', 5)], 'quiz'],
    ['an unopened report stops at coached', [step('coached', 3), step('report', 3, { pct: 50 })], 'coached'],
    ['an opened report', [step('coached', 3), step('report', 3, { pct: 50, opened_at: ago(2) })], 'report'],
    ['a report opened 40 days ago', [step('report', 45, { pct: 50, opened_at: ago(40) })], null],
    ['a step older than 30 days', [step('quiz', 31)], null],
    ['tips and papers are not rungs', [step('tip', 1, { text: 'x' }), step('exam', 1)], null],
  ])('%s → %s', (_n, journey, want) => {
    expect(shape({ journey }).furthest_step).toBe(want);
  });
});

describe('trend (bands only, ≥ 2 reports of one framework)', () => {
  test('line 1 = the indicator that rose most, line 2 = the lowest in the latest report; points oldest first', () => {
    const v = shape({ reports: [
      report('s2', 5, [ind('D1', 2, 'Reasoning'), ind('D2', 0, 'Questions'), ind('D3', 1), ind('D4', 2)]),
      report('s1', 20, [ind('D1', 0, 'Reasoning'), ind('D2', 0, 'Questions'), ind('D3', 1), ind('D4', 1)]),
    ] });
    expect(v.trend).toEqual([
      { indicator_id: 'D1', indicator_name: 'Reasoning', framework: 'fico', points: [
        { session_id: 's1', at: ago(20), band: 'needs_support' }, { session_id: 's2', at: ago(5), band: 'excellent' }] },
      { indicator_id: 'D2', indicator_name: 'Questions', framework: 'fico', points: [
        { session_id: 's1', at: ago(20), band: 'needs_support' }, { session_id: 's2', at: ago(5), band: 'needs_support' }] },
    ]);
  });

  test('none rose → line 1 is her best band', () => {
    const v = shape({ reports: [report('s2', 5, [ind('D1', 1), ind('D2', 2)]), report('s1', 9, [ind('D1', 1), ind('D2', 2)])] });
    expect(v.trend.map((t) => t.indicator_id)).toEqual(['D2', 'D1']);
  });

  test('compares with her previous report of the SAME framework', () => {
    const v = shape({ reports: [
      report('s3', 2, [ind('D1', 2)]), report('h', 4, [ind('D1', 0)], 'hots'), report('s1', 9, [ind('D1', 1)]),
    ] });
    expect(v.trend[0].points.map((p) => p.session_id)).toEqual(['s1', 's3']);
  });

  test.each([
    ['one report', [report('s1', 2, [ind('D1', 2)])]],
    ['two of different frameworks', [report('s1', 2, [ind('D1', 2)]), report('s0', 5, [ind('D1', 1)], 'hots')]],
    ['an unknown framework', [report('s1', 2, [ind('D1', 2)], 'oecd'), report('s0', 5, [ind('D1', 1)], 'oecd')]],
    ['scores out of range', [report('s1', 2, [ind('D1', 3)]), report('s0', 5, [ind('D1', 3)])]],
    ['no shared indicator', [report('s1', 2, [ind('D1', 2)]), report('s0', 5, [ind('D2', 1)])]],
    ['an indicator with no name', [report('s1', 2, [ind('D1', 2, '')]), report('s0', 5, [ind('D1', 1, '')])]],
  ])('%s → no trend', (_n, reports) => {
    expect(shape({ reports }).trend).toEqual([]);
  });
});

describe('buildTeam', () => {
  const value = (furthest, lastDays, band = 'k5') => ({
    ...shape({}), furthest_step: furthest, grade_band: band,
    journey: lastDays === null ? [] : [{ kind: 'quiz', at: ago(lastDays), ref_id: 'q', meta: {} }],
  });
  const who = { org: 'niete', region: 'Sihala', name: 'Test Teacherwala', school: 'Test School' };

  test('counts each teacher once at her furthest step, ids oldest last step first, with the roster', () => {
    const t = J.buildTeam([
      { userId: UID, value: value('quiz', 2), who },
      { userId: UID2, value: value('quiz', 9), who: { ...who, org: 'moawin', region: null } },
      { userId: 'c', value: value(null, null), who },
    ], { now: NOW });
    expect(C.checkTeamActivity(t, NOW)).toEqual(t);
    expect(t.window_days).toBe(30);
    expect(t.steps.quiz).toEqual({ count: 2, user_ids: [UID2, UID] });
    expect(t.steps.none).toEqual({ count: 1, user_ids: ['c'] });
    expect(t.steps.taught).toEqual({ count: 0, user_ids: [] });
    expect(t.teachers[UID2]).toEqual({ org: 'moawin', region: null, band: 'k5', name: 'Test Teacherwala', school: 'Test School', furthest: 'quiz', last_kind: 'quiz', last_at: ago(9) });
    expect(t.teachers.c).toMatchObject({ furthest: 'none', last_kind: null, last_at: null });
  });

  test('no teachers → an empty but valid summary', () => {
    const t = J.buildTeam([], { now: NOW });
    expect(C.checkTeamActivity(t, NOW)).toEqual(t);
    expect(t.steps.none.count).toBe(0);
  });
});
