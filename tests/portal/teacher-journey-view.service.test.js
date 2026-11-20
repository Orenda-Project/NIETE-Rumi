'use strict';
/**
 * dashboard/services/teacher-journey-view.service.js — pure: the stored activity values (docs/teacher-activity-store.md)
 * → what My journey and the team view answer. No Redis, no database.
 *   journeySteps   her stored steps for the page (camelCase, newest first, as stored)
 *   inScope        an analytics account sees its own organization's teachers; the default organization also keeps
 *                  the teachers no region places (analyticsScope.keepsUnplaced)
 *   teamView       Primary teachers in scope (and in one region when asked): per rung, reached (this rung or later)
 *                  and stopped (exactly here), and the largest drop between neighbouring rungs
 *   stoppedAt      the teachers who stopped at one rung, oldest last step first
 */
const V = require('../../dashboard/services/teacher-journey-view.service');

const FDE = { organization: 'niete', regions: ['B.K', 'Sihala'], keepsUnplaced: true };
const GB = { organization: 'moawin', regions: ['Gilgit-Baltistan'], keepsUnplaced: false };
const who = (org, region, furthest, over = {}) => ({
  org, region, band: 'k5', name: `${furthest} Testwala`, school: 'Test School', furthest,
  last_kind: furthest === 'none' ? null : furthest, last_at: furthest === 'none' ? null : '2026-11-10T08:00:00.000Z', ...over,
});
const team = {
  updated_at: '2026-11-19T09:30:00.000Z', window_days: 30, steps: {},
  teachers: {
    a: who('niete', 'Sihala', 'quiz', { last_at: '2026-11-12T08:00:00.000Z' }),
    b: who('niete', 'B.K', 'quiz', { last_at: '2026-11-02T08:00:00.000Z' }),
    c: who('niete', 'Sihala', 'plan_opened'),
    d: who('niete', 'Sihala', 'none'),
    e: who(null, null, 'taught'),
    f: who('moawin', 'Gilgit-Baltistan', 'coached'),
    g: who('niete', 'Sihala', 'report', { band: 'g612' }),
  },
};

test('journeySteps: the stored steps, camelCased, nothing added', () => {
  const value = { journey: [{ kind: 'quiz', at: '2026-11-10T08:00:00.000Z', ref_id: 'q1', meta: { played: 3 } }] };
  expect(V.journeySteps(value)).toEqual([{ kind: 'quiz', at: '2026-11-10T08:00:00.000Z', refId: 'q1', meta: { played: 3 } }]);
  expect(V.journeySteps(null)).toEqual([]);
});

test('inScope: own organization; unplaced only for the default organization', () => {
  expect(V.inScope(team.teachers.a, FDE)).toBe(true);
  expect(V.inScope(team.teachers.e, FDE)).toBe(true);
  expect(V.inScope(team.teachers.f, FDE)).toBe(false);
  expect(V.inScope(team.teachers.f, GB)).toBe(true);
  expect(V.inScope(team.teachers.e, GB)).toBe(false);
  expect(V.inScope(undefined, FDE)).toBe(false);
});

test('teamView: Primary only, reached = this rung or later, stopped = exactly here; the largest drop named', () => {
  const v = V.teamView(team, FDE);
  expect(v.tracked).toBe(5); // a b c d e — not f (other organization), not g (grades 6-12)
  expect(v.steps).toEqual([
    { step: 'none', reached: 5, stopped: 1 },
    { step: 'plan_opened', reached: 4, stopped: 1 },
    { step: 'taught', reached: 3, stopped: 1 },
    { step: 'coached', reached: 2, stopped: 0 },
    { step: 'report', reached: 2, stopped: 0 },
    { step: 'quiz', reached: 2, stopped: 2 },
  ]);
  expect(v.largestDrop).toBe('plan_opened');
  // reached of each rung = the sum of "stopped" from that rung down the list
  v.steps.forEach((s, i) => expect(s.reached).toBe(v.steps.slice(i).reduce((n, x) => n + x.stopped, 0)));
});

test('teamView in one region; another organization sees only its own', () => {
  expect(V.teamView(team, FDE, { region: 'B.K' }).tracked).toBe(1);
  expect(V.teamView(team, GB).tracked).toBe(1);
  expect(V.teamView({ ...team, teachers: undefined }, FDE).tracked).toBe(0);
});

test('stoppedAt: oldest last step first, ids, names and schools; an unknown rung is empty', () => {
  expect(V.stoppedAt(team, FDE, 'quiz')).toEqual([
    { id: 'b', name: 'quiz Testwala', school: 'Test School', lastKind: 'quiz', lastAt: '2026-11-02T08:00:00.000Z' },
    { id: 'a', name: 'quiz Testwala', school: 'Test School', lastKind: 'quiz', lastAt: '2026-11-12T08:00:00.000Z' },
  ]);
  expect(V.stoppedAt(team, GB, 'quiz')).toEqual([]);
  expect(V.stoppedAt(team, FDE, 'tip')).toEqual([]);
});

test('parseRegion: blank or all = every region of the view; one of its regions; anything else is refused', () => {
  expect(V.parseRegion(FDE, undefined)).toEqual({ ok: true, region: null });
  expect(V.parseRegion(FDE, 'all')).toEqual({ ok: true, region: null });
  expect(V.parseRegion(FDE, 'sihala')).toEqual({ ok: true, region: 'Sihala' });
  expect(V.parseRegion(FDE, 'Gilgit-Baltistan')).toEqual({ ok: false });
});
