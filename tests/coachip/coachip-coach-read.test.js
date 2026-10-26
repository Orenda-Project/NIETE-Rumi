'use strict';
/**
 * bd-sex15q.13 — the coach's read routes over HTTP, through the real router, real scope service, real codec and a
 * throwaway Postgres 17 (tests/coachip/helpers/pg-harness.js). Only the clock and the flag readers are fakes.
 *
 *   R4 GET /coachip/schools      the Schools tab: top W per school (school rollup rank 1), visits, graded of recordings
 *   R2 GET /coachip/home         S1: the card, the row, cause + also, where first, moment, steps, note, coverage,
 *                                not_yet, phonics; the states no_scope / pending / stale / failed / insufficient / paused
 *   R3 GET /coachip/w/:wId       S2 + S3: card, split, schools (shows / too_few listed; the rest counted), codes, strips,
 *                                the inline moment with its pair, the step card, excluded, method
 *   R9 GET /coachip/i/:wId       S5: the library entry (no url), alternatives, check_by_default for ?school (scoped)
 *
 * Contract: contracts/API.md v1.4 §1, §3, §7 (R2, R3, R4, R9), §8.1, §12; key sets from contracts/fixtures.json v2.2
 * payloads home, home_stale, home_insufficient, home_no_scope, home_phonics_paused, w_W-IP-TIME, schools, i_W-IP-TIME
 * (listed below, verbatim). Every payload is grepped for identity leaks (each fixture teacher's users.id, the HMAC key
 * pattern, http, X-Amz-, r2.cloudflarestorage, the clip key prefix) and every Count/Stat must resolve to a Window in
 * the same body's windows[] (everyCountResolves).
 *
 * The world is C-03's story from FIXTURES.md, shrunk to a size a test can count by hand: six schools (S-01..S-06),
 * nine teachers, 23 recordings in w4-2026-09-28 (20 with a linked plan), W-IP-TIME 6 of 20. Coach B (C-08) holds S-52
 * and has a moment, a good example and rollups of its own that C-03 must never see. Fictional data only.
 */
const http = require('http');
const express = require('express');
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const seed = require('./helpers/seed');
const I = require('./helpers/insights-seed');
const { createCoachipCodes } = require('../../dashboard/services/coachip-codes.service');
const { createCoachipScope } = require('../../dashboard/services/coachip-scope.service');
const { createCoachipRouter } = require('../../dashboard/routes/portal-coachip.routes');

const run = hasPostgres() ? describe : describe.skip;
const { fid } = seed;
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday 26 Oct 2026, 11:00 PKT
const C3 = fid('coach', 3);
const CB = fid('coach', 8);
const C9 = fid('coach', 9);                     // switch on, no school
const RM = fid('rm', 1);
const TEACHER_ROLE_USER = fid('coach', 20);     // a teacher-role session
const SCH = (n) => fid('school', n);
const T = (n) => fid('teacher', n);
const SESS = (n) => fid('session', n);
const MOM = (n) => fid('moment', n);
const VIS = (n) => fid('visit', n);
const INVENTED = '00000000-0000-4000-8000-0f0000000999';

// ── the fixture's key sets (contracts/fixtures.json v2.2, read off the payloads named in the header) ─────────────
const K = {
  home: ['window', 'moves', 'note', 'steps', 'coverage', 'not_yet', 'phonics', 'stale', 'empty', 'method', 'windows', 'computed_at'],
  wcard: ['w_id', 'parent_w_id', 'rank', 'short_name', 'number_line', 'sentence', 'cause', 'count', 'teacher_count', 'teachers', 'window', 'status', 'where_first', 'moment_id', 'moment_duration_s', 'i_id'],
  cause: ['text', 'stat', 'also'],
  also: ['text', 'count'],
  cardWhere: ['school', 'count', 'visit', 'then'],
  wrow: ['w_id', 'short_name', 'sentence', 'count', 'window', 'state', 'where_first', 'not_yet', 'sector'],
  rowWhere: ['school', 'count'],
  notYet: ['graded', 'codes_seen', 'codes_needed', 'coaches_with_5plus'],
  window: ['id', 'from', 'to', 'weeks', 'grader', 'grader_label', 'framework', 'scoring_changed_on'],
  step: ['id', 'scope', 'code', 'school', 'w_id', 'i_id', 'step', 'set_on', 'check_by', 'check_rule', 'visit', 'status', 'coach_tick', 'strip', 'chip', 'to_come', 'rm_note_id'],
  note: ['id', 'label', 'template_id', 'w_id', 'lines', 'schools', 'due_on', 'status'],
  phonics: ['status', 'read', 'needed', 'kappa_passed', 'card', 'reading_hours'],
  empty: ['status', 'message', 'detail'],
  detail: ['graded', 'widened_to_weeks', 'as_of'],
  homeMethod: ['hysteresis_applied', 'query_id'],
  stale: ['as_of', 'reason'],
  w: ['card', 'split', 'good_looks_like', 'schools', 'schools_not_showing', 'moment', 'step_card', 'excluded', 'method', 'windows', 'computed_at'],
  wSchool: ['school', 'count', 'last_visit', 'next_visit', 'state', 'codes'],
  codeRow: ['code', 'graded', 'strip'],
  stripItem: ['session_id', 'shows'],
  moment: ['moment_id', 'session', 'code', 'school', 'w', 'kind', 'steps', 'lesson_s', 'confidence', 'clip', 'gloss', 'gloss_status', 'question', 'pair', 'full_recording'],
  session: ['session_id', 'grade', 'subject', 'recorded_on', 'duration_s'],
  mstep: ['phase', 'label', 'verdict', 'from_s', 'to_s'],
  clip: ['from_s', 'to_s', 'duration_s', 'status'],
  stepCard: ['i_id', 'title', 'teacher_step', 'check_line', 'check_by', 'code', 'visit'],
  excluded: ['mismatch', 'unusable', 'duplicates', 'failed'],
  wMethod: ['query_id', 'grader', 'framework', 'window', 'coverage', 'caveats', 'current_school_rule'],
  schools: ['window', 'schools', 'windows', 'computed_at'],
  schoolRow: ['school', 'top_w', 'last_visit', 'next_visit', 'graded'],
  i: ['w', 'i', 'alternatives', 'check_by_default', 'fln', 'windows', 'computed_at'],
  iBody: ['i_id', 'title', 'teacher_action_step', 'with_whom', 'duration', 'materials', 'rehearsal_script', 'debrief_script', 'listen_for', 'check_it_worked', 'evidence', 'library_version'],
  material: ['kind', 'ref', 'title'],
  evidence: ['source', 'claim'],
  alt: ['i_id', 'title'],
  checkByDefault: ['date', 'rule', 'visit'],
};
const keysOf = (o) => Object.keys(o).sort();
const expectKeys = (o, want) => expect(keysOf(o)).toEqual([...want].sort());
const isText = (t) => t && typeof t.en === 'string' && typeof t.ur === 'string' && keysOf(t).join() === 'en,ur';
const isCount = (c) => c && Number.isInteger(c.n) && Number.isInteger(c.d) && typeof c.window_id === 'string' && keysOf(c).join() === 'd,n,window_id';
const isCode = (c) => c && /^T-\d{2,3}$/.test(c.code) && /^[0-9a-f-]{36}$/.test(c.code_id) && keysOf(c).join() === 'code,code_id';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkWindow(w) { expectKeys(w, K.window); }
function checkWCard(c) {
  expectKeys(c, K.wcard);
  expect(isText(c.short_name) && isText(c.number_line) && isText(c.sentence)).toBe(true);
  expect(isCount(c.count) && isCount(c.teachers)).toBe(true);
  expect(Number.isInteger(c.teacher_count)).toBe(true);
  checkWindow(c.window);
  if (c.cause) {
    expectKeys(c.cause, K.cause);
    expect(isText(c.cause.text)).toBe(true);
    if (c.cause.also) { expectKeys(c.cause.also, K.also); expect(isCount(c.cause.also.count)).toBe(true); }
  }
  if (c.where_first) {
    expectKeys(c.where_first, K.cardWhere);
    expect(isCount(c.where_first.count)).toBe(true);
    expect(Array.isArray(c.where_first.then) && c.where_first.then.length <= 2).toBe(true);
  }
}
function checkWRow(r) {
  expectKeys(r, K.wrow);
  expect(isText(r.short_name) && isText(r.sentence)).toBe(true);
  checkWindow(r.window);
  if (r.count !== null) expect(isCount(r.count)).toBe(true);
  if (r.where_first) { expectKeys(r.where_first, K.rowWhere); expect(isCount(r.where_first.count)).toBe(true); }
  if (r.not_yet) expectKeys(r.not_yet, K.notYet);
}
function checkMoment(m, nested = false) {
  expectKeys(m, K.moment);
  expectKeys(m.session, K.session);
  expect(isCode(m.code)).toBe(true);
  expectKeys(m.clip, K.clip);
  for (const s of m.steps) { expectKeys(s, K.mstep); expect(isText(s.label)).toBe(true); }
  expect(isText(m.question)).toBe(true);
  if (nested) expect(m.pair).toBeNull();
}

/** G10: every Count / Stat resolves to a Window in the same body's windows[]; n ≤ d; every nested Window is listed. */
function everyCountResolves(body) {
  const ids = new Map((body.windows || []).map((w) => [w.id, w]));
  const bad = [];
  const walk = (o, at) => {
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (!o || typeof o !== 'object') return;
    if ('window_id' in o) {
      if (!ids.has(o.window_id)) bad.push(`${at}: window ${o.window_id} not in windows[]`);
      if ('n' in o && 'd' in o && !(o.n <= o.d)) bad.push(`${at}: n ${o.n} > d ${o.d}`);
    }
    if ('grader_label' in o && 'framework' in o && 'id' in o && at !== '' && !at.startsWith('.windows')) {
      if (!ids.has(o.id)) bad.push(`${at}: Window ${o.id} not in windows[]`);
      else expect(o).toEqual(ids.get(o.id));
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`);
  };
  walk(body, '');
  expect(bad).toEqual([]);
}

let teacherIds = [];
let teacherKeys = [];
/** B1, B4, B21: no teacher users.id, no 16-hex key, no URL, no R2 key in a payload. */
function noIdentity(body) {
  const s = JSON.stringify(body);
  for (const id of teacherIds) expect(s).not.toContain(id);
  for (const k of teacherKeys) expect(s).not.toContain(k);
  expect(s).not.toMatch(/"[0-9a-f]{16}"/);
  for (const bad of ['http', 'X-Amz-', 'r2.cloudflarestorage', 'coachip/clips', 'teacher_key', '"name"', 'phone']) expect(s).not.toContain(bad);
}

run('coachip coach read routes R2 R3 R4 R9 (Postgres, HTTP)', () => {
  let pg; let srv; let codes;
  const ON = new Set([C3, CB, C9]);

  beforeAll(async () => {
    pg = await startPg();
    await I.seedLibrary(pg.query);
    codes = createCoachipCodes({ query: pg.query, secret: seed.SECRET });
    const scope = createCoachipScope({ query: pg.query, codes, now: () => NOW });
    const app = express();
    app.use((req, _res, next) => { req.session = { portalUserId: req.headers['x-uid'] || undefined }; next(); });
    app.use('/api/portal', createCoachipRouter({
      query: pg.query,
      pool: pg.pool,
      flags: { coachOn: async (uid) => ON.has(uid), rmSector: async () => null, decodeOn: async () => false },
      scope,
      codes,
      now: () => NOW,
    }));
    srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  }, 180000);
  afterAll(async () => {
    if (srv) await new Promise((r) => srv.close(r));
    if (pg) await pg.close();
  });

  const get = (uid, path) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: `/api/portal/coachip${path}`, method: 'GET', headers: uid ? { 'x-uid': uid } : {} }, (res) => {
      let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => {
        let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = raw; }
        resolve({ status: res.statusCode, headers: res.headers, raw, body });
      });
    });
    r.on('error', reject);
    r.end();
  });
  /** A 200 that passes the identity grep and the G10 check. */
  async function ok(uid, path) {
    const r = await get(uid, path);
    if (r.status !== 200) throw new Error(`${path} → ${r.status} ${r.raw}`);
    expect(r.headers['cache-control']).toBe('private, no-store');
    noIdentity(r.body);
    everyCountResolves(r.body);
    return r.body;
  }

  // ── the world ───────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * opts.mode: 'ok' (one ok run on 2026-10-26, rollups w4-2026-09-28) | 'stale' (rollups of the 2026-10-24 ok run,
   * window w4-2026-09-21, then a failed run on 2026-10-26) | 'old_failed' (last ok run 2026-10-17, failed since) |
   * 'pending' (no run, no insight row at all). opts.insufficient: every coach rollup under the floor (max d 9).
   * opts.phonics: 'testing' | 'paused' | null.
   */
  async function world(opts = {}) {
    const { mode = 'ok', insufficient = false, phonics = 'testing', codeSeries = false } = opts;
    const q = pg.query;
    await seed.user(q, { id: C3, role: 'coach' });
    await seed.user(q, { id: CB, role: 'coach' });
    await seed.user(q, { id: C9, role: 'coach' });
    await seed.user(q, { id: RM, role: 'coach' });
    await seed.user(q, { id: TEACHER_ROLE_USER, role: 'teacher' });
    for (const n of [1, 2, 3, 4, 5, 6, 52]) await seed.school(q, { id: SCH(n), n });
    for (const n of [1, 2, 3, 4, 5, 6]) await seed.holds(q, { coachId: C3, schoolId: SCH(n) });
    await seed.holds(q, { coachId: CB, schoolId: SCH(52) });
    // teachers: t1 t2 t3 at S-03, t4 t5 at S-05, t6 S-06, t7 S-02, t8 S-01, t9 S-04, t10 S-52 (coach B)
    const at = { 1: 3, 2: 3, 3: 3, 4: 5, 5: 5, 6: 6, 7: 2, 8: 1, 9: 4, 10: 52 };
    teacherIds = []; teacherKeys = [];
    for (const [t, s] of Object.entries(at)) {
      await seed.user(q, { id: T(t), schoolId: SCH(s) });
      teacherIds.push(T(t)); teacherKeys.push(codes.teacherKey(T(t)));
    }
    const key = (t) => codes.teacherKey(T(t));

    // visits (observation_schedules): C-03's booked and completed; one cancelled; coach B's own (never C-03's)
    await I.visit(q, { id: VIS(3), coachId: C3, schoolId: SCH(3), date: '2026-10-28' });
    await I.visit(q, { id: VIS(5), coachId: C3, schoolId: SCH(5), date: '2026-11-03' });
    await I.visit(q, { id: VIS(2), coachId: C3, schoolId: SCH(2), date: '2026-11-05' });
    await I.visit(q, { id: VIS(1), coachId: C3, schoolId: SCH(1), date: '2026-11-09' });
    await I.visit(q, { id: VIS(4), coachId: C3, schoolId: SCH(4), date: '2026-11-12' });
    await I.visit(q, { coachId: C3, schoolId: SCH(6), date: '2026-10-30', status: 'cancelled' });
    for (const [s, d] of [[6, '2026-09-14'], [5, '2026-09-30'], [2, '2026-10-07'], [3, '2026-10-14'], [1, '2026-10-20']]) {
      await I.visit(q, { coachId: C3, schoolId: SCH(s), date: d, status: 'done' });
    }
    await I.visit(q, { coachId: CB, schoolId: SCH(4), date: '2026-10-23', status: 'done' });   // coach B's, not C-03's
    await I.visit(q, { coachId: CB, schoolId: SCH(3), date: '2026-10-27' });                  // coach B's booking
    await I.visit(q, { id: VIS(52), coachId: CB, schoolId: SCH(52), date: '2026-11-02' });

    // sessions (coaching_sessions; the FK parents) — n → teacher
    let sn = 0;
    const sess = async (t) => { sn += 1; await I.session(q, { id: SESS(sn), teacherId: T(t) }); return SESS(sn); };

    // the RM's note to C-03 (sent) and a newer dismissed one (never shown)
    await q(`INSERT INTO coachip_rm_notes (id, rm_user_id, coach_user_id, sector, w_id, template_id, body_en, body_ur, due_on, status, created_at)
             VALUES ($1, $2, $3, 'Urban-I', 'W-IP-TIME', 'RM-T1', E'line one\\nline two\\nline three', E'سطر ۱\\nسطر ۲\\nسطر ۳', '2026-10-30', 'sent', '2026-10-20T05:00:00Z'),
                    ($4, $2, $3, 'Urban-I', 'W-IP-TIME', 'RM-T2', E'a\\nb\\nc', E'ا\\nب\\nج', '2026-10-30', 'dismissed', '2026-10-22T05:00:00Z')`,
    [fid('note', 1), RM, C3, fid('note', 2)]);
    await q('INSERT INTO coachip_rm_note_schools (rm_note_id, school_id, position) VALUES ($1, $2, 1), ($3, $2, 1)', [fid('note', 1), SCH(3), fid('note', 2)]);

    // T-01 (t1) has an open W-IP-TIME step from the S-03 visit on 2026-10-14, checked at the 2026-10-28 visit
    const t1Code = await codes.codeFor(C3, key(1));
    await q(`INSERT INTO coachip_steps (id, coach_user_id, scope, code_id, school_id, w_id, i_id, set_at, check_by, check_by_rule, visit_schedule_id)
             VALUES ($1, $2, 'coach', $3, $4, 'W-IP-TIME', 'I-IP-1', '2026-10-14T05:00:00Z', '2026-10-28', 'visit', $5)`,
    [fid('step', 7), C3, t1Code.code_id, SCH(3), VIS(3)]);

    if (phonics) await I.phonics(q, phonics === 'paused' ? { state: 'paused', read: 30, kappa: 0.85 } : { state: 'testing', read: 12 });
    if (mode === 'pending') return;

    const okDate = { ok: '2026-10-26', stale: '2026-10-24', old_failed: '2026-10-17' }[mode];
    const from = { ok: '2026-09-28', stale: '2026-09-21', old_failed: '2026-09-14' }[mode];
    const computedAt = { ok: '2026-10-25T21:40:00Z', stale: '2026-10-23T21:40:00Z', old_failed: '2026-10-16T21:40:00Z' }[mode];
    const run = await I.jobRun(q, { date: okDate });
    if (mode !== 'ok') await I.jobRun(q, { date: '2026-10-26', status: 'failed' });

    // facts + signals (W-IP-TIME hit pattern per teacher; W-EXIT-TIME and W-WARM hits on some)
    const facts = {};
    const lesson = async (t, date, { linked = true, hit = null, exitTime = false, warm = false, subject = 'Urdu' } = {}) => {
      const s = await sess(t);
      const f = await I.fact(q, { sessionId: s, teacherKey: key(t), schoolId: SCH(at[t]), date, jobRunId: run, linked, subject, computedAt });
      if (linked) {
        await I.signal(q, { factId: f, sessionId: s, wId: 'W-IP-TIME', hit: hit === true });
        await I.signal(q, { factId: f, sessionId: s, wId: 'W-EXIT-TIME', hit: exitTime });
        await I.signal(q, { factId: f, sessionId: s, wId: 'W-WARM', hit: warm });
      }
      facts[s] = f;
      return { s, f };
    };
    const L = {};
    L.t1a = await lesson(1, '2026-10-01', { hit: false });
    L.t1b = await lesson(1, '2026-10-05', { hit: true, warm: true });
    L.t1c = await lesson(1, '2026-10-08', { hit: false });
    L.t1d = await lesson(1, '2026-10-13', { hit: true, exitTime: true });
    L.t1e = await lesson(1, '2026-10-20', { linked: false });
    L.t2a = await lesson(2, '2026-10-02', { hit: true, exitTime: true });
    L.t2b = await lesson(2, '2026-10-06', { hit: false });
    L.t2c = await lesson(2, '2026-10-09', { hit: false });
    L.t3a = await lesson(3, '2026-10-03', { hit: false });
    L.t3b = await lesson(3, '2026-10-10', { linked: false });
    L.t4a = await lesson(4, '2026-10-01', { hit: true, warm: true });
    L.t4b = await lesson(4, '2026-10-07', { hit: false });
    L.t4c = await lesson(4, '2026-10-14', { hit: false });
    L.t4d = await lesson(4, '2026-10-21', { hit: true });
    L.t5a = await lesson(5, '2026-10-02', { hit: false });
    L.t6a = await lesson(6, '2026-10-04', { hit: true });
    L.t6b = await lesson(6, '2026-10-11', { hit: false });
    L.t7a = await lesson(7, '2026-10-06', { hit: false });
    L.t8a = await lesson(8, '2026-10-06', { linked: false });
    for (const d of ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']) L[`t9${d}`] = await lesson(9, d, { hit: false });
    L.t1old = await lesson(1, '2026-09-10', { hit: true, exitTime: true });   // before any window: never counted
    L.t10a = await lesson(10, '2026-10-05', { hit: true });                 // coach B's teacher

    // moments: M1 the high-confidence missing moment (t1, S-03), M2 a medium one (t2), M3 the pair (t4, S-05, good),
    // M4 a good one by t1 (same teacher: never the pair), M5 coach B's good one (out of scope), M6 coach B's missing one
    await I.sessionSteps(q, L.t1d.f, [['warm', 'executed', 0, 150], ['explain', 'executed', 150, 900], ['guided', 'partial', 900, 1122], ['ip', 'not_done', 1122, 1500], ['exit', 'not_done', 1500, 1660]]);
    await I.moment(q, { id: MOM(1), factId: L.t1d.f, sessionId: L.t1d.s, wId: 'W-IP-TIME', from: 1122, to: 1160, gloss: { en: 'The explanation is still going.', ur: 'وضاحت ابھی جاری ہے۔' }, jobRunId: run });
    await I.moment(q, { id: MOM(2), factId: L.t2a.f, sessionId: L.t2a.s, wId: 'W-IP-TIME', confidence: 'medium', from: 1250, to: 1286, clip: 'failed' });
    await I.moment(q, { id: MOM(3), factId: L.t4d.f, sessionId: L.t4d.s, wId: 'W-IP-TIME', kind: 'good', from: 905, to: 946, credit: 0.9 });
    await I.moment(q, { id: MOM(4), factId: L.t1b.f, sessionId: L.t1b.s, wId: 'W-IP-TIME', kind: 'good', from: 800, to: 840, credit: 1.0 });
    await I.moment(q, { id: MOM(5), factId: L.t10a.f, sessionId: L.t10a.s, wId: 'W-IP-TIME', kind: 'good', from: 700, to: 740, credit: 1.0 });
    await I.moment(q, { id: MOM(6), factId: L.t10a.f, sessionId: L.t10a.s, wId: 'W-IP-TIME', kind: 'missing', from: 600, to: 640 });

    // T-01's step strip: a hit and a partial in later recordings
    const c1 = await sess(1); const c2 = await sess(1);
    await q(`INSERT INTO coachip_step_checks (step_id, session_id, seq, hit, recorded_at, job_run_id) VALUES
             ($1, $2, 1, 'hit', '2026-10-16T04:00:00Z', $4), ($1, $3, 2, 'partial', '2026-10-23T04:00:00Z', $4)`, [fid('step', 7), c1, c2, run]);

    // coach rollups: C-03 (23 recordings, 20 linked, 20 in the W-IP family's denominator)
    const base = { coachId: C3, jobRunId: run, from, computedAt, recordings: 23, linked: 20, excluded: [1, 0, 0, 0] };
    if (insufficient) {
      await I.rollup(q, { ...base, wId: 'W-IP-TIME', n: 3, d: 9, status: 'insufficient', teacherCount: 4 });
      await I.rollup(q, { ...base, wId: 'W-EXIT-NOPLAN', n: 1, d: 7, status: 'insufficient', teacherCount: 3 });
    } else {
      await I.rollup(q, { ...base, wId: 'W-IP-TIME', n: 6, d: 20, rank: 1, teacherCount: 9, stat: { kind: 'median', unit: 'min', value: 6.0, base: 6 } });
      await I.rollup(q, { ...base, wId: 'W-EXIT-NOPLAN', n: 3, d: 20, rank: 2, teacherCount: 9 });
      await I.rollup(q, { ...base, wId: 'W-IP-NOPLAN', n: 2, d: 20, teacherCount: 9 });
      await I.rollup(q, { ...base, wId: 'W-IP', n: 8, d: 20, teacherCount: 9 });
      await I.rollup(q, { ...base, wId: 'W-WARM', n: 2, d: 12, status: 'insufficient', teacherCount: 5 });
    }
    // the nightly's computed series (FICO_CROSSWALK §2, source `code`): W-IP-HOME is stored with framework_version 'code'
    if (codeSeries) {
      await I.rollup(q, { ...base, wId: 'W-IP-HOME', n: 2, d: 20, teacherCount: 9, framework: 'code' });
      await I.rollup(q, { schoolId: SCH(3), wId: 'W-IP-HOME', n: 1, d: 8, jobRunId: run, from, computedAt, framework: 'code' });
    }
    // school rollups (rank 1 = the school's top W)
    const sch = (s, wId, n, d, rank = null) => I.rollup(q, { schoolId: SCH(s), wId, n, d, rank, jobRunId: run, from, computedAt });
    await sch(3, 'W-IP-TIME', 3, 8, 1);
    await sch(5, 'W-IP-TIME', 2, 5);
    await sch(6, 'W-IP-TIME', 1, 2, 1);
    await sch(2, 'W-IP-TIME', 0, 1);
    await sch(4, 'W-IP-TIME', 0, 4);
    await sch(5, 'W-EXIT-NOPLAN', 2, 4, 1);
    await sch(3, 'W-EXIT-NOPLAN', 1, 8);
    await sch(2, 'W-IP-NOPLAN', 1, 1, 1);
    await sch(3, 'W-IP-NOPLAN', 1, 8);
    // coach B's own (never C-03's)
    await I.rollup(q, { coachId: CB, jobRunId: run, from, computedAt, wId: 'W-IP-TIME', n: 15, d: 30, rank: 1, teacherCount: 1, recordings: 31, linked: 30 });
    await I.rollup(q, { schoolId: SCH(52), wId: 'W-IP-TIME', n: 1, d: 1, rank: 1, jobRunId: run, from, computedAt });
  }

  beforeEach(async () => { await pg.truncate(); });

  // ── R4 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R4 GET /coachip/schools', () => {
    test('six schools, last visit oldest first (never visited first) then name; top W, visits, graded of recordings', async () => {
      await world();
      const b = await ok(C3, '/schools');
      expectKeys(b, K.schools);
      checkWindow(b.window);
      expect(b.window.id).toBe('w4-2026-09-28');
      expect(b.window).toMatchObject({ from: '2026-09-28', to: '2026-10-25', weeks: 4, grader: I.GRADER, framework: 'lp_fidelity', scoring_changed_on: '2026-09-28' });
      for (const s of b.schools) {
        expectKeys(s, K.schoolRow);
        expect(isCount(s.graded)).toBe(true);
        if (s.top_w) checkWRow(s.top_w);
      }
      expect(b.schools.map((s) => s.school.school_id)).toEqual([SCH(4), SCH(6), SCH(5), SCH(2), SCH(3), SCH(1)]);
      const by = Object.fromEntries(b.schools.map((s) => [s.school.school_id, s]));
      expect(by[SCH(4)].last_visit).toBeNull();                  // coach B's visit there is not C-03's
      expect(by[SCH(4)].top_w).toBeNull();
      expect(by[SCH(4)].graded).toEqual({ n: 4, d: 4, window_id: 'w4-2026-09-28' });
      expect(by[SCH(3)]).toMatchObject({
        school: { school_id: SCH(3), school_name: 'Govt. Primary School Fictional-03' },
        last_visit: '2026-10-14',
        next_visit: { date: '2026-10-28', schedule_id: VIS(3) },  // not coach B's 2026-10-27 booking
        graded: { n: 8, d: 10, window_id: 'w4-2026-09-28' },
      });
      expect(by[SCH(3)].top_w).toMatchObject({ w_id: 'W-IP-TIME', state: 'also_seen', count: { n: 3, d: 8 }, where_first: null, not_yet: null, sector: null });
      expect(by[SCH(5)].top_w).toMatchObject({ w_id: 'W-EXIT-NOPLAN', count: { n: 2, d: 4 } });
      expect(by[SCH(6)]).toMatchObject({ last_visit: '2026-09-14', next_visit: null });   // the cancelled booking is no visit
      expect(by[SCH(1)].graded).toEqual({ n: 0, d: 1, window_id: 'w4-2026-09-28' });
      expect(b.windows.map((w) => w.id)).toEqual(['w4-2026-09-28']);
      expect(new Date(b.computed_at).toISOString()).toBe('2026-10-25T21:40:00.000Z');
    });

    test('no scope → 404; a teacher session → 404; signed out → 401', async () => {
      await world();
      expect((await get(C9, '/schools')).raw).toBe('{"error":"not_found"}');
      expect((await get(TEACHER_ROLE_USER, '/schools')).status).toBe(404);
      expect((await get(null, '/schools')).status).toBe(401);
    });
  });

  // ── R2 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R2 GET /coachip/home', () => {
    test('the normal state: card, row, note, steps, coverage, not yet, phonics, every key of the fixture', async () => {
      await world();
      const b = await ok(C3, '/home');
      expectKeys(b, K.home);
      checkWindow(b.window);
      expect(b.window.id).toBe('w4-2026-09-28');
      expect(b.moves).toHaveLength(2);
      const [card, row] = b.moves;
      checkWCard(card);
      checkWRow(row);
      expect(card).toMatchObject({
        w_id: 'W-IP-TIME', parent_w_id: 'W-IP', rank: 1, status: 'ok',
        number_line: { en: '6 of 20', ur: '۲۰ میں سے ۶' },
        count: { n: 6, d: 20, window_id: 'w4-2026-09-28' },
        teacher_count: 9,
        teachers: { n: 4, d: 9, window_id: 'w4-2026-09-28' },    // t1, t2, t4, t6 hit in the window (t10 is coach B's)
        moment_id: MOM(1), moment_duration_s: 38, i_id: 'I-IP-TIME-1',
      });
      expect(card.short_name).toEqual({ en: 'Ran out of time', ur: 'وقت ختم ہو گیا' });
      expect(card.cause.stat).toEqual({ kind: 'median', value: 6, unit: 'min', base: 6, window_id: 'w4-2026-09-28' });
      expect(card.cause.text.en).toBe('In the lessons that ran out of time, the explanation ran a median of about 6 minutes over the plan.');
      expect(card.cause.text.ur).toContain('۶');
      expect(card.cause.also.count).toEqual({ n: 2, d: 6, window_id: 'w4-2026-09-28' });   // t1 10-13 and t2 10-02 (t1's 09-10 is outside)
      expect(card.cause.also.text.en).toBe('2 of these also ended before the closing check.');
      expect(card.where_first).toEqual({
        school: { school_id: SCH(3), school_name: 'Govt. Primary School Fictional-03' },
        count: { n: 3, d: 8, window_id: 'w4-2026-09-28' },
        visit: { date: '2026-10-28', schedule_id: VIS(3) },
        then: [{ school_id: SCH(5), school_name: 'Govt. Primary School Fictional-05' }, { school_id: SCH(6), school_name: 'Govt. Primary School Fictional-06' }],
      });
      expect(row).toMatchObject({ w_id: 'W-EXIT-NOPLAN', state: 'ranked', count: { n: 3, d: 20 }, not_yet: null, sector: null });
      expect(row.where_first).toEqual({ school: { school_id: SCH(5), school_name: 'Govt. Primary School Fictional-05' }, count: { n: 2, d: 4, window_id: 'w4-2026-09-28' } });

      expectKeys(b.note, K.note);
      expect(b.note).toMatchObject({ id: fid('note', 1), status: 'sent', template_id: 'RM-T1', due_on: '2026-10-30' });
      expect(b.steps).toHaveLength(1);
      expectKeys(b.steps[0], K.step);
      expect(isCode(b.steps[0].code)).toBe(true);
      expect(b.steps[0]).toMatchObject({ id: fid('step', 7), check_by: '2026-10-28', check_rule: 'visit', chip: 'to_come', to_come: 1 });
      expect(b.coverage).toEqual({ recordings: { n: 20, d: 23, window_id: 'w4-2026-09-28' } });
      expect(b.not_yet).toHaveLength(1);
      checkWRow(b.not_yet[0]);
      expect(b.not_yet[0]).toMatchObject({ w_id: 'W-WARM', state: 'not_yet', count: null, where_first: null,
        not_yet: { graded: { n: 12, d: 20, window_id: 'w4-2026-09-28' }, codes_seen: 2, codes_needed: 3, coaches_with_5plus: null } });
      expectKeys(b.phonics, K.phonics);
      expect(b.phonics).toEqual({ status: 'testing', read: 12, needed: 30, kappa_passed: false, card: null, reading_hours: null });
      expect(b.stale).toBeNull();
      expect(b.empty).toBeNull();
      expectKeys(b.method, K.homeMethod);
      expect(b.method).toEqual({ hysteresis_applied: false, query_id: 'q-coachip-home-v1' });
      expect(b.windows.map((w) => w.id)).toEqual(['w4-2026-09-28']);
      expect(new Date(b.computed_at).toISOString()).toBe('2026-10-25T21:40:00.000Z');
    });

    test("a `code` series row (W-IP-HOME, framework_version 'code') is windowed as lp_fidelity, never a 500", async () => {
      await world({ codeSeries: true });
      const b = await ok(C3, '/home');
      expect(b.window.id).toBe('w4-2026-09-28');
      expect(b.moves.map((m) => m.w_id)).toEqual(['W-IP-TIME', 'W-EXIT-NOPLAN']);
      for (const w of b.windows) expect(w).toMatchObject({ framework: 'lp_fidelity', scoring_changed_on: '2026-09-28' });
      expect(b.windows.map((w) => w.id)).toEqual(['w4-2026-09-28']);
      const w = await ok(C3, '/w/W-IP-HOME');
      checkWindow(w.card.window);
      expect(w.card.window).toMatchObject({ id: 'w4-2026-09-28', framework: 'lp_fidelity', grader: 'google/gemini-3.8-flash' });
      expect(w.card.count).toEqual({ n: 2, d: 20, window_id: 'w4-2026-09-28' });
      await ok(C3, '/schools');
      await ok(C3, '/i/W-IP-HOME');
      // the reads that pick their series by family (stats, moments, results) never meet a 'code' row as a grader
      for (const p of ['/stats', '/moments', '/results']) {
        const r = await ok(C3, p);   // eslint-disable-line no-await-in-loop
        for (const win of r.windows) expect(win.framework).not.toBe('code');
      }
    });

    test('coach B sees only coach B: its own card and moment, never C-03 numbers', async () => {
      await world();
      const b = await ok(CB, '/home');
      expect(b.moves[0]).toMatchObject({ w_id: 'W-IP-TIME', count: { n: 15, d: 30 }, moment_id: MOM(6) });
      expect(b.moves[0].where_first.school.school_id).toBe(SCH(52));
      expect(b.note).toBeNull();
      expect(b.steps).toEqual([]);
      expect(JSON.stringify(b)).not.toContain(SCH(3));
    });

    test('no scope: 200 with empty.no_scope, no moves, no steps, the current 4-week window', async () => {
      await world();
      const b = await ok(C9, '/home');
      expectKeys(b, K.home);
      expect(b.moves).toEqual([]);
      expect(b.steps).toEqual([]);
      expect(b.not_yet).toEqual([]);
      expect(b.note).toBeNull();
      expectKeys(b.empty, K.empty);
      expectKeys(b.empty.detail, K.detail);
      expect(b.empty).toEqual({
        status: 'no_scope',
        message: { en: 'No schools are assigned to you yet. Ask your RM.', ur: 'ابھی آپ کو کوئی اسکول تفویض نہیں ہوا۔ اپنے آر ایم سے بات کریں۔' },
        detail: { graded: null, widened_to_weeks: null, as_of: null },
      });
      expect(b.window).toMatchObject({ id: 'w4-2026-09-28', from: '2026-09-28', to: '2026-10-25' });
      expect(b.coverage).toEqual({ recordings: { n: 0, d: 0, window_id: 'w4-2026-09-28' } });
      expect(b.phonics.status).toBe('testing');
    });

    test('pending: the first night has not run; steps still show', async () => {
      await world({ mode: 'pending' });
      const b = await ok(C3, '/home');
      expect(b.moves).toEqual([]);
      expect(b.empty.status).toBe('pending');
      expect(b.empty.message.en).toBe("Being prepared: your first week's moves appear after tonight's run.");
      expect(b.steps).toHaveLength(1);
      expect(b.stale).toBeNull();
    });

    test('stale: last night failed, the 2026-10-24 rollups are shown with their own window and computed_at', async () => {
      await world({ mode: 'stale' });
      const b = await ok(C3, '/home');
      expect(b.stale).toEqual({ as_of: '2026-10-24', reason: 'failed' });
      expect(b.empty).toBeNull();
      expect(b.window).toMatchObject({ id: 'w4-2026-09-21', from: '2026-09-21', to: '2026-10-18' });
      expect(b.moves[0].count.window_id).toBe('w4-2026-09-21');
      expect(new Date(b.computed_at).toISOString()).toBe('2026-10-23T21:40:00.000Z');
      expect(b.steps).toHaveLength(1);
    });

    test('failed: no ok run for more than 7 days → empty.failed, no moves, steps still show', async () => {
      await world({ mode: 'old_failed' });
      const b = await ok(C3, '/home');
      expect(b.moves).toEqual([]);
      expect(b.stale).toBeNull();
      expect(b.empty.status).toBe('failed');
      expect(b.empty.detail.as_of).toBe('2026-10-17');
      expect(b.empty.message.en).toBe('The analysis has not run for 7 days. Your open steps still show. Ask your RM.');
      expect(b.steps).toHaveLength(1);
    });

    test('insufficient: nothing clears 20 in 4 weeks and 8 would cross the scoring change → 4-week window, not widened', async () => {
      await world({ insufficient: true });
      const b = await ok(C3, '/home');
      expect(b.moves).toEqual([]);
      expect(b.window.id).toBe('w4-2026-09-28');
      expect(b.empty).toEqual({
        status: 'insufficient',
        message: {
          en: 'Not enough recordings yet: 9 graded lessons in the last 4 weeks, 20 needed. Your open steps still show.',
          ur: 'ابھی کافی ریکارڈنگز نہیں: پچھلے ۴ ہفتوں میں ۹ جانچے گئے اسباق، ۲۰ درکار۔ آپ کے جاری قدم دکھائی دے رہے ہیں۔',
        },
        detail: { graded: { n: 9, d: 20, window_id: 'w4-2026-09-28' }, widened_to_weeks: null, as_of: null },
      });
      expect(b.steps).toHaveLength(1);
      expect(b.not_yet.map((r) => r.w_id)).toEqual(['W-IP-TIME', 'W-EXIT-NOPLAN']);
    });

    test('phonics paused: the global gate row, kappa passed, 30 of 30', async () => {
      await world({ phonics: 'paused' });
      const b = await ok(C3, '/home');
      expect(b.phonics).toEqual({ status: 'paused', read: 30, needed: 30, kappa_passed: true, card: null, reading_hours: null });
    });
  });

  // ── R3 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R3 GET /coachip/w/:wId', () => {
    test('W-IP-TIME: card, split, schools in next-visit order, codes, strips, the moment and its pair, the step card', async () => {
      await world();
      const home = await ok(C3, '/home');
      const b = await ok(C3, '/w/W-IP-TIME');
      expectKeys(b, K.w);
      checkWCard(b.card);
      expect(b.card).toEqual(home.moves[0]);
      expect(b.split.map((r) => [r.w_id, r.state, r.count.n, r.count.d])).toEqual([['W-IP-TIME', 'also_seen', 6, 20], ['W-IP-NOPLAN', 'also_seen', 2, 20]]);
      b.split.forEach(checkWRow);
      expect(isText(b.good_looks_like)).toBe(true);
      expect(b.good_looks_like.en).toMatch(/^The teacher reads the plan's task aloud/);

      // shows (S-03, S-05) and too_few (S-06) are listed in next-visit order, no visit last; the rest only counted
      expect(b.schools.map((s) => [s.school.school_id, s.state])).toEqual([[SCH(3), 'shows'], [SCH(5), 'shows'], [SCH(6), 'too_few']]);
      b.schools.forEach((s) => expectKeys(s, K.wSchool));
      const [s3, s5, s6] = b.schools;
      expect(s3).toMatchObject({ count: { n: 3, d: 8 }, last_visit: '2026-10-14', next_visit: { date: '2026-10-28', schedule_id: VIS(3) } });
      expect(s6).toMatchObject({ next_visit: null, last_visit: '2026-09-14', codes: [] });
      expect(b.schools_not_showing).toEqual({ n: 3, d: 6, window_id: 'w4-2026-09-28' });   // S-02, S-04 do not show; S-01 no graded
      for (const c of [...s3.codes, ...s5.codes]) { expectKeys(c, K.codeRow); expect(isCode(c.code)).toBe(true); expect(isCount(c.graded)).toBe(true); }
      expect(s3.codes.map((c) => [c.graded.n, c.graded.d])).toEqual([[4, 5], [3, 3], [1, 2]]);
      expect(s3.codes[0].code.code).toBe('T-01');                            // t1, coded first by the step
      expect(s3.codes[0].strip.map((x) => x.shows)).toEqual([false, true, false, true]);
      s3.codes[0].strip.forEach((x) => expectKeys(x, K.stripItem));
      expect(s3.codes[1].strip).toBeNull();
      expect(s5.codes.map((c) => [c.graded.n, c.strip && c.strip.map((x) => x.shows)])).toEqual([[4, [true, false, false, true]], [1, null]]);
      const allCodes = [...s3.codes, ...s5.codes].map((c) => c.code.code);
      expect(new Set(allCodes).size).toBe(allCodes.length);

      checkMoment(b.moment);
      expect(b.moment).toMatchObject({
        moment_id: MOM(1), kind: 'missing', confidence: 'high', lesson_s: 1122,
        clip: { from_s: 1122, to_s: 1160, duration_s: 38, status: 'ready' },
        school: { school_id: SCH(3) }, w: { w_id: 'W-IP-TIME' },
        gloss: { en: 'The explanation is still going.', ur: 'وضاحت ابھی جاری ہے۔' }, gloss_status: 'ok',
        session: { session_id: expect.any(String), grade: 3, subject: 'Urdu', recorded_on: '2026-10-13', duration_s: 1500 },
        full_recording: { duration_s: 1500 },
      });
      expect(b.moment.code.code).toBe('T-01');
      expect(b.moment.steps.map((s) => [s.phase, s.label.en, s.verdict])).toEqual([
        ['warm', 'Warm-up', 'executed'], ['explain', 'Explain', 'executed'], ['guided', 'Guided', 'partial'], ['ip', 'Practice', 'not_done'], ['exit', 'Exit', 'not_done']]);
      checkMoment(b.moment.pair, true);
      expect(b.moment.pair).toMatchObject({ moment_id: MOM(3), kind: 'good', school: { school_id: SCH(5) } });   // not t1's own, not coach B's

      expectKeys(b.step_card, K.stepCard);
      expect(b.step_card).toMatchObject({ i_id: 'I-IP-TIME-1', check_by: { date: '2026-11-09', rule: '14_days' }, visit: null });
      expect(b.step_card.check_line.en).toBe('Check by {date} · your tick, then 2 of 3 recordings');
      expect(isCode(b.step_card.code)).toBe(true);
      expect(b.step_card.code).toEqual(s3.codes[1].code);                    // t2: S-03's next teacher with a hit and no open step
      expect(isText(b.step_card.title) && isText(b.step_card.teacher_step)).toBe(true);

      expectKeys(b.excluded, K.excluded);
      expect(b.excluded).toEqual({ mismatch: 1, unusable: 0, duplicates: 0, failed: 0 });
      expectKeys(b.method, K.wMethod);
      expect(b.method).toMatchObject({ query_id: 'q-coachip-w-ip-time-v1', grader: I.GRADER, framework: 'lp_fidelity', coverage: { n: 20, d: 23 } });
      expect(b.method.current_school_rule).toEqual({ en: "Every recording counts at the teacher's current school.", ur: 'ہر ریکارڈنگ استاد کے موجودہ اسکول میں گنی جاتی ہے۔' });
      expect(Array.isArray(b.method.caveats)).toBe(true);
      expect(new Date(b.computed_at).toISOString()).toBe('2026-10-25T21:40:00.000Z');
    });

    test('a sub-row of an S1 W answers (insufficient card, moment null); S7-only and unknown Ws are 404; bad grammar 400', async () => {
      await world();
      const b = await ok(C3, '/w/W-IP-HOME');
      expect(b.card).toMatchObject({ w_id: 'W-IP-HOME', status: 'insufficient', moment_id: null });
      expect(b.moment).toBeNull();
      expect((await get(C3, '/w/W-LS')).raw).toBe('{"error":"not_found"}');
      expect((await get(C3, '/w/W-NOPE-X')).raw).toBe('{"error":"not_found"}');
      expect((await get(C3, '/w/nope')).raw).toBe('{"error":"bad_request"}');
      expect((await get(C9, '/w/W-IP-TIME')).raw).toBe('{"error":"not_found"}');
    });
  });

  // ── R9 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe('R9 GET /coachip/i/:wId', () => {
    test('W-IP-TIME: the card, the library entry as Text pairs (no url), alternatives parent first, check_by for where_first', async () => {
      await world();
      const home = await ok(C3, '/home');
      const b = await ok(C3, '/i/W-IP-TIME');
      expectKeys(b, K.i);
      expect(b.w).toEqual(home.moves[0]);
      expectKeys(b.i, K.iBody);
      expect(b.i.i_id).toBe('I-IP-TIME-1');
      for (const f of ['title', 'teacher_action_step', 'with_whom', 'duration', 'rehearsal_script', 'debrief_script', 'listen_for', 'check_it_worked']) expect(isText(b.i[f])).toBe(true);
      expect(b.i.title.en).toBe('Hard cap: explanation ends at minute 10 (rehearse the stop line)');
      expect(b.i.teacher_action_step.en).toBe("Write 10 in the board corner; stop explaining at minute 10 and move to 'we do'");
      expect(b.i.library_version).toBe('1.0');
      expect(b.i.materials.length).toBeGreaterThan(0);
      for (const m of b.i.materials) {
        expectKeys(m, K.material);
        expect(['vidrec', 'fln', 'print', 'other', 'none']).toContain(m.kind);
        expect(isText(m.title)).toBe(true);
      }
      expect(b.i.materials.map((m) => m.kind)).toEqual(['print', 'other', 'vidrec']);
      expect(b.i.evidence.length).toBeGreaterThan(0);
      for (const e of b.i.evidence) { expectKeys(e, K.evidence); expect(typeof e.source).toBe('string'); expect(isText(e.claim)).toBe(true); }
      expect(b.alternatives.map((a) => a.i_id)).toEqual(['I-IP-1', 'I-IP-TIME-2']);
      b.alternatives.forEach((a) => { expectKeys(a, K.alt); expect(isText(a.title)).toBe(true); });
      expectKeys(b.check_by_default, K.checkByDefault);
      expect(b.check_by_default).toEqual({ date: '2026-11-09', rule: '14_days', visit: null });   // S-03's visit is 2 days away
      expect(b.fln).toBeNull();
      expect(new Date(b.computed_at).toISOString()).toBe('2026-10-25T21:40:00.000Z');
    });

    test('?school= a held school with a visit ≥ 7 days away → the visit rule', async () => {
      await world();
      const b = await ok(C3, `/i/W-IP-TIME?school=${SCH(5)}`);
      expect(b.check_by_default).toEqual({ date: '2026-11-03', rule: 'visit', visit: { date: '2026-11-03', schedule_id: VIS(5) } });
    });

    test("coach B's school in ?school → 404, byte-identical to an invented uuid's; a bad uuid → 400", async () => {
      await world();
      const other = await get(C3, `/i/W-IP-TIME?school=${SCH(52)}`);
      const invented = await get(C3, `/i/W-IP-TIME?school=${INVENTED}`);
      expect(other.status).toBe(404);
      expect(other.raw).toBe(invented.raw);
      expect(other.raw).toBe('{"error":"not_found"}');
      expect((await get(C3, '/i/W-IP-TIME?school=nope')).raw).toBe('{"error":"bad_request"}');
      expect((await get(C3, '/i/W-LS')).raw).toBe('{"error":"not_found"}');
    });
  });
});
