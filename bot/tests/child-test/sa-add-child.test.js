'use strict';

/**
 * "Add a child" on the coach's list (app_settings sa_add_child, default OFF). ON: a first name, the grade and an
 * optional section seat one more child on the coach's open list at a school linked to them (draw.addChild), under the
 * phone's own id for the child. OFF, an unlinked school, a bad name / grade / section / id: refused, nothing drawn.
 * The name never reaches a log line.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL = 'bbbbbbbb-0000-4000-8000-000000000002';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000009';
const KID = '0a0a0a0a-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-22T05:00:00Z');
const DAY_KEY = `day:${COACH}:${SCHOOL}:2026-10-22`;

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

function world({ on = true, allGrades = false, out } = {}) {
  const calls = { addChild: [], logs: [] };
  const LIST = { ok: true, cycleId: 'ICT-2026-Q4', grade: 3, children: [{ drawId: 'd-new', displayName: 'Zara', grade: 3, status: 'listed' }], alternates: [] };
  const deps = {
    enabled: async () => true,
    supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: SCHOOL, school_name: 'Testwala School' }] : []) },
    store: { listSessionsForVisit: async () => ({ ok: true, sessions: [] }), listVisitDraws: async () => ({ ok: true, draws: [] }) },
    draw: { addChild: async (a) => { calls.addChild.push(a); return out || LIST; } },
    now: () => NOW,
    log: (...a) => calls.logs.push(a), logError: (...a) => calls.logs.push(a),
    addChild: on,
    allGrades,
  };
  return { deps, calls };
}

const add = (deps, extra = {}) => sa.addChild({ userId: COACH, schoolId: SCHOOL, grade: 3, firstName: '  Zara ', section: 'b', clientChildId: KID, ...extra }, deps);

describe('Add a child on the spot', () => {
  test('ON: the child is seated on today\'s list (trimmed name, section upper-cased) and the list comes back', async () => {
    const { deps, calls } = world();
    const out = await add(deps);
    expect(out.status).toBe('ok');
    expect(out.list.children.map((c) => c.drawId)).toEqual(['d-new']);
    expect(calls.addChild[0]).toMatchObject({ schoolId: SCHOOL, visitKey: DAY_KEY, grade: 3, firstName: 'Zara', section: 'B', clientChildId: KID });
    expect(JSON.stringify(calls.logs)).not.toContain('Zara');
  });

  test('ON with every grade: the list\'s grade names the key, the child may be Grade 1', async () => {
    const { deps, calls } = world({ allGrades: true });
    await add(deps, { grade: 1, listGrade: 1 });
    expect(calls.addChild[0]).toMatchObject({ visitKey: `${DAY_KEY}:g1`, grade: 1 });
  });

  test('without every grade: Grade 3 and Grade 5 only', async () => {
    const { deps, calls } = world();
    expect(await add(deps, { grade: 1 })).toEqual({ status: 'invalid', reason: 'bad_grade' });
    expect(calls.addChild).toEqual([]);
  });

  test('OFF: not found, nothing drawn', async () => {
    const { deps, calls } = world({ on: false });
    expect(await add(deps)).toEqual({ status: 'not_found' });
    expect(calls.addChild).toEqual([]);
  });

  test('a school the coach is not linked to: not found', async () => {
    const { deps, calls } = world();
    expect(await add(deps, { schoolId: OTHER })).toEqual({ status: 'not_found' });
    expect(calls.addChild).toEqual([]);
  });

  test('a bad name, section or id is refused', async () => {
    const { deps, calls } = world();
    expect(await add(deps, { firstName: '   ' })).toEqual({ status: 'invalid', reason: 'bad_name' });
    expect(await add(deps, { firstName: 'x'.repeat(41) })).toEqual({ status: 'invalid', reason: 'bad_name' });
    expect(await add(deps, { firstName: '<b>Zara</b>' })).toEqual({ status: 'invalid', reason: 'bad_name' });
    expect(await add(deps, { section: 'A1' })).toEqual({ status: 'invalid', reason: 'bad_section' });
    expect(await add(deps, { clientChildId: 'kid-1' })).toEqual({ status: 'invalid', reason: 'bad_client_id' });
    expect(calls.addChild).toEqual([]);
  });

  test('an Urdu first name is a name', async () => {
    const { deps, calls } = world();
    expect((await add(deps, { firstName: 'زارا', section: '' })).status).toBe('ok');
    expect(calls.addChild[0]).toMatchObject({ firstName: 'زارا', section: null });
  });

  test('no open list: the draw\'s reason, invalid', async () => {
    const { deps } = world({ out: { ok: false, reason: 'no_list' } });
    expect(await add(deps)).toEqual({ status: 'invalid', reason: 'no_list' });
  });
});
