'use strict';
/**
 * bd-sex15q.17 (m-rm lane, worker w-scope) — adversarial RM sector-scope tests over HTTP, through the real COACHIP
 * router, the real fail-closed flag readers, the real scope and codec services, against a throwaway Postgres
 * (contracts/API.md §1 status table, §9 R17-R21, §10 R7; SPEC v2 §1 rmScope / circleAllows; RUBRIC B3, B22).
 *
 *   1  the Tarnol RM replaying Urban-I ids (R18 coach, R19 coach + schools, R6/R7 circle moment) → the 404 an invented
 *      UUID gets: same status, Content-Type, Cache-Control, ETag and body bytes
 *   2  a flagged coach session with no RM entry → the same 404 on every RM route and on the RM leg of R6/R7
 *   3  a coach who is also the RM of another sector: coach routes unchanged, RM routes show only the RM sector
 *   4  R19 cross-coach: a school of the same sector held by ANOTHER coach, or a Tarnol school → the same 404
 *   5  R19 strict body: any extra key → 400 {"error":"bad_request"}; four schools → 400
 *   6  R17/R18/R20 carry no teacher reference; the circle row is exactly the B22 seven keys
 *   7  the Tarnol RM's R17 (and R20) names no Urban-I school id, coach id or school name
 *   8  portal_coachip_rm absent / a list / a number / bad JSON / a non-sector literal → every RM route 404, /me rm null
 *   mutation proof: an app whose rmSector says "Urban-I" for everyone makes blocks 1 and 2 leak, and the predicate the
 *      tests use catches it (so a green run above is not a vacuous one)
 *
 * Fictional rows only (contracts/FIXTURES.md): schools "Govt. Primary School Fictional-NN", users.name null, fake v4 ids.
 * The world is the one tests/coachip/coachip-rm-read.test.js builds (copied, not imported: m-api owns that file).
 */
const crypto = require('crypto');
const { startPg, hasPostgres } = require('../coachip/helpers/pg-harness');
const seed = require('../coachip/helpers/seed');
const { startApp, pgSupabase } = require('../coachip/helpers/app');
const S = require('../../dashboard/services/coachip-shapes');
const { teacherKeyFor } = require('../../dashboard/services/coachip-codes.service');
const { isFlagEnabledForUser, rmSectorFor, PORTAL_COACHIP_KEY, PORTAL_COACHIP_DECODE_KEY } = require('../../dashboard/lib/feature-flags');

const run = hasPostgres() ? describe : describe.skip;
const { fid } = seed;
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday 26 Oct 2026, 11:00 PKT
const TODAY = '2026-10-26';
const P = '/api/portal/coachip';
const INVENTED = '00000000-0000-4000-8000-ff0000000001';
const NOT_FOUND_TEXT = '{"error":"not_found"}';
const BAD_TEXT = '{"error":"bad_request"}';
const GRADER = 'google/gemini-3.8-flash';
const FW = 'lp_fidelity';
const PIPE = 'coachip-1.0.0';

const RM = fid('rm', 1);        // Urban-I
const RM2 = fid('rm', 2);       // Tarnol
const CA = fid('coach', 1);     // Urban-I: S-03, S-04
const CB = fid('coach', 2);     // Urban-I: S-01, S-02
const CC = fid('coach', 3);     // Urban-I: S-05
const CT = fid('coach', 4);     // Tarnol:  S-10
const CX = fid('coach', 9);     // Urban-I roster, holds no school
const SCH = (n) => fid('school', n);
const T = (n) => fid('teacher', n);
const SESS = (n) => fid('session', n);
const MOM = (n) => fid('moment', n);
const FACT = (n) => fid('fact', n);
const TEACHERS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(T);
const URBAN_SCHOOLS = [1, 2, 3, 4, 5, 6].map(SCH);
const URBAN_COACHES = [CA, CB, CC, CX];
const URBAN_SCHOOL_NAMES = [1, 2, 3, 4, 5, 6].map((n) => `Govt. Primary School Fictional-${String(n).padStart(2, '0')}`);
const RM_MAP = { [RM]: 'Urban-I', [RM2]: 'Tarnol' };
const CIRCLE_MOMENT_KEYS = ['coach_user_id', 'coach_label', 'moment_id', 'w_id', 'short_name', 'school', 'duration_s'];

const noteBody = (o = {}) => ({ coach_user_id: CA, template_id: 'RM-T1', w_id: 'W-IP-TIME', school_ids: [SCH(3)], due_on: '2026-10-30', ...o });
const stepBody = (o = {}) => ({ i_id: 'I-IP-TIME-3', w_id: 'W-IP-TIME', date: TODAY, ...o });

/**
 * The predicate every scope test uses: `res` is the one 404 (status, the headers that matter, body bytes) that `ref`
 * (the same route called with an invented UUID) got. Returns the list of differences; [] means identical.
 */
function diff404(res, ref) {
  const out = [];
  if (ref.status !== 404) out.push(`reference status ${ref.status}, not 404`);
  if (ref.text !== NOT_FOUND_TEXT) out.push(`reference body ${ref.text}`);
  if (res.status !== ref.status) out.push(`status ${res.status} != ${ref.status}`);
  for (const h of ['content-type', 'cache-control', 'etag', 'content-length']) {
    if (res.headers[h] !== ref.headers[h]) out.push(`${h} ${res.headers[h]} != ${ref.headers[h]}`);
  }
  if (res.headers['cache-control'] !== 'private, no-store') out.push(`cache-control ${res.headers['cache-control']}`);
  if (res.text !== ref.text) out.push(`body ${res.text.slice(0, 80)} != ${ref.text}`);
  return out;
}
/** Same idea for two answers that need not be 404 (R7 without m-player's module): identical status and bytes. */
function diffSame(res, ref) {
  const out = [];
  if (res.status !== ref.status) out.push(`status ${res.status} != ${ref.status}`);
  for (const h of ['content-type', 'cache-control', 'etag', 'content-length']) {
    if (res.headers[h] !== ref.headers[h]) out.push(`${h} ${res.headers[h]} != ${ref.headers[h]}`);
  }
  if (res.text !== ref.text) out.push(`body ${res.text.slice(0, 80)} != ${ref.text}`);
  return out;
}

/** B1, B21, B22: no teacher reference of any kind in an RM payload. Returns the violations. */
function teacherLeaks(res) {
  const out = [];
  const keysOfTeachers = TEACHERS.map((t) => teacherKeyFor(seed.SECRET, t));
  for (const id of TEACHERS) if (res.text.includes(id)) out.push(`teacher users.id ${id}`);
  for (const k of keysOfTeachers) if (k && res.text.includes(k)) out.push('a teacher key');
  (function walk(v, path) {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (typeof v === 'string') {
      if (/^T-\d{2,3}$/.test(v)) out.push(`${path}: T-code ${v}`);
      if (/^[0-9a-f]{16}$/.test(v)) out.push(`${path}: 16-hex ${v}`);
      return;
    }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (['code', 'code_id', 'teacher_key', 'session_id', 'url', 'phone', 'name'].includes(k)) out.push(`${path}.${k}: forbidden key`);
      walk(x, `${path}.${k}`);
    }
  }(res.body, '$'));
  return out;
}

// ── seed helpers (fictional rows; parents first) ───────────────────────────────────────────────────────────────
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
    await q('INSERT INTO coachip_interventions (i_id, w_id, level, rank_in_w, library_version) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [i.id, i.weakness_id, i.level, i.rank_in_w || 1, String(i.library_version || lib.library_version)]);
  }
}
const key = (teacherId) => teacherKeyFor(seed.SECRET, teacherId);
async function jobRun(q) {
  const { rows } = await q(`INSERT INTO coachip_job_runs (run_date, pipeline_version, env_ref, started_at, finished_at, status)
    VALUES ($1, $2, 'olvritwoqujtjvwfulbh', $3, $3, 'ok') RETURNING id`, [TODAY, PIPE, `${TODAY}T00:00:00Z`]);
  return rows[0].id;
}
async function fact(q, { id, sessionId, teacherId, schoolId, sector = 'Urban-I', at, run: jobRunId }) {
  await q('INSERT INTO coaching_sessions (id, user_id, created_at) VALUES ($1, $2, $3)', [sessionId, teacherId, at]);
  await q(`INSERT INTO coachip_session_facts (id, session_id, teacher_key, school_id, sector, recorded_at, is_observed, job_run_id, grader_model,
             framework_version, pipeline_version, input_hash, status, is_mismatch, is_unusable, is_duplicate, is_lp_linked,
             subject, grade, audio_s, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11,'ok',false,false,false,true,'Urdu',3,1600,'2026-10-25T21:40:00Z')`,
  [id, sessionId, key(teacherId), schoolId, sector, at, jobRunId, GRADER, FW, PIPE, crypto.createHash('sha256').update(id).digest('hex')]);
}
async function moment(q, { id, factId, sessionId, w, from, to }) {
  await q(`INSERT INTO coachip_moments (id, fact_id, session_id, w_id, kind, phase, from_s, to_s, moment_s, confidence, gloss_status, clip_r2_key, clip_status)
           VALUES ($1,$2,$3,$4,'missing','ip',$5,$6,$5,'high','pending',$7,'ready')`,
  [id, factId, sessionId, w, from, to, `coachip/clips/sandbox/${sessionId}/${from}-${to}.mp3`]);
}
async function rollup(q, o) {
  await q(`INSERT INTO coachip_rollups (scope_kind, coach_user_id, school_id, sector, w_id, window_start, window_end, window_weeks, numerator,
             denominator, teacher_count, coach_count, coaches_with_5plus, recordings, recordings_linked, rank, grader_model, framework_version,
             pipeline_version, status, job_run_id, computed_at)
           VALUES ($1,$2,$3,$4,$5,'2026-09-28'::date,'2026-10-25'::date,4,$6,$7,3,$8,$9,3,2,$10,$11,$12,$13,'ok',$14,'2026-10-25T21:40:00Z')`,
  [o.kind, o.coach || null, o.school || null, o.sector || null, o.w, o.n, o.d, o.coachCount || 1, o.c5 === undefined ? 1 : o.c5,
    o.rank || null, GRADER, FW, PIPE, o.run]);
}
async function visit(q, { coach, schoolId, date, status = 'done' }) {
  await q(`INSERT INTO observation_schedules (leader_user_id, school_ext_id, teacher_ext_id, scheduled_for, status, school_id)
    VALUES ($1, 'niete:fixture', 'fixture-teacher', $2, $3, $4)`, [coach, date, status, schoolId]);
}
async function step(q, codes, { coach, teacherId, schoolId, w, i, setAt, checkBy, sourceSessionId = null }) {
  const code = await codes.codeFor(coach, key(teacherId));
  await q(`INSERT INTO coachip_steps (coach_user_id, scope, code_id, school_id, w_id, i_id, source_session_id, set_at, check_by, check_by_rule, status)
    VALUES ($1,'coach',$2,$3,$4,$5,$6,$7,$8,'14_days','open')`, [coach, code.code_id, schoolId, w, i, sourceSessionId, setAt, checkBy]);
}
async function note(q, { id, rm, coach, sector, schools }) {
  await q(`INSERT INTO coachip_rm_notes (id, rm_user_id, coach_user_id, sector, w_id, template_id, body_en, body_ur, due_on, status, created_at)
    VALUES ($1,$2,$3,$4,'W-IP-TIME','RM-T1','line one\nline two\nline three','سطر ۱\nسطر ۲\nسطر ۳','2026-10-30','sent','2026-10-20T05:00:00Z')`,
  [id, rm, coach, sector]);
  for (const [i, s] of schools.entries()) await q('INSERT INTO coachip_rm_note_schools (rm_note_id, school_id, position) VALUES ($1,$2,$3)', [id, s, i + 1]);
}

/** The flag readers app.js builds by default; the mutation proof overrides one of them. */
function realFlags(pg) {
  const supabase = pgSupabase(pg.query);
  return {
    coachOn: (uid) => isFlagEnabledForUser(supabase, PORTAL_COACHIP_KEY, uid),
    rmSector: (uid) => rmSectorFor(supabase, uid),
    decodeOn: (uid) => isFlagEnabledForUser(supabase, PORTAL_COACHIP_DECODE_KEY, uid),
  };
}

run('COACHIP RM sector scope (adversarial; Postgres, HTTP)', () => {
  let pg; let app;

  beforeAll(async () => {
    pg = await startPg();
    await seedLibrary(pg.query);
    app = await startApp(pg, { now: NOW });
  }, 180000);
  afterAll(async () => { if (app) await app.close(); if (pg) await pg.close(); });

  async function world() {
    const q = pg.query;
    for (const id of [RM, RM2, CA, CB, CC, CT, CX]) await seed.user(q, { id, role: 'coach' });
    for (let n = 1; n <= 6; n += 1) await seed.school(q, { id: SCH(n), n });
    await seed.school(q, { id: SCH(10), n: 10, region: 'Tarnol' });
    await seed.holds(q, { coachId: CB, schoolId: SCH(1) });
    await seed.holds(q, { coachId: CB, schoolId: SCH(2) });
    await seed.holds(q, { coachId: CA, schoolId: SCH(3) });
    await seed.holds(q, { coachId: CA, schoolId: SCH(4) });
    await seed.holds(q, { coachId: CC, schoolId: SCH(5) });
    await seed.holds(q, { coachId: CT, schoolId: SCH(10) });
    const at = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 3, 6: 4, 7: 5, 8: 6, 9: 10 };
    for (const [t, s] of Object.entries(at)) await seed.user(q, { id: T(Number(t)), role: 'teacher', schoolId: SCH(s) });
    await seed.setting(q, 'portal_coachip_rm', RM_MAP);
    await seed.setting(q, 'analytics_rdf_coaches', { coaches: [
      { name: 'Fictional Coach A', sector: 'Urban-I', userIds: [CA] },
      { name: 'Fictional Coach B', sector: 'Urban-I', userIds: [CB] },
      { name: 'Fictional Coach C', sector: 'Urban-I', userIds: [CC] },
      { name: 'Fictional Coach X', sector: 'Urban-I', userIds: [CX] },
      { name: 'Fictional Coach T', sector: 'Tarnol', userIds: [CT] },
    ] });

    await visit(q, { coach: CB, schoolId: SCH(1), date: '2026-10-20' });
    await visit(q, { coach: CA, schoolId: SCH(3), date: '2026-10-14' });
    await visit(q, { coach: CA, schoolId: SCH(3), date: '2026-10-28', status: 'upcoming' });
    await visit(q, { coach: CC, schoolId: SCH(5), date: '2026-10-01' });
    await visit(q, { coach: CT, schoolId: SCH(10), date: '2026-10-21' });

    const r = await jobRun(q);
    await fact(q, { id: FACT(1), sessionId: SESS(1), teacherId: T(4), schoolId: SCH(3), at: '2026-10-13T05:00:00Z', run: r });
    await fact(q, { id: FACT(2), sessionId: SESS(2), teacherId: T(5), schoolId: SCH(3), at: '2026-10-21T05:00:00Z', run: r });
    await fact(q, { id: FACT(4), sessionId: SESS(4), teacherId: T(1), schoolId: SCH(1), at: '2026-10-20T05:00:00Z', run: r });
    await fact(q, { id: FACT(5), sessionId: SESS(5), teacherId: T(9), schoolId: SCH(10), sector: 'Tarnol', at: '2026-10-21T05:00:00Z', run: r });
    await moment(q, { id: MOM(1), factId: FACT(2), sessionId: SESS(2), w: 'W-IP-TIME', from: 1100, to: 1138 });
    await moment(q, { id: MOM(2), factId: FACT(4), sessionId: SESS(4), w: 'W-EXIT-NOPLAN', from: 1300, to: 1331 });
    await moment(q, { id: MOM(3), factId: FACT(5), sessionId: SESS(5), w: 'W-IP-TIME', from: 900, to: 940 });
    // MOM(4): an Urban-I moment that is NOT in this week's circle (a coach's moment; an RM must never reach it)
    await moment(q, { id: MOM(4), factId: FACT(1), sessionId: SESS(1), w: 'W-IP-TIME', from: 700, to: 730 });
    const circle = (sector, coach, m) => q(`INSERT INTO coachip_circle_items (sector, week_start, coach_user_id, moment_id, job_run_id)
      VALUES ($1, $2, $3, $4, $5)`, [sector, TODAY, coach, m, r]);
    await circle('Urban-I', CA, MOM(1));
    await circle('Urban-I', CB, MOM(2));
    await circle('Tarnol', CT, MOM(3));

    await rollup(q, { kind: 'sector', sector: 'Urban-I', w: 'W-IP-TIME', n: 20, d: 50, c5: 3, coachCount: 3, rank: 1, run: r });
    await rollup(q, { kind: 'sector', sector: 'Urban-I', w: 'W-EXIT-NOPLAN', n: 12, d: 44, c5: 3, coachCount: 3, run: r });
    await rollup(q, { kind: 'sector', sector: 'Tarnol', w: 'W-IP-TIME', n: 9, d: 45, c5: 3, coachCount: 3, rank: 1, run: r });
    await rollup(q, { kind: 'school', school: SCH(1), w: 'W-IP-TIME', n: 7, d: 12, run: r });
    await rollup(q, { kind: 'school', school: SCH(3), w: 'W-IP-TIME', n: 6, d: 9, run: r });
    await rollup(q, { kind: 'school', school: SCH(10), w: 'W-IP-TIME', n: 4, d: 9, run: r });
    await rollup(q, { kind: 'coach', coach: CA, w: 'W-IP-TIME', n: 8, d: 21, rank: 1, run: r });
    await rollup(q, { kind: 'coach', coach: CT, w: 'W-IP-TIME', n: 4, d: 21, rank: 1, run: r });

    // coach steps carry teacher codes in the DB: an RM payload must never show one
    await step(q, app.codes, { coach: CA, teacherId: T(4), schoolId: SCH(3), w: 'W-IP-TIME', i: 'I-IP-TIME-1', setAt: '2026-10-14T05:00:00Z', checkBy: '2026-10-28', sourceSessionId: SESS(1) });
    await step(q, app.codes, { coach: CB, teacherId: T(1), schoolId: SCH(1), w: 'W-EXIT-NOPLAN', i: 'I-EXIT-NOPLAN-1', setAt: '2026-10-01T05:00:00Z', checkBy: '2026-10-15', sourceSessionId: SESS(4) });
    await step(q, app.codes, { coach: CT, teacherId: T(9), schoolId: SCH(10), w: 'W-IP-TIME', i: 'I-IP-TIME-1', setAt: '2026-10-21T05:00:00Z', checkBy: '2026-11-04', sourceSessionId: SESS(5) });
    await note(q, { id: fid('note', 1), rm: RM, coach: CA, sector: 'Urban-I', schools: [SCH(3)] });
    await note(q, { id: fid('note', 3), rm: RM2, coach: CT, sector: 'Tarnol', schools: [SCH(10)] });
  }

  beforeEach(async () => { await pg.truncate(); await world(); });

  const get = (p, as, a = app) => a.call('GET', `${P}${p}`, { as });
  const post = (p, as, body, a = app) => a.call('POST', `${P}${p}`, { as, body });

  /** The invented-UUID 404 each route answers its own RM; the reference block 1 and 2 compare against. */
  async function refs(as = RM, a = app) {
    return {
      R18: await get(`/rm/coach/${INVENTED}`, as, a),
      R19: await post('/rm/notes', as, noteBody({ coach_user_id: INVENTED }), a),
      R6: await get(`/m/${INVENTED}`, as, a),
      R7: await get(`/m/${INVENTED}/clip`, as, a),
    };
  }

  /** Every RM route (and the RM leg of R6/R7) as `as`, with requests that are valid and in scope for the Urban-I RM. */
  async function everyRmRoute(as, a = app) {
    return [
      ['R17', await get('/rm/home', as, a)],
      ['R18', await get(`/rm/coach/${CA}`, as, a)],
      ['R19', await post('/rm/notes', as, noteBody(), a)],
      ['R20', await get('/rm/circle', as, a)],
      ['R21', await post('/rm/steps', as, stepBody(), a)],
      ['R6', await get(`/m/${MOM(2)}`, as, a)],
      ['R7', await get(`/m/${MOM(2)}/clip`, as, a)],
    ];
  }

  // ── controls: the requests the scope tests reuse DO answer for the right RM (else a 404 below would prove nothing) ──
  test('control: the Urban-I RM gets 200/201 on R17-R21 and R6 for its own circle moment', async () => {
    const got = (await everyRmRoute(RM)).map(([id, r]) => [id, r.status]);
    expect(got).toEqual([['R17', 200], ['R18', 200], ['R19', 201], ['R20', 200], ['R21', 201], ['R6', 200], ['R7', 503]]);
    // R7 is 503 clip_unavailable because startApp mounts no m-player module (the router's stand-in); scope passed first.
    const t = await get(`/rm/coach/${CT}`, RM2);
    expect(t.status).toBe(200);
    const tm = await get(`/m/${MOM(3)}`, RM2);
    expect(tm.status).toBe(200);
  });

  // ── 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('1 · the Tarnol RM replaying Urban-I ids → the invented-UUID 404, byte for byte', () => {
    test('R18: every Urban-I coach id (holding, roster-only), and the Urban-I RM\'s own id', async () => {
      const ref = await get(`/rm/coach/${INVENTED}`, RM2);
      for (const coach of [CA, CB, CC, CX, RM]) {
        const r = await get(`/rm/coach/${coach}`, RM2);
        expect([coach, diff404(r, ref)]).toEqual([coach, []]);
      }
    });

    test('R19: an Urban-I coach with that coach\'s own Urban-I schools; a Tarnol coach with an Urban-I school; nothing written', async () => {
      const ref = await post('/rm/notes', RM2, noteBody({ coach_user_id: INVENTED, school_ids: [SCH(10)] }));
      const cases = [
        noteBody({ coach_user_id: CA, school_ids: [SCH(3)] }),
        noteBody({ coach_user_id: CA, school_ids: [SCH(3), SCH(4)] }),
        noteBody({ coach_user_id: CB, school_ids: [SCH(1), SCH(2)] }),
        noteBody({ coach_user_id: CC, school_ids: [SCH(5)] }),
        noteBody({ coach_user_id: CT, school_ids: [SCH(3)] }),
        noteBody({ coach_user_id: CT, school_ids: [SCH(10), SCH(1)] }),
        noteBody({ coach_user_id: INVENTED, school_ids: [SCH(3)] }),
      ];
      for (const body of cases) {
        const r = await post('/rm/notes', RM2, body);
        expect([body.coach_user_id, body.school_ids, diff404(r, ref)]).toEqual([body.coach_user_id, body.school_ids, []]);
      }
      const { rows } = await pg.query('SELECT count(*)::int AS n FROM coachip_rm_notes WHERE rm_user_id = $1', [RM2]);
      expect(rows[0].n).toBe(1);   // only the seeded one
      const { rows: audit } = await pg.query("SELECT count(*)::int AS n FROM coachip_audit_log WHERE action::text = 'note_sent'");
      expect(audit[0].n).toBe(0);
    });

    test('R6: an Urban-I circle moment, and an Urban-I moment outside any circle', async () => {
      const ref = await get(`/m/${INVENTED}`, RM2);
      for (const m of [MOM(1), MOM(2), MOM(4)]) {
        const r = await get(`/m/${m}`, RM2);
        expect([m, diff404(r, ref)]).toEqual([m, []]);
      }
    });

    test('R7: an Urban-I circle moment answers exactly what an invented UUID answers (no existence oracle)', async () => {
      const ref = await get(`/m/${INVENTED}/clip`, RM2);
      for (const m of [MOM(1), MOM(2), MOM(4)]) {
        const r = await get(`/m/${m}/clip`, RM2);
        expect([m, diffSame(r, ref)]).toEqual([m, []]);
      }
    });
  });

  // ── 1b · SPEC v2.1 §11.1: a coach-basis circle is the same stored predicate (the basis changes the W, never who may hear) ──
  test('1b · an RM may open a coach-basis moment of their own sector and gets the invented-UUID 404 for another sector\'s', async () => {
    await pg.query("UPDATE coachip_circle_items SET basis = 'coach' WHERE sector = 'Urban-I'");
    await pg.query("UPDATE coachip_rollups SET rank = NULL, status = 'insufficient', coaches_with_5plus = 1 WHERE scope_kind = 'sector' AND sector = 'Urban-I'");
    const circle = await get('/rm/circle', RM);
    expect([circle.status, circle.body.basis]).toEqual([200, 'coach']);
    expect(circle.body.moments.map((m) => m.moment_id).sort()).toEqual([MOM(1), MOM(2)].sort());
    for (const m of [MOM(1), MOM(2)]) expect([m, (await get(`/m/${m}`, RM)).status]).toEqual([m, 200]);
    // the Tarnol moment (sector basis) and an Urban-I moment outside the circle: the invented-UUID answer, byte for byte
    const ref = await get(`/m/${INVENTED}`, RM);
    for (const m of [MOM(3), MOM(4)]) expect([m, diff404(await get(`/m/${m}`, RM), ref)]).toEqual([m, []]);
    // and the Tarnol RM replaying the Urban-I coach-basis moments
    const ref2 = await get(`/m/${INVENTED}`, RM2);
    for (const m of [MOM(1), MOM(2)]) expect([m, diff404(await get(`/m/${m}`, RM2), ref2)]).toEqual([m, []]);
  });

  // ── 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  test('2 · a flagged coach session with no RM entry → the one 404 on every RM route and the RM leg of R6', async () => {
    await seed.setting(pg.query, 'portal_coachip', [CA, CB]);
    const ref = await refs(RM);
    const canonical = ref.R18;
    for (const as of [CA, CB]) {
      for (const [id, r] of await everyRmRoute(as)) {
        // R6/R7 below with a moment that is NOT this coach's own (MOM(2) is CB's own teacher: the coach leg, rightly 200)
        if (id === 'R6' || id === 'R7') continue;
        expect([as, id, diff404(r, canonical)]).toEqual([as, id, []]);
      }
      // the RM leg of R6: another coach's circle moment and a Tarnol circle moment are not reachable as a coach either
      for (const m of [as === CA ? MOM(2) : MOM(1), MOM(3)]) {
        const r = await get(`/m/${m}`, as);
        expect([as, m, diff404(r, ref.R6)]).toEqual([as, m, []]);
      }
    }
    // R7 for a coach (kind either, coach switch on): answers what an invented UUID answers
    const r7ref = await get(`/m/${INVENTED}/clip`, CA);
    for (const m of [MOM(2), MOM(3)]) expect([m, diffSame(await get(`/m/${m}/clip`, CA), r7ref)]).toEqual([m, []]);
    // no RM row written by the coach's attempts
    const { rows } = await pg.query('SELECT count(*)::int AS n FROM coachip_rm_notes WHERE rm_user_id = ANY($1::uuid[])', [[CA, CB]]);
    expect(rows[0].n).toBe(0);
    const { rows: s } = await pg.query("SELECT count(*)::int AS n FROM coachip_steps WHERE scope = 'sector'");
    expect(s[0].n).toBe(0);
  });

  // ── 3 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('3 · a coach who is also the RM of another sector', () => {
    const DUAL_MAP = { ...RM_MAP, [CT]: 'Urban-I' };   // CT coaches in Tarnol and is RM of Urban-I

    test('their own coach routes answer byte-identically with and without the RM entry', async () => {
      await seed.setting(pg.query, 'portal_coachip', [CT]);
      const paths = ['/home', '/schools', `/m/${MOM(3)}`, '/stats', '/results'];
      const before = [];
      for (const p of paths) before.push(await get(p, CT));
      expect(before.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      await seed.setting(pg.query, 'portal_coachip_rm', DUAL_MAP);
      for (const [i, p] of paths.entries()) {
        const after = await get(p, CT);
        expect([p, diffSame(after, before[i])]).toEqual([p, []]);
      }
      const me = await get('/me', CT);
      expect(me.body.coach).toEqual({ schoolCount: 1, teacherCount: 1 });
      expect(me.body.rm).toEqual({ sector: 'Urban-I', schoolCount: 6, coachCount: 3, coachesHere: false });   // fix-r5 s5: they coach in Tarnol
    });

    test('on RM routes they see only the Urban-I sector, never their own Tarnol schools, teachers or moments', async () => {
      await seed.setting(pg.query, 'portal_coachip', [CT]);
      await seed.setting(pg.query, 'portal_coachip_rm', DUAL_MAP);
      const home = await get('/rm/home', CT);
      expect(home.status).toBe(200);
      expect(home.body.sector).toBe('Urban-I');
      const coaches = home.body.groups.needs_me.concat(home.body.groups.on_track).map((c) => c.coach_user_id).sort();
      expect(coaches).toEqual([CA, CB, CC].sort());
      const circle = await get('/rm/circle', CT);
      expect(circle.body.moments.map((m) => m.moment_id).sort()).toEqual([MOM(1), MOM(2)].sort());
      for (const r of [home, circle]) {
        for (const id of [SCH(10), MOM(3), CT, RM2]) expect(r.text).not.toContain(id);
        expect(r.text).not.toContain('Fictional-10');
        expect(teacherLeaks(r)).toEqual([]);
      }
      // R18 for themselves (a Tarnol coach) and for the Tarnol RM → the one 404; an Urban-I coach → 200
      const ref = await get(`/rm/coach/${INVENTED}`, CT);
      for (const c of [CT, RM2]) expect([c, diff404(await get(`/rm/coach/${c}`, CT), ref)]).toEqual([c, []]);
      expect((await get(`/rm/coach/${CA}`, CT)).status).toBe(200);
      // R19: a note to themselves for their own Tarnol school → 404 (they are not a coach of the sector they run)
      const nref = await post('/rm/notes', CT, noteBody({ coach_user_id: INVENTED }));
      const self = await post('/rm/notes', CT, noteBody({ coach_user_id: CT, school_ids: [SCH(10)] }));
      expect(diff404(self, nref)).toEqual([]);
      // R6: their own Tarnol moment still opens, but in the COACH form (the coach leg), never the RM circle form
      const own = await get(`/m/${MOM(3)}`, CT);
      expect(own.status).toBe(200);
      // the Tarnol circle is not their RM circle: the Tarnol RM's view is unchanged by CT's RM entry
      const t = await get('/rm/circle', RM2);
      expect(t.body.moments.map((m) => m.moment_id)).toEqual([MOM(3)]);
      // R21: a sector step is written for Urban-I, never Tarnol
      const st = await post('/rm/steps', CT, stepBody());
      expect(st.status).toBe(201);
      const { rows } = await pg.query("SELECT sector FROM coachip_steps WHERE scope = 'sector' AND coach_user_id = $1", [CT]);
      expect(rows).toEqual([{ sector: 'Urban-I' }]);
    });
  });

  // ── 4 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  test('4 · R19 cross-coach: a school held by another coach of the same sector, or a Tarnol school → the one 404', async () => {
    const ref = await post('/rm/notes', RM, noteBody({ coach_user_id: INVENTED }));
    const cases = [
      ['CA + CB\'s school', noteBody({ coach_user_id: CA, school_ids: [SCH(1)] })],
      ['CA + own and CB\'s school', noteBody({ coach_user_id: CA, school_ids: [SCH(3), SCH(2)] })],
      ['CB + CA\'s school', noteBody({ coach_user_id: CB, school_ids: [SCH(4)] })],
      ['CA + the unheld Urban-I school', noteBody({ coach_user_id: CA, school_ids: [SCH(6)] })],
      ['CA + a Tarnol school', noteBody({ coach_user_id: CA, school_ids: [SCH(10)] })],
      ['CA + own and a Tarnol school', noteBody({ coach_user_id: CA, school_ids: [SCH(3), SCH(10)] })],
      ['CA + an invented school', noteBody({ coach_user_id: CA, school_ids: [INVENTED] })],
      ['roster coach with no school', noteBody({ coach_user_id: CX, school_ids: [SCH(6)] })],
      ['the RM to themselves', noteBody({ coach_user_id: RM, school_ids: [SCH(3)] })],
      ['Tarnol coach + Tarnol school', noteBody({ coach_user_id: CT, school_ids: [SCH(10)] })],
    ];
    for (const [label, body] of cases) {
      const r = await post('/rm/notes', RM, body);
      expect([label, diff404(r, ref)]).toEqual([label, []]);
    }
    const { rows } = await pg.query('SELECT count(*)::int AS n FROM coachip_rm_notes WHERE rm_user_id = $1', [RM]);
    expect(rows[0].n).toBe(1);   // the seeded one only
    // and the in-scope note still goes through
    expect((await post('/rm/notes', RM, noteBody())).status).toBe(201);
  });

  // ── 5 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  test('5 · R19 strict body: one extra key, or four schools → 400 {"error":"bad_request"}, nothing written', async () => {
    const extras = {
      lines: ['a', 'b', 'c'], codes: ['T-01'], note: 'free text', text: 'free text', teacher_key: '0123456789abcdef', code_id: INVENTED,
    };
    for (const [k, v] of Object.entries(extras)) {
      const r = await post('/rm/notes', RM, { ...noteBody(), [k]: v });
      expect([k, r.status, r.text, r.headers['cache-control']]).toEqual([k, 400, BAD_TEXT, 'private, no-store']);
    }
    const four = await post('/rm/notes', RM, noteBody({ school_ids: [SCH(1), SCH(2), SCH(3), SCH(4)] }));
    expect([four.status, four.text]).toEqual([400, BAD_TEXT]);
    // the 400 is decided before any read: the same for a coach out of scope
    const outOfScope = await post('/rm/notes', RM2, { ...noteBody(), lines: ['x'] });
    expect([outOfScope.status, outOfScope.text]).toEqual([400, BAD_TEXT]);
    const { rows } = await pg.query('SELECT count(*)::int AS n FROM coachip_rm_notes WHERE rm_user_id = $1', [RM]);
    expect(rows[0].n).toBe(1);
  });

  // ── 6 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  test('6 · R17, R18, R20 (and the R6 circle form) carry no teacher reference; the circle row is exactly B22\'s keys', async () => {
    const answers = {
      R17: await get('/rm/home', RM),
      R18a: await get(`/rm/coach/${CA}`, RM),
      R18b: await get(`/rm/coach/${CB}`, RM),
      R20: await get('/rm/circle', RM),
      R6: await get(`/m/${MOM(1)}`, RM),
      R17t: await get('/rm/home', RM2),
      R20t: await get('/rm/circle', RM2),
    };
    for (const [id, r] of Object.entries(answers)) {
      expect([id, r.status]).toEqual([id, 200]);
      expect([id, teacherLeaks(r)]).toEqual([id, []]);
    }
    const ms = answers.R20.body.moments;
    expect(ms.length).toBe(2);
    for (const m of [...ms, ...answers.R20t.body.moments]) expect(Object.keys(m).sort()).toEqual([...CIRCLE_MOMENT_KEYS].sort());
    expect(Object.keys(ms[0].school).sort()).toEqual(['school_id', 'school_name']);
    // B22 on the R6 circle form: no grade, subject or date of the recording
    for (const k of ['grade', 'subject', 'recorded_on', 'recorded_at', 'date']) expect(answers.R6.text).not.toContain(`"${k}"`);
  });

  // ── 7 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  test('7 · the Tarnol RM\'s R17 and R20 name no Urban-I school id, coach id or school name anywhere', async () => {
    for (const p of ['/rm/home', '/rm/circle']) {
      const r = await get(p, RM2);
      expect([p, r.status]).toEqual([p, 200]);
      const hits = [...URBAN_SCHOOLS, ...URBAN_COACHES, RM, MOM(1), MOM(2), MOM(4), ...URBAN_SCHOOL_NAMES].filter((x) => r.text.includes(x));
      expect([p, hits]).toEqual([p, []]);
    }
    // the predicate is live: the Urban-I RM's own R17 does name them
    const own = await get('/rm/home', RM);
    expect([CA, SCH(1)].every((x) => own.text.includes(x))).toBe(true);
  });

  // ── 8 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('8 · a malformed portal_coachip_rm row → every RM route 404 and /me rm: null', () => {
    const variants = [
      ['row absent', null],
      ['a JSON list of ids', [RM, RM2]],
      ['a number', 1],
      ['bad JSON in a string', '{"00000000-0000-4000-8000-090000000001": "Urban-I"'],
      ['a non-sector literal', { [RM]: 'Urban-III', [RM2]: 'tarnol' }],
      ['a sector as a list', { [RM]: ['Urban-I'], [RM2]: ['Tarnol'] }],
      ['true', true],
    ];
    for (const [label, value] of variants) {
      test(label, async () => {
        if (value === null) await pg.query("DELETE FROM app_settings WHERE key = 'portal_coachip_rm'");
        else await seed.setting(pg.query, 'portal_coachip_rm', value);
        for (const as of [RM, RM2]) {
          for (const [id, r] of await everyRmRoute(as)) {
            expect([label, as, id, r.status, r.text, r.headers['cache-control']]).toEqual([label, as, id, 404, NOT_FOUND_TEXT, 'private, no-store']);
          }
          const me = await get('/me', as);
          expect([label, as, me.status, me.body.rm]).toEqual([label, as, 200, null]);
        }
        const { rows } = await pg.query("SELECT count(*)::int AS n FROM coachip_steps WHERE scope = 'sector'");
        expect(rows[0].n).toBe(0);
      });
    }
  });

  // ── mutation proof ────────────────────────────────────────────────────────────────────────────────────────────
  describe('mutation proof: rmSector says "Urban-I" for every caller → blocks 1 and 2 would see the leak', () => {
    let leaky;
    beforeAll(async () => {
      leaky = await startApp(pg, { now: NOW, flags: { ...realFlags(pg), rmSector: async () => 'Urban-I' } });
    });
    afterAll(async () => { if (leaky) await leaky.close(); });

    test('block 1\'s predicate flags the Tarnol RM reading Urban-I ids', async () => {
      const ref18 = await get(`/rm/coach/${INVENTED}`, RM2, leaky);
      const r18 = await get(`/rm/coach/${CA}`, RM2, leaky);
      expect(r18.status).toBe(200);
      expect(diff404(r18, ref18)).not.toEqual([]);
      const ref19 = await post('/rm/notes', RM2, noteBody({ coach_user_id: INVENTED }), leaky);
      const r19 = await post('/rm/notes', RM2, noteBody(), leaky);
      expect(r19.status).toBe(201);
      expect(diff404(r19, ref19)).not.toEqual([]);
      const ref6 = await get(`/m/${INVENTED}`, RM2, leaky);
      const r6 = await get(`/m/${MOM(1)}`, RM2, leaky);
      expect(r6.status).toBe(200);
      expect(diff404(r6, ref6)).not.toEqual([]);
    });

    test('block 2\'s predicate flags a coach session reaching the RM routes', async () => {
      await seed.setting(pg.query, 'portal_coachip', [CA]);
      const ref = await get(`/rm/coach/${INVENTED}`, RM, leaky);
      const leaks = [];
      // the same requests block 2 sends, aimed at coach CB's ids (CA as a would-be RM is excluded from its own coach list)
      const tries = [
        ['R17', await get('/rm/home', CA, leaky)],
        ['R18', await get(`/rm/coach/${CB}`, CA, leaky)],
        ['R19', await post('/rm/notes', CA, noteBody({ coach_user_id: CB, school_ids: [SCH(1)] }), leaky)],
        ['R20', await get('/rm/circle', CA, leaky)],
        ['R21', await post('/rm/steps', CA, stepBody(), leaky)],
        ['R6', await get(`/m/${MOM(2)}`, CA, leaky)],
      ];
      for (const [id, r] of tries) if (diff404(r, ref).length) leaks.push(id);
      expect(leaks).toEqual(['R17', 'R18', 'R19', 'R20', 'R21', 'R6']);
    });

    test('block 6 predicate is live: a teacher id, a T-code key and a 16-hex value are caught', () => {
      const fake = { text: `{"x":"${T(1)}","code":"T-01","k":"0123456789abcdef"}`, body: { x: T(1), code: 'T-01', k: '0123456789abcdef' } };
      expect(teacherLeaks(fake).length).toBeGreaterThanOrEqual(3);
    });
  });
});
