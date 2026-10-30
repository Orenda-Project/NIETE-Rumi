'use strict';
/**
 * bd-sex15q.13 (worker w-listen) — the coach's Listen, player, Stats and Results reads over HTTP, through the real
 * router, flag readers, scope and codec services, against a throwaway Postgres (contracts/API.md §7 R5, R6, R14, R15).
 *
 *   R14 GET /coachip/stats            rows in catalogue order, window_pair, opening first_window / two_windows / marker
 *   R15 GET /coachip/results          S7 cells; under 5 tested every count null; no child, teacher or code
 *   R5  GET /coachip/moments          the week's moments (newest first, pair null, steps []), base / recordings / filters
 *   R6  GET /coachip/m/:momentId      coach form (inScope) and the RM's circle form (circleAllows)
 *
 * Fictional rows only. The world: coach C holds S-01 and S-02 (teachers T1, T2 at S-01, T3 at S-02); coach D holds
 * S-03 (teacher T4); an RM of Urban-I and one of Tarnol. Every payload is checked for the fixture's keys
 * (contracts/fixtures.json stats / stats_marker / results / moments / moment / moment_rm, listed below), every Count
 * resolving to a Window of the same body, and no teacher identity (users.id, 16-hex key, URL).
 */
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const seed = require('./helpers/seed');
const ins = require('./helpers/insights-seed');
const { startApp } = require('./helpers/app');
const S = require('../../dashboard/services/coachip-shapes');
const { teacherKeyFor } = require('../../dashboard/services/coachip-codes.service');

const run = hasPostgres() ? describe : describe.skip;
const { fid } = seed;
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday 26 Oct 2026, 11:00 PKT
const P = '/api/portal/coachip';
const INVENTED = '00000000-0000-4000-8000-ff0000000001';
const G = 'google/gemini-3.8-flash';
const G_OLD = 'google/gemini-2.5-flash';

const C = fid('coach', 1);
const D = fid('coach', 2);
const RM = fid('rm', 1);
const RM2 = fid('rm', 2);
const SCH = (n) => fid('school', n);
const T = (n) => fid('teacher', n);
const SESS = (n) => fid('session', n);
const MOM = (n) => fid('moment', n);
const FACT = (n) => fid('fact', n);
const TEACHERS = [1, 2, 3, 4].map(T);
const key = (t) => teacherKeyFor(seed.SECRET, t);

const K = {
  stats: ['window_pair', 'rows', 'opening', 'fico_panel', 'recordings_by_week', 'coverage', 'method', 'windows', 'computed_at'],
  statsRow: ['w_id', 'short_name', 'sentence', 'now', 'before', 'change', 'sector', 'status'],
  opening: ['state', 'first_trend_after', 'scoring_changed_on'],
  fico: ['indicator', 'label', 'lowest_share'],
  method: ['query_id', 'grader', 'framework', 'caveats'],
  results: ['window', 'cells', 'empty', 'windows', 'computed_at'],
  cell: ['school', 'grade', 'language', 'tested', 'rows', 'fln', 'debrief_line', 'i_id'],
  cellRow: ['w_id', 'short_name', 'sentence', 'count', 'status'],
  moments: ['window', 'base', 'recordings', 'filters', 'moments', 'failed_sessions', 'windows', 'computed_at'],
  moment: ['moment_id', 'session', 'code', 'school', 'w', 'kind', 'steps', 'lesson_s', 'confidence', 'clip', 'gloss', 'gloss_status', 'question', 'pair', 'full_recording'],
  momentRm: ['moment_id', 'school', 'w', 'kind', 'steps', 'lesson_s', 'confidence', 'clip', 'gloss', 'gloss_status', 'question', 'coach_label', 'pair', 'full_recording', 'windows', 'computed_at'],
  failed: ['session_id', 'school', 'recorded_on', 'duration_s'],
  window: ['id', 'from', 'to', 'weeks', 'grader', 'grader_label', 'framework', 'scoring_changed_on'],
};
const keys = (o) => Object.keys(o).sort();
const expectKeys = (o, list) => expect(keys(o)).toEqual([...list].sort());

/** G10: every object carrying a window_id resolves to a Window of the same body; a Count has integer n ≤ d. */
function everyCountResolves(body) {
  const ids = new Set((body.windows || []).map((w) => w.id));
  let counted = 0;
  (function walk(v, path) {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(v, 'window_id')) {
      counted += 1;
      if (!ids.has(v.window_id)) throw new Error(`${path}: window_id ${v.window_id} not in windows[]`);
      if ('d' in v && (!Number.isInteger(v.n) || !Number.isInteger(v.d) || v.n < 0 || v.n > v.d)) throw new Error(`${path}: bad Count ${JSON.stringify(v)}`);
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  }(body, '$'));
  for (const w of body.windows || []) expectKeys(w, K.window);
  return counted;
}
function noIdentity(text) {
  for (const id of TEACHERS) expect(text).not.toContain(id);
  for (const t of TEACHERS) expect(text).not.toContain(key(t));
  expect(text).not.toMatch(/"[0-9a-f]{16}"/);
  expect(text).not.toContain('http');
  expect(text).not.toContain('X-Amz-');
  expect(text).not.toContain('r2.cloudflarestorage');
  expect(text).not.toContain('coachip/clips');
}
function noTeacherInRm(body) {
  (function walk(v, path) {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (typeof v === 'string') { if (/^T-\d{2,3}$/.test(v)) throw new Error(`${path}: T-code ${v}`); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (['code', 'code_id', 'teacher_key', 'session_id', 'session', 'name', 'url'].includes(k)) throw new Error(`${path}.${k}: forbidden key in an RM payload`);
      walk(x, `${path}.${k}`);
    }
  }(body, '$'));
}

// ── seed helpers beyond helpers/insights-seed.js (sector rollups, other graders, S7 cells) ─────────────────────────
async function rollup(q, o) {
  await q(`INSERT INTO coachip_rollups (scope_kind, coach_user_id, school_id, sector, w_id, window_start, window_end, window_weeks, numerator,
             denominator, teacher_count, coach_count, coaches_with_5plus, recordings, recordings_linked, rank, grader_model, framework_version,
             pipeline_version, status, job_run_id, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6::date,$6::date + 27,4,$7,$8,3,$9,$10,$11,$12,$13,$14,$15,'coachip-1.0.0',$16,$17,$18)`,
  [o.kind || 'coach', o.coach || null, o.school || null, o.sector || null, o.w, o.from || '2026-09-28', o.n, o.d, o.coachCount || 1,
    o.c5 === undefined ? 1 : o.c5, o.recordings || 0, o.linked || 0, o.rank || null, o.grader || G, o.framework || 'lp_fidelity',
    o.status || 'ok', o.run, o.computedAt || '2026-10-25T21:40:00Z']);
}
async function cell(q, { school, grade, language = 'ur', w, term = '2026-09-28', tested, n = null, status, run: jobRunId, computedAt = '2026-10-25T21:40:00Z' }) {
  await q(`INSERT INTO coachip_result_cells (school_id, grade, language, w_id, term_start, tested, numerator, status, grader_model, framework_version,
             pipeline_version, job_run_id, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'egra-coach-tablet-v2','egra','coachip-1.0.0',$9,$10)`,
  [school, grade, language, w, term, tested, n, status, jobRunId, computedAt]);
}
/** A graded (or not) fact on a fixed session id: the session row first (FK). */
async function rec(q, { n, teacher, school, date, run: jobRunId, linked = true, status = 'ok', grader = G, audioS = 1500, subject = 'Urdu' }) {
  await ins.session(q, { id: SESS(n), teacherId: teacher });
  return ins.fact(q, { id: FACT(n), sessionId: SESS(n), teacherKey: key(teacher), schoolId: school, date, jobRunId, linked, status, grader, audioS, subject });
}

run('COACHIP coach reads: R14 stats, R15 results, R5 moments, R6 m/:id (Postgres, HTTP)', () => {
  let pg; let app; let runId;

  beforeAll(async () => {
    pg = await startPg();
    await ins.seedLibrary(pg.query);
    app = await startApp(pg, { now: NOW });
  }, 180000);
  afterAll(async () => { if (app) await app.close(); if (pg) await pg.close(); });

  async function world() {
    const q = pg.query;
    for (const id of [C, D, RM, RM2]) await seed.user(q, { id, role: 'coach' });
    for (const n of [1, 2, 3]) await seed.school(q, { id: SCH(n), n });
    await seed.school(q, { id: SCH(10), n: 10, region: 'Tarnol' });
    await seed.holds(q, { coachId: C, schoolId: SCH(1) });
    await seed.holds(q, { coachId: C, schoolId: SCH(2) });
    await seed.holds(q, { coachId: D, schoolId: SCH(3) });
    await seed.user(q, { id: T(1), schoolId: SCH(1) });
    await seed.user(q, { id: T(2), schoolId: SCH(1) });
    await seed.user(q, { id: T(3), schoolId: SCH(2) });
    await seed.user(q, { id: T(4), schoolId: SCH(3) });
    await seed.setting(q, 'portal_coachip', [C, D]);
    await seed.setting(q, 'portal_coachip_rm', { [RM]: 'Urban-I', [RM2]: 'Tarnol' });
    runId = await ins.jobRun(q, { date: '2026-10-26' });
  }
  beforeEach(async () => { await pg.truncate(); await world(); });

  // ── R14 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async function statsWorld() {
    const q = pg.query;
    const r = runId;
    await rollup(q, { coach: C, w: 'W-IP', n: 22, d: 49, recordings: 62, linked: 53, run: r });
    await rollup(q, { coach: C, w: 'W-IP-TIME', n: 17, d: 49, rank: 1, recordings: 62, linked: 53, run: r });
    await rollup(q, { coach: C, w: 'W-EXIT-TIME', n: 7, d: 17, status: 'insufficient', recordings: 62, linked: 53, run: r, computedAt: '2026-10-25T21:30:00Z' });
    await rollup(q, { coach: C, w: 'W-WARM', n: 5, d: 12, status: 'insufficient', recordings: 62, linked: 53, run: r });
    await rollup(q, { kind: 'sector', sector: 'Urban-I', w: 'W-IP-TIME', n: 171, d: 505, c5: 3, coachCount: 3, run: r });
    await rollup(q, { kind: 'sector', sector: 'Urban-I', w: 'W-WARM', n: 9, d: 46, c5: 2, status: 'insufficient', run: r });
    // a fico17 share on recordings without a plan: d 9 is under the coach floor, so the DB stores it as insufficient
    await rollup(q, { coach: C, w: 'W-Q', framework: 'fico17', n: 4, d: 9, status: 'insufficient', run: r });
    // the window before, under the old grader (the marker), and coach D's own rollups (never in C's payload)
    await rollup(q, { coach: C, w: 'W-IP-TIME', from: '2026-08-31', n: 20, d: 50, grader: G_OLD, run: r });
    await rollup(q, { coach: D, w: 'W-IP-TIME', n: 30, d: 60, run: r });
    // recordings per week: 09-28 one of two graded; 10-05 one of one; 10-12 none; 10-19 two of three (one failed)
    await rec(q, { n: 1, teacher: T(1), school: SCH(1), date: '2026-09-29', run: r });
    await rec(q, { n: 2, teacher: T(2), school: SCH(1), date: '2026-10-01', run: r, linked: false });
    await rec(q, { n: 3, teacher: T(3), school: SCH(2), date: '2026-10-06', run: r });
    await rec(q, { n: 4, teacher: T(1), school: SCH(1), date: '2026-10-20', run: r });
    await rec(q, { n: 5, teacher: T(3), school: SCH(2), date: '2026-10-24', run: r });
    await rec(q, { n: 6, teacher: T(2), school: SCH(1), date: '2026-10-25', run: r, status: 'failed' });
    await rec(q, { n: 7, teacher: T(4), school: SCH(3), date: '2026-10-21', run: r });   // coach D's teacher
  }

  test('R14 stats (marker): an earlier window under another grader → before set, every row before/change null', async () => {
    await statsWorld();
    const res = await app.call('GET', `${P}/stats`, { as: C });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const b = res.body;
    expectKeys(b, K.stats);
    everyCountResolves(b);
    noIdentity(res.text);
    expect(b.window_pair.now).toMatchObject({ id: 'w4-2026-09-28', from: '2026-09-28', to: '2026-10-25', weeks: 4, grader: G, framework: 'lp_fidelity', scoring_changed_on: '2026-09-28' });
    expect(b.window_pair.before).toMatchObject({ id: 'w4-2026-08-31', from: '2026-08-31', to: '2026-09-27', grader: G_OLD, scoring_changed_on: null });
    expect(b.rows.map((r) => r.w_id)).toEqual(['W-IP', 'W-IP-TIME', 'W-WARM']);   // catalogue order; W-EXIT-TIME is a cause line
    for (const r of b.rows) { expectKeys(r, K.statsRow); expect(r.before).toBeNull(); expect(r.change).toBeNull(); }
    const ipt = b.rows[1];
    expect(ipt.now).toEqual({ n: 17, d: 49, window_id: 'w4-2026-09-28' });
    expect(ipt.sector).toEqual({ n: 171, d: 505, window_id: 'w4-2026-09-28' });
    expect(ipt.short_name).toEqual(S.wCopy('W-IP-TIME').short_name);
    expect(ipt.status).toBe('ok');
    expect(b.rows[2]).toMatchObject({ status: 'insufficient', sector: null, now: { n: 5, d: 12 } });
    expect(b.rows[0].sector).toBeNull();
    expect(b.opening).toEqual({ state: 'marker', first_trend_after: '2026-11-22', scoring_changed_on: '2026-09-28' });
    expect(b.fico_panel).toHaveLength(1);
    expectKeys(b.fico_panel[0], K.fico);
    expect(b.fico_panel[0].lowest_share).toEqual({ n: 4, d: 9, window_id: 'fico17-w4-2026-09-28' });
    expect(b.fico_panel[0].label).toEqual(S.wCopy('W-Q').short_name);
    expect(b.recordings_by_week).toEqual([
      { week_start: '2026-09-28', graded: { n: 1, d: 2, window_id: 'week-2026-09-28' } },
      { week_start: '2026-10-05', graded: { n: 1, d: 1, window_id: 'week-2026-10-05' } },
      { week_start: '2026-10-12', graded: { n: 0, d: 0, window_id: 'week-2026-10-12' } },
      { week_start: '2026-10-19', graded: { n: 2, d: 3, window_id: 'week-2026-10-19' } },
    ]);
    expect(b.coverage).toEqual({ n: 53, d: 62, window_id: 'w4-2026-09-28' });
    expectKeys(b.method, K.method);
    expect(b.method).toMatchObject({ grader: G, framework: 'lp_fidelity' });
    expect(b.method.caveats).toHaveLength(1);
    expect(b.windows.map((w) => w.id)).toEqual(['w4-2026-08-31', 'fico17-w4-2026-09-28', 'w4-2026-09-28', 'week-2026-09-28', 'week-2026-10-05', 'week-2026-10-12', 'week-2026-10-19']);
    expect(b.computed_at).toBe('2026-10-25T21:40:00.000Z');
  });

  test('R14 stats (two_windows): same grader before → before counts and the change pill (5-point rule)', async () => {
    await statsWorld();
    await pg.query('UPDATE coachip_rollups SET grader_model = $1 WHERE window_start = $2', [G, '2026-08-31']);
    await rollup(pg.query, { coach: C, w: 'W-IP', from: '2026-08-31', n: 24, d: 50, run: runId });
    const b = (await app.call('GET', `${P}/stats`, { as: C })).body;
    everyCountResolves(b);
    expect(b.opening).toEqual({ state: 'two_windows', first_trend_after: '2026-10-25', scoring_changed_on: null });
    expect(b.window_pair.before.id).toBe('w4-2026-08-31');
    const [ip, ipt, warm] = b.rows;
    expect(ipt.before).toEqual({ n: 20, d: 50, window_id: 'w4-2026-08-31' });
    expect(ipt.change).toBe('fewer');          // 34.7% vs 40.0%: 5.3 points fewer
    expect(ip.before).toEqual({ n: 24, d: 50, window_id: 'w4-2026-08-31' });
    expect(ip.change).toBe('same');            // 44.9% vs 48.0%: under 5 points
    expect(warm.before).toBeNull();
    expect(warm.change).toBeNull();
    expect(b.method.caveats).toEqual([]);
  });

  test('R14 stats (first_window): no earlier window → before null, first_trend_after = now.to + 28', async () => {
    await statsWorld();
    await pg.query("DELETE FROM coachip_rollups WHERE window_start = '2026-08-31'");
    const b = (await app.call('GET', `${P}/stats`, { as: C })).body;
    everyCountResolves(b);
    expect(b.window_pair.before).toBeNull();
    expect(b.opening).toEqual({ state: 'first_window', first_trend_after: '2026-11-22', scoring_changed_on: null });
  });

  test('R14 stats: a coach with no rollups yet → 200 with empty rows, still every Count resolves', async () => {
    const res = await app.call('GET', `${P}/stats`, { as: C });
    expect(res.status).toBe(200);
    everyCountResolves(res.body);
    expect(res.body.rows).toEqual([]);
    expect(res.body.coverage).toEqual({ n: 0, d: 0, window_id: 'w4-2026-09-28' });
    expect(res.body.opening.state).toBe('first_window');
  });

  // ── R15 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  test('R15 results: cells of the coach\'s schools, latest term; < 5 tested → every count null, insufficient', async () => {
    const q = pg.query;
    await cell(q, { school: SCH(1), grade: 2, w: 'W-LS', tested: 12, n: 7, status: 'ok', run: runId });
    await cell(q, { school: SCH(1), grade: 2, w: 'W-LN', tested: 12, n: 5, status: 'ok', run: runId });
    await cell(q, { school: SCH(1), grade: 2, w: 'W-FW', tested: 12, status: 'not_measured', run: runId });
    await cell(q, { school: SCH(2), grade: 3, w: 'W-LS', tested: 3, status: 'insufficient', run: runId });
    await cell(q, { school: SCH(2), grade: 3, w: 'W-LN', tested: 3, status: 'insufficient', run: runId });
    await cell(q, { school: SCH(3), grade: 2, w: 'W-LS', tested: 9, n: 8, status: 'ok', run: runId });                  // coach D's school
    await cell(q, { school: SCH(1), grade: 2, w: 'W-LS', term: '2026-06-01', tested: 10, n: 9, status: 'ok', run: runId }); // an older term
    const res = await app.call('GET', `${P}/results`, { as: C });
    expect(res.status).toBe(200);
    const b = res.body;
    expectKeys(b, K.results);
    everyCountResolves(b);
    noIdentity(res.text);
    expect(res.text).not.toContain(SCH(3));
    expect(res.text).not.toMatch(/"T-\d{2,3}"/);
    expect(res.text).not.toContain('"code');
    expect(b.window).toMatchObject({ id: 'egra-2026-09-28', from: '2026-09-28', to: '2026-10-25', framework: 'egra', grader: 'egra-coach-tablet-v2' });
    expect(b.cells).toHaveLength(2);
    for (const c of b.cells) { expectKeys(c, K.cell); for (const r of c.rows) expectKeys(r, K.cellRow); }
    const [c1, c2] = b.cells;
    expect(c1).toMatchObject({ school: { school_id: SCH(1), school_name: 'Govt. Primary School Fictional-01' }, grade: 2, language: 'ur',
      tested: { n: 12, floor: 5, window_id: 'egra-2026-09-28' } });
    expect(c1.rows.map((r) => [r.w_id, r.count, r.status])).toEqual([
      ['W-LS', { n: 7, d: 12, window_id: 'egra-2026-09-28' }, 'ok'],
      ['W-LN', { n: 5, d: 12, window_id: 'egra-2026-09-28' }, 'ok'],
      ['W-FW', null, 'not_measured'],
    ]);
    expect(c1.i_id).toBe('I-LS-1');
    expect(c1.fln.can_send).toBe(true);
    expect(c1.fln.plan_ids.length).toBeGreaterThan(0);
    expect(c1.debrief_line.en).toMatch(/^Try this tomorrow: /);
    expect(c2).toMatchObject({ grade: 3, tested: { n: 3, floor: 5, window_id: 'egra-2026-09-28' }, fln: { plan_ids: [], can_send: false }, debrief_line: null, i_id: null });
    expect(c2.rows.map((r) => [r.w_id, r.count, r.status])).toEqual([['W-LS', null, 'insufficient'], ['W-LN', null, 'insufficient']]);
    expect(b.empty).toBeNull();
    expect(b.windows.map((w) => w.id)).toEqual(['egra-2026-09-28']);
  });

  test('R15 results: no reading check yet → cells [], empty pending', async () => {
    const res = await app.call('GET', `${P}/results`, { as: C });
    expect(res.status).toBe(200);
    everyCountResolves(res.body);
    expect(res.body.cells).toEqual([]);
    expect(res.body.empty).toMatchObject({ status: 'pending', detail: { graded: null, widened_to_weeks: null, as_of: null } });
    expect(res.body.empty.message.en).toBe('No reading check in your schools yet.');
  });

  // ── R5 / R6 ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function listenWorld() {
    const q = pg.query;
    const r = runId;
    await rec(q, { n: 1, teacher: T(1), school: SCH(1), date: '2026-10-23', run: r, audioS: 1620 });
    await rec(q, { n: 2, teacher: T(2), school: SCH(1), date: '2026-10-22', run: r });
    await rec(q, { n: 3, teacher: T(3), school: SCH(2), date: '2026-10-21', run: r });
    await rec(q, { n: 4, teacher: T(1), school: SCH(1), date: '2026-10-20', run: r });
    await rec(q, { n: 5, teacher: T(3), school: SCH(2), date: '2026-10-20', run: r });
    await rec(q, { n: 6, teacher: T(2), school: SCH(1), date: '2026-10-21', run: r, linked: false });
    await rec(q, { n: 7, teacher: T(3), school: SCH(2), date: '2026-10-21', run: r, status: 'failed', audioS: 1480 });
    await rec(q, { n: 8, teacher: T(4), school: SCH(3), date: '2026-10-22', run: r });   // coach D's teacher
    await rec(q, { n: 9, teacher: T(1), school: SCH(1), date: '2026-10-13', run: r });   // the week before
    await ins.moment(q, { id: MOM(1), factId: FACT(1), sessionId: SESS(1), wId: 'W-IP-TIME', from: 1180, to: 1214 });
    await ins.moment(q, { id: MOM(2), factId: FACT(2), sessionId: SESS(2), wId: 'W-IP-TIME', from: 1250, to: 1286, clip: 'failed', confidence: 'medium' });
    await ins.moment(q, { id: MOM(3), factId: FACT(3), sessionId: SESS(3), wId: 'W-IP-TIME', kind: 'good', from: 905, to: 946, credit: 0.9 });
    await ins.moment(q, { id: MOM(4), factId: FACT(4), sessionId: SESS(4), wId: 'W-EXIT-NOPLAN', phase: 'exit', from: 1370, to: 1405 });
    await ins.moment(q, { id: MOM(5), factId: FACT(8), sessionId: SESS(8), wId: 'W-IP-TIME', from: 1000, to: 1030 });
    await ins.moment(q, { id: MOM(6), factId: FACT(9), sessionId: SESS(9), wId: 'W-IP-TIME', from: 1122, to: 1160 });
    await ins.sessionSteps(q, FACT(1), [['warm', 'executed', 0, 150], ['explain', 'executed', 150, 900], ['ip', 'not_done', 1180, 1500]]);
    await q(`INSERT INTO coachip_circle_items (sector, week_start, coach_user_id, moment_id, job_run_id) VALUES ('Urban-I', '2026-10-26', $1, $2, $3)`, [C, MOM(1), r]);
  }

  test('R5 moments?week=: the week\'s graded recordings, newest first, filters on base.d, failed sessions, nothing of coach D', async () => {
    await listenWorld();
    const res = await app.call('GET', `${P}/moments?week=2026-10-19`, { as: C });
    expect(res.status).toBe(200);
    const b = res.body;
    expectKeys(b, K.moments);
    everyCountResolves(b);
    noIdentity(res.text);
    for (const id of [MOM(5), SESS(8), SCH(3)]) expect(res.text).not.toContain(id);
    expect(b.window).toMatchObject({ id: 'week-2026-10-19', from: '2026-10-19', to: '2026-10-25', weeks: 1, framework: 'lp_fidelity' });
    expect(b.recordings).toEqual({ n: 5, d: 7, window_id: 'week-2026-10-19' });
    expect(b.base).toEqual({ n: 4, d: 5, window_id: 'week-2026-10-19' });
    expect(b.filters.map((f) => [f.w_id, f.count])).toEqual([
      ['W-IP-TIME', { n: 2, d: 5, window_id: 'week-2026-10-19' }],
      ['W-EXIT-NOPLAN', { n: 1, d: 5, window_id: 'week-2026-10-19' }],
      ['good', { n: 1, d: 5, window_id: 'week-2026-10-19' }],
    ]);
    expect(b.filters[2].short_name).toEqual({ en: 'Good examples', ur: 'اچھی مثالیں' });
    expect(b.moments.map((m) => m.moment_id)).toEqual([MOM(1), MOM(2), MOM(3), MOM(4)]);
    for (const m of b.moments) {
      expectKeys(m, K.moment);
      expect(m.pair).toBeNull();
      expect(m.steps).toEqual([]);
      expect(m.code.code).toMatch(/^T-\d{2,3}$/);
    }
    expect(b.moments[1].clip.status).toBe('failed');
    expect(b.moments[0].session).toMatchObject({ session_id: SESS(1), recorded_on: '2026-10-23', duration_s: 1620 });
    expect(b.failed_sessions).toEqual([{ session_id: SESS(7), school: { school_id: SCH(2), school_name: 'Govt. Primary School Fictional-02' }, recorded_on: '2026-10-21', duration_s: 1480 }]);
    for (const f of b.failed_sessions) expectKeys(f, K.failed);
    expect(b.windows.map((w) => w.id)).toEqual(['week-2026-10-19']);
  });

  test('R5 moments: ?w= a W, ?w=good, an unknown W → 404, a non-Monday week → 400, default week = this Monday', async () => {
    await listenWorld();
    const w = await app.call('GET', `${P}/moments?week=2026-10-19&w=W-IP-TIME`, { as: C });
    expect(w.body.moments.map((m) => m.moment_id)).toEqual([MOM(1), MOM(2)]);
    expect(w.body.filters).toHaveLength(3);
    const good = await app.call('GET', `${P}/moments?week=2026-10-19&w=good`, { as: C });
    expect(good.body.moments.map((m) => m.moment_id)).toEqual([MOM(3)]);
    const unknown = await app.call('GET', `${P}/moments?w=W-NOT-A-WEAKNESS`, { as: C });
    expect([unknown.status, unknown.text]).toEqual([404, '{"error":"not_found"}']);
    const bad = await app.call('GET', `${P}/moments?week=2026-10-20`, { as: C });
    expect([bad.status, bad.text]).toEqual([400, '{"error":"bad_request"}']);
    const now = await app.call('GET', `${P}/moments`, { as: C });
    expect(now.status).toBe(200);
    expect(now.body.window.id).toBe('week-2026-10-26');
    expect(now.body.moments).toEqual([]);
    expect(now.body.recordings).toEqual({ n: 0, d: 0, window_id: 'week-2026-10-26' });
    everyCountResolves(now.body);
    const before = await app.call('GET', `${P}/moments?week=2026-10-12`, { as: C });
    expect(before.body.moments.map((m) => m.moment_id)).toEqual([MOM(6)]);
  });

  test('R6 m/:id (coach): the Moment with its pair inside the coach\'s scope; windows []', async () => {
    await listenWorld();
    const res = await app.call('GET', `${P}/m/${MOM(1)}`, { as: C });
    expect(res.status).toBe(200);
    const b = res.body;
    expectKeys(b, [...K.moment, 'windows', 'computed_at']);
    noIdentity(res.text);
    expect(b.windows).toEqual([]);
    expect(b.moment_id).toBe(MOM(1));
    expect(b.steps.map((s) => [s.phase, s.verdict])).toEqual([['warm', 'executed'], ['explain', 'executed'], ['ip', 'not_done']]);
    expect(b.pair.moment_id).toBe(MOM(3));
    expect(b.pair.pair).toBeNull();
    expect(b.full_recording).toEqual({ duration_s: 1620 });
    expect(b.computed_at).toBe('2026-10-25T21:40:00.000Z');
  });

  test('R6 m/:id step labels (fix-r5 s2 item 1, B17): every grader phase reads a COPY word in EN and UR, an unknown phase the COPY fallback, never the enum', async () => {
    await listenWorld();
    const phases = ['announce', 'hook', 'warm_up', 'recall', 'explain', 'guided', 'independent', 'peer_review', 'exit', 'homework', 'xyz'];
    await ins.sessionSteps(pg.query, FACT(2), phases.map((p, i) => [p, 'executed', i * 100, i * 100 + 90]));
    const res = await app.call('GET', `${P}/m/${MOM(2)}`, { as: C });
    expect(res.status).toBe(200);
    const WARM = { en: 'Warm-up', ur: 'آغاز' };
    expect(res.body.steps.map((s) => [s.phase, s.label])).toEqual([
      ['announce', WARM], ['hook', WARM], ['warm_up', WARM], ['recall', WARM],
      ['explain', { en: 'Explain', ur: 'وضاحت' }],
      ['guided', { en: 'Guided', ur: 'مل کر' }],
      ['independent', { en: 'Practice', ur: 'خود مشق' }],
      ['peer_review', { en: 'Peer check', ur: 'ساتھیوں کی جانچ' }],
      ['exit', { en: 'Exit', ur: 'جانچ' }],
      ['homework', { en: 'Homework', ur: 'گھر کا کام' }],
      ['xyz', { en: 'Another step', ur: 'کوئی اور مرحلہ' }],
    ]);
    for (const s of res.body.steps) for (const v of Object.values(s.label)) expect(v).not.toMatch(/_|xyz/);
  });

  test('R6 m/:id: another coach\'s moment, an invented id → one 404 body; coach D cannot open C\'s moment', async () => {
    await listenWorld();
    const invented = await app.call('GET', `${P}/m/${INVENTED}`, { as: C });
    expect([invented.status, invented.text]).toEqual([404, '{"error":"not_found"}']);
    const other = await app.call('GET', `${P}/m/${MOM(5)}`, { as: C });
    expect([other.status, other.text]).toEqual([404, invented.text]);
    const d = await app.call('GET', `${P}/m/${MOM(1)}`, { as: D });
    expect([d.status, d.text]).toEqual([404, invented.text]);
  });

  test('R6 m/:id (RM): the circle form for a moment in this week\'s circle; nothing else, no code, no session', async () => {
    await listenWorld();
    const res = await app.call('GET', `${P}/m/${MOM(1)}`, { as: RM });
    expect(res.status).toBe(200);
    const b = res.body;
    expectKeys(b, K.momentRm);
    noIdentity(res.text);
    noTeacherInRm(b);
    expect(res.text).not.toContain(SESS(1));
    expect(b).toMatchObject({ moment_id: MOM(1), coach_label: 'C-01', pair: null, full_recording: null, kind: 'missing', lesson_s: 1180,
      school: { school_id: SCH(1), school_name: 'Govt. Primary School Fictional-01' }, windows: [] });
    expect(b.clip).toEqual({ from_s: 1180, to_s: 1214, duration_s: 34, status: 'ready' });
    expect(b.steps.map((s) => s.phase)).toEqual(['warm', 'explain', 'ip']);
    expect(b.w.w_id).toBe('W-IP-TIME');
    const invented = await app.call('GET', `${P}/m/${INVENTED}`, { as: RM });
    for (const [as, m] of [[RM, MOM(2)], [RM2, MOM(1)]]) {
      const r = await app.call('GET', `${P}/m/${m}`, { as });
      expect([as, m, r.status, r.text]).toEqual([as, m, 404, invented.text]);
    }
  });
});
