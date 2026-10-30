'use strict';
/**
 * bd-sex15q.13 (worker w-listen) — the three RM reads over HTTP, through the real router, flag readers, scope and codec
 * services, against a throwaway Postgres (contracts/API.md §9 R17, R18, R20; §3 Coach, WRow, Note; §8.4 needs-me).
 *
 *   R17 GET /coachip/rm/home            the Monday sector card
 *   R18 GET /coachip/rm/coach/:coachId  one coach (404 unless the coach holds a school in the RM's sector)
 *   R20 GET /coachip/rm/circle          the Friday circle
 *
 * Fictional rows only (FIXTURES rules): schools "Govt. Primary School Fictional-NN", users.name null, fake v4 ids. The
 * world: sector Urban-I, three coaches holding schools (labels by first school name: CB → C-01, CA → C-02, CC → C-03),
 * one roster coach holding none, one unheld school; a second RM for Tarnol with its own coach and circle.
 *
 * Every payload is checked for: the fixture's key sets (contracts/fixtures.json rm_home / rm_coach / rm_circle, listed
 * below), every Count resolving to a Window in the same body with n ≤ d, and no teacher reference at all (no code,
 * code_id, teacher_key or session_id key, no T-code, no teacher users.id, no 16-hex value, no URL).
 */
const crypto = require('crypto');
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const seed = require('./helpers/seed');
const { startApp } = require('./helpers/app');
const S = require('../../dashboard/services/coachip-shapes');
const { teacherKeyFor } = require('../../dashboard/services/coachip-codes.service');

const run = hasPostgres() ? describe : describe.skip;
const { fid } = seed;
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday 26 Oct 2026, 11:00 PKT
const P = '/api/portal/coachip';
const INVENTED = '00000000-0000-4000-8000-ff0000000001';
const GRADER = 'google/gemini-3.8-flash';
const FW = 'lp_fidelity';
const PIPE = 'coachip-1.0.0';

const RM = fid('rm', 1);        // Urban-I
const RM2 = fid('rm', 2);       // Tarnol
const CA = fid('coach', 1);     // S-03, S-04 → C-02
const CB = fid('coach', 2);     // S-01, S-02 → C-01
const CC = fid('coach', 3);     // S-05 → C-03
const CT = fid('coach', 4);     // Tarnol S-10
const CX = fid('coach', 9);     // on the Urban-I roster, holds no school
const SCH = (n) => fid('school', n);
const T = (n) => fid('teacher', n);
const SESS = (n) => fid('session', n);
const MOM = (n) => fid('moment', n);
const FACT = (n) => fid('fact', n);
const TEACHERS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(T);

// ── the fixture's key sets (contracts/fixtures.json v2.2) ─────────────────────────────────────────────────────────
const K = {
  rmHome: ['sector', 'window', 'opening', 'moves', 'groups', 'on_track_count', 'no_scope_coaches', 'unassigned_schools', 'circle', 'cluster', 'monday', 'stale', 'empty', 'windows', 'computed_at'],
  opening: ['visited', 'unobserved_schools', 'unobserved_codes', 'floor_weeks'],
  move: ['row', 'by_school', 'agenda', 'coach_count', 'coaches_with_5plus'],
  wrow: ['w_id', 'short_name', 'sentence', 'count', 'window', 'state', 'where_first', 'not_yet', 'sector'],
  notYet: ['graded', 'codes_seen', 'codes_needed', 'coaches_with_5plus'],
  coach: ['coach_user_id', 'coach_label', 'activity', 'needs_me_reason', 'note_open'],
  activity: ['schools_unvisited', 'debriefs_with_step', 'checks_overdue'],
  note: ['id', 'label', 'template_id', 'w_id', 'lines', 'schools', 'due_on', 'status'],
  window: ['id', 'from', 'to', 'weeks', 'grader', 'grader_label', 'framework', 'scoring_changed_on'],
  rmCoach: ['coach', 'schools', 'steps', 'moves', 'notes', 'calibration', 'windows', 'computed_at'],
  rmCoachSchool: ['school', 'last_visit', 'next_visit', 'graded', 'weeks_since_visit'],
  rmCircle: ['week_start', 'window', 'basis', 'floor', 'sector_interventions', 'moments', 'checks_due', 'windows', 'computed_at'],
  sectorI: ['i_id', 'title', 'level', 'date', 'attendees', 'check'],
  circleMoment: ['coach_user_id', 'coach_label', 'moment_id', 'w_id', 'short_name', 'school', 'duration_s'],
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
      if ('d' in v) {
        if (!Number.isInteger(v.n) || !Number.isInteger(v.d) || v.n < 0 || v.n > v.d) throw new Error(`${path}: bad Count ${JSON.stringify(v)}`);
      }
    }
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  }(body, '$'));
  // every Window listed is a full Window
  for (const w of body.windows || []) expectKeys(w, K.window);
  return counted;
}
/** Rule 2 (API §1): nothing that names or keys a teacher, no URL, no bucket key. */
function noIdentity(text) {
  for (const id of TEACHERS) expect(text).not.toContain(id);
  expect(text).not.toMatch(/"[0-9a-f]{16}"/);
  expect(text).not.toContain('http');
  expect(text).not.toContain('X-Amz-');
  expect(text).not.toContain('r2.cloudflarestorage');
}
/** RM payloads (FIXTURES §1): no code, code_id, teacher_key or session_id key, no T-code value. */
function noTeacherInRm(body) {
  (function walk(v, path) {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (typeof v === 'string') { if (/^T-\d{2,3}$/.test(v)) throw new Error(`${path}: T-code ${v}`); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (['code', 'code_id', 'teacher_key', 'session_id', 'name', 'phone', 'url'].includes(k)) throw new Error(`${path}.${k}: forbidden key in an RM payload`);
      walk(x, `${path}.${k}`);
    }
  }(body, '$'));
}

// ── seed helpers (fictional rows; parents first, as the FKs need) ─────────────────────────────────────────────────
async function seedLibrary(q) {
  const lib = S.library().raw;
  const done = new Set();
  const byId = new Map(lib.weaknesses.map((w) => [w.id, w]));
  async function put(w) {
    if (done.has(w.id)) return;
    if (w.parent_w_id) await put(byId.get(w.parent_w_id));
    await q(`INSERT INTO coachip_weaknesses (w_id, parent_w_id, primary_source, pedagogical_weight, is_s1_eligible, is_s7, is_cause_line,
               short_name_en, short_name_ur, library_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [w.id, w.parent_w_id || null, w.stream, Number(w.pedagogical_weight) || 0.5, !!w.s1_eligible, !!w.is_s7, !!w.is_cause_line,
      String(w.short_name_en || w.name_en).slice(0, 60), String(w.short_name_ur || w.name_ur).slice(0, 60), String(w.library_version || lib.library_version)]);
    done.add(w.id);
  }
  for (const w of lib.weaknesses) await put(w);
  for (const i of lib.interventions) {
    await q(`INSERT INTO coachip_interventions (i_id, w_id, level, rank_in_w, library_version) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [i.id, i.weakness_id, i.level, i.rank_in_w || 1, String(i.library_version || lib.library_version)]);
  }
}
async function jobRun(q, { runDate = '2026-10-26', status = 'ok' } = {}) {
  const { rows } = await q(`INSERT INTO coachip_job_runs (run_date, pipeline_version, env_ref, started_at, finished_at, status, failure_class)
    VALUES ($1, $2, 'olvritwoqujtjvwfulbh', $3, $3, $4, $5) RETURNING id`,
  [runDate, PIPE, `${runDate}T00:00:00Z`, status, status === 'failed' ? 'http' : null]);
  return rows[0].id;
}
const key = (teacherId) => teacherKeyFor(seed.SECRET, teacherId);
async function session(q, id, teacherId, at) {
  await q('INSERT INTO coaching_sessions (id, user_id, created_at) VALUES ($1, $2, $3)', [id, teacherId, at]);
}
async function fact(q, { id, sessionId, teacherId, schoolId, sector = 'Urban-I', at, run: jobRunId, status = 'ok', linked = true, audioS = 1600 }) {
  await session(q, sessionId, teacherId, at);
  await q(`INSERT INTO coachip_session_facts (id, session_id, teacher_key, school_id, sector, recorded_at, is_observed, job_run_id, grader_model,
             framework_version, pipeline_version, input_hash, status, failure_class, is_mismatch, is_unusable, is_duplicate, is_lp_linked,
             subject, grade, audio_s, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11,$12,$13,false,false,false,$14,'Urdu',3,$15,'2026-10-25T21:40:00Z')`,
  [id, sessionId, key(teacherId), schoolId, sector, at, jobRunId, GRADER, FW, PIPE, crypto.createHash('sha256').update(id).digest('hex'),
    status, status === 'failed' ? 'http' : null, linked, audioS]);
}
async function moment(q, { id, factId, sessionId, w, from, to, kind = 'missing' }) {
  await q(`INSERT INTO coachip_moments (id, fact_id, session_id, w_id, kind, phase, from_s, to_s, moment_s, confidence, gloss_status, clip_r2_key, clip_status)
           VALUES ($1,$2,$3,$4,$5,'ip',$6,$7,$6,'high','pending',$8,'ready')`,
  [id, factId, sessionId, w, kind, from, to, `coachip/clips/sandbox/${sessionId}/${from}-${to}.mp3`]);
}
async function rollup(q, o) {
  const weeks = o.weeks || 4;
  const from = o.from || '2026-09-28';
  await q(`INSERT INTO coachip_rollups (scope_kind, coach_user_id, school_id, sector, w_id, window_start, window_end, window_weeks, numerator,
             denominator, teacher_count, coach_count, coaches_with_5plus, recordings, recordings_linked, rank, grader_model, framework_version,
             pipeline_version, status, job_run_id, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6::date,$6::date + $7::int * 7 - 1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
  [o.kind, o.coach || null, o.school || null, o.sector || null, o.w, from, weeks, o.n, o.d, o.teachers || 3, o.coachCount || 1, o.c5 === undefined ? 1 : o.c5,
    o.recordings || 0, o.linked || 0, o.rank || null, o.grader || GRADER, o.framework || FW, PIPE, o.status || 'ok', o.run, o.computedAt || '2026-10-25T21:40:00Z']);
}
async function visit(q, { id = null, coach, schoolId, date, status = 'done', sessionId = null }) {
  const { rows } = await q(`INSERT INTO observation_schedules (id, leader_user_id, school_ext_id, teacher_ext_id, scheduled_for, status, session_id, school_id)
    VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, 'niete:fixture', 'fixture-teacher', $3, $4, $5, $6) RETURNING id`, [id, coach, date, status, sessionId, schoolId]);
  return rows[0].id;
}
async function step(q, codes, { coach, teacherId, schoolId, w, i, setAt, checkBy, status = 'open', sourceSessionId = null }) {
  const code = await codes.codeFor(coach, key(teacherId));
  const { rows } = await q(`INSERT INTO coachip_steps (coach_user_id, scope, code_id, school_id, w_id, i_id, source_session_id, set_at, check_by, check_by_rule, status)
    VALUES ($1,'coach',$2,$3,$4,$5,$6,$7,$8,'14_days',$9) RETURNING id`, [coach, code.code_id, schoolId, w, i, sourceSessionId, setAt, checkBy, status]);
  return rows[0].id;
}
async function note(q, { id, rm = RM, coach, sector = 'Urban-I', w = 'W-IP-TIME', template = 'RM-T1', status = 'sent', dueOn = '2026-10-30', schools, createdAt }) {
  await q(`INSERT INTO coachip_rm_notes (id, rm_user_id, coach_user_id, sector, w_id, template_id, body_en, body_ur, due_on, status, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, rm, coach, sector, w, template, 'line one\nline two\nline three', 'سطر ۱\nسطر ۲\nسطر ۳', dueOn, status, createdAt]);
  for (const [i, s] of schools.entries()) {
    await q('INSERT INTO coachip_rm_note_schools (rm_note_id, school_id, position) VALUES ($1,$2,$3)', [id, s, i + 1]);
  }
}

run('COACHIP RM reads: R17 rm/home, R18 rm/coach/:id, R20 rm/circle (Postgres, HTTP)', () => {
  let pg; let app; let ids;

  beforeAll(async () => {
    pg = await startPg();
    await seedLibrary(pg.query);
    app = await startApp(pg, { now: NOW });
  }, 180000);
  afterAll(async () => { if (app) await app.close(); if (pg) await pg.close(); });

  async function world() {
    const q = pg.query;
    ids = {};
    for (const id of [RM, RM2, CA, CB, CC, CT, CX]) await seed.user(q, { id, role: 'coach' });
    for (let n = 1; n <= 6; n += 1) await seed.school(q, { id: SCH(n), n });
    await seed.school(q, { id: SCH(10), n: 10, region: 'Tarnol' });
    await seed.holds(q, { coachId: CB, schoolId: SCH(1) });
    await seed.holds(q, { coachId: CB, schoolId: SCH(2) });
    await seed.holds(q, { coachId: CA, schoolId: SCH(4) });
    await seed.holds(q, { coachId: CA, schoolId: SCH(3) });
    await seed.holds(q, { coachId: CC, schoolId: SCH(5) });
    await seed.holds(q, { coachId: CT, schoolId: SCH(10) });
    const at = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 3, 6: 4, 7: 5, 8: 6, 9: 10 };
    for (const [t, s] of Object.entries(at)) await seed.user(q, { id: T(Number(t)), role: 'teacher', schoolId: SCH(s) });
    await seed.setting(q, 'portal_coachip_rm', { [RM]: 'Urban-I', [RM2]: 'Tarnol' });
    await seed.setting(q, 'analytics_rdf_coaches', { coaches: [
      { name: 'Fictional Coach A', sector: 'Urban-I', userIds: [CA] },
      { name: 'Fictional Coach B', sector: 'Urban-I', userIds: [CB] },
      { name: 'Fictional Coach C', sector: 'Urban-I', userIds: [CC] },
      { name: 'Fictional Coach X', sector: 'Urban-I', userIds: [CX] },
      { name: 'Fictional Coach T', sector: 'Tarnol', userIds: [CT] },
    ] });

    // visits (done unless said): CB S-02 last seen 46 days ago (unvisited ≥ 5 weeks); CA a booked S-03 visit on 28 Oct
    await visit(q, { coach: CB, schoolId: SCH(1), date: '2026-10-20' });
    await visit(q, { coach: CB, schoolId: SCH(2), date: '2026-09-10' });
    await visit(q, { coach: CA, schoolId: SCH(3), date: '2026-10-14', sessionId: SESS(1) });
    await visit(q, { coach: CA, schoolId: SCH(4), date: '2026-10-22' });
    ids.nextVisit = await visit(q, { coach: CA, schoolId: SCH(3), date: '2026-10-28', status: 'upcoming' });
    await visit(q, { coach: CC, schoolId: SCH(5), date: '2026-10-01', sessionId: SESS(3) });

    const r = await jobRun(q);
    ids.run = r;
    await fact(q, { id: FACT(1), sessionId: SESS(1), teacherId: T(4), schoolId: SCH(3), at: '2026-10-13T05:00:00Z', run: r });
    await fact(q, { id: FACT(2), sessionId: SESS(2), teacherId: T(5), schoolId: SCH(3), at: '2026-10-21T05:00:00Z', run: r });
    await fact(q, { id: FACT(3), sessionId: SESS(3), teacherId: T(7), schoolId: SCH(5), at: '2026-09-30T05:00:00Z', run: r });
    await fact(q, { id: FACT(4), sessionId: SESS(4), teacherId: T(1), schoolId: SCH(1), at: '2026-10-20T05:00:00Z', run: r });
    await fact(q, { id: FACT(5), sessionId: SESS(5), teacherId: T(9), schoolId: SCH(10), sector: 'Tarnol', at: '2026-10-21T05:00:00Z', run: r });
    await moment(q, { id: MOM(1), factId: FACT(2), sessionId: SESS(2), w: 'W-IP-TIME', from: 1100, to: 1138 });
    await moment(q, { id: MOM(2), factId: FACT(4), sessionId: SESS(4), w: 'W-EXIT-NOPLAN', from: 1300, to: 1331 });
    await moment(q, { id: MOM(3), factId: FACT(5), sessionId: SESS(5), w: 'W-IP-TIME', from: 900, to: 940 });
    const circle = (sector, coach, m) => q(`INSERT INTO coachip_circle_items (sector, week_start, coach_user_id, moment_id, job_run_id)
      VALUES ($1, '2026-10-26', $2, $3, $4)`, [sector, coach, m, r]);
    await circle('Urban-I', CA, MOM(1));
    await circle('Urban-I', CB, MOM(2));
    await circle('Tarnol', CT, MOM(3));

    // rollups: sector (W-IP-TIME ranked; W-WARM under B23; W-EXIT-NOPLAN ok, unranked), schools, coach CA
    await rollup(q, { kind: 'sector', sector: 'Urban-I', w: 'W-IP-TIME', n: 20, d: 50, c5: 3, coachCount: 3, rank: 1, teachers: 6, run: r });
    await rollup(q, { kind: 'sector', sector: 'Urban-I', w: 'W-WARM', n: 10, d: 46, c5: 2, coachCount: 3, status: 'insufficient', teachers: 5, run: r });
    await rollup(q, { kind: 'sector', sector: 'Urban-I', w: 'W-EXIT-NOPLAN', n: 12, d: 44, c5: 3, coachCount: 3, run: r });
    await rollup(q, { kind: 'school', school: SCH(1), w: 'W-IP-TIME', n: 7, d: 12, run: r });
    await rollup(q, { kind: 'school', school: SCH(3), w: 'W-IP-TIME', n: 6, d: 9, run: r });
    await rollup(q, { kind: 'school', school: SCH(5), w: 'W-IP-TIME', n: 6, d: 10, run: r });
    await rollup(q, { kind: 'school', school: SCH(4), w: 'W-IP-TIME', n: 2, d: 8, run: r });
    await rollup(q, { kind: 'coach', coach: CA, w: 'W-IP-TIME', n: 8, d: 21, rank: 1, recordings: 3, linked: 2, run: r });
    await rollup(q, { kind: 'coach', coach: CA, w: 'W-EXIT-NOPLAN', n: 5, d: 20, rank: 2, recordings: 3, linked: 2, run: r });

    // steps: CA one open (from the 14 Oct debrief), one completed this month, one cancelled in September; CC one overdue
    ids.stepA = await step(q, app.codes, { coach: CA, teacherId: T(4), schoolId: SCH(3), w: 'W-IP-TIME', i: 'I-IP-TIME-1', setAt: '2026-10-14T05:00:00Z', checkBy: '2026-10-28', sourceSessionId: SESS(1) });
    await step(q, app.codes, { coach: CA, teacherId: T(5), schoolId: SCH(3), w: 'W-EXIT-NOPLAN', i: 'I-EXIT-NOPLAN-1', setAt: '2026-10-05T05:00:00Z', checkBy: '2026-10-19', status: 'completed' });
    await step(q, app.codes, { coach: CA, teacherId: T(6), schoolId: SCH(4), w: 'W-IP-TIME', i: 'I-IP-TIME-1', setAt: '2026-09-20T05:00:00Z', checkBy: '2026-10-04', status: 'cancelled' });
    await step(q, app.codes, { coach: CC, teacherId: T(7), schoolId: SCH(5), w: 'W-EXIT-NOPLAN', i: 'I-EXIT-NOPLAN-1', setAt: '2026-10-01T05:00:00Z', checkBy: '2026-10-15', sourceSessionId: SESS(3) });
    // the RM's sector step (the cluster session): set today, so its check is today + 14
    await q(`INSERT INTO coachip_steps (coach_user_id, scope, sector, w_id, i_id, set_at, check_by, check_by_rule)
      VALUES ($1, 'sector', 'Urban-I', 'W-IP-TIME', 'I-IP-TIME-3', '2026-10-26T05:00:00Z', '2026-11-09', '14_days')`, [RM]);
    // notes: one open RM-T1 to CA, one older dismissed; one from the Tarnol RM to CT
    await note(q, { id: fid('note', 1), coach: CA, schools: [SCH(3)], createdAt: '2026-10-20T05:00:00Z' });
    await note(q, { id: fid('note', 2), coach: CA, status: 'dismissed', template: 'RM-T2', schools: [SCH(4)], createdAt: '2026-10-06T05:00:00Z', dueOn: '2026-10-09' });
    await note(q, { id: fid('note', 3), rm: RM2, coach: CT, sector: 'Tarnol', schools: [SCH(10)], createdAt: '2026-10-20T05:00:00Z' });
  }

  beforeEach(async () => { await pg.truncate(); await world(); });

  // ── R17 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  test('R17 rm/home: the fixture shape, counts on server-owned bases, groups by first school, never a teacher', async () => {
    const res = await app.call('GET', `${P}/rm/home`, { as: RM });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const b = res.body;
    expectKeys(b, K.rmHome);
    expect(everyCountResolves(b)).toBeGreaterThan(10);
    noIdentity(res.text);
    noTeacherInRm(b);

    expect(b.sector).toBe('Urban-I');
    expectKeys(b.window, K.window);
    expect(b.window).toMatchObject({ id: 'w4-2026-09-28', from: '2026-09-28', to: '2026-10-25', weeks: 4, grader: GRADER, framework: 'lp_fidelity' });
    expect(b.windows.map((w) => w.id)).toEqual(['w4-2026-09-28', 'act-4w-2026-10-26', 'act-m-2026-10', 'week-2026-10-19']);

    expectKeys(b.opening, K.opening);
    expect(b.opening.visited).toEqual({ n: 4, d: 6, window_id: 'act-4w-2026-10-26' });
    expect(b.opening.unobserved_schools).toEqual({ n: 2, d: 6, window_id: 'act-4w-2026-10-26' });
    expect(b.opening.unobserved_codes).toEqual({ n: 4, d: 8, window_id: 'act-4w-2026-10-26' });
    expect(b.opening.floor_weeks).toBe(4);

    expect(b.moves).toHaveLength(2);
    const [m1, m2] = b.moves;
    expectKeys(m1, K.move);
    expectKeys(m1.row, K.wrow);
    expect(m1.row).toMatchObject({ w_id: 'W-IP-TIME', state: 'ranked', count: { n: 20, d: 50, window_id: 'w4-2026-09-28' }, not_yet: null, sector: null });
    expect(m1.row.short_name).toEqual(S.wCopy('W-IP-TIME').short_name);
    expect(m1.by_school.map((x) => x.school.school_id)).toEqual([SCH(1), SCH(3), SCH(5)]);
    expect(m1.by_school[0].count).toEqual({ n: 7, d: 12, window_id: 'w4-2026-09-28' });
    expect(m1.row.where_first).toEqual(m1.by_school[0]);
    expect(m1).toMatchObject({ agenda: true, coach_count: 3, coaches_with_5plus: 3 });
    expect(m2.row).toMatchObject({ w_id: 'W-WARM', state: 'not_yet', count: null, where_first: null, sector: null });
    expectKeys(m2.row.not_yet, K.notYet);
    expect(m2.row.not_yet).toMatchObject({ graded: null, codes_needed: 3, coaches_with_5plus: 2 });
    expect(m2).toMatchObject({ by_school: [], agenda: false, coach_count: 3, coaches_with_5plus: 2 });

    // groups: needs me C-01 (CB, unvisited ≥ 5 weeks) then C-03 (CC, checks overdue); on track C-02 (CA)
    expect(b.groups.needs_me.map((c) => [c.coach_label, c.coach_user_id, c.needs_me_reason])).toEqual([
      ['C-01', CB, 'unvisited'], ['C-03', CC, 'checks_overdue']]);
    expect(b.groups.on_track.map((c) => [c.coach_label, c.coach_user_id, c.needs_me_reason])).toEqual([['C-02', CA, null]]);
    for (const c of [...b.groups.needs_me, ...b.groups.on_track]) { expectKeys(c, K.coach); expectKeys(c.activity, K.activity); }
    const ca = b.groups.on_track[0];
    expect(ca.activity).toEqual({
      schools_unvisited: { n: 0, d: 2, window_id: 'act-4w-2026-10-26' },
      debriefs_with_step: { n: 1, d: 2, window_id: 'act-m-2026-10' },
      checks_overdue: { n: 0, d: 2, window_id: 'act-4w-2026-10-26' },
    });
    expectKeys(ca.note_open, K.note);
    expect(ca.note_open).toMatchObject({ id: fid('note', 1), template_id: 'RM-T1', status: 'sent', due_on: '2026-10-30', schools: [{ school_id: SCH(3), school_name: 'Govt. Primary School Fictional-03' }] });
    const cb = b.groups.needs_me[0];
    expect(cb.activity.schools_unvisited).toEqual({ n: 1, d: 2, window_id: 'act-4w-2026-10-26' });
    expect(cb.note_open).toBeNull();
    const cc = b.groups.needs_me[1];
    expect(cc.activity.checks_overdue).toEqual({ n: 1, d: 1, window_id: 'act-4w-2026-10-26' });
    expect(cc.activity.debriefs_with_step).toEqual({ n: 1, d: 1, window_id: 'act-m-2026-10' });

    expect(b.on_track_count).toEqual({ n: 1, d: 3, window_id: 'act-4w-2026-10-26' });
    expect(b.no_scope_coaches).toEqual({ n: 1, d: 4, window_id: 'act-4w-2026-10-26' });
    expect(b.unassigned_schools).toEqual({ n: 1, d: 6, window_id: 'act-4w-2026-10-26' });
    expect(b.circle.moments).toEqual({ n: 2, d: 3, window_id: 'week-2026-10-19' });
    expect(b.circle.checks_due).toEqual({ n: 2, d: 2, window_id: 'act-4w-2026-10-26' });
    expect(b.cluster).toMatchObject({ i_id: 'I-IP-TIME-3', date: '2026-10-26' });
    expect(b.cluster.title.en).toBe(S.library().intervention('I-IP-TIME-3').title_en);
    expect(b.monday.templates.map((t) => t.template_id)).toEqual(['RM-T1', 'RM-T2', 'RM-T3', 'RM-T4']);
    for (const t of b.monday.templates) { expect(typeof t.title.en).toBe('string'); expect(typeof t.title.ur).toBe('string'); }
    expect(b.stale).toBeNull();
    expect(b.empty).toBeNull();
    expect(b.computed_at).toBe('2026-10-25T21:40:00.000Z');
  });

  test('R17 rm/home: the Tarnol RM sees only Tarnol (no Urban-I coach, school or moment)', async () => {
    const res = await app.call('GET', `${P}/rm/home`, { as: RM2 });
    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('Tarnol');
    for (const id of [CA, CB, CC, SCH(1), SCH(3), MOM(1)]) expect(res.text).not.toContain(id);
    expect(res.body.groups.on_track.concat(res.body.groups.needs_me).map((c) => c.coach_user_id)).toEqual([CT]);
    everyCountResolves(res.body);
    noTeacherInRm(res.body);
  });

  test('R17 rm/home: no rollups and no job run yet → empty pending, moves []', async () => {
    await pg.query('DELETE FROM coachip_rollups');
    await pg.query('DELETE FROM coachip_circle_items');
    await pg.query('DELETE FROM coachip_moments');
    await pg.query('UPDATE coachip_steps SET source_session_id = NULL');
    await pg.query('DELETE FROM coachip_session_facts');
    await pg.query('DELETE FROM coachip_job_runs');
    const res = await app.call('GET', `${P}/rm/home`, { as: RM });
    expect(res.status).toBe(200);
    expect(res.body.moves).toEqual([]);
    expect(res.body.empty).toMatchObject({ status: 'pending' });
    expect(res.body.empty.detail).toEqual({ graded: null, widened_to_weeks: null, as_of: null });
    everyCountResolves(res.body);
  });

  // ── R18 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  test('R18 rm/coach/:id: one coach of the sector, the fixture shape, schools by name, steps this month', async () => {
    const res = await app.call('GET', `${P}/rm/coach/${CA}`, { as: RM });
    expect(res.status).toBe(200);
    const b = res.body;
    expectKeys(b, K.rmCoach);
    everyCountResolves(b);
    noIdentity(res.text);
    noTeacherInRm(b);
    expectKeys(b.coach, K.coach);
    expect(b.coach).toMatchObject({ coach_user_id: CA, coach_label: 'C-02', needs_me_reason: null });
    expect(b.schools.map((s) => s.school.school_id)).toEqual([SCH(3), SCH(4)]);
    for (const s of b.schools) expectKeys(s, K.rmCoachSchool);
    expect(b.schools[0]).toMatchObject({ last_visit: '2026-10-14', next_visit: { date: '2026-10-28', schedule_id: ids.nextVisit }, weeks_since_visit: 1,
      graded: { n: 2, d: 2, window_id: 'w4-2026-09-28' } });
    expect(b.schools[1]).toMatchObject({ last_visit: '2026-10-22', next_visit: null, weeks_since_visit: 0, graded: { n: 0, d: 0, window_id: 'w4-2026-09-28' } });
    expect(b.steps).toEqual({
      open: { n: 1, d: 2, window_id: 'act-m-2026-10' },
      completed: { n: 1, d: 2, window_id: 'act-m-2026-10' },
      overdue: { n: 0, d: 2, window_id: 'act-m-2026-10' },
    });
    expect(b.moves).toHaveLength(2);
    expect(b.moves[0].row).toMatchObject({ w_id: 'W-IP-TIME', state: 'ranked', count: { n: 8, d: 21, window_id: 'w4-2026-09-28' }, sector: null,
      where_first: { school: { school_id: SCH(3), school_name: 'Govt. Primary School Fictional-03' }, count: { n: 6, d: 9, window_id: 'w4-2026-09-28' } } });
    expect(b.moves[0].sector).toEqual({ n: 20, d: 50, window_id: 'w4-2026-09-28' });
    expect(b.moves[1].row).toMatchObject({ w_id: 'W-EXIT-NOPLAN', count: { n: 5, d: 20, window_id: 'w4-2026-09-28' }, where_first: null });
    expect(b.moves[1].sector).toEqual({ n: 12, d: 44, window_id: 'w4-2026-09-28' });
    expect(b.notes.map((n) => n.id)).toEqual([fid('note', 1), fid('note', 2)]);
    for (const n of b.notes) expectKeys(n, K.note);
    expect(b.calibration).toEqual({ status: 'later_bead' });
    expect(b.windows.map((w) => w.id)).toEqual(['w4-2026-09-28', 'act-4w-2026-10-26', 'act-m-2026-10']);
  });

  test('R18 rm/coach/:id: another sector\'s coach, a roster coach with no school, the other RM → 404 byte-identical to an invented id', async () => {
    const invented = await app.call('GET', `${P}/rm/coach/${INVENTED}`, { as: RM });
    expect(invented.status).toBe(404);
    expect(invented.text).toBe('{"error":"not_found"}');
    for (const [as, coach] of [[RM, CT], [RM, CX], [RM2, CA], [RM, RM]]) {
      const r = await app.call('GET', `${P}/rm/coach/${coach}`, { as });
      expect([as, coach, r.status, r.text]).toEqual([as, coach, 404, invented.text]);
    }
    const ok = await app.call('GET', `${P}/rm/coach/${CT}`, { as: RM2 });
    expect(ok.status).toBe(200);
    expect(ok.body.coach.coach_label).toBe('C-01');
  });

  test('R18 rm/coach/:id: a coach-only session (no RM switch) → 404', async () => {
    await seed.setting(pg.query, 'portal_coachip', [CA]);
    const r = await app.call('GET', `${P}/rm/coach/${CA}`, { as: CA });
    expect(r.status).toBe(404);
    expect(r.text).toBe('{"error":"not_found"}');
  });

  // ── R20 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  test('R20 rm/circle: this Monday\'s items, one per coach by label, school and W only; checks due per coach', async () => {
    const res = await app.call('GET', `${P}/rm/circle`, { as: RM });
    expect(res.status).toBe(200);
    const b = res.body;
    expectKeys(b, K.rmCircle);
    everyCountResolves(b);
    noIdentity(res.text);
    noTeacherInRm(b);
    expect(b.week_start).toBe('2026-10-26');
    expect(b.window).toMatchObject({ id: 'week-2026-10-19', from: '2026-10-19', to: '2026-10-25', weeks: 1 });
    expect(b.moments.map((m) => [m.coach_label, m.moment_id])).toEqual([['C-01', MOM(2)], ['C-02', MOM(1)]]);
    for (const m of b.moments) expectKeys(m, K.circleMoment);
    expect(b.moments[1]).toMatchObject({ coach_user_id: CA, w_id: 'W-IP-TIME', duration_s: 38,
      school: { school_id: SCH(3), school_name: 'Govt. Primary School Fictional-03' } });
    expect(b.moments[1].short_name).toEqual(S.wCopy('W-IP-TIME').short_name);
    expect(b.checks_due).toEqual([
      { coach_label: 'C-01', count: { n: 0, d: 0, window_id: 'act-4w-2026-10-26' } },
      { coach_label: 'C-02', count: { n: 1, d: 1, window_id: 'act-4w-2026-10-26' } },
      { coach_label: 'C-03', count: { n: 1, d: 1, window_id: 'act-4w-2026-10-26' } },
    ]);
    // LIBRARY_RULES §2.2 (panel 093959 c2): S10 takes level `sector` only; the school-level PLC (I-IP-TIME-3) never shows here
    expect(b.sector_interventions.map((i) => [i.i_id, i.level, i.date])).toEqual([['I-IP-4', 'sector', null]]);
    for (const i of b.sector_interventions) { expectKeys(i, K.sectorI); expect(i.level).toBe('sector'); }
    const lib = S.library().intervention('I-IP-4');
    expect(b.sector_interventions[0].attendees).toEqual({ en: lib.with_whom, ur: lib.with_whom_ur });
    expect(b.sector_interventions[0].check).toEqual({ en: lib.check_it_worked.look_for, ur: lib.check_it_worked.look_for_ur });
    // train 7 item 3 (design-qa 172524, lead-final 223944): S10 shows who, in one line; the Monday/Friday routine is
    // LIBRARY_RULES §G8, never a paragraph on the RM's screen, and no "teacher code" process text
    for (const i of b.sector_interventions) {
      expect(i.attendees.en.trim().split(/\s+/).length).toBeLessThanOrEqual(12);
      expect(i.attendees.ur.trim().split(/\s+/).length).toBeLessThanOrEqual(12);
      expect(i.attendees.en).not.toMatch(/Monday|teacher code|codes/i);
      expect(i.attendees.ur).not.toMatch(/پیر|کوڈ/);
    }
    expect(b.sector_interventions[0].attendees).toEqual({ en: "The sector's coaches, at the Friday circle", ur: 'سیکٹر کی کوچ ٹیم، جمعے کے حلقے میں' });
    expect(b.windows.map((w) => w.id)).toEqual(['act-4w-2026-10-26', 'week-2026-10-19']);
    // SPEC v2.1 §11.1: the sector ranks, so the week is on the sector's W and there is no floor line
    expect(b.basis).toBe('sector');
    expect(b.floor).toBeNull();
  });

  test('R20 rm/circle: last week\'s items are not this week\'s circle; the Tarnol RM sees only Tarnol', async () => {
    await pg.query("UPDATE coachip_circle_items SET week_start = '2026-10-19' WHERE coach_user_id = $1", [CB]);
    const res = await app.call('GET', `${P}/rm/circle`, { as: RM });
    expect(res.body.moments.map((m) => m.moment_id)).toEqual([MOM(1)]);
    const t = await app.call('GET', `${P}/rm/circle`, { as: RM2 });
    expect(t.status).toBe(200);
    expect(t.body.moments.map((m) => m.moment_id)).toEqual([MOM(3)]);
    for (const id of [MOM(1), MOM(2), CA, CB]) expect(t.text).not.toContain(id);
  });

  // SPEC v2.1 §11.1: the basis is stored on the row and the week says which; the floor comes from the sector rollups
  test('R20 rm/circle: a coach-basis week says basis coach and the floor; the rows are the same B22 rows', async () => {
    await pg.query("UPDATE coachip_circle_items SET week_start = '2026-10-26', basis = 'coach' WHERE sector = 'Urban-I'");
    await pg.query("UPDATE coachip_rollups SET rank = NULL, status = 'insufficient', coaches_with_5plus = LEAST(coaches_with_5plus, 2) WHERE scope_kind = 'sector' AND sector = 'Urban-I'");
    const res = await app.call('GET', `${P}/rm/circle`, { as: RM });
    expect(res.status).toBe(200);
    expectKeys(res.body, K.rmCircle);
    expect(res.body.basis).toBe('coach');
    // COPY §8 / SPEC §11.1: {c} is a Count on the sector's 4-week graded window, and that window is in `windows` (G10)
    const fw = res.body.windows.find((w) => w.id === res.body.floor.window_id);
    expect(fw).toMatchObject({ weeks: 4, framework: 'lp_fidelity' });
    expect(res.body.floor).toEqual({ coaches_with_5plus: 2, needed: 3, coaches_ranked: expect.any(Number), window_id: fw.id });
    everyCountResolves(res.body);
    expect(res.body.moments.map((m) => [m.coach_label, m.moment_id])).toEqual([['C-01', MOM(2)], ['C-02', MOM(1)]]);
    for (const m of res.body.moments) expectKeys(m, K.circleMoment);
    noIdentity(res.text);
    // the Tarnol RM's week is untouched: its row is still basis sector
    const t = await app.call('GET', `${P}/rm/circle`, { as: RM2 });
    expect(t.body.basis).toBe('sector');
  });

  test('R20 rm/circle: no row and no sector rank 1 → basis coach with the floor and no moments (S10 empty.floor, never a zero)', async () => {
    await pg.query("DELETE FROM coachip_circle_items WHERE sector = 'Urban-I'");
    await pg.query("UPDATE coachip_rollups SET rank = NULL, status = 'insufficient', coaches_with_5plus = LEAST(coaches_with_5plus, 2) WHERE scope_kind = 'sector' AND sector = 'Urban-I'");
    const res = await app.call('GET', `${P}/rm/circle`, { as: RM });
    expect(res.status).toBe(200);
    expect(res.body.moments).toEqual([]);
    expect(res.body.basis).toBe('coach');
    expect(res.body.floor).toMatchObject({ coaches_with_5plus: 2, needed: 3 });
    expect(res.body.windows.map((w) => w.id)).toContain(res.body.floor.window_id);
  });

  // red-2 20261027T001002: an empty coach week is "no coach over the floor" only when no coach has a rank-1 W; R20 says
  // how many do (`floor.coaches_ranked`, the sector's coaches with an ok coach-level rank 1 in the same window) so S10 can tell
  test('R20 rm/circle: an empty coach week counts the coaches who do rank (floor.coaches_ranked)', async () => {
    await pg.query("DELETE FROM coachip_circle_items WHERE sector = 'Urban-I'");
    await pg.query("UPDATE coachip_rollups SET rank = NULL, status = 'insufficient', coaches_with_5plus = LEAST(coaches_with_5plus, 2) WHERE scope_kind = 'sector' AND sector = 'Urban-I'");
    const { rows } = await pg.query(`SELECT COUNT(DISTINCT r.coach_user_id)::int AS n FROM coachip_rollups r
      WHERE r.scope_kind = 'coach' AND r.rank = 1 AND r.status = 'ok' AND r.coach_user_id = ANY($1::uuid[])`, [[CA, CB]]);
    expect(rows[0].n).toBeGreaterThan(0); // the fixture has ranked coaches in Urban-I: the sentence "no coach has 20" would be false
    const res = await app.call('GET', `${P}/rm/circle`, { as: RM });
    expect([res.body.basis, res.body.moments]).toEqual(['coach', []]);
    expect(res.body.floor.coaches_ranked).toBe(rows[0].n);
    await pg.query("UPDATE coachip_rollups SET rank = NULL WHERE scope_kind = 'coach'");
    const none = await app.call('GET', `${P}/rm/circle`, { as: RM });
    expect(none.body.floor.coaches_ranked).toBe(0);
  });

  test('R20 rm/circle: no row but the sector ranks → basis sector, floor null (S10 keeps s10.moments.empty)', async () => {
    await pg.query("DELETE FROM coachip_circle_items WHERE sector = 'Urban-I'");
    const res = await app.call('GET', `${P}/rm/circle`, { as: RM });
    expect([res.body.moments, res.body.basis, res.body.floor]).toEqual([[], 'sector', null]);
  });

  test('RM reads: no switch → 404 on all three; a teacher → 404', async () => {
    await seed.setting(pg.query, 'portal_coachip_rm', {});
    for (const p of ['/rm/home', `/rm/coach/${CA}`, '/rm/circle']) {
      const r = await app.call('GET', `${P}${p}`, { as: RM });
      expect([p, r.status, r.text]).toEqual([p, 404, '{"error":"not_found"}']);
      const t = await app.call('GET', `${P}${p}`, { as: T(1) });
      expect([p, t.status]).toEqual([p, 404]);
    }
  });

  // ── fix-r5 s6 (c): R17's server time (GO_PACKAGE v5 §0.4 c; qa-rm 104134, ux-lead-2 152702) ──────────────────────────
  // The handler awaited ten-plus reads in series and read the school rollups once per ranked move, so every Sector,
  // Coaches or Stats open waited 7-9 s on sandbox and staging. The payload must not change by a byte; the reads must run
  // side by side, the per-move and per-coach reads must be one read each, and a second open on the same nightly must not
  // read the rollups again (a per-RM cache keyed on the rollups' computed_at), while the live counts are read every time.
  const GOLDEN = require('path').join(__dirname, '__golden__');
  function golden(name, text) {
    const f = require('path').join(GOLDEN, name);
    if (process.env.CAPTURE_GOLDEN === '1') require('fs').writeFileSync(f, `${text}\n`);
    return require('fs').readFileSync(f, 'utf8').trimEnd();
  }
  /** The real router over the same Postgres, every query logged (sql, first param) and counted while in flight. */
  async function countingApp() {
    const log = { calls: [], inFlight: 0, maxInFlight: 0 };
    const query = async (sql, params) => {
      log.calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), p0: params ? params[0] : undefined });
      log.inFlight += 1;
      log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
      try {
        await new Promise((r) => { setTimeout(r, 3); });
        return await pg.query(sql, params);
      } finally { log.inFlight -= 1; }
    };
    const a = await startApp({ ...pg, query }, { now: NOW });
    return { a, log, reset: () => { log.calls = []; log.maxInFlight = 0; } };
  }
  const schoolRollupReads = (log) => log.calls.filter((c) => /FROM coachip_rollups WHERE scope_kind = \$1 AND scope_id = ANY/.test(c.sql) && c.p0 === 'school').length;
  const sectorRollupReads = (log) => log.calls.filter((c) => /FROM coachip_rollups WHERE scope_kind = \$1 AND scope_id = ANY/.test(c.sql) && c.p0 === 'sector').length;
  const lastVisitReads = (log) => log.calls.filter((c) => /MAX\(os\.scheduled_for\)/.test(c.sql)).length;
  const noteReads = (log) => log.calls.filter((c) => /FROM coachip_rm_notes n WHERE/.test(c.sql)).length;

  test('s6c R17 rm/home: the payload is byte-identical to the one before the change (default world and two ranked moves)', async () => {
    const one = await app.call('GET', `${P}/rm/home`, { as: RM });
    expect(one.status).toBe(200);
    expect(one.text).toBe(golden('rm_home_r17_s6.json', one.text));
    await pg.query("UPDATE coachip_rollups SET rank = 2 WHERE scope_kind = 'sector' AND w_id = 'W-EXIT-NOPLAN'");
    await pg.query(`INSERT INTO coachip_rollups (scope_kind, school_id, w_id, window_start, window_end, window_weeks, numerator, denominator, teacher_count,
      coach_count, coaches_with_5plus, recordings, recordings_linked, grader_model, framework_version, pipeline_version, status, job_run_id, computed_at)
      SELECT 'school', $1::uuid, 'W-EXIT-NOPLAN', window_start, window_end, 4, 5, 9, 3, 1, 1, 0, 0, grader_model, framework_version, pipeline_version, 'ok', job_run_id, computed_at
        FROM coachip_rollups WHERE scope_kind = 'sector' AND w_id = 'W-EXIT-NOPLAN'`, [SCH(2)]);
    const two = await app.call('GET', `${P}/rm/home`, { as: RM });
    expect(two.body.moves.map((m) => [m.row.w_id, m.row.state, m.by_school.length])).toEqual([['W-IP-TIME', 'ranked', 3], ['W-EXIT-NOPLAN', 'ranked', 1]]);
    expect(two.text).toBe(golden('rm_home_r17_s6_two_ranked.json', two.text));
    const tarnol = await app.call('GET', `${P}/rm/home`, { as: RM2 });
    expect(tarnol.text).toBe(golden('rm_home_r17_s6_tarnol.json', tarnol.text));
  });

  test('s6c R17 rm/home: the reads run side by side, one school-rollup read for every ranked move, one visit and one note read for every coach', async () => {
    await pg.query("UPDATE coachip_rollups SET rank = 2 WHERE scope_kind = 'sector' AND w_id = 'W-EXIT-NOPLAN'");
    const { a, log, reset } = await countingApp();
    try {
      reset();
      const res = await a.call('GET', `${P}/rm/home`, { as: RM });
      expect(res.status).toBe(200);
      expect(res.body.moves.filter((m) => m.row.state === 'ranked')).toHaveLength(2);
      expect({
        side_by_side: log.maxInFlight >= 4,
        school_rollup_reads: schoolRollupReads(log),
        last_visit_reads: lastVisitReads(log),
        note_reads_at_most: noteReads(log) <= 2,
      }).toEqual({ side_by_side: true, school_rollup_reads: 1, last_visit_reads: 1, note_reads_at_most: true });
    } finally { await a.close(); }
  });

  test('s6c R17 rm/home: a second open on the same nightly does not read the rollups again, and says the same bytes', async () => {
    const { a, log, reset } = await countingApp();
    try {
      const cold = await a.call('GET', `${P}/rm/home`, { as: RM });
      reset();
      const warm = await a.call('GET', `${P}/rm/home`, { as: RM });
      expect(warm.text).toBe(cold.text);
      expect({ sector: sectorRollupReads(log), school: schoolRollupReads(log) }).toEqual({ sector: 0, school: 0 });
    } finally { await a.close(); }
  });

  test('s6c R17 rm/home: the cache never holds the live counts, and a changed nightly is read again', async () => {
    const { a } = await countingApp();
    try {
      const first = await a.call('GET', `${P}/rm/home`, { as: RM });
      expect(first.body.opening.visited).toEqual({ n: 4, d: 6, window_id: 'act-4w-2026-10-26' });
      // a visit done after the first open, a note dismissed and a step set: all three show on the next open
      await visit(pg.query, { coach: CB, schoolId: SCH(2), date: '2026-10-24' });
      await pg.query("UPDATE coachip_rm_notes SET status = 'dismissed' WHERE id = $1", [fid('note', 1)]);
      const second = await a.call('GET', `${P}/rm/home`, { as: RM });
      expect(second.body.opening.visited).toEqual({ n: 5, d: 6, window_id: 'act-4w-2026-10-26' });
      expect(second.body.groups.on_track.concat(second.body.groups.needs_me).find((c) => c.coach_user_id === CA).note_open).toBeNull();
      // the nightly rewrites the same window: the moves follow it (no stale count from the cache)
      await pg.query("UPDATE coachip_rollups SET numerator = 21 WHERE scope_kind = 'sector' AND w_id = 'W-IP-TIME'");
      const third = await a.call('GET', `${P}/rm/home`, { as: RM });
      expect(third.body.moves[0].row.count).toEqual({ n: 21, d: 50, window_id: 'w4-2026-09-28' });
      // another RM (Tarnol) never gets Urban-I's cached moves
      const t = await a.call('GET', `${P}/rm/home`, { as: RM2 });
      expect(t.body.sector).toBe('Tarnol');
      for (const id of [CA, CB, CC, SCH(1), SCH(3)]) expect(t.text).not.toContain(id);
    } finally { await a.close(); }
  });
});
