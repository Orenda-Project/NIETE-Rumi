'use strict';
/**
 * bd-sex15q.13 (worker w-write) — the COACHIP write routes over HTTP, through the real router
 * (dashboard/routes/portal-coachip.routes.js) against a throwaway Postgres carrying the insights schema
 * (tests/coachip/helpers/pg-harness.js). Mocked: only the clock and the three switches.
 *
 *   R10 POST /coachip/steps                 checks in API order → 404 (one body); 409 step_exists (pre-check AND the
 *                                           uq_coachip_steps_open race); check_by by API §8.1; rm_note_id → note 'set'
 *   R11 POST /coachip/steps/:id/tick        open|deferred only; closed → 409 step_closed; sets checked_at
 *   R12 POST /coachip/steps/:id/status      open → completed|deferred|cancelled, deferred → completed|cancelled
 *   R13 POST /coachip/notes/:id/status      sent → seen; sent|seen|set → dismissed; seen on set/dismissed is a no-op
 *   R16 POST /coachip/teacher-name          decode switch AND keyFor; audit 'decode' BEFORE the name; audit fails → 500
 *   R19 POST /coachip/rm/notes              coach in sector, schools the coach's and the sector's, W in catalogue
 *   R21 POST /coachip/rm/steps              conservative reading (board m-api question 11:48Z): date = today only
 *
 * Contract: contracts/API.md v1.4 §1, §2, §3, §7, §8.1, §8.2, §8.5, §9, §11; payload shapes from contracts/fixtures.json
 * (steps_post_201, steps_post_409, rm_notes_post_201, rm_steps_post_201, errors), compared key by key below.
 * Fictional data only (FIXTURES.md): fake v4 ids, "Govt. Primary School Fictional-NN", no person's name.
 */
const http = require('http');
const express = require('express');
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const seed = require('./helpers/seed');
const S = require('../../dashboard/services/coachip-shapes');
const { createCoachipRouter } = require('../../dashboard/routes/portal-coachip.routes');
const { createCoachipCodes } = require('../../dashboard/services/coachip-codes.service');

const run = hasPostgres() ? describe : describe.skip;
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday 11:00 in Karachi
const TODAY = '2026-10-26';

// ── the fictional world ───────────────────────────────────────────────────────────────────────────────────────────
const A = seed.fid('coach', 1);      // coach A, Urban-I: schools 3, 4, 6
const B = seed.fid('coach', 2);      // coach B, Urban-I: school 5
const C = seed.fid('coach', 3);      // coach C, Sihala: school 9
const RM = seed.fid('rm', 1);        // RM of Urban-I
const RM2 = seed.fid('rm', 2);       // RM of Sihala
const SCH = (n) => seed.fid('school', n);
const T = (n) => seed.fid('teacher', n);
const SESS = (n) => seed.fid('session', n);
const INVENTED = '00000000-0000-4000-8000-0f0000000999';
const TEACHER_NAME = 'Teacher Fictional-01';   // a placeholder string, not a person (FIXTURES rule)
const TEACHER_IDS = [T(1), T(2), T(3), T(4)];

/** The fixtures.json payloads this file compares shapes against (verbatim keys and types, fictional). */
const FIX = {
  steps_post_201: {
    step: {
      id: '00000000-0000-4000-8000-05000000000c', scope: 'coach',
      code: { code_id: '00000000-0000-4000-8000-020000000138', code: 'T-12' },
      school: { school_id: '00000000-0000-4000-8000-010000000003', school_name: 'Govt. Primary School Fictional-03' },
      w_id: 'W-IP-TIME', i_id: 'I-IP-TIME-1', step: { en: 'x', ur: 'x' },
      set_on: '2026-10-26', check_by: '2026-11-09', check_rule: '14_days', visit: null, status: 'open', coach_tick: 'pending',
      strip: { needed: 3, window_days: 14, hits: [] }, chip: 'to_come', to_come: 3,
      rm_note_id: '00000000-0000-4000-8000-060000000001',
    },
    computed_at: '2026-10-26T05:12:00Z',
  },
  steps_post_409: { error: 'step_exists', step_id: '00000000-0000-4000-8000-050000000007' },
  rm_notes_post_201: {
    note: {
      id: '00000000-0000-4000-8000-060000000002', label: { en: 'x', ur: 'x' }, template_id: 'RM-T2', w_id: 'W-IP-TIME',
      lines: { en: ['a', 'b', 'c'], ur: ['a', 'b', 'c'] },
      schools: [{ school_id: '00000000-0000-4000-8000-010000000006', school_name: 'Govt. Primary School Fictional-06' }],
      due_on: '2026-10-30', status: 'sent',
    },
    computed_at: '2026-10-26T05:12:00Z',
  },
  rm_steps_post_201: {
    step: {
      id: '00000000-0000-4000-8000-0a0000000001', scope: 'sector', sector: 'Urban-I', w_id: 'W-IP-TIME', i_id: 'I-IP-TIME-3',
      title: { en: 'x', ur: 'x' }, date: '2026-10-29', status: 'open',
    },
    computed_at: '2026-10-26T05:12:00Z',
  },
  errors: { 400: { error: 'bad_request' }, 404: { error: 'not_found' }, '409_closed': { error: 'step_closed' }, 500: { error: 'server_error' } },
};
/** Fields API §3 types as `X | null`: the fixture holds one branch, the payload may hold the other. */
const NULLABLE = new Set(['visit', 'rm_note_id']);

/** Same keys at every level, same JSON types (null accepted only on a NULLABLE field). */
function sameShape(actual, fixture, at = '$') {
  const errs = [];
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const key = at.split('.').pop();
  if (NULLABLE.has(key) && (actual === null || fixture === null)) return errs;
  if (kind(actual) !== kind(fixture)) return [`${at}: ${kind(actual)} ≠ ${kind(fixture)}`];
  if (kind(fixture) === 'object') {
    const a = Object.keys(actual).sort(); const f = Object.keys(fixture).sort();
    if (JSON.stringify(a) !== JSON.stringify(f)) errs.push(`${at}: keys ${a} ≠ ${f}`);
    for (const k of f) if (k in actual) errs.push(...sameShape(actual[k], fixture[k], `${at}.${k}`));
  } else if (kind(fixture) === 'array' && actual.length && fixture.length) {
    errs.push(...sameShape(actual[0], fixture[0], `${at}[0]`));
  }
  return errs;
}

/** API §1 "never in any payload" (B1, B4, B21): grep the serialised JSON. */
function assertNoLeak(raw, { allowName = false } = {}) {
  for (const id of TEACHER_IDS) expect(raw).not.toContain(id);
  expect(raw).not.toMatch(/"[0-9a-f]{16}"/);
  expect(raw).not.toMatch(/http/i);
  expect(raw).not.toContain('X-Amz-');
  expect(raw).not.toContain('r2.cloudflarestorage');
  for (const k of ['teacher_key', 'phone', 'evidence', 'rationale', 'narrative', 'executive_summary']) expect(raw).not.toContain(`"${k}"`);
  if (!allowName) expect(raw).not.toContain(TEACHER_NAME);
}

/** G10: every Count / Stat's window_id resolves to a Window in the same body's windows[]. */
function everyCountResolves(body) {
  const ids = new Set((body && Array.isArray(body.windows) ? body.windows : []).map((w) => w.id));
  const bad = [];
  (function walk(v, at) {
    if (!v || typeof v !== 'object') return;
    if (!Array.isArray(v) && typeof v.window_id === 'string') {
      if (!ids.has(v.window_id)) bad.push(at);
      if ('n' in v && 'd' in v && !(v.n <= v.d)) bad.push(`${at} n>d`);
    }
    for (const [k, x] of Object.entries(v)) if (k !== 'windows') walk(x, `${at}.${k}`);
  }(body, '$'));
  expect(bad).toEqual([]);
}

// ── the app under test ────────────────────────────────────────────────────────────────────────────────────────────
let servers = [];
function req(srv, method, path, { uid, body, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const data = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (uid) headers['x-test-uid'] = uid;
    if (data !== null) headers['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: `/api/portal${path}`, method, headers }, (res) => {
      let raw = ''; res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, raw, body: parsed });
      });
    });
    r.on('error', reject);
    if (data !== null) r.write(data);
    r.end();
  });
}

run('COACHIP write routes (Postgres, HTTP)', () => {
  let pg; let srv; let codes; let sw; let codeOf; let auditFails;
  let hidePrecheck = 0;   // > 0: the next open-step pre-check reads nothing, so the insert meets uq_coachip_steps_open

  /** A scope service with the contract's semantics (API.md §4), read from the same tables the real one reads. */
  function testScope() {
    return {
      async coachScope(uid) {
        const { rows } = await pg.query(
          `SELECT DISTINCT s.id FROM leader_schools ls JOIN schools s ON s.id = ls.school_id
            WHERE ls.leader_user_id = $1 AND ls.name_match_quality IS DISTINCT FROM 'test' AND NOT s.is_probable_test`, [uid]);
        if (!rows.length) return null;
        const schoolIds = rows.map((r) => r.id);
        const t = await pg.query(
          `SELECT id, school_id FROM users WHERE role = 'teacher' AND deleted_at IS NULL AND NOT COALESCE(is_test_user, false)
              AND school_id = ANY($1::uuid[])`, [schoolIds]);
        const teacherSchool = new Map(t.rows.map((r) => [codes.teacherKey(r.id), r.school_id]));
        return { schoolIds, teacherKeys: [...teacherSchool.keys()], teacherSchool, teacherCount: t.rows.length, schoolCount: schoolIds.length };
      },
      async rmScope(uid, sector) {
        const s = await pg.query('SELECT id FROM schools WHERE region = $1 AND NOT is_probable_test', [sector]);
        if (!s.rows.length) return null;
        const schoolIds = s.rows.map((r) => r.id);
        const c = await pg.query(
          `SELECT DISTINCT ls.leader_user_id AS id FROM leader_schools ls JOIN users u ON u.id = ls.leader_user_id
            WHERE ls.school_id = ANY($1::uuid[]) AND u.role = 'coach' AND u.deleted_at IS NULL`, [schoolIds]);
        const coachUserIds = c.rows.map((r) => r.id);
        return { sector, schoolIds, coachUserIds, rosterCoachUserIds: coachUserIds, teacherCount: 0, unassignedSchoolCount: 0 };
      },
      async inScope(scope, sessionId) {
        const { rows } = await pg.query(
          'SELECT u.school_id FROM coaching_sessions cs JOIN users u ON u.id = cs.user_id WHERE cs.id = $1', [sessionId]);
        return !!rows[0] && scope.schoolIds.includes(rows[0].school_id);
      },
      async circleAllows() { return false; },
    };
  }

  beforeAll(async () => {
    pg = await startPg();
    // The catalogue (coachip_weaknesses / coachip_interventions) from the library; truncate() keeps these two.
    const lib = S.library();
    const ws = [...lib.raw.weaknesses];
    const done = new Set();
    while (done.size < ws.length) {   // parents before sub-rows (W-IP-HOME's parent is itself a sub-row)
      for (const w of ws) {
        if (done.has(w.id) || (w.parent_w_id && !done.has(w.parent_w_id))) continue;
        // eslint-disable-next-line no-await-in-loop
        await pg.query(
          `INSERT INTO coachip_weaknesses (w_id, parent_w_id, primary_source, pedagogical_weight, is_s1_eligible, is_s7,
                                           short_name_en, short_name_ur, library_version)
           VALUES ($1, $2, 'lp_fidelity', 0.5, true, false, $3, $4, $5) ON CONFLICT (w_id) DO NOTHING`,
          [w.id, w.parent_w_id || null, w.short_name_en.slice(0, 60), w.short_name_ur.slice(0, 60), lib.version]);
        done.add(w.id);
      }
    }
    for (const i of lib.raw.interventions) {
      // eslint-disable-next-line no-await-in-loop
      await pg.query(
        `INSERT INTO coachip_interventions (i_id, w_id, level, rank_in_w, library_version) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (i_id) DO NOTHING`, [i.id, i.weakness_id, i.level, i.rank_in_w, lib.version]);
    }
    const real = createCoachipCodes({ query: pg.query, secret: seed.SECRET });
    codes = { ...real, audit: (...a) => (auditFails ? Promise.reject(new Error('audit insert refused')) : real.audit(...a)) };
    const app = express();
    app.use((rq, _rs, next) => { const u = rq.headers['x-test-uid']; rq.session = u ? { portalUserId: u } : {}; next(); });
    const query = (sql, params) => {
      if (hidePrecheck > 0 && /FROM coachip_steps/.test(sql) && /status = 'open'/.test(sql)) { hidePrecheck -= 1; return Promise.resolve({ rows: [] }); }
      return pg.query(sql, params);
    };
    app.use('/api/portal', createCoachipRouter({
      query,
      pool: pg.pool,
      flags: {
        coachOn: async (uid) => sw.coach.has(uid),
        rmSector: async (uid) => sw.rm[uid] || null,
        decodeOn: async (uid) => sw.decode.has(uid),
      },
      scope: testScope(),
      codes,
      now: () => NOW,
    }));
    srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    servers.push(srv);
  }, 180000);

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = [];
    if (pg) await pg.close();
  });

  beforeEach(async () => {
    await pg.truncate();
    auditFails = false;
    hidePrecheck = 0;
    sw = { coach: new Set([A, B, C]), rm: { [RM]: 'Urban-I', [RM2]: 'Sihala' }, decode: new Set([A]) };
    const q = pg.query;
    for (const [n, region] of [[3, 'Urban-I'], [4, 'Urban-I'], [5, 'Urban-I'], [6, 'Urban-I'], [9, 'Sihala']]) {
      // eslint-disable-next-line no-await-in-loop
      await seed.school(q, { id: SCH(n), n, region });
    }
    for (const id of [A, B, C, RM, RM2]) await seed.user(q, { id, role: 'coach' });   // eslint-disable-line no-await-in-loop
    await seed.user(q, { id: T(1), schoolId: SCH(3), name: TEACHER_NAME });
    await seed.user(q, { id: T(2), schoolId: SCH(4) });
    await seed.user(q, { id: T(3), schoolId: SCH(5) });
    await seed.user(q, { id: T(4), schoolId: SCH(9) });
    for (const n of [3, 4, 6]) await seed.holds(q, { coachId: A, schoolId: SCH(n) });   // eslint-disable-line no-await-in-loop
    await seed.holds(q, { coachId: B, schoolId: SCH(5) });
    await seed.holds(q, { coachId: C, schoolId: SCH(9) });
    for (const n of [1, 2, 3]) await q('INSERT INTO coaching_sessions (id, user_id) VALUES ($1, $2)', [SESS(n), T(n)]);   // eslint-disable-line no-await-in-loop
    const cA1 = await codes.codeFor(A, codes.teacherKey(T(1)));
    const cA2 = await codes.codeFor(A, codes.teacherKey(T(2)));
    const cB3 = await codes.codeFor(B, codes.teacherKey(T(3)));
    codeOf = { A1: cA1.code_id, A2: cA2.code_id, B3: cB3.code_id };
  });

  // ── helpers over the tables ──
  const stepBody = (over = {}) => ({
    code_id: codeOf.A1, school_id: SCH(3), w_id: 'W-IP-TIME', i_id: 'I-IP-TIME-1', source_session_id: SESS(1), rm_note_id: null, ...over,
  });
  async function note({ coach = A, status = 'sent', rm = RM, sector = 'Urban-I' } = {}) {
    const { rows } = await pg.query(
      `INSERT INTO coachip_rm_notes (rm_user_id, coach_user_id, sector, w_id, template_id, body_en, body_ur, due_on, status)
       VALUES ($1, $2, $3, 'W-IP-TIME', 'RM-T2', E'a\\nb\\nc', E'a\\nb\\nc', '2026-10-30', $4) RETURNING id`, [rm, coach, sector, status]);
    await pg.query('INSERT INTO coachip_rm_note_schools (rm_note_id, school_id, position) VALUES ($1, $2, 1)', [rows[0].id, coach === A ? SCH(3) : SCH(5)]);
    return rows[0].id;
  }
  async function step({ coach = A, codeId = codeOf.A1, school = SCH(3), status = 'open', w = 'W-IP-TIME' } = {}) {
    const { rows } = await pg.query(
      `INSERT INTO coachip_steps (coach_user_id, scope, code_id, school_id, w_id, i_id, set_at, check_by, check_by_rule, status)
       VALUES ($1, 'coach', $2, $3, $4, 'I-IP-TIME-1', $5, $6, '14_days', $7) RETURNING id`,
      [coach, codeId, school, w, NOW, S.addDays(TODAY, 14), status]);
    return rows[0].id;
  }
  async function visit(schoolN, date, { coach = A, status = 'upcoming' } = {}) {
    const { rows } = await pg.query(
      `INSERT INTO observation_schedules (leader_user_id, school_ext_id, teacher_ext_id, scheduled_for, status, school_id)
       VALUES ($1, 'niete:fx', 'fx', $2, $3, $4) RETURNING id`, [coach, date, status, SCH(schoolN)]);
    return rows[0].id;
  }
  const one = async (sql, p) => (await pg.query(sql, p)).rows[0];
  async function expectNotFoundLike(r) {
    expect(r.status).toBe(404);
    const invented = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ code_id: INVENTED }) });
    expect(r.raw).toBe(invented.raw);
    expect(r.raw).toBe(JSON.stringify(FIX.errors[404]));
    expect(r.headers['cache-control']).toBe('private, no-store');
  }

  // ── R10 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R10 POST /coachip/steps', () => {
    test('201: the worked case — a visit 2 days away is too soon, so check_by = set + 14 (2026-11-09, 14_days)', async () => {
      await visit(3, '2026-10-28');
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() });
      expect(r.status).toBe(201);
      expect(sameShape(r.body, FIX.steps_post_201)).toEqual([]);
      const s = r.body.step;
      expect(s).toMatchObject({
        scope: 'coach', code: { code_id: codeOf.A1, code: 'T-01' }, school: { school_id: SCH(3), school_name: 'Govt. Primary School Fictional-03' },
        w_id: 'W-IP-TIME', i_id: 'I-IP-TIME-1', set_on: TODAY, check_by: '2026-11-09', check_rule: '14_days', visit: null,
        status: 'open', coach_tick: 'pending', strip: { needed: 3, window_days: 14, hits: [] }, chip: 'to_come', to_come: 3, rm_note_id: null,
      });
      expect(s.step.en.length).toBeGreaterThan(0);
      expect(r.body.computed_at).toBe(NOW.toISOString());
      const row = await one(`SELECT check_by::text AS check_by, check_by_rule, visit_schedule_id, source_session_id, set_at, coach_user_id
                               FROM coachip_steps WHERE id = $1`, [s.id]);
      expect(row).toMatchObject({ check_by: '2026-11-09', check_by_rule: '14_days', visit_schedule_id: null, source_session_id: SESS(1), coach_user_id: A });
      expect(new Date(row.set_at).toISOString()).toBe(NOW.toISOString());
      expect(r.headers['cache-control']).toBe('private, no-store');
      assertNoLeak(r.raw);
      everyCountResolves(r.body);
    });

    test('201: a booked visit ≥ set + 7 days → check_by = that visit, rule visit, visit {date, schedule_id}', async () => {
      await visit(3, '2026-10-28');
      const sid = await visit(3, '2026-11-04');
      await visit(3, '2026-11-05');
      await visit(3, '2026-11-03', { status: 'cancelled' });
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() });
      expect(r.status).toBe(201);
      expect(r.body.step).toMatchObject({ check_by: '2026-11-04', check_rule: 'visit', visit: { date: '2026-11-04', schedule_id: sid } });
      expect(sameShape(r.body, FIX.steps_post_201)).toEqual([]);
      const row = await one('SELECT check_by_rule, visit_schedule_id FROM coachip_steps WHERE id = $1', [r.body.step.id]);
      expect(row).toEqual({ check_by_rule: 'visit', visit_schedule_id: sid });
    });

    test('a visit another coach booked is not this coach\'s check (14_days)', async () => {
      await visit(3, '2026-11-04', { coach: B });
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() });
      expect(r.status).toBe(201);
      expect(r.body.step).toMatchObject({ check_rule: '14_days', check_by: '2026-11-09' });
    });

    test('with rm_note_id: the note becomes set in the same transaction and the step carries it', async () => {
      const nid = await note();
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ rm_note_id: nid }) });
      expect(r.status).toBe(201);
      expect(r.body.step.rm_note_id).toBe(nid);
      expect(sameShape(r.body, FIX.steps_post_201)).toEqual([]);
      expect((await one('SELECT status::text AS s FROM coachip_rm_notes WHERE id = $1', [nid])).s).toBe('set');
      expect((await one('SELECT rm_note_id FROM coachip_steps WHERE id = $1', [r.body.step.id])).rm_note_id).toBe(nid);
    });

    test('an I of the W\'s parent is accepted (I-IP-1 for W-IP-TIME); source_session_id may be null', async () => {
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ i_id: 'I-IP-1', source_session_id: null }) });
      expect(r.status).toBe(201);
      expect(r.body.step.i_id).toBe('I-IP-1');
    });

    test('409 step_exists (pre-check): the open step for (coach, code, W) is named; nothing written', async () => {
      const first = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() });
      expect(first.status).toBe(201);
      const nid = await note();
      const again = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ i_id: 'I-IP-TIME-2', rm_note_id: nid }) });
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ error: 'step_exists', step_id: first.body.step.id });
      expect(sameShape(again.body, FIX.steps_post_409)).toEqual([]);
      expect((await one('SELECT count(*)::int AS n FROM coachip_steps')).n).toBe(1);
      expect((await one('SELECT status::text AS s FROM coachip_rm_notes WHERE id = $1', [nid])).s).toBe('sent');
    });

    test('409 step_exists from the unique index itself: the 23505 on uq_coachip_steps_open is mapped, not a 500', async () => {
      const first = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() });
      const nid = await note();
      hidePrecheck = 1;
      const again = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ rm_note_id: nid }) });
      expect(hidePrecheck).toBe(0);
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ error: 'step_exists', step_id: first.body.step.id });
      expect((await one('SELECT count(*)::int AS n FROM coachip_steps')).n).toBe(1);
      expect((await one('SELECT status::text AS s FROM coachip_rm_notes WHERE id = $1', [nid])).s).toBe('sent');   // rolled back
    });

    test('409 step_exists under a race: the uq_coachip_steps_open violation maps to the same body', async () => {
      const rs = await Promise.all([1, 2, 3, 4].map(() => req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() })));
      const ok = rs.filter((r) => r.status === 201);
      const dup = rs.filter((r) => r.status === 409);
      expect(ok).toHaveLength(1);
      expect(dup).toHaveLength(3);
      for (const d of dup) expect(d.body).toEqual({ error: 'step_exists', step_id: ok[0].body.step.id });
    });

    test('a completed step frees the pair: a new open step for the same (code, W) is 201', async () => {
      await step({ status: 'completed' });
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() });
      expect(r.status).toBe(201);
    });

    test('another coach\'s code_id → 404, byte-identical to an invented code_id; nothing written', async () => {
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ code_id: codeOf.B3, school_id: SCH(5), source_session_id: null }) });
      await expectNotFoundLike(r);
      expect((await one('SELECT count(*)::int AS n FROM coachip_steps')).n).toBe(0);
    });

    test.each([
      ['a school outside the coach\'s scope', { school_id: SCH(5) }],
      ['an in-scope school that is not the teacher\'s current school', { school_id: SCH(4) }],
      ['an invented school', { school_id: INVENTED }],
      ['a W not in the catalogue', { w_id: 'W-NOPE' }],
      ['an I of another W', { i_id: 'I-EXIT-TIME-1' }],
      ['an I not in the library', { i_id: 'I-NOPE-1' }],
      ['a source session of another coach\'s teacher', { source_session_id: SESS(3) }],
      ['a source session of another of this coach\'s teachers', { source_session_id: SESS(2) }],
      ['an invented source session', { source_session_id: INVENTED }],
      ['an invented rm_note_id', { rm_note_id: INVENTED }],
    ])('%s → the one 404', async (_label, over) => {
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody(over) });
      await expectNotFoundLike(r);
      expect((await one('SELECT count(*)::int AS n FROM coachip_steps')).n).toBe(0);
    });

    test('a note to another coach as rm_note_id → 404, and that note is untouched', async () => {
      const nid = await note({ coach: B });
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ rm_note_id: nid }) });
      await expectNotFoundLike(r);
      expect((await one('SELECT status::text AS s FROM coachip_rm_notes WHERE id = $1', [nid])).s).toBe('sent');
    });

    test('a teacher who moved out of the coach\'s schools: the old code_id → 404', async () => {
      await pg.query('UPDATE users SET school_id = $1 WHERE id = $2', [SCH(5), T(1)]);
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody({ source_session_id: null }) });
      await expectNotFoundLike(r);
    });

    test('400: an extra key (teacher_key), a missing key, a bad value — decided before any read', async () => {
      const { rm_note_id: _drop, ...missing } = stepBody();
      for (const body of [
        { ...stepBody(), teacher_key: 'abcdef0123456789' },
        missing,
        stepBody({ code_id: 'T-01' }),
        stepBody({ w_id: 'ip-time' }),
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body });
        expect(r.status).toBe(400);
        expect(r.raw).toBe(JSON.stringify(FIX.errors[400]));
      }
    });

    test('the coach switch off → 404 (the router\'s one body)', async () => {
      sw.coach.delete(A);
      const r = await req(srv, 'POST', '/coachip/steps', { uid: A, body: stepBody() });
      expect(r.status).toBe(404);
      expect(r.raw).toBe(JSON.stringify(FIX.errors[404]));
    });
  });

  // ── R11 / R12 ────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R11 tick and R12 status', () => {
    test('R11: a tick on an open step sets coach_tick and checked_at; 200 {step, computed_at}', async () => {
      const id = await step();
      const r = await req(srv, 'POST', `/coachip/steps/${id}/tick`, { uid: A, body: { coach_tick: 'yes' } });
      expect(r.status).toBe(200);
      expect(sameShape(r.body, FIX.steps_post_201)).toEqual([]);
      expect(r.body.step).toMatchObject({ id, coach_tick: 'yes', status: 'open' });
      const row = await one('SELECT coach_tick::text AS t, checked_at FROM coachip_steps WHERE id = $1', [id]);
      expect(row.t).toBe('yes');
      expect(new Date(row.checked_at).toISOString()).toBe(NOW.toISOString());
      assertNoLeak(r.raw);
      everyCountResolves(r.body);
    });

    test('R11: a tick on a deferred step is allowed; "no" too', async () => {
      const id = await step({ status: 'deferred' });
      const r = await req(srv, 'POST', `/coachip/steps/${id}/tick`, { uid: A, body: { coach_tick: 'no' } });
      expect(r.status).toBe(200);
      expect(r.body.step).toMatchObject({ coach_tick: 'no', status: 'deferred' });
    });

    test.each(['completed', 'cancelled'])('R11: a tick on a %s step → 409 step_closed, unchanged', async (status) => {
      const id = await step({ status });
      const r = await req(srv, 'POST', `/coachip/steps/${id}/tick`, { uid: A, body: { coach_tick: 'yes' } });
      expect(r.status).toBe(409);
      expect(r.raw).toBe(JSON.stringify(FIX.errors['409_closed']));
      expect((await one('SELECT coach_tick::text AS t FROM coachip_steps WHERE id = $1', [id])).t).toBe('pending');
    });

    test('R11/R12: another coach\'s step, a sector step, an invented id → the one 404', async () => {
      const bs = await step({ coach: B, codeId: codeOf.B3, school: SCH(5) });
      const sector = await one(
        `INSERT INTO coachip_steps (coach_user_id, scope, sector, w_id, i_id, set_at, check_by, check_by_rule)
         VALUES ($1, 'sector', 'Urban-I', 'W-IP-TIME', 'I-IP-TIME-3', $2, $3, '14_days') RETURNING id`, [A, NOW, S.addDays(TODAY, 14)]);
      for (const id of [bs, sector.id, INVENTED]) {
        // eslint-disable-next-line no-await-in-loop
        const t = await req(srv, 'POST', `/coachip/steps/${id}/tick`, { uid: A, body: { coach_tick: 'yes' } });
        // eslint-disable-next-line no-await-in-loop
        await expectNotFoundLike(t);
        // eslint-disable-next-line no-await-in-loop
        const s = await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: 'completed' } });
        // eslint-disable-next-line no-await-in-loop
        await expectNotFoundLike(s);
      }
      expect((await one('SELECT coach_tick::text AS t, status::text AS s FROM coachip_steps WHERE id = $1', [bs]))).toEqual({ t: 'pending', s: 'open' });
    });

    test('R12: open → deferred → completed; then any change → 409 step_closed', async () => {
      const id = await step();
      const d = await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: 'deferred' } });
      expect(d.status).toBe(200);
      expect(d.body.step.status).toBe('deferred');
      expect(sameShape(d.body, FIX.steps_post_201)).toEqual([]);
      const c = await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: 'completed' } });
      expect(c.status).toBe(200);
      expect(c.body.step.status).toBe('completed');
      const x = await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: 'cancelled' } });
      expect(x.status).toBe(409);
      expect(x.raw).toBe(JSON.stringify(FIX.errors['409_closed']));
      expect((await one('SELECT status::text AS s FROM coachip_steps WHERE id = $1', [id])).s).toBe('completed');
      assertNoLeak(c.raw);
    });

    test.each([['open', 'cancelled'], ['open', 'completed'], ['deferred', 'cancelled']])('R12: %s → %s is 200', async (from, to) => {
      const id = await step({ status: from });
      const r = await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: to } });
      expect(r.status).toBe(200);
      expect((await one('SELECT status::text AS s FROM coachip_steps WHERE id = $1', [id])).s).toBe(to);
    });

    test('R12: a cancelled step cannot be completed (409), and there is no way back to open (400)', async () => {
      const id = await step({ status: 'cancelled' });
      expect((await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: 'completed' } })).status).toBe(409);
      expect((await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: 'open' } })).status).toBe(400);
    });

    test('R11/R12: a malformed step id or body → 400; an extra key → 400', async () => {
      const id = await step();
      expect((await req(srv, 'POST', '/coachip/steps/not-a-uuid/tick', { uid: A, body: { coach_tick: 'yes' } })).status).toBe(400);
      expect((await req(srv, 'POST', `/coachip/steps/${id}/tick`, { uid: A, body: { coach_tick: 'maybe' } })).status).toBe(400);
      expect((await req(srv, 'POST', `/coachip/steps/${id}/tick`, { uid: A, body: { coach_tick: 'yes', note: 'x' } })).status).toBe(400);
      expect((await req(srv, 'POST', `/coachip/steps/${id}/status`, { uid: A, body: { status: 'completed', step_id: id } })).status).toBe(400);
    });
  });

  // ── R13 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R13 POST /coachip/notes/:noteId/status', () => {
    test('sent → seen → dismissed; 200 {note, computed_at} in the fixture shape', async () => {
      const id = await note();
      const s = await req(srv, 'POST', `/coachip/notes/${id}/status`, { uid: A, body: { status: 'seen' } });
      expect(s.status).toBe(200);
      expect(sameShape(s.body, FIX.rm_notes_post_201)).toEqual([]);
      expect(s.body.note).toMatchObject({ id, status: 'seen' });
      expect(s.body.computed_at).toBe(NOW.toISOString());
      const d = await req(srv, 'POST', `/coachip/notes/${id}/status`, { uid: A, body: { status: 'dismissed' } });
      expect(d.status).toBe(200);
      expect(d.body.note.status).toBe('dismissed');
      expect((await one('SELECT status::text AS s FROM coachip_rm_notes WHERE id = $1', [id])).s).toBe('dismissed');
      assertNoLeak(d.raw);
      everyCountResolves(d.body);
    });

    test('a set note can be dismissed', async () => {
      const id = await note({ status: 'set' });
      const r = await req(srv, 'POST', `/coachip/notes/${id}/status`, { uid: A, body: { status: 'dismissed' } });
      expect(r.status).toBe(200);
      expect(r.body.note.status).toBe('dismissed');
    });

    test.each(['set', 'dismissed'])('seen on a %s note is a no-op 200', async (status) => {
      const id = await note({ status });
      const r = await req(srv, 'POST', `/coachip/notes/${id}/status`, { uid: A, body: { status: 'seen' } });
      expect(r.status).toBe(200);
      expect(r.body.note.status).toBe(status);
      expect((await one('SELECT status::text AS s FROM coachip_rm_notes WHERE id = $1', [id])).s).toBe(status);
    });

    test('another coach\'s note or an invented id → the one 404; a bad status or an extra key → 400', async () => {
      const other = await note({ coach: B });
      for (const id of [other, INVENTED]) {
        // eslint-disable-next-line no-await-in-loop
        await expectNotFoundLike(await req(srv, 'POST', `/coachip/notes/${id}/status`, { uid: A, body: { status: 'dismissed' } }));
      }
      expect((await one('SELECT status::text AS s FROM coachip_rm_notes WHERE id = $1', [other])).s).toBe('sent');
      const mine = await note();
      expect((await req(srv, 'POST', `/coachip/notes/${mine}/status`, { uid: A, body: { status: 'set' } })).status).toBe(400);
      expect((await req(srv, 'POST', `/coachip/notes/${mine}/status`, { uid: A, body: { status: 'seen', why: 'x' } })).status).toBe(400);
    });
  });

  // ── R16 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R16 POST /coachip/teacher-name', () => {
    test('200 {name, computed_at}; one decode audit row (subject = code_id) written', async () => {
      const r = await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: codeOf.A1 } });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ name: TEACHER_NAME, computed_at: NOW.toISOString() });
      assertNoLeak(r.raw, { allowName: true });
      const rows = (await pg.query('SELECT actor_user_id, action::text AS action, subject_id FROM coachip_audit_log')).rows;
      expect(rows).toEqual([{ actor_user_id: A, action: 'decode', subject_id: codeOf.A1 }]);
    });

    test('decode switch off → the one 404, no audit row', async () => {
      sw.decode.delete(A);
      const r = await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: codeOf.A1 } });
      await expectNotFoundLike(r);
      expect((await one('SELECT count(*)::int AS n FROM coachip_audit_log')).n).toBe(0);
    });

    test('a decode-switch read that throws is off → 404', async () => {
      const saved = sw.decode;
      sw.decode = { has: () => { throw new Error('flag read failed'); } };
      const r = await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: codeOf.A1 } });
      sw.decode = saved;
      expect(r.status).toBe(404);
      expect(r.raw).toBe(JSON.stringify(FIX.errors[404]));
    });

    test('another coach\'s code_id, an invented one, a teacher who left the scope → the one 404, no name, no audit', async () => {
      sw.decode.add(B);
      await expectNotFoundLike(await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: codeOf.B3 } }));
      await expectNotFoundLike(await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: INVENTED } }));
      await pg.query('UPDATE users SET school_id = $1 WHERE id = $2', [SCH(5), T(1)]);
      const moved = await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: codeOf.A1 } });
      await expectNotFoundLike(moved);
      expect(moved.raw).not.toContain(TEACHER_NAME);
      expect((await one('SELECT count(*)::int AS n FROM coachip_audit_log')).n).toBe(0);
    });

    test('the audit insert fails → 500 server_error and no name', async () => {
      auditFails = true;
      const errs = jest.spyOn(console, 'error').mockImplementation(() => {});
      const r = await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: codeOf.A1 } });
      errs.mockRestore();
      expect(r.status).toBe(500);
      expect(r.raw).toBe(JSON.stringify(FIX.errors[500]));
      expect(r.raw).not.toContain(TEACHER_NAME);
    });

    test('400: an extra key (name) or a code instead of a code_id', async () => {
      expect((await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: codeOf.A1, name: 'x' } })).status).toBe(400);
      expect((await req(srv, 'POST', '/coachip/teacher-name', { uid: A, body: { code_id: 'T-01' } })).status).toBe(400);
    });
  });

  // ── R19 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R19 POST /coachip/rm/notes', () => {
    const noteBody = (over = {}) => ({ coach_user_id: A, template_id: 'RM-T2', w_id: 'W-IP-TIME', school_ids: [SCH(6)], due_on: '2026-10-30', ...over });

    test('201: lines composed from COPY §RM-T, schools in order, audit note_sent, fixture shape', async () => {
      const r = await req(srv, 'POST', '/coachip/rm/notes', { uid: RM, body: noteBody() });
      expect(r.status).toBe(201);
      expect(sameShape(r.body, FIX.rm_notes_post_201)).toEqual([]);
      const n = r.body.note;
      expect(n).toMatchObject({
        template_id: 'RM-T2', w_id: 'W-IP-TIME', due_on: '2026-10-30', status: 'sent',
        schools: [{ school_id: SCH(6), school_name: 'Govt. Primary School Fictional-06' }],
        label: { en: 'From your RM' },
      });
      // fixtures.json rm_notes_post_201 lines (en); the {date} slot is composeNoteLines' COPY §F date
      expect(n.lines.en[0]).toBe('Govt. Primary School Fictional-06 have had no visit for 4 weeks or more.');
      expect(n.lines.en[1]).toMatch(/^Please visit before .*30 Oct and set one step from ".+"\.$/);
      expect(n.lines.en[2]).toBe('Bring the moment to the Friday circle.');
      expect(n.lines.ur).toHaveLength(3);
      expect(r.body.computed_at).toBe(NOW.toISOString());
      const row = await one('SELECT rm_user_id, coach_user_id, sector, body_en, status::text AS s FROM coachip_rm_notes WHERE id = $1', [n.id]);
      expect(row).toMatchObject({ rm_user_id: RM, coach_user_id: A, sector: 'Urban-I', s: 'sent' });
      expect(row.body_en).toBe(n.lines.en.join('\n'));
      const audit = (await pg.query('SELECT actor_user_id, action::text AS action, subject_id FROM coachip_audit_log')).rows;
      expect(audit).toEqual([{ actor_user_id: RM, action: 'note_sent', subject_id: n.id }]);
      assertNoLeak(r.raw);
      everyCountResolves(r.body);
    });

    test('three schools: positions 1..3 in the order given, joined by the list rule', async () => {
      const r = await req(srv, 'POST', '/coachip/rm/notes', { uid: RM, body: noteBody({ school_ids: [SCH(6), SCH(3), SCH(4)] }) });
      expect(r.status).toBe(201);
      expect(r.body.note.schools.map((s) => s.school_id)).toEqual([SCH(6), SCH(3), SCH(4)]);
      const pos = (await pg.query('SELECT school_id, position FROM coachip_rm_note_schools WHERE rm_note_id = $1 ORDER BY position', [r.body.note.id])).rows;
      expect(pos).toEqual([{ school_id: SCH(6), position: 1 }, { school_id: SCH(3), position: 2 }, { school_id: SCH(4), position: 3 }]);
      expect(r.body.note.lines.en[0]).toBe('Govt. Primary School Fictional-06, Govt. Primary School Fictional-03 and Govt. Primary School Fictional-04 have had no visit for 4 weeks or more.');
    });

    test('a failed note_sent audit is logged and the note still lands (API §11)', async () => {
      auditFails = true;
      const errs = jest.spyOn(console, 'error').mockImplementation(() => {});
      const r = await req(srv, 'POST', '/coachip/rm/notes', { uid: RM, body: noteBody() });
      errs.mockRestore();
      expect(r.status).toBe(201);
      expect((await one('SELECT count(*)::int AS n FROM coachip_rm_notes')).n).toBe(1);
    });

    test.each([
      ['a coach in another sector', { coach_user_id: C, school_ids: [SCH(9)] }],
      ['an invented coach', { coach_user_id: INVENTED }],
      ['the RM as their own coach', { coach_user_id: RM }],
      ['a school of another coach in the sector', { school_ids: [SCH(5)] }],
      ['one good school and one not the coach\'s', { school_ids: [SCH(6), SCH(5)] }],
      ['a school in another sector', { school_ids: [SCH(9)] }],
      ['an invented school', { school_ids: [INVENTED] }],
      ['a W not in the catalogue', { w_id: 'W-NOPE' }],
    ])('%s → the one 404; no note, no audit', async (_l, over) => {
      const r = await req(srv, 'POST', '/coachip/rm/notes', { uid: RM, body: noteBody(over) });
      await expectNotFoundLike(r);
      expect((await one('SELECT count(*)::int AS n FROM coachip_rm_notes')).n).toBe(0);
      expect((await one('SELECT count(*)::int AS n FROM coachip_audit_log')).n).toBe(0);
    });

    test('the RM of another sector writing to an Urban-I coach → 404', async () => {
      await expectNotFoundLike(await req(srv, 'POST', '/coachip/rm/notes', { uid: RM2, body: noteBody() }));
    });

    test('a coach session (no RM switch) → 404', async () => {
      expect((await req(srv, 'POST', '/coachip/rm/notes', { uid: A, body: noteBody({ coach_user_id: B, school_ids: [SCH(5)] }) })).status).toBe(404);
    });

    test('400: lines / codes / free text keys, a bad template, a past or far due_on, 4 schools, a duplicate school', async () => {
      for (const body of [
        { ...noteBody(), lines: ['x', 'y', 'z'] },
        { ...noteBody(), codes: ['T-01'] },
        noteBody({ template_id: 'RM-T9' }),
        noteBody({ due_on: '2026-10-25' }),
        noteBody({ due_on: S.addDays(TODAY, 29) }),
        noteBody({ school_ids: [SCH(3), SCH(4), SCH(6), SCH(5)] }),
        noteBody({ school_ids: [SCH(3), SCH(3)] }),
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await req(srv, 'POST', '/coachip/rm/notes', { uid: RM, body });
        expect(r.status).toBe(400);
      }
    });
  });

  // ── R21 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R21 POST /coachip/rm/steps (conservative reading: date = today, Karachi)', () => {
    const body = (over = {}) => ({ i_id: 'I-IP-TIME-3', w_id: 'W-IP-TIME', date: TODAY, ...over });

    test('201 SectorStep: scope sector, the RM\'s sector, check_by = today + 14, 14_days, date = the set date', async () => {
      const r = await req(srv, 'POST', '/coachip/rm/steps', { uid: RM, body: body() });
      expect(r.status).toBe(201);
      expect(sameShape(r.body, FIX.rm_steps_post_201)).toEqual([]);
      expect(r.body.step).toMatchObject({ scope: 'sector', sector: 'Urban-I', w_id: 'W-IP-TIME', i_id: 'I-IP-TIME-3', date: TODAY, status: 'open' });
      expect(r.body.step.title.en.length).toBeGreaterThan(0);
      expect(r.body.computed_at).toBe(NOW.toISOString());
      const row = await one(`SELECT coach_user_id, scope::text AS scope, sector, code_id, school_id, check_by::text AS check_by, check_by_rule
                               FROM coachip_steps WHERE id = $1`, [r.body.step.id]);
      expect(row).toEqual({ coach_user_id: RM, scope: 'sector', sector: 'Urban-I', code_id: null, school_id: null, check_by: '2026-11-09', check_by_rule: '14_days' });
      assertNoLeak(r.raw);
      everyCountResolves(r.body);
    });

    test('a sector-level I of the W is accepted', async () => {
      const r = await req(srv, 'POST', '/coachip/rm/steps', { uid: RM, body: body({ i_id: 'I-IP-4', w_id: 'W-IP' }) });
      expect(r.status).toBe(201);
    });

    test('a date after today → 400 (no column holds a planned date; board m-api question)', async () => {
      const r = await req(srv, 'POST', '/coachip/rm/steps', { uid: RM, body: body({ date: '2026-10-29' }) });
      expect(r.status).toBe(400);
      expect(r.raw).toBe(JSON.stringify(FIX.errors[400]));
      expect((await one('SELECT count(*)::int AS n FROM coachip_steps')).n).toBe(0);
    });

    test.each([
      ['a teacher-level I', { i_id: 'I-IP-TIME-1' }],
      ['an I of another W', { i_id: 'I-EXIT-TIME-2' }],
      ['an I not in the library', { i_id: 'I-NOPE-1' }],
      ['a W not in the catalogue', { w_id: 'W-NOPE' }],
    ])('%s → the one 404', async (_l, over) => {
      await expectNotFoundLike(await req(srv, 'POST', '/coachip/rm/steps', { uid: RM, body: body(over) }));
      expect((await one('SELECT count(*)::int AS n FROM coachip_steps')).n).toBe(0);
    });

    test('a coach with no RM switch → 404; an extra key → 400', async () => {
      expect((await req(srv, 'POST', '/coachip/rm/steps', { uid: A, body: body() })).status).toBe(404);
      expect((await req(srv, 'POST', '/coachip/rm/steps', { uid: RM, body: { ...body(), sector: 'Sihala' } })).status).toBe(400);
    });
  });
});
