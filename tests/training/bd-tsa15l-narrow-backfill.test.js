/**
 * bd-tsa15l — the narrowed backfill picks only teachers at a programme school with a level signal and no assignment.
 * Made-up data only (public repo).
 */
const { pickTargets, emisKey } = require('../../scripts/backfill-training-assignments-programme-teachers');

const schools = new Map([['s1', { id: 's1', emis: '101.0' }], ['s2', { id: 's2', emis: '999' }]]);
const programmeEmis = new Set(['101']);
const base = { role: 'teacher', deleted_at: null, is_test_user: false, phone_number: '9230000', school_id: 's1', teacher_level: null, grades_taught: '["grade_3"]' };
const pick = (u, assigned = new Set()) => pickTargets({ users: [{ id: 'u', ...base, ...u }], assignedUserIds: assigned, schoolsById: schools, programmeEmis });

describe('narrowed backfill: who is picked', () => {
  it('a teacher at a programme school with a grade signal: by the level rule', () => {
    expect(pick({}).map((t) => t.programs)).toEqual([['niete_primary']]);
    expect(pick({ grades_taught: '["grade_7"]' })[0].programs).toEqual(['niete_middle_high']);
    expect(pick({ grades_taught: '["grade_3","grade_8"]' })[0].programs.sort()).toEqual(['niete_middle_high', 'niete_primary']);
  });
  it.each([
    ['deleted', { deleted_at: '2026-11-01' }], ['test', { is_test_user: true }], ['a principal', { role: 'principal' }],
    ['no school', { school_id: null }], ['an off-list school', { school_id: 's2' }], ['merged phone', { phone_number: 'merged:1' }],
    ['no level signal', { grades_taught: null }],
  ])('%s is skipped', (_n, u) => { expect(pick(u)).toEqual([]); });
  it('someone already assigned is skipped', () => { expect(pick({}, new Set(['u']))).toEqual([]); });
  it('EMIS "101.0" and "101" are the same school', () => { expect(emisKey('101.0')).toBe(emisKey(101)); });
});
