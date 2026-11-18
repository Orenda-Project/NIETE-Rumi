'use strict';
/**
 * A COACH WHO HOLDS A SCHOOL WITH NO EMIS CAN ADD A TEACHER THERE.
 *
 * A school with no EMIS (the Gilgit-Baltistan community schools) is keyed by its name in leader_schools:
 * `niete:gb-example-community-school`. `myschool()` used to read the text after 'niete:' as an EMIS and look for
 * `schools.emis = 'gb-example-community-school'`, which is NULL on that row, so it found nothing and the add was
 * refused as `not_my_school` ("Not your school" in the portal) for a coach who does hold the school.
 *
 * The holding's own `school_id` is the exact key. The EMIS lookup stays for holdings written before school_id
 * was filled in.
 */

const mockTables = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    let rows = (mockTables[table] || []).slice();
    const q = {
      select: () => q,
      limit: () => q,
      eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return q; },
      then: (res) => res({ data: rows, error: null }),
    };
    return q;
  },
}));

const T = require('../../bot/shared/services/observe/observe-teacher-admin.service');

const LEADER = 'leader-1';
const NO_EMIS_KEY = 'niete:gb-example-community-school';
const PHONE = '03001234567';

beforeEach(() => {
  mockTables.users = [];
  mockTables.schools = [
    { id: 's-emis', name: 'Example School With EMIS', emis: '24191', region: 'Gilgit-Baltistan', is_probable_test: false },
    { id: 's-none', name: 'Example GB Community School', emis: null, region: 'Gilgit-Baltistan', is_probable_test: false },
  ];
  mockTables.leader_schools = [
    { leader_user_id: LEADER, school_ext_id: 'niete:24191', school_id: 's-emis' },
    { leader_user_id: LEADER, school_ext_id: NO_EMIS_KEY, school_id: 's-none' },
  ];
});

describe('planAdd at a school with no EMIS', () => {
  it('accepts a school the coach holds, found by the holding school_id', async () => {
    const plan = await T.planAdd({ actorLeaderUserId: LEADER, schoolExtId: NO_EMIS_KEY, rawPhone: PHONE });
    expect(plan.outcome).toBe('new');
    expect(plan.target.school_id).toBe('s-none');
    expect(plan.target.emis).toBeNull();           // not the string 'null'
  });

  it('still accepts a school that has an EMIS', async () => {
    const plan = await T.planAdd({ actorLeaderUserId: LEADER, schoolExtId: 'niete:24191', rawPhone: PHONE });
    expect(plan.outcome).toBe('new');
    expect(plan.target.emis).toBe('24191');
  });

  it('still falls back to the EMIS for a holding written before school_id was filled in', async () => {
    mockTables.leader_schools = [{ leader_user_id: LEADER, school_ext_id: 'niete:24191', school_id: null }];
    const plan = await T.planAdd({ actorLeaderUserId: LEADER, schoolExtId: 'niete:24191', rawPhone: PHONE });
    expect(plan.outcome).toBe('new');
    expect(plan.target.school_id).toBe('s-emis');
  });

  it('still refuses a school the coach does not hold', async () => {
    mockTables.leader_schools = [{ leader_user_id: 'someone-else', school_ext_id: NO_EMIS_KEY, school_id: 's-none' }];
    const plan = await T.planAdd({ actorLeaderUserId: LEADER, schoolExtId: NO_EMIS_KEY, rawPhone: PHONE });
    expect(plan.outcome).toBe('not_my_school');
  });

  it('reports a teacher already at the school as already_here', async () => {
    mockTables.users = [{ id: 'u1', phone_number: '923001234567', role: 'principal', school_id: 's-none', name: 'Example Principal' }];
    const plan = await T.planAdd({ actorLeaderUserId: LEADER, schoolExtId: NO_EMIS_KEY, rawPhone: PHONE });
    expect(plan.outcome).toBe('already_here');
  });

  it('moving a teacher away from a school with no EMIS records no "niete:null" key', async () => {
    mockTables.users = [{ id: 'u1', phone_number: '923001234567', role: 'teacher', school_id: 's-none', name: 'Example Teacher' }];
    const plan = await T.planAdd({ actorLeaderUserId: LEADER, schoolExtId: 'niete:24191', rawPhone: PHONE });
    expect(plan.outcome).toBe('move');
    expect(plan.fromSchoolExtId).toBeNull();
  });
});
