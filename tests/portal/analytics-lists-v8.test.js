/**
 * Schools analytics v8 (FDE feedback 2026-10-19): the three lists every tab counts against, and what they change.
 *
 *   - dashboard/lib/analytics-lists.js — FDE's school list, the RDF teacher populations and the RDF coach roster,
 *     read from app_settings, resolved against live rows, cached, and FAIL-CLOSED: a missing list is null + a
 *     loud log, and the consumer keeps the v7 rule rather than showing zeros.
 *   - /analytics/schools: school base = FDE's list; teachers = the RDF populations by the RDF's sector, with a
 *     sector's school-less teachers on a "No school" row; "Lesson plans used" = the RDF's lp_use.
 *   - /analytics/coaching: coaches = the RDF roster (count, names, sectors); visits unchanged, on FDE schools.
 *   - /analytics/observations: FDE school base; sessions of the RDF populations, school-less ones on "No school".
 */

const Lists = require('../../dashboard/lib/analytics-lists');
const Schools = require('../../dashboard/services/schools-analytics.service');
const Coaching = require('../../dashboard/services/coaching-analytics.service');
const Observations = require('../../dashboard/services/observations-analytics.service');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const STORED = {
  schools: { asOf: '2026-10-19', emis: ['101', '102', '201', '999'] },
  teachers: {
    asOf: '2026-10-19',
    primary: { 'B.K': [U(1), U(2), U(3)], Sihala: [U(4), U(9)], Nowhere: [U(8)] },
    midHigh: { 'B.K': [U(5)], Sihala: [U(6), U(7)] },
    sectorByUser: { 'B.K': [U(1), U(2), U(3), U(5), U(60)], Sihala: [U(4), U(6), U(7), U(9)] },
  },
  coaches: {
    asOf: '2026-09-24',
    coaches: [
      { name: 'Saima Jabeen', sector: 'B.K', userIds: [U(50)] },
      { name: 'Mubasher Irfan', sector: 'Nilore', userIds: [U(51), U(52)] },
      { name: '  Abdul   Malik ', sector: 'Sihala', userIds: [] },
    ],
  },
};

const LIVE_USERS = new Map([
  [U(1), { role: 'teacher', teacher_level: ['PRIMARY'] }],
  [U(2), { role: 'teacher', teacher_level: ['PRIMARY', 'MIDDLE'] }],
  [U(3), { role: 'coach', teacher_level: ['PRIMARY'] }], // no longer a teacher: out
  [U(4), { role: 'teacher', teacher_level: ['PRIMARY'] }],
  [U(5), { role: 'teacher', teacher_level: ['HIGH'] }],
  [U(6), { role: 'teacher', teacher_level: ['MIDDLE'], deleted_at: '2026-10-01' }], // 6-12 drops deleted
  [U(7), { role: 'teacher', teacher_level: ['MIDDLE'] }],
  // U(9) gone from users: out
  [U(60), { role: 'principal', teacher_level: null }], // a principal on the allocation file
  [U(50), { role: 'coach' }],
  [U(51), { role: 'coach' }],
]);
const LIVE = { schoolEmis: new Set(['101', '102', '201', '301']), users: LIVE_USERS };

describe('analytics-lists: resolveLists', () => {
  const lists = Lists.resolveLists(STORED, LIVE);

  it('FDE list: EMIS kept only when a school carries it', () => {
    expect([...lists.fdeSchoolEmis].sort()).toEqual(['101', '102', '201']);
    expect(lists.asOf.schools).toBe('2026-10-19');
  });

  it('Primary: still a teacher with PRIMARY (RDF primary_scope); sector kept from the list; unknown sectors dropped', () => {
    expect([...lists.primary.entries()].sort()).toEqual([[U(1), 'B.K'], [U(2), 'B.K'], [U(4), 'Sihala']]);
  });

  it('6-12: teacher, not deleted, MIDDLE or HIGH (RDF 6-12 cohort)', () => {
    expect([...lists.midHigh.entries()].sort()).toEqual([[U(5), 'B.K'], [U(7), 'Sihala']]);
  });

  it('sectorByUser: every allocation-file user still in users, ANY role (principals too), with the RDF sector', () => {
    expect([...lists.sectorByUser.entries()].sort()).toEqual([
      [U(1), 'B.K'], [U(2), 'B.K'], [U(3), 'B.K'], [U(4), 'Sihala'], [U(5), 'B.K'], [U(6), 'Sihala'], [U(60), 'B.K'], [U(7), 'Sihala'],
    ].sort());
    // a stored value from before the key existed: null, and the teacher lists are unaffected
    const old = Lists.resolveLists({ ...STORED, teachers: { ...STORED.teachers, sectorByUser: undefined } }, LIVE);
    expect(old.sectorByUser).toBeNull();
    expect(old.primary.size).toBe(3);
  });

  it('coaches: the roster entries as they are, names tidied, userIds cut to live users', () => {
    expect(lists.coaches).toEqual([
      { name: 'Saima Jabeen', sector: 'B.K', userIds: [U(50)] },
      { name: 'Mubasher Irfan', sector: 'Nilore', userIds: [U(51)] },
      { name: 'Abdul Malik', sector: 'Sihala', userIds: [] },
    ]);
    expect(lists.missing).toEqual({ schools: false, teachers: false, coaches: false });
  });

  it('FAIL-CLOSED: a missing, malformed or nothing-matches list is null with its missing flag — never an empty set', () => {
    const none = Lists.resolveLists({ schools: undefined, teachers: 'not json', coaches: { coaches: [] } }, LIVE);
    expect(none.fdeSchoolEmis).toBeNull();
    expect(none.primary).toBeNull();
    expect(none.midHigh).toBeNull();
    expect(none.coaches).toBeNull();
    expect(none.missing).toEqual({ schools: true, teachers: true, coaches: true });
    // sandbox: stored ids match no live user, stored EMIS match no school
    const sandbox = Lists.resolveLists(STORED, { schoolEmis: new Set(['7']), users: new Map() });
    expect(sandbox.fdeSchoolEmis).toBeNull();
    expect(sandbox.primary).toBeNull();
    expect(sandbox.missing.teachers).toBe(true);
    expect(Lists.populationSectors(sandbox)).toBeNull();
  });

  it('populationSectors: Primary ∪ 6-12, one entry per teacher', () => {
    expect([...Lists.populationSectors(lists).entries()].sort())
      .toEqual([[U(1), 'B.K'], [U(2), 'B.K'], [U(4), 'Sihala'], [U(5), 'B.K'], [U(7), 'Sihala']]);
  });
});

describe('analytics-lists: the cached loader', () => {
  function fakeSupabase(settingsRows, { users = [], schools = [] } = {}) {
    const calls = [];
    return {
      calls,
      from(table) {
        const chain = {
          select() { return chain; },
          in(col, vals) {
            calls.push({ table, col, n: vals.length });
            if (table === 'app_settings') return Promise.resolve(settingsRows instanceof Error ? { data: null, error: settingsRows } : { data: settingsRows, error: null });
            if (table === 'users') return Promise.resolve({ data: users.filter((u) => vals.includes(u.id)), error: null });
            return Promise.resolve({ data: schools.filter((s) => vals.includes(s.emis)), error: null });
          },
        };
        return chain;
      },
    };
  }
  const rows = [
    { key: Lists.LIST_KEYS.schools, value: STORED.schools },
    { key: Lists.LIST_KEYS.teachers, value: STORED.teachers },
    { key: Lists.LIST_KEYS.coaches, value: STORED.coaches },
  ];
  const users = [...LIVE_USERS.entries()].map(([id, u]) => ({ id, ...u }));
  const schools = ['101', '102', '201'].map((emis) => ({ emis }));

  it('reads the three keys, resolves them, and caches for 30 minutes', async () => {
    let t = 0;
    const loader = Lists.createAnalyticsListsLoader({ now: () => t, log: () => {} });
    const sb = fakeSupabase(rows, { users, schools });
    const a = await loader.load(sb);
    expect(sb.calls[0]).toEqual({ table: 'app_settings', col: 'key', n: 3 });
    expect(a.primary.size).toBe(3);
    const reads = sb.calls.length;
    t = 29 * 60 * 1000;
    await loader.load(sb);
    expect(sb.calls.length).toBe(reads);
    t = 31 * 60 * 1000;
    await loader.load(sb);
    expect(sb.calls.length).toBe(reads * 2);
  });

  it('with a pg query it resolves in two reads, ids as one uuid[] parameter', async () => {
    const loader = Lists.createAnalyticsListsLoader({ log: () => {} });
    const sql = [];
    const query = async (q, p) => {
      sql.push({ q, p });
      if (/FROM users/.test(q)) return { rows: users };
      return { rows: schools };
    };
    const out = await loader.load(fakeSupabase(rows), { query });
    expect(sql).toHaveLength(2);
    expect(sql.find((s) => /FROM users/.test(s.q)).q).toMatch(/id = ANY\(\$1::uuid\[\]\)/);
    expect(out.midHigh.size).toBe(2);
  });

  it('a missing list is logged LOUDLY and comes back null (the consumer falls back to v7)', async () => {
    const logs = [];
    const loader = Lists.createAnalyticsListsLoader({ log: (m) => logs.push(m) });
    const out = await loader.load(fakeSupabase([rows[0]], { schools }));
    expect(out.fdeSchoolEmis.size).toBe(3);
    expect(out.primary).toBeNull();
    expect(out.coaches).toBeNull();
    expect(logs.join('\n')).toMatch(/analytics_rdf_teachers .*v7/);
    expect(logs.join('\n')).toMatch(/analytics_rdf_coaches .*v7/);
  });

  it('a failed read with nothing cached throws (the route 500s); with a cached answer, serves it', async () => {
    let t = 0;
    const loader = Lists.createAnalyticsListsLoader({ now: () => t, log: () => {} });
    await expect(loader.load(fakeSupabase(new Error('down')))).rejects.toThrow(/app_settings/);
    const ok = await loader.load(fakeSupabase(rows, { users, schools }));
    t = 31 * 60 * 1000;
    const stale = await loader.load(fakeSupabase(new Error('down')));
    expect(stale).toBe(ok);
  });
});

