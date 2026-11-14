'use strict';

/**
 * Which schools are practice schools (schools.is_probable_test) is never asked with one long list of school ids.
 *
 * A user who may open any school (sa_any_school) has every live programme school in their list, ~460 ids. Put in one
 * `.in('id', ids)` filter, that request is too big for the HTTP client: supabase-js answers `TypeError: fetch failed`
 * (cause UND_ERR_HEADERS_OVERFLOW, from about 400 ids). With sa_r19_practice_first ON the school list made exactly that
 * request, so the Learning assessment never left "Loading" for those users. The results dashboard's practice mark
 * (sa_r8_hide_practice) asked the same way, with one id per school that has a session.
 *
 * The stub below behaves like that client: any `.in()` list longer than LIMIT fails the query the same way.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const LIMIT = 300;
const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-14T06:00:00Z');
const id = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 457 live programme schools, the coach's linked practice school, and 26 other practice schools nobody here is linked to
const LIVE = Array.from({ length: 457 }, (_, i) => ({
  id: id('bbbbbbbb', i + 1), name: `School ${String(i + 1).padStart(3, '0')}`, emis: String(1000 + i), region: 'Urban-I',
  is_active: true, is_probable_test: i % 2 ? false : null,
}));
const SIM = { id: id('dddddddd', 1), name: 'SIM Child Test School', emis: 'SIM-CT-0001', region: 'Urban-I', is_active: true, is_probable_test: true };
const OTHER_PRACTICE = Array.from({ length: 26 }, (_, i) => ({
  id: id('eeeeeeee', i + 1), name: `Practice ${i + 1}`, emis: `SIM-X-${i}`, region: 'ICT', is_active: true, is_probable_test: true,
}));
const SCHOOLS = [...LIVE, SIM, ...OTHER_PRACTICE];

/** A Supabase stub that filters like PostgREST and fails like the real client when an `.in()` list is too long. */
function supabaseLike(tables, seen) {
  return {
    from(table) {
      const filters = [];
      let tooLong = false;
      const q = {
        select: () => q, gte: () => q, order: () => q, limit: () => q,
        eq: (col, v) => { filters.push((r) => r[col] === v); return q; },
        in: (col, list) => {
          seen.push(list.length);
          if (list.length > LIMIT) tooLong = true;
          const want = new Set(list);
          filters.push((r) => want.has(r[col]));
          return q;
        },
        then: (ok, ko) => Promise.resolve(tooLong
          ? { data: null, error: { message: 'TypeError: fetch failed' } }
          : { data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null }).then(ok, ko),
      };
      return q;
    },
  };
}

describe('the Learning assessment school list, for a user who may open any school', () => {
  function world() {
    const seen = [];
    const tables = {
      leader_schools: [SIM, LIVE[0], LIVE[1]].map((s) => ({ leader_user_id: COACH, school_id: s.id, school_name: s.name })),
      schools: SCHOOLS,
      observation_field_forms: [],
    };
    return {
      seen,
      deps: {
        enabled: async () => true,
        practice: async () => null,
        supabase: supabaseLike(tables, seen),
        draw: { resolveVisitSchool: async () => ({ ok: false }) },
        now: () => NOW,
        log: () => {}, logError: () => {},
        anySchool: true,
        practiceFirst: true,
      },
    };
  }

  test('with practice-first ON it answers: every live school plus the linked practice school, that one first', async () => {
    const w = world();
    const out = await sa.listSchools({ userId: COACH }, w.deps);
    expect(out.status).toBe('ok');
    expect(out.schools).toHaveLength(458);
    expect(out.schools[0]).toMatchObject({ schoolId: SIM.id, name: 'SIM Child Test School', practice: true });
    expect(out.schools.filter((s) => s.practice).map((s) => s.schoolId)).toEqual([SIM.id]);
  });

  test('no single request carries the whole school list', async () => {
    const w = world();
    await sa.listSchools({ userId: COACH }, w.deps);
    expect(Math.max(0, ...w.seen)).toBeLessThanOrEqual(LIMIT);
  });
});

describe('the results dashboard, with sessions at more schools than one request can name', () => {
  const session = (n, schoolId) => ({
    id: id('cccccccc', n), coach_user_id: COACH, student_id: `st-${n}`, draw_id: `d-${n}`, school_id: schoolId, grade: 3, form: 'A',
    item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-11-13T05:00:00Z', finished_at: '2026-11-13T05:30:00Z',
    created_at: '2026-11-13T04:59:00Z', device: { block: 'rdf_auto' },
  });
  const block = (sessionId) => ({
    session_id: sessionId, block: 'ur.words4', response_mode: 'record', lang: 'ur', created_at: '2026-11-13T05:05:00Z', ai_status: 'scored',
    ai_marks: { correct: 3, attempted: 4 }, audio_r2_key: `k/${sessionId}.webm`, responses: [{ kind: 'result', mode: 'record' }],
  });

  test('sa_r8_hide_practice ON: it answers, and only the practice school\'s session is marked practice', async () => {
    const seen = [];
    const sessions = [...LIVE, SIM].map((s, i) => session(i + 1, s.id));
    const store = {
      listSaSessions: async () => ({ ok: true, sessions }),
      listBlocksForSessions: async (ids) => ({ ok: true, blocks: ids.map(block) }),
      getSchoolsByIds: async (ids) => ({ ok: true, schools: SCHOOLS.filter((s) => ids.includes(s.id)) }),
      getUserNamesByIds: async (ids) => ({ ok: true, users: ids.map((u) => ({ id: u, name: 'Coach Testwala' })) }),
      getSessionDrawOrigins: async () => ({ ok: true, origins: [] }),
    };
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, {
      enabled: async () => true, practiceSwitch: false, stopRules: false, dashFilters: true, hidePractice: true, coachNameGuard: true,
      supabase: supabaseLike({ schools: SCHOOLS }, seen), store, saStore: {}, bank: null, now: () => NOW, log: () => {}, logError: () => {},
    });
    expect(out.status).toBe('ok');
    expect(out.practiceFilter).toBe(true);
    expect(out.sessions).toHaveLength(458);
    const practice = out.sessions.filter((r) => r.practice).map((r) => r.results.session.id);
    expect(practice).toEqual([id('cccccccc', 458)]);
    expect(Math.max(0, ...seen)).toBeLessThanOrEqual(LIMIT);
  });
});
