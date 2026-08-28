/**
 * Adding a school links the real foreign key, and materialises the school if
 * the master does not have it (TDD, red-first).
 *
 * Two defects, one cause. `leader_schools.school_id` is a declared FK to
 * `schools(id)` that adding a school never wrote, so the link ran on the text
 * `'niete:' || emis` instead. That string join is why `extIdIsAmbiguous()` and
 * the niete:607 / niete:628 guards exist in application code at all — two real
 * schools were typed with the same EMIS.
 *
 * The second defect only became sharp when the patch went derived. The school
 * search draws from `schools` UNION `leader_schools`, so a coach can add a
 * school that exists only in the assignment table — and since a teacher reaches
 * a coach through `users.school_id -> schools.id`, a school with no `schools`
 * row can never have anyone derived into it. She adds it, it works, and the
 * list is empty forever with nothing saying why.
 *
 * Operator, 2026-08-28: add the school first, then the school_id.
 *
 * Live shape: 495 leader_schools rows, 490 now carrying school_id after the
 * backfill; the 5 that cannot resolve are `test:` rows whose prefix the
 * 'niete:' || emis construction cannot even see.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const { resolveOrCreateSchool } = require('../../shared/services/observe/observe-school-admin.service');

/** A fake supabase recording what was written. */
function fakeDb({ schools = [], leaderSchools = [] } = {}) {
  const calls = { schoolsInserted: [] };
  const table = (rows, name) => {
    const q = {
      _rows: [...rows],
      select() { return q; },
      eq(c, v) { q._rows = q._rows.filter((r) => r[c] === v); return q; },
      limit() { return q; },
      insert(row) {
        if (name === 'schools') calls.schoolsInserted.push(row);
        const made = { id: `new-${name}-id`, ...row };
        rows.push(made);
        return { select: () => ({ limit: async () => ({ data: [made], error: null }) }) };
      },
      then(res) { return res({ data: q._rows, error: null }); },
    };
    return q;
  };
  return {
    calls,
    from(n) {
      if (n === 'schools') return table(schools, 'schools');
      if (n === 'leader_schools') return table(leaderSchools, 'leader_schools');
      return table([], n);
    },
  };
}

const IN_MASTER = { id: 's409', name: 'IMSB (VI-X), Rawal Dam', emis: '409' };
const ORPHAN = { school_ext_id: 'niete:777', school_name: 'IMSG (I-V) Orphan', emis: '777' };

describe('resolveOrCreateSchool · the master is the destination, not an optional lookup', () => {
  it('a school already in the master is used as-is, and nothing is created', async () => {
    const db = fakeDb({ schools: [IN_MASTER] });
    const out = await resolveOrCreateSchool(db, 'niete:409');
    expect(out).toMatchObject({ school_id: 's409', name: 'IMSB (VI-X), Rawal Dam', emis: '409' });
    expect(db.calls.schoolsInserted).toHaveLength(0);
  });

  it('a school only in leader_schools is MATERIALISED into the master', async () => {
    // Without this it is addable and permanently empty: nobody's
    // users.school_id can point at a school that has no row.
    const db = fakeDb({ schools: [], leaderSchools: [ORPHAN] });
    const out = await resolveOrCreateSchool(db, 'niete:777');
    expect(db.calls.schoolsInserted).toHaveLength(1);
    expect(db.calls.schoolsInserted[0]).toMatchObject({
      name: 'IMSG (I-V) Orphan', emis: '777', is_active: true,
    });
    expect(out.school_id).toBe('new-schools-id');
  });

  it('a school nobody has ever heard of is refused, not invented', async () => {
    const db = fakeDb({ schools: [], leaderSchools: [] });
    expect(await resolveOrCreateSchool(db, 'niete:999')).toBeNull();
    expect(db.calls.schoolsInserted).toHaveLength(0);
  });

  it('never creates a second row for an EMIS the master already has', async () => {
    const db = fakeDb({ schools: [IN_MASTER], leaderSchools: [{ ...ORPHAN, emis: '409' }] });
    await resolveOrCreateSchool(db, 'niete:409');
    expect(db.calls.schoolsInserted).toHaveLength(0);
  });

  it('returns the id the assignment row needs, not just a name', async () => {
    // The whole point: leader_schools.school_id was 0% populated because the
    // resolve step only ever handed back a name.
    const out = await resolveOrCreateSchool(fakeDb({ schools: [IN_MASTER] }), 'niete:409');
    expect(out.school_id).toBeTruthy();
  });
});

describe('the assignment row carries the foreign key', () => {
  it('addSchoolForCoach writes school_id alongside the text id', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/services/observe/observe-school-admin.service.js'), 'utf8');
    const insert = src.slice(src.indexOf("from('leader_schools').insert("));
    const block = insert.slice(0, insert.indexOf('});'));
    expect(block).toContain('school_id');
  });
});
