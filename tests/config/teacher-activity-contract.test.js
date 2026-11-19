'use strict';
/**
 * The teacher activity store's contract (docs/teacher-activity-store.md): key names, TTL, kinds, and the shape check
 * the twice-a-day writer and the portal reader both run. Pure: no Redis, no database.
 */
const C = require('../../bot/shared/config/teacher-activity-contract');

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const UID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';

function teacher(over = {}) {
  return {
    updated_at: '2026-11-19T09:30:00.000Z',
    slot: 'day',
    tiles: {
      plans_opened: { now: 14, prev: 9 },
      taught: { now: 3, prev: 1 },
      coached: { now: 2, prev: 2 },
      quizzes: { now: 4, prev: 0 },
      exams: { now: 1, prev: 0 },
    },
    trend: [{
      indicator_id: 'D3',
      indicator_name: 'Checks for understanding',
      framework: 'fico17-v6',
      points: [
        { session_id: 's1', at: '2026-10-01T08:00:00.000Z', band: 'average' },
        { session_id: 's2', at: '2026-11-01T08:00:00.000Z', band: 'good' },
      ],
    }],
    tip: { session_id: 's2', text: 'Ask two children to explain.', at: '2026-11-01T08:00:00.000Z' },
    journey: [
      { kind: 'taught', at: '2026-11-18T08:00:00.000Z', ref_id: 'fb1', meta: { grade: 3, subject: 'math' } },
      { kind: 'plan_opened', at: '2026-11-17T08:00:00.000Z', ref_id: 'L03', meta: { plan_kind: 'k5' } },
    ],
    furthest_step: 'taught',
    grade_band: 'k5',
    ...over,
  };
}

const team = (over = {}) => ({
  updated_at: '2026-11-18T20:30:00.000Z',
  window_days: 30,
  steps: { none: { count: 1, user_ids: ['u1'] }, plan_opened: { count: 2, user_ids: ['u2', 'u3'] } },
  ...over,
});

describe('keys and constants', () => {
  test('key names and TTL', () => {
    expect(C.teacherActivityKey(UID)).toBe(`teacher_activity:v1:${UID}`);
    expect(C.TEAM_ACTIVITY_KEY).toBe('teacher_activity:v1:team');
    expect(C.runMarkerKey('2026-11-19', 'day')).toBe('teacher_activity:v1:run:2026-11-19:day');
    expect(C.runMarkerKey('2026-11-19', 'night')).toBe('teacher_activity:v1:run:2026-11-19:night');
    expect(C.TTL_SECONDS).toBe(36 * 3600);
  });
  test('a key is only made from a real id, date and slot', () => {
    for (const bad of [null, '', 'a:b', 'x y', 5, 'team', 'run']) expect(C.teacherActivityKey(bad)).toBe(null);
    expect(C.runMarkerKey('19-11-2026', 'day')).toBe(null);
    expect(C.runMarkerKey('2026-11-19', 'noon')).toBe(null);
  });
  test('kinds, the ladder and the band keys', () => {
    expect(C.JOURNEY_KINDS).toEqual(['plan_opened', 'taught', 'coached', 'report', 'tip', 'quiz', 'exam']);
    expect(C.LADDER).toEqual(['plan_opened', 'taught', 'coached', 'report', 'quiz']);
    expect(C.TEAM_STEPS).toEqual(['none', ...C.LADDER]);
    expect(C.TILE_KEYS).toEqual(['plans_opened', 'taught', 'coached', 'quizzes', 'exams']);
    expect(C.BAND_KEYS).toEqual(['excellent', 'good', 'average', 'below_average', 'needs_support']);
  });
});

describe('checkTeacherActivity', () => {
  test('a well-formed value passes, as itself', () => {
    const v = teacher();
    expect(C.checkTeacherActivity(v, NOW)).toEqual(v);
  });
  test('empty is fine: no trend, no tip, no journey, no furthest step, no grade band', () => {
    const v = teacher({ trend: [], tip: null, journey: [], furthest_step: null, grade_band: null });
    expect(C.checkTeacherActivity(v, NOW)).toEqual(v);
  });
  test('a journey longer than the cap is cut to the newest 200', () => {
    const step = { kind: 'plan_opened', at: '2026-11-17T08:00:00.000Z', ref_id: 'L', meta: {} };
    const out = C.checkTeacherActivity(teacher({ journey: Array(250).fill(step) }), NOW);
    expect(out.journey).toHaveLength(200);
  });
  test('older than 36 hours, or from the future beyond a minute → null', () => {
    expect(C.checkTeacherActivity(teacher({ updated_at: '2026-11-17T23:59:00.000Z' }), NOW)).toBe(null);
    expect(C.checkTeacherActivity(teacher({ updated_at: '2026-11-19T12:05:00.000Z' }), NOW)).toBe(null);
  });
  const BAD = {
    'not an object': null,
    'no updated_at': teacher({ updated_at: undefined }),
    'bad slot': teacher({ slot: 'noon' }),
    'a missing tile': teacher({ tiles: { ...teacher().tiles, exams: undefined } }),
    'a negative count': teacher({ tiles: { ...teacher().tiles, taught: { now: -1, prev: 0 } } }),
    'a fractional count': teacher({ tiles: { ...teacher().tiles, taught: { now: 1.5, prev: 0 } } }),
    'three trend lines': teacher({ trend: [teacher().trend[0], teacher().trend[0], teacher().trend[0]] }),
    'a trend with one point': teacher({ trend: [{ ...teacher().trend[0], points: [teacher().trend[0].points[0]] }] }),
    'a raw mark as band': teacher({ trend: [{ ...teacher().trend[0], points: [{ session_id: 's', at: 'x', band: 72 }, teacher().trend[0].points[1]] }] }),
    'an unknown band': teacher({ trend: [{ ...teacher().trend[0], points: [{ session_id: 's', at: '2026-10-01T08:00:00.000Z', band: 'great' }, teacher().trend[0].points[1]] }] }),
    'a tip with no text': teacher({ tip: { session_id: 's', text: '', at: '2026-11-01T08:00:00.000Z' } }),
    'an unknown journey kind': teacher({ journey: [{ kind: 'visited', at: '2026-11-17T08:00:00.000Z', ref_id: 'x', meta: {} }] }),
    'a journey meta that is a list': teacher({ journey: [{ kind: 'quiz', at: '2026-11-17T08:00:00.000Z', ref_id: 'x', meta: [] }] }),
    'a tip as furthest step': teacher({ furthest_step: 'tip' }),
    'a bad grade band': teacher({ grade_band: 'g13' }),
  };
  test.each(Object.entries(BAD))('%s → null', (_name, v) => {
    expect(C.checkTeacherActivity(v, NOW)).toBe(null);
  });
});

describe('checkTeamActivity', () => {
  test('a well-formed value passes; unknown steps are dropped', () => {
    expect(C.checkTeamActivity(team(), NOW)).toEqual(team());
    const withExtra = team({ steps: { ...team().steps, later_rung: { count: 1, user_ids: ['x'] } } });
    expect(C.checkTeamActivity(withExtra, NOW)).toEqual(team());
  });
  test('stale, a bad count, ids that are not strings, a count that disagrees with the ids, or no steps → null', () => {
    expect(C.checkTeamActivity(team({ updated_at: '2026-11-17T00:00:00.000Z' }), NOW)).toBe(null);
    expect(C.checkTeamActivity(team({ steps: { none: { count: -1, user_ids: [] } } }), NOW)).toBe(null);
    expect(C.checkTeamActivity(team({ steps: { none: { count: 1, user_ids: [7] } } }), NOW)).toBe(null);
    expect(C.checkTeamActivity(team({ steps: { none: { count: 2, user_ids: ['a'] } } }), NOW)).toBe(null);
    expect(C.checkTeamActivity(team({ steps: null }), NOW)).toBe(null);
    expect(C.checkTeamActivity(team({ window_days: '30' }), NOW)).toBe(null);
  });
});
