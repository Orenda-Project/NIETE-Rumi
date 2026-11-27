/**
 * Schools analytics: principals who also teach count as teachers.
 *
 * In some schools the head teacher is the school's principal AND teaches a class. Rumi holds one role per
 * person, so they are role 'principal' (they keep /observe), and the analytics roster, which counts only role
 * 'teacher', left them out: their own Digital Coach recordings, lesson plans and training went missing too.
 *
 * The switch `analytics_teaching_principals` (app_settings) names them: a JSON array of users.id, list-only.
 * A principal on it counts as a teacher on the schools analytics roster and in its counted sessions.
 * No row, a broadcast value, a malformed value or a failed read is the empty list, and an empty list leaves
 * every read EXACTLY as it was (so no other region's numbers move).
 */

const {
  loadSchoolsAnalyticsRows,
  loadCountedSessions,
  createScoreMemo,
} = require('../../dashboard/services/schools-analytics.service');
const {
  ANALYTICS_TEACHING_PRINCIPALS_KEY,
  readTeachingPrincipals,
} = require('../../dashboard/lib/feature-flags');

const P1 = '11111111-0000-4000-8000-00000000aa01';
const P2 = '11111111-0000-4000-8000-00000000aa02';

const THROW = Symbol('throw');
const ERROR = Symbol('error');
const ABSENT = Symbol('absent');

/** A supabase stand-in whose app_settings row holds `value` (or fails / is absent). A fresh one per test: the flag cache is per client. */
function fakeDb(value) {
  const keys = [];
  return {
    keys,
    from() {
      let key;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { key = v; keys.push(v); return chain; },
        maybeSingle: async () => {
          if (value === THROW) throw new Error('socket hang up');
          if (value === ERROR) return { data: null, error: { message: 'upstream timeout' } };
          if (value === ABSENT) return { data: null, error: null };
          return { data: { key, value }, error: null };
        },
      };
      return chain;
    },
  };
}

describe('readTeachingPrincipals — the analytics_teaching_principals switch, list-only and fail-closed', () => {
  it('reads the analytics_teaching_principals row', async () => {
    const db = fakeDb([P1]);
    await readTeachingPrincipals(db);
    expect(ANALYTICS_TEACHING_PRINCIPALS_KEY).toBe('analytics_teaching_principals');
    expect(db.keys).toEqual(['analytics_teaching_principals']);
  });

  it('a JSON list of users.id (or its JSON string) is that list', async () => {
    expect(await readTeachingPrincipals(fakeDb([P1, P2]))).toEqual([P1, P2]);
    expect(await readTeachingPrincipals(fakeDb(JSON.stringify([P2])))).toEqual([P2]);
  });

  it('no row, a broadcast value, an object or bad JSON is nobody', async () => {
    for (const v of [ABSENT, true, 'true', 'teachers', { [P1]: true }, '{not json', 7]) {
      expect(await readTeachingPrincipals(fakeDb(v))).toEqual([]);
    }
  });

  it('a failed read is nobody, never a thrown error: the page shows the counts it showed before', async () => {
    expect(await readTeachingPrincipals(fakeDb(ERROR))).toEqual([]);
    expect(await readTeachingPrincipals(fakeDb(THROW))).toEqual([]);
  });

  it('keeps only well-formed ids, so a typo cannot break the uuid[] cast of the whole read', async () => {
    expect(await readTeachingPrincipals(fakeDb([P1, 'not-a-uuid', '', 42, null, P2]))).toEqual([P1, P2]);
  });
});

describe('the schools analytics reads with teaching principals', () => {
  const RANGE = { from: '2026-11-01', to: '2026-11-26' };

  function makeQuery() {
    const calls = [];
    const query = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/'scores'/.test(sql)) return { rows: [] };
      if (/FROM schools/i.test(sql)) return { rows: [] };
      if (/FROM coaching_sessions/i.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    return { query, calls };
  }
  const find = (calls, re) => calls.find((c) => re.test(c.sql));
  const schoolsCall = (calls) => find(calls, /FROM schools sch/);
  const sessionsCall = (calls) => find(calls, /FROM coaching_sessions c/);

  /** Bind each $n of `sql` to its parameter, so a test reads which value a placeholder really gets. */
  const bound = (call, re) => {
    const m = call.sql.match(re);
    return m ? call.params[Number(m[1]) - 1] : undefined;
  };
  const PRINCIPAL_LIST = /u\.role = 'principal' AND u\.id = ANY\(\$(\d+)::uuid\[\]\)/;

  it('an empty list (the default) leaves both reads byte-for-byte as they were', async () => {
    for (const regions of [null, ['Gilgit-Baltistan']]) {
      const before = makeQuery();
      await loadSchoolsAnalyticsRows(before.query, RANGE, { memo: createScoreMemo(), regions });
      const after = makeQuery();
      await loadSchoolsAnalyticsRows(after.query, RANGE, { memo: createScoreMemo(), regions, teachingPrincipals: [] });
      expect(after.calls).toEqual(before.calls);
    }
  });

  it('the roster counts a listed principal as a teacher, in both of its reads (opens and training)', async () => {
    const { query, calls } = makeQuery();
    await loadSchoolsAnalyticsRows(query, RANGE, { memo: createScoreMemo(), regions: ['Gilgit-Baltistan'], teachingPrincipals: [P1, P2] });
    const c = schoolsCall(calls);
    expect(c.sql.match(new RegExp(PRINCIPAL_LIST.source, 'g'))).toHaveLength(2);
    expect(bound(c, PRINCIPAL_LIST)).toEqual([P1, P2]);
    // The region filter still gets the regions, not the list.
    expect(bound(c, /sch\.region = ANY\(\$(\d+)::text\[\]\)/)).toEqual(['Gilgit-Baltistan']);
    // Still a teacher's roster: test accounts and retired accounts stay out for principals too.
    expect(c.sql).toMatch(/\(u\.role = 'teacher'\s+OR \(u\.role = 'principal' AND u\.id = ANY\(\$\d+::uuid\[\]\)\)\)\s+AND u\.school_id IS NOT NULL\s+AND u\.is_test_user IS NOT TRUE/);
  });

  it('the counted sessions take a listed principal\'s own recordings too, with or without a region filter', async () => {
    for (const regions of [null, ['Gilgit-Baltistan']]) {
      const { query, calls } = makeQuery();
      await loadCountedSessions(query, RANGE, { memo: createScoreMemo(), regions, teachingPrincipals: [P1] });
      const c = sessionsCall(calls);
      expect(bound(c, PRINCIPAL_LIST)).toEqual([P1]);
      if (regions) expect(bound(c, /region = ANY\(\$(\d+)::text\[\]\)/)).toEqual(regions);
      // The window bounds keep $1 and $2.
      expect(c.params.slice(0, 2)).toEqual([expect.any(String), expect.any(String)]);
    }
  });

  it('an open window still binds the list to its own placeholder', async () => {
    const { query, calls } = makeQuery();
    await loadSchoolsAnalyticsRows(query, { from: null, to: null }, { memo: createScoreMemo(), teachingPrincipals: [P2] });
    expect(bound(schoolsCall(calls), PRINCIPAL_LIST)).toEqual([P2]);
    expect(bound(sessionsCall(calls), PRINCIPAL_LIST)).toEqual([P2]);
  });
});

// The Overview's Total teachers tile says how many of its teachers are head teachers ("incl. 3 head teachers").
// The roster read counts them per school (head_teachers) only when the list names someone; the summary carries
// headTeachers only where it is above 0, so every other answer (FDE's, a school with none) is exactly as before.
describe('headTeachers: how many of the counted teachers are listed principals', () => {
  const { summarizeSchoolsAnalytics } = require('../../dashboard/services/schools-analytics.service');
  const school = (id, region, teachers, head_teachers) => ({
    id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false,
    teachers, lps_opened: 0, teachers_opened_lp: 0, training_modules: 0, teachers_trained: 0,
    ...(head_teachers === undefined ? {} : { head_teachers }),
  });

  it('the roster read counts them per school, only when the list names someone', async () => {
    const calls = [];
    const query = async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; };
    await loadSchoolsAnalyticsRows(query, { from: null, to: null }, { memo: createScoreMemo(), teachingPrincipals: [P1] });
    const roster = calls.find((c) => /FROM schools sch/.test(c.sql)).sql;
    expect(roster).toMatch(/count\(\*\) FILTER \(WHERE u\.role = 'principal'\)::int AS head_teachers/);
    expect(roster).toMatch(/COALESCE\(r\.head_teachers, 0\)::int AS head_teachers/);
    const plain = [];
    await loadSchoolsAnalyticsRows(async (sql, params) => { plain.push({ sql, params }); return { rows: [] }; }, { from: null, to: null }, { memo: createScoreMemo() });
    expect(plain.find((c) => /FROM schools sch/.test(c.sql)).sql).not.toMatch(/head_teachers/);
  });

  it('sums per school, per area and overall, and is carried only where it is above 0', () => {
    const out = summarizeSchoolsAnalytics({
      schools: [school('w', 'Gilgit-Baltistan', 7, 1), school('h', 'Gilgit-Baltistan', 6, 2), school('s', 'Gilgit-Baltistan', 9, 0)],
      sessions: [],
    }, { regions: ['Gilgit-Baltistan'] });
    expect(out.overview.teachers).toBe(22);
    expect(out.overview.headTeachers).toBe(3);
    expect(out.regions[0].headTeachers).toBe(3);
    expect(Object.fromEntries(out.schools.map((s) => [s.schoolId, s.headTeachers]))).toEqual({ w: 1, h: 2, s: undefined });
    expect('headTeachers' in out.schools.find((s) => s.schoolId === 's')).toBe(false);
  });

  it('no head_teachers on the rows (no list) leaves the answer without the key anywhere', () => {
    const out = summarizeSchoolsAnalytics({ schools: [school('a', 'B.K', 4)], sessions: [] });
    expect(JSON.stringify(out)).not.toMatch(/headTeachers/);
  });

  it('the teachers count already includes them: headTeachers is a part of teachers, never added on top', () => {
    const out = summarizeSchoolsAnalytics({ schools: [school('w', 'Gilgit-Baltistan', 7, 1)], sessions: [] }, { regions: ['Gilgit-Baltistan'] });
    expect(out.overview).toMatchObject({ teachers: 7, headTeachers: 1 });
  });
});
