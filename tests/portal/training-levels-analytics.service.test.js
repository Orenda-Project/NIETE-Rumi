/**
 * bd-97x22y.4 — the v7 Trainings tab, her levels 1 to 1 (PLAN v7 "Trainings"): the pure summariser, the
 * band / region filters, the SQL's shape, and the 30-minute snapshot.
 *
 * Per teacher × visible NIETE level, the state is the bot's own (loadVisibleLevelsWithProgress,
 * bot/shared/routes/teacher-training-endpoint.js:1148, states at :1312-1319), mapped to her three:
 *   Passed      = certified
 *   In Progress = in_progress + ready_for_quiz
 *   Not Started = not_started + locked
 * The denominator of a level is the band's teachers whose programme shows that level. Primary = teacher_level
 * holds PRIMARY, levels 1-4; Mid/High = MIDDLE or HIGH, levels 3-4 (her Mid/High tab shows Skilled Practitioner
 * and Teacher Leader only). "Passed all levels" = passed Teacher Leader (hers: views.py, passed_all_levels).
 */

const {
  summarizeTrainingLevels,
  parseBandFilter,
  createSnapshot,
  trainingStatesSql,
  loadTrainingLevelRows,
  STATE_GROUP,
  BANDS,
} = require('../../dashboard/services/training-levels-analytics.service');
const { REGION_BUCKETS } = require('../../dashboard/services/schools-analytics.service');

// The NIETE ladder as prod holds it (training_levels, vendor TALEEMABAD): ids are bigints, so they arrive as strings.
const LEVELS = [
  { id: '1', name: 'Aspiring Teacher', order_index: 0 },
  { id: '2', name: 'Emerging Practitioner', order_index: 1 },
  { id: '3', name: 'Skilled Practitioner', order_index: 2 },
  { id: '4', name: 'Teacher Leader', order_index: 3 },
];

const school = (id, region, extra = {}) => ({
  id, name: `School ${id}`, emis: `E-${id}`, region, is_active: true, is_probable_test: false, ...extra,
});

/** One grouped row of the states read: how many teachers of this school, band pair, level, state. */
const st = (school_id, level_id, state, teachers, { primary = true, midhigh = false } = {}) => ({
  school_id, primary_band: primary, midhigh_band: midhigh, level_id: String(level_id), state, teachers,
});

const P = { primary: true, midhigh: false };
const M = { primary: false, midhigh: true };
const BOTH = { primary: true, midhigh: true };

function baseRows() {
  return {
    levels: LEVELS,
    schools: [
      school('s1', 'B.K'),
      school('s2', 'B.K'),
      school('s3', 'Sihala'),
      // Not counted anywhere (bd-s6qbts.4): no region, another region, inactive, a probable test school.
      school('x1', null),
      school('x2', 'Durbeen'),
      school('x3', 'Tarnol', { is_active: false }),
      school('x4', 'Nilore', { is_probable_test: true }),
    ],
    states: [
      // s1, Primary-only teachers: L1 3 certified + 1 ready + 1 locked? (L1 is first, never locked) + 1 not started
      st('s1', 1, 'certified', 3, P), st('s1', 1, 'ready_for_quiz', 1, P), st('s1', 1, 'not_started', 1, P),
      st('s1', 2, 'certified', 2, P), st('s1', 2, 'in_progress', 1, P), st('s1', 2, 'locked', 2, P),
      st('s1', 3, 'certified', 1, P), st('s1', 3, 'locked', 4, P),
      st('s1', 4, 'locked', 5, P),
      // s1, a teacher in both bands (both programmes: all four levels)
      st('s1', 1, 'certified', 1, BOTH), st('s1', 2, 'certified', 1, BOTH),
      st('s1', 3, 'certified', 1, BOTH), st('s1', 4, 'certified', 1, BOTH),
      // s2, Mid/High-only teachers: their programme shows levels 3-4 only
      st('s2', 3, 'certified', 2, M), st('s2', 3, 'in_progress', 1, M),
      st('s2', 4, 'certified', 1, M), st('s2', 4, 'not_started', 2, M),
      // s3, Primary
      st('s3', 1, 'certified', 4, P), st('s3', 2, 'certified', 4, P), st('s3', 3, 'certified', 3, P), st('s3', 3, 'ready_for_quiz', 1, P),
      st('s3', 4, 'certified', 2, P), st('s3', 4, 'in_progress', 1, P), st('s3', 4, 'not_started', 1, P),
      // uncounted schools: in no number
      st('x1', 1, 'certified', 50, P), st('x2', 4, 'certified', 50, M), st('x3', 1, 'certified', 50, P), st('x4', 3, 'certified', 50, BOTH),
      // a teacher with no band at all is in neither tab
      st('s1', 1, 'certified', 7, { primary: false, midhigh: false }),
    ],
  };
}

const lvl = (block, order) => block.levels.find((l) => l.levelOrder === order);

describe('state mapping (her three states from the bot\'s five)', () => {
  it('Passed = certified; In Progress = in_progress + ready_for_quiz; Not Started = not_started + locked', () => {
    expect(STATE_GROUP).toEqual({
      certified: 'passed',
      in_progress: 'inProgress',
      ready_for_quiz: 'inProgress',
      not_started: 'notStarted',
      locked: 'notStarted',
    });
  });

  it('an unknown state is counted nowhere rather than guessed into a bucket', () => {
    const rows = { levels: LEVELS, schools: [school('s1', 'B.K')], states: [st('s1', 1, 'certified', 2, P), st('s1', 1, 'mystery', 9, P)] };
    const out = summarizeTrainingLevels(rows, { band: 'primary' });
    expect(lvl(out.overview, 0)).toMatchObject({ passed: 2, inProgress: 0, notStarted: 0, teachers: 2 });
  });
});

describe('Primary band — levels 1-4 over the Primary teachers whose programme shows them', () => {
  const out = summarizeTrainingLevels(baseRows(), { band: 'primary' });

  it('four level cards in ladder order, with her three counts, the denominator and % passed', () => {
    expect(out.overview.levels.map((l) => [l.levelOrder, l.name])).toEqual([
      [0, 'Aspiring Teacher'], [1, 'Emerging Practitioner'], [2, 'Skilled Practitioner'], [3, 'Teacher Leader'],
    ]);
    // L1: s1 3+1(both) passed, 1 ready → in progress, 1 not started; s3 4 passed
    expect(lvl(out.overview, 0)).toEqual({
      levelId: 1, levelOrder: 0, name: 'Aspiring Teacher', passed: 8, inProgress: 1, notStarted: 1, teachers: 10, pctPassed: 80,
    });
    // L2: s1 2+1 passed, 1 in progress, 2 locked → not started; s3 4 passed
    expect(lvl(out.overview, 1)).toMatchObject({ passed: 7, inProgress: 1, notStarted: 2, teachers: 10, pctPassed: 70 });
    // L3: s1 1+1 passed, 4 locked; s3 3 passed, 1 ready
    expect(lvl(out.overview, 2)).toMatchObject({ passed: 5, inProgress: 1, notStarted: 4, teachers: 10, pctPassed: 50 });
    // L4: s1 1 passed (both), 5 locked; s3 2 passed, 1 in progress, 1 not started
    expect(lvl(out.overview, 3)).toMatchObject({ passed: 3, inProgress: 1, notStarted: 6, teachers: 10, pctPassed: 30 });
  });

  it('Mid/High-only teachers, no-band teachers and uncounted schools are in no Primary number', () => {
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/School x\d|Durbeen/);
    expect(out.schools.map((s) => s.schoolId)).toEqual(['s1', 's3']); // s2 has no Primary teacher
  });

  it('passed all levels = passed Teacher Leader, of the Teacher Leader denominator', () => {
    expect(out.overview).toMatchObject({ passedAll: 3, teachers: 10 });
    const bk = out.regions.find((r) => r.region === 'B.K');
    expect(bk).toMatchObject({ passedAll: 1, teachers: 6 });
    const sihala = out.regions.find((r) => r.region === 'Sihala');
    expect(sihala).toMatchObject({ passedAll: 2, teachers: 4 });
  });

  it('per sector × level: counts and % passed', () => {
    const bk = out.regions.find((r) => r.region === 'B.K');
    expect(lvl(bk, 0)).toEqual({ levelId: 1, levelOrder: 0, passed: 4, inProgress: 1, notStarted: 1, teachers: 6, pctPassed: 66.7 });
    expect(lvl(bk, 3)).toMatchObject({ passed: 1, inProgress: 0, notStarted: 5, teachers: 6, pctPassed: 16.7 });
  });

  it('all six regions, in sector order, whatever the data; an empty one is zeros with no %', () => {
    expect(out.regions.map((r) => r.region)).toEqual([...REGION_BUCKETS]);
    const tarnol = out.regions.find((r) => r.region === 'Tarnol');
    expect(tarnol).toMatchObject({ teachers: 0, passedAll: 0 });
    for (const l of tarnol.levels) expect(l).toMatchObject({ passed: 0, inProgress: 0, notStarted: 0, teachers: 0, pctPassed: null });
  });

  it('per school, for the drill-down: passed all levels of the teachers, and per level passed of teachers', () => {
    const s3 = out.schools.find((s) => s.schoolId === 's3');
    expect(Object.keys(s3).sort()).toEqual(['emis', 'levels', 'name', 'passedAll', 'region', 'schoolId', 'teachers']);
    expect(s3).toMatchObject({ emis: 'E-s3', name: 'School s3', region: 'Sihala', teachers: 4, passedAll: 2 });
    expect(lvl(s3, 2)).toEqual({ levelOrder: 2, passed: 3, teachers: 4, pctPassed: 75 });
  });

  it('sums: schools → region → overview', () => {
    for (const order of [0, 1, 2, 3]) {
      for (const k of ['passed', 'inProgress', 'notStarted', 'teachers']) {
        const fromSchools = ['passed', 'teachers'].includes(k)
          ? out.schools.reduce((n, s) => n + lvl(s, order)[k], 0)
          : lvl(out.overview, order)[k];
        const fromRegions = out.regions.reduce((n, r) => n + lvl(r, order)[k], 0);
        expect(fromSchools).toBe(lvl(out.overview, order)[k]);
        expect(fromRegions).toBe(lvl(out.overview, order)[k]);
      }
    }
  });
});

describe('Mid/High band — levels 3-4 (her Mid/High tab), over MIDDLE or HIGH teachers', () => {
  const out = summarizeTrainingLevels(baseRows(), { band: 'midhigh' });

  it('two levels only: Skilled Practitioner and Teacher Leader', () => {
    expect(out.overview.levels.map((l) => l.name)).toEqual(['Skilled Practitioner', 'Teacher Leader']);
  });

  it('a teacher in both bands counts in both tabs (hers double-counts too)', () => {
    // L3: s1 both 1 passed; s2 2 passed + 1 in progress
    expect(lvl(out.overview, 2)).toMatchObject({ passed: 3, inProgress: 1, notStarted: 0, teachers: 4, pctPassed: 75 });
    // L4: s1 both 1 passed; s2 1 passed, 2 not started
    expect(lvl(out.overview, 3)).toMatchObject({ passed: 2, inProgress: 0, notStarted: 2, teachers: 4, pctPassed: 50 });
    // (Mid/High "passed all" is hers — NIETE's two plus Oxbridge and Beaconhouse: see the partners block below.)
    expect(out.schools.map((s) => s.schoolId)).toEqual(['s1', 's2']);
  });
});

describe('band "all" — every teacher whose programme shows the level (the sanity check\'s denominator)', () => {
  it('counts each teacher once, band or none', () => {
    const out = summarizeTrainingLevels(baseRows(), { band: 'all' });
    expect(out.overview.levels).toHaveLength(4);
    // L1: Primary 10 + no-band 7 (both-band teacher once)
    expect(lvl(out.overview, 0)).toMatchObject({ passed: 15, teachers: 17 });
    // L3: Primary-only 9 + both 1 + Mid/High 3 = 13
    expect(lvl(out.overview, 2)).toMatchObject({ passed: 7, inProgress: 2, notStarted: 4, teachers: 13 });
  });
});

describe('the region filter', () => {
  it('scopes the overview and the schools to that region; the six region blocks stay', () => {
    const out = summarizeTrainingLevels(baseRows(), { band: 'primary', region: 'Sihala' });
    expect(out.schools.map((s) => s.schoolId)).toEqual(['s3']);
    const { region, ...card } = out.regions.find((r) => r.region === 'Sihala');
    expect(out.overview.teachers).toBe(card.teachers);
    expect(out.overview.passedAll).toBe(card.passedAll);
    expect(out.overview.levels.map(({ name, ...l }) => l)).toEqual(card.levels);
    expect(out.regions).toHaveLength(6);
  });
});

describe('empty and odd input', () => {
  it('no rows: zeros, never null counts, % passed null', () => {
    const out = summarizeTrainingLevels({ levels: LEVELS }, { band: 'primary' });
    expect(out.overview).toMatchObject({ teachers: 0, passedAll: 0 });
    for (const l of out.overview.levels) expect(l).toMatchObject({ passed: 0, inProgress: 0, notStarted: 0, teachers: 0, pctPassed: null });
    expect(out.schools).toEqual([]);
  });

  it('a level row for a level outside the band is ignored', () => {
    const rows = { levels: LEVELS, schools: [school('s1', 'B.K')], states: [st('s1', 1, 'certified', 3, M), st('s1', 3, 'certified', 1, M)] };
    const out = summarizeTrainingLevels(rows, { band: 'midhigh' });
    expect(lvl(out.overview, 2)).toMatchObject({ passed: 1, teachers: 1 });
    expect(out.overview.levels).toHaveLength(2);
  });

  it('carries no teacher identity', () => {
    const json = JSON.stringify(summarizeTrainingLevels(baseRows(), { band: 'primary' }));
    expect(json).not.toMatch(/user_id|userId|phone|teacher_level/);
  });
});

describe('parseBandFilter', () => {
  it('blank or absent is Primary (her default tab)', () => {
    for (const raw of [undefined, null, '', '  ']) expect(parseBandFilter(raw)).toEqual({ ok: true, band: 'primary' });
  });

  it('primary, midhigh and all in any case; her spellings mid_high and mid-high too', () => {
    expect(parseBandFilter('PRIMARY')).toEqual({ ok: true, band: 'primary' });
    expect(parseBandFilter('midhigh')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('mid_high')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('Mid-High')).toEqual({ ok: true, band: 'midhigh' });
    expect(parseBandFilter('all')).toEqual({ ok: true, band: 'all' });
  });

  it('anything else is refused', () => {
    for (const raw of ['secondary', 'high', ['primary'], 3, "primary'; drop"]) expect(parseBandFilter(raw)).toEqual({ ok: false });
  });

  it('the band table: Primary levels 1-4, Mid/High levels 3-4', () => {
    expect(BANDS.primary.orders).toEqual([0, 1, 2, 3]);
    expect(BANDS.midhigh.orders).toEqual([2, 3]);
    expect(BANDS.all.orders).toEqual([0, 1, 2, 3]);
  });
});

describe('the states read (set-based; the bot\'s rule in SQL)', () => {
  const sql = trainingStatesSql();
  const code = sql.replace(/--[^\n]*/g, ''); // assert on the SQL, not on its comments

  it('is one statement of materialised CTEs: no per-teacher LATERAL, no correlated loop over teachers', () => {
    expect(code).not.toMatch(/LATERAL/i);
    expect((code.match(/AS MATERIALIZED/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(code).toMatch(/GROUP BY/);
  });

  it('never JOINs two CTEs except the four-row ladder: facts are folded by UNION ALL + GROUP BY, then windows', () => {
    const ctes = ['roster', 'visible', 'done', 'module_totals', 'exams', 'certs', 'facts', 'judged', 'ordered', 'states', 'partner_facts'];
    const joined = [...code.matchAll(/JOIN\s+([a-z_]+)/g)].map((m) => m[1]);
    // the roster is joined only to real tables (assignments, scopes) and the small catalogues (the four-row ladder,
    // module_totals, the partner levels and Oxbridge's seven sessions)
    expect(joined.filter((t) => ctes.includes(t) && t !== 'module_totals')).toEqual([]);
    expect(code).toMatch(/UNION ALL/);
    expect(code).toMatch(/OVER \(PARTITION BY f\.user_id\)/);
  });

  it('visible levels come from active assignments → programme scopes (NULL or empty level_ids = the whole vendor)', () => {
    expect(code).toMatch(/teacher_training_assignments/);
    expect(code).toMatch(/a\.is_active/);
    expect(code).toMatch(/training_program_scopes/);
    expect(code).toMatch(/level_ids IS NULL/);
    expect(code).toMatch(/cardinality\(s\.level_ids\) = 0/);
  });

  it('only a level EXAM certifies: quiz_kind grand|capstone, the quiz an active grand_quiz|capstone, never a diagnostic', () => {
    expect(code).toMatch(/quiz_kind IN \('grand', 'capstone'\)/);
    expect(code).toMatch(/quiz_type IN \('grand_quiz', 'capstone'\)/);
    expect(code).toMatch(/is_passed IS TRUE/);
    expect(code).not.toMatch(/'diagnostic'/);
    expect(code).toMatch(/training_certificates/);
  });

  it('the chain lock reads the vendor\'s level_unlock_logic (parallel = unchained) and the previous VISIBLE level', () => {
    expect(code).toMatch(/level_unlock_logic/);
    expect(code).toMatch(/'parallel'/);
    // the level just below among the teacher's VISIBLE levels (lag over her visible rows of one vendor)
    expect(code).toMatch(/HAVING max\(f\.vis\) = 1/);
    expect(code).toMatch(/lag\(j\.order_index\) OVER w/);
    expect(code).toMatch(/PARTITION BY j\.user_id, j\.vendor_id ORDER BY j\.order_index/);
    expect(code).toMatch(/prev_order = o\.order_index - 1 AND NOT o\.prev_certified/);
  });

  it('the roster is the analytics roster: teachers with a school, test accounts out; the band from teacher_level', () => {
    expect(code).toMatch(/u\.role = 'teacher'/);
    expect(code).toMatch(/u\.school_id IS NOT NULL/);
    expect(code).toMatch(/u\.is_test_user IS NOT TRUE/);
    expect(code).toMatch(/teacher_level/);
    expect(code).not.toMatch(/training_bands/);
  });

  it('the five states, in the bot\'s order of precedence: locked, certified, ready_for_quiz, in_progress, not_started', () => {
    const at = (s) => code.indexOf(`'${s}'`);
    for (const s of ['locked', 'certified', 'ready_for_quiz', 'in_progress', 'not_started']) expect(at(s)).toBeGreaterThan(-1);
    expect(at('locked')).toBeLessThan(at('certified'));
    expect(at('certified')).toBeLessThan(at('ready_for_quiz'));
    expect(at('ready_for_quiz')).toBeLessThan(at('in_progress'));
    expect(at('in_progress')).toBeLessThan(at('not_started'));
  });
});

describe('loadTrainingLevelRows', () => {
  it('four reads (levels, schools, the partner catalogue, states), no parameters from the request', async () => {
    const seen = [];
    const query = jest.fn(async (sql, params) => {
      seen.push({ sql, params });
      if (/partner_facts/.test(sql)) return { rows: [st('s1', 1, 'certified', 1, P)] };
      if (/'oxbridge' AS partner/.test(sql)) return { rows: [{ partner: 'oxbridge', bit: 0, name: 'SESSION#1' }] };
      if (/FROM training_levels l\s+JOIN training_vendors/.test(sql)) return { rows: LEVELS };
      if (/FROM schools/.test(sql)) return { rows: [school('s1', 'B.K')] };
      return { rows: [] };
    });
    const rows = await loadTrainingLevelRows(query);
    expect(query).toHaveBeenCalledTimes(4);
    for (const q of seen) expect(q.params === undefined || q.params.length === 0).toBe(true);
    expect(rows.levels).toEqual(LEVELS);
    expect(rows.schools).toHaveLength(1);
    expect(rows.partners).toEqual([{ partner: 'oxbridge', bit: 0, name: 'SESSION#1' }]);
    expect(rows.states).toHaveLength(1);
  });
});

describe('createSnapshot — at most every 30 minutes, never blocking on a refresh', () => {
  function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
  }
  const deferred = () => {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it('the first request computes; concurrent first requests share ONE computation', async () => {
    const c = clock();
    const d = deferred();
    const load = jest.fn(() => d.promise);
    const snap = createSnapshot({ load, now: c.now });
    const a = snap.get();
    const b = snap.get();
    d.resolve({ v: 1 });
    const [ra, rb] = await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
    expect(ra.rows).toEqual({ v: 1 });
    expect(ra.computedAt).toBe(new Date(1_000_000).toISOString());
  });

  it('within 30 minutes the snapshot is served as is', async () => {
    const c = clock();
    const load = jest.fn(async () => ({ v: load.mock.calls.length }));
    const snap = createSnapshot({ load, now: c.now });
    await snap.get();
    c.advance(30 * 60 * 1000 - 1);
    const again = await snap.get();
    expect(load).toHaveBeenCalledTimes(1);
    expect(again.rows).toEqual({ v: 1 });
  });

  it('past 30 minutes: the old snapshot comes back at once, ONE refresh runs behind it, and the next request gets the new one', async () => {
    const c = clock();
    let gate = null;
    const load = jest.fn(() => (gate ? gate.promise : Promise.resolve({ v: 1 })));
    const snap = createSnapshot({ load, now: c.now });
    await snap.get();
    c.advance(30 * 60 * 1000);
    gate = deferred();
    const stale1 = await snap.get();
    const stale2 = await snap.get();
    expect(stale1.rows).toEqual({ v: 1 });
    expect(stale2.rows).toEqual({ v: 1 });
    expect(load).toHaveBeenCalledTimes(2); // one refresh, shared
    gate.resolve({ v: 2 });
    await gate.promise;
    await new Promise((r) => setImmediate(r));
    const fresh = await snap.get();
    expect(fresh.rows).toEqual({ v: 2 });
    expect(fresh.computedAt).toBe(new Date(1_000_000 + 30 * 60 * 1000).toISOString());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh keeps the old snapshot and is reported, and a later request tries again', async () => {
    const c = clock();
    const onError = jest.fn();
    let fail = false;
    const load = jest.fn(async () => { if (fail) throw new Error('timeout'); return { v: load.mock.calls.length }; });
    const snap = createSnapshot({ load, now: c.now, onError });
    await snap.get();
    c.advance(31 * 60 * 1000);
    fail = true;
    expect((await snap.get()).rows).toEqual({ v: 1 });
    await new Promise((r) => setImmediate(r));
    expect(onError).toHaveBeenCalledTimes(1);
    fail = false;
    expect((await snap.get()).rows).toEqual({ v: 1 }); // still stale: this request starts the retry
    await new Promise((r) => setImmediate(r));
    expect((await snap.get()).rows).toEqual({ v: 3 });
  });

  it('a failed FIRST computation rejects (nothing to show) and the next request computes again', async () => {
    const c = clock();
    let fail = true;
    const load = jest.fn(async () => { if (fail) throw new Error('down'); return { v: 'ok' }; });
    const snap = createSnapshot({ load, now: c.now });
    await expect(snap.get()).rejects.toThrow('down');
    fail = false;
    expect((await snap.get()).rows).toEqual({ v: 'ok' });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

// ── her Mid/High partner panels (operator, 2026-10-15: include Oxbridge and Beaconhouse, her rules) ──────────────
//
// Hers (bigquery_queries.py get_oxbridge_counts_direct / get_beaconhouse_counts / get_mid_high_passed_all_by_sector,
// views.py TrainingView MID_HIGH): over the mid/high cohort,
//   Oxbridge     passed = every session passed (7); in progress = at least one; not started = none
//   Beaconhouse  passed = passed at least one Beaconhouse level; in progress = some activity, no pass; not started
//   passed all   = NIETE Skilled Practitioner + Teacher Leader + Oxbridge (all sessions) + Beaconhouse (>= 1 level)
// NIETE's data: a session passed = a progress row on the Oxbridge module; a Beaconhouse level passed = its
// certificate or a passed exam attempt. One 'partner' row per (school, bands, masks) from the same read.
describe('Mid/High partners — Oxbridge and Beaconhouse, her rules', () => {
  const CATALOGUE = [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ partner: 'oxbridge', bit: n - 1, name: `SESSION#${n}` })),
    { partner: 'beaconhouse', bit: 1, name: 'English' },
    { partner: 'beaconhouse', bit: 2, name: 'Mathematics' },
    { partner: 'beaconhouse', bit: 3, name: 'General Science' },
    { partner: 'beaconhouse', bit: 4, name: 'Computer Science' },
  ];
  const ALL7 = 0b1111111;
  const pr = (school_id, { middle = true, high = false, primary = false, ox = 0, bh = 0, bhActive = false, niete = false }, teachers) => ({
    kind: 'partner', school_id, primary_band: primary, middle_band: middle, high_band: high, midhigh_band: middle || high,
    level_id: null, state: null, ox_mask: ox, bh_mask: bh, bh_active: bhActive, niete_both: niete, teachers,
  });
  function rows() {
    const r = baseRows();
    return {
      ...r,
      partners: CATALOGUE,
      states: r.states.concat([
        // s1 (B.K): 2 did everything; 1 all Oxbridge + English but not the NIETE two; 1 three sessions, no Beaconhouse
        pr('s1', { ox: ALL7, bh: 0b10, niete: true }, 2),
        pr('s1', { high: true, middle: false, ox: ALL7, bh: 0b10 }, 1),
        pr('s1', { ox: 0b0000111, bhActive: true }, 1),
        // s2 (B.K): 1 middle+high teacher passed Maths and Science, sessions 1-2; 3 with nothing at all
        pr('s2', { middle: true, high: true, ox: 0b11, bh: 0b1100, niete: true }, 1),
        pr('s2', {}, 3),
        // an uncounted school is in no number
        pr('x2', { ox: ALL7, bh: 0b10, niete: true }, 40),
      ]),
    };
  }

  it('Primary carries no partners (her Primary tab has none)', () => {
    const out = summarizeTrainingLevels(rows(), { band: 'primary' });
    expect(out.overview.partners).toBeUndefined();
    for (const r of out.regions) expect(r.partners).toBeUndefined();
  });

  it('Oxbridge: all sessions = passed, some = in progress, none = not started, of the mid/high teachers', () => {
    const out = summarizeTrainingLevels(rows(), { band: 'midhigh' });
    expect(out.overview.partners.oxbridge).toMatchObject({ passed: 3, inProgress: 2, notStarted: 3, teachers: 8, pctPassed: 37.5 });
  });

  it('Oxbridge sessions funnel: per session middle / high / total, then completed all', () => {
    const { sessions, completedAll } = summarizeTrainingLevels(rows(), { band: 'midhigh' }).overview.partners.oxbridge;
    expect(sessions.map((s) => s.name)).toEqual(['SESSION#1', 'SESSION#2', 'SESSION#3', 'SESSION#4', 'SESSION#5', 'SESSION#6', 'SESSION#7']);
    // session 1: s1 2 (middle) + 1 (high) + 1 (middle) + s2 1 (middle and high)
    expect(sessions[0]).toEqual({ name: 'SESSION#1', middle: 4, high: 2, total: 5 });
    expect(sessions[2]).toEqual({ name: 'SESSION#3', middle: 3, high: 1, total: 4 });
    expect(sessions[6]).toEqual({ name: 'SESSION#7', middle: 2, high: 1, total: 3 });
    expect(completedAll).toEqual({ middle: 2, high: 1, total: 3 });
  });

  it('Beaconhouse: passed >= 1 level = passed, activity without a pass = in progress; per level middle / high / total', () => {
    const bh = summarizeTrainingLevels(rows(), { band: 'midhigh' }).overview.partners.beaconhouse;
    expect(bh).toMatchObject({ passed: 4, inProgress: 1, notStarted: 3, teachers: 8, pctPassed: 50 });
    expect(bh.levels).toEqual([
      { name: 'English', middle: 2, high: 1, total: 3 },
      { name: 'Mathematics', middle: 1, high: 1, total: 1 },
      { name: 'General Science', middle: 1, high: 1, total: 1 },
      { name: 'Computer Science', middle: 0, high: 0, total: 0 },
    ]);
  });

  it('passed all levels on Mid/High = NIETE Skilled Practitioner + Teacher Leader + Oxbridge + Beaconhouse, of the mid/high teachers', () => {
    const out = summarizeTrainingLevels(rows(), { band: 'midhigh' });
    expect(out.overview).toMatchObject({ passedAll: 2, teachers: 8 });
    const bk = out.regions.find((r) => r.region === 'B.K');
    expect(bk).toMatchObject({ passedAll: 2, teachers: 8 });
    expect(bk.partners).toEqual({
      oxbridge: { passed: 3, inProgress: 2, notStarted: 3, teachers: 8, pctPassed: 37.5 },
      beaconhouse: { passed: 4, inProgress: 1, notStarted: 3, teachers: 8, pctPassed: 50 },
    });
    const s1 = out.schools.find((s) => s.schoolId === 's1');
    expect(s1).toMatchObject({ teachers: 4, passedAll: 2 });
    expect(out.schools.find((s) => s.schoolId === 's2')).toMatchObject({ teachers: 4, passedAll: 0 });
  });

  it('no Oxbridge sessions on record: nobody has passed Oxbridge, so nobody has passed all', () => {
    const r = rows();
    const out = summarizeTrainingLevels({ ...r, partners: r.partners.filter((p) => p.partner !== 'oxbridge') }, { band: 'midhigh' });
    expect(out.overview.partners.oxbridge).toMatchObject({ passed: 0, teachers: 8 });
    expect(out.overview.passedAll).toBe(0);
  });

  it('the region filter scopes the partner panels too', () => {
    const out = summarizeTrainingLevels(rows(), { band: 'midhigh', region: 'Sihala' });
    expect(out.overview.partners.oxbridge).toMatchObject({ passed: 0, teachers: 0, pctPassed: null });
    expect(out.overview.partners.oxbridge.sessions.every((s) => s.total === 0)).toBe(true);
  });
});

describe('the states read — partners', () => {
  const code = trainingStatesSql().replace(/--[^\n]*/g, '');

  it('one read: level rows and partner rows, told apart by kind', () => {
    expect(code).toMatch(/'level' AS kind/);
    expect(code).toMatch(/'partner'/);
    expect(code).toMatch(/UNION ALL/);
  });

  it('Oxbridge sessions are the active modules of its active course, a progress row a passed session', () => {
    expect(code).toMatch(/'OXBRIDGE'/);
    expect(code).toMatch(/ox_sessions/);
    expect(code).toMatch(/teacher_training_progress p\s+JOIN ox_sessions/);
  });

  it('a Beaconhouse level passed is its certificate or a passed exam attempt; any attempt or module is activity', () => {
    expect(code).toMatch(/'BEACONHOUSE'/);
    expect(code).toMatch(/bit_or/);
    expect(code).toMatch(/niete_both/);
  });
});
