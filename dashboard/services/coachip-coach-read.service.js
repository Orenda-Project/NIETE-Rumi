'use strict';
/**
 * bd-sex15q.13 — the coach's read routes (contracts/API.md v1.4 §7): R2 GET /coachip/home (S1), R3 GET /coachip/w/:wId
 * (S2 + S3 with G1's inline moment and step card), R4 GET /coachip/schools (Schools tab), R9 GET /coachip/i/:wId (S5).
 * Each handler is `async (ctx) => ({ status, body })` (the router factory, portal-coachip.routes.js, does the guards,
 * the grammar and the coach scope; a handler without ctx.coach only exists for R2's no_scope state).
 *
 * What it reads (API.md §1, §12): the c-insights tables (coachip_rollups, coachip_weaknesses, coachip_session_facts,
 * coachip_session_signals, coachip_moments via coachip-moment.js, coachip_steps / coachip_step_checks / coachip_rm_notes
 * via coachip-rules, coachip_phonics_state, coachip_job_runs), the library JSON, and live schools /
 * observation_schedules for names and visits. Never coaching_sessions.analysis_data; never a teacher's users.id or name:
 * teachers exist here only as the scope's HMAC keys (server side) and leave as Code {code_id, code} (B21).
 *
 * Rules kept here, each from the contract:
 * - The ranking is stored (rank, is_hysteresis_applied); nothing re-ranks (§8.3).
 * - The rollups shown are the coach's newest window from an ok/partial run; freshness from coachip_job_runs (R2 States).
 * - Every number is a Count/Stat whose window_id is in the body's windows[] (§1, G10); computed_at is the OLDEST
 *   computed_at of the stored rows used (rollups, and the facts behind an inline moment), else the clock.
 * - Lists of schools are never ordered by a count (R3, R4, B9 add).
 * - Scope before content: R9's ?school is checked against the coach's schools before anything is read (§4, B3).
 */
const S = require('./coachip-shapes');
const R = require('./coachip-rules.service');
const { buildMomentsWithMeta } = require('./coachip-moment');

const COACH_FLOOR = 20;
const CODES_NEEDED = 3;
const FRESH_DAYS = 7;

/**
 * Where each graded series starts (FICO_CROSSWALK §1; NIGHTLY_JOB §5 B19) → Window.scoring_changed_on. No table stores
 * it (contract gap, see the result file): keyed by framework, or framework|grader where the grader decides the series.
 */
const SERIES_START = {
  'lp_fidelity|google/gemini-3.8-flash': '2026-09-28',
  fico_v3: '2026-09-14',
  egra: '2026-10-26',
};
function seriesStart(framework, grader) {
  return SERIES_START[`${framework}|${grader}`] || SERIES_START[framework] || null;
}

// ── COPY (contracts/COPY.md v1), the server-composed lines this file needs; copy.json carries only §W/§RM-T ──────
const COPY = {
  empty: {
    pending: S.text("Being prepared: your first week's moves appear after tonight's run.", 'تیاری جاری ہے: آپ کے پہلے ہفتے کے قدم آج رات کے تجزیے کے بعد آئیں گے۔'),
    failed: S.text('The analysis has not run for 7 days. Your open steps still show. Ask your RM.', 'تجزیہ سات دن سے نہیں چلا۔ آپ کے جاری قدم دکھائی دے رہے ہیں۔ اپنے آر ایم سے بات کریں۔'),
    no_scope: S.text('No schools are assigned to you yet. Ask your RM.', 'ابھی آپ کو کوئی اسکول تفویض نہیں ہوا۔ اپنے آر ایم سے بات کریں۔'),
  },
  // s1.empty.insufficient8 with its "8" as {weeks} (FIXTURES §7 item 4: COPY has no "not widened" key yet)
  insufficient: (graded, weeks) => S.text(
    `Not enough recordings yet: ${graded} graded lessons in the last ${weeks} weeks, ${COACH_FLOOR} needed. Your open steps still show.`,
    `ابھی کافی ریکارڈنگز نہیں: پچھلے ${S.urDigits(weeks)} ہفتوں میں ${S.urDigits(graded)} جانچے گئے اسباق، ${S.urDigits(COACH_FLOOR)} درکار۔ آپ کے جاری قدم دکھائی دے رہے ہیں۔`,
  ),
  checkLine: { // s2.step.check_line / .no_visit (the client fills {date})
    visit: S.text('Visit {date} · your tick, then 2 of 3 recordings', 'دورہ {date}، آپ کا نشان، پھر ۳ میں سے ۲ ریکارڈنگز'),
    '14_days': S.text('Check by {date} · your tick, then 2 of 3 recordings', 'جانچ {date} تک، آپ کا نشان، پھر ۳ میں سے ۲ ریکارڈنگز'),
  },
  currentSchool: S.text("Every recording counts at the teacher's current school.", 'ہر ریکارڈنگ استاد کے موجودہ اسکول میں گنی جاتی ہے۔'),
};

// ── small pure helpers ──────────────────────────────────────────────────────────────────────────────────────────
const frameworkOf = (fv) => String(fv).split(':')[0];
const KARACHI_DAY = "((f.recorded_at AT TIME ZONE 'Asia/Karachi')::date)";
const oldest = (dates) => dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b)[0] || null;
const fmtStat = (v) => { const r = Math.round(Number(v) * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
const ordinalOf = (code) => Number(String(code).replace(/^T-/, ''));

function libOrder() {
  const lib = S.library();
  return new Map(lib.raw.weaknesses.map((w, i) => [w.id, i]));
}

/** The Window of a stored rollup row. */
function rowWindow(r) {
  const framework = frameworkOf(r.framework_version);
  return S.gradedWindow({
    framework, weeks: r.window_weeks, from: r.window_start, to: r.window_end, grader: r.grader_model,
    scoringChangedOn: seriesStart(framework, r.grader_model),
  });
}

/** Text of a W from COPY §W, else the catalogue row's short name (the sentence then empty). */
function wText(wId, meta) {
  const c = S.wCopy(wId);
  if (c) return c;
  const m = meta && meta.get(wId);
  return { short_name: m ? S.text(m.short_name_en, m.short_name_ur) : S.text(wId, wId), sentence: S.text('', '') };
}

/** The first teacher-level I: the W's own, else its parent's (LIBRARY_RULES §2.1). */
function firstTeacherI(wId) {
  const lib = S.library();
  let w = lib.weakness(wId);
  let id = wId;
  while (id) {
    const i = lib.forW(id).find((x) => x.level === 'teacher');
    if (i) return i;
    id = w && w.parent_w_id ? w.parent_w_id : null;
    w = id ? lib.weakness(id) : null;
  }
  return null;
}

// ── reads ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function weaknessMeta(q) {
  const { rows } = await q('SELECT w_id, parent_w_id, is_s1_eligible, is_cause_line, short_name_en, short_name_ur FROM coachip_weaknesses');
  return new Map(rows.map((r) => [r.w_id, r]));
}

/** R3/R9's set: S1-eligible, or the direct sub-row of an S1-eligible W (API.md R3 Scope). */
function inRouteSet(meta, wId) {
  const m = meta.get(wId);
  if (!m) return false;
  if (m.is_s1_eligible) return true;
  const p = m.parent_w_id ? meta.get(m.parent_w_id) : null;
  return !!(p && p.is_s1_eligible);
}

/** coachip_job_runs, newest first → { latest, okRun } (each {run_date, status} | null). */
async function jobState(q) {
  const { rows } = await q(
    `SELECT run_date::text AS run_date, status::text AS status FROM coachip_job_runs
      ORDER BY run_date DESC, attempt DESC, started_at DESC LIMIT 60`,
  );
  return { latest: rows[0] || null, okRun: rows.find((r) => r.status === 'ok' || r.status === 'partial') || null };
}

const ROLLUP_COLS = `r.id, r.w_id, r.school_id, r.window_start::text AS window_start, r.window_end::text AS window_end,
  r.window_weeks, r.numerator, r.denominator, r.teacher_count, r.excluded_mismatch, r.excluded_unusable,
  r.excluded_duplicate, r.excluded_failed, r.recordings, r.recordings_linked, r.stat_kind::text AS stat_kind,
  r.stat_unit::text AS stat_unit, r.stat_value, r.stat_base, r.rank, r.is_hysteresis_applied, r.grader_model,
  r.framework_version, r.pipeline_version, r.status::text AS status, r.computed_at`;

/**
 * The coach's rollups as shown: from ok/partial runs only, the newest window_end, one row per W (newest computed_at,
 * a ranked row first). An 8-week row that starts before its series start is dropped (B19: a widening never crosses a
 * scoring change). → { rows: Map(wId → row), windowEnd } | { rows: empty Map, windowEnd: null }
 */
async function coachSet(q, coachUserId) {
  const { rows } = await q(
    `SELECT ${ROLLUP_COLS}
       FROM coachip_rollups r JOIN coachip_job_runs j ON j.id = r.job_run_id
      WHERE r.scope_kind = 'coach' AND r.coach_user_id = $1 AND j.status IN ('ok', 'partial')
        AND r.window_end = (SELECT MAX(r2.window_end) FROM coachip_rollups r2 JOIN coachip_job_runs j2 ON j2.id = r2.job_run_id
                             WHERE r2.scope_kind = 'coach' AND r2.coach_user_id = $1 AND j2.status IN ('ok', 'partial'))
      ORDER BY r.w_id, (r.rank IS NOT NULL) DESC, r.computed_at DESC, r.window_weeks ASC`,
    [coachUserId],
  );
  const out = new Map();
  for (const r of rows) {
    if (out.has(r.w_id)) continue;
    const start = seriesStart(frameworkOf(r.framework_version), r.grader_model);
    if (r.window_weeks === 8 && start && r.window_start < start) continue;
    out.set(r.w_id, r);
  }
  return { rows: out, windowEnd: rows.length ? rows[0].window_end : null };
}

/** School-scope rollups for one W in the reference row's window and versions, for the given schools. → Map(schoolId → row) */
async function schoolRowsFor(q, schoolIds, wId, ref) {
  const out = new Map();
  if (!ref || !schoolIds.length) return out;
  const { rows } = await q(
    `SELECT ${ROLLUP_COLS}
       FROM coachip_rollups r JOIN coachip_job_runs j ON j.id = r.job_run_id
      WHERE r.scope_kind = 'school' AND r.school_id = ANY($1::uuid[]) AND r.w_id = $2 AND j.status IN ('ok', 'partial')
        AND r.window_start = $3::date AND r.window_end = $4::date AND r.grader_model = $5 AND r.framework_version = $6
        AND r.pipeline_version = $7
      ORDER BY r.school_id, r.computed_at DESC`,
    [schoolIds, wId, ref.window_start, ref.window_end, ref.grader_model, ref.framework_version, ref.pipeline_version],
  );
  for (const r of rows) if (!out.has(r.school_id)) out.set(r.school_id, r);
  return out;
}

async function schoolNames(q, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await q(`SELECT id, name FROM schools WHERE id = ANY($1::uuid[])`, [ids]);
  for (const r of rows) out.set(r.id, r.name);
  return out;
}
const schoolOf = (id, names) => ({ school_id: id, school_name: names.get(id) || '' });

/** The current 4-week lp_fidelity window when no rollup decides it (no scope, nothing computed yet). */
async function defaultWindow(q, todayIso) {
  const { from, to } = S.currentGradedRange(todayIso, 4);
  const { rows } = await q(
    `SELECT grader_model FROM coachip_rollups WHERE framework_version LIKE 'lp_fidelity%' ORDER BY computed_at DESC LIMIT 1`,
  );
  const grader = rows[0] ? rows[0].grader_model : null;
  return S.gradedWindow({ framework: 'lp_fidelity', weeks: 4, from, to, grader, scoringChangedOn: seriesStart('lp_fidelity', grader) });
}

/** Distinct teachers (in scope, in the row's window and versions) with ≥ 1 hit, per W. → Map(wId → n) */
async function teachersHit(q, scope, ref, wIds) {
  const out = new Map();
  if (!ref || !scope.teacherKeys.length || !wIds.length) return out;
  const { rows } = await q(
    `SELECT sg.w_id, COUNT(DISTINCT f.teacher_key)::int AS n
       FROM coachip_session_facts f JOIN coachip_session_signals sg ON sg.fact_id = f.id
      WHERE f.teacher_key = ANY($1::text[]) AND ${KARACHI_DAY} BETWEEN $2::date AND $3::date
        AND f.grader_model = $4 AND f.framework_version = $5 AND f.pipeline_version = $6
        AND sg.is_hit AND sg.w_id = ANY($7::text[])
      GROUP BY sg.w_id`,
    [scope.teacherKeys, ref.window_start, ref.window_end, ref.grader_model, ref.framework_version, ref.pipeline_version, wIds],
  );
  for (const r of rows) out.set(r.w_id, r.n);
  return out;
}

/** W-IP-TIME's cause.also: lessons in the card's n that also hit W-EXIT-TIME (same scope, window, versions). */
async function alsoExitTime(q, scope, ref) {
  if (!scope.teacherKeys.length) return null;
  const { rows } = await q(
    `SELECT COUNT(DISTINCT f.id)::int AS n
       FROM coachip_session_facts f
       JOIN coachip_session_signals t ON t.fact_id = f.id AND t.w_id = 'W-IP-TIME' AND t.is_hit
       JOIN coachip_session_signals e ON e.fact_id = f.id AND e.w_id = 'W-EXIT-TIME' AND e.is_hit
      WHERE f.teacher_key = ANY($1::text[]) AND ${KARACHI_DAY} BETWEEN $2::date AND $3::date
        AND f.grader_model = $4 AND f.framework_version = $5 AND f.pipeline_version = $6`,
    [scope.teacherKeys, ref.window_start, ref.window_end, ref.grader_model, ref.framework_version, ref.pipeline_version],
  );
  return rows[0] ? rows[0].n : 0;
}

/** The W's highest-confidence `missing` moment in scope and window. → {id, duration_s} | null */
async function topMoment(q, scope, wId, ref) {
  if (!scope.teacherKeys.length || !ref) return null;
  const { rows } = await q(
    `SELECT m.id, m.from_s, m.to_s, m.confidence::text AS confidence, f.audio_s
       FROM coachip_moments m JOIN coachip_session_facts f ON f.id = m.fact_id
      WHERE m.w_id = $1 AND m.kind = 'missing' AND f.teacher_key = ANY($2::text[])
        AND ${KARACHI_DAY} BETWEEN $3::date AND $4::date
      ORDER BY CASE m.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               (m.clip_status = 'ready') DESC, f.recorded_at DESC, m.id
      LIMIT 1`,
    [wId, scope.teacherKeys, ref.window_start, ref.window_end],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, duration_s: r.confidence === 'none' && r.audio_s != null ? r.audio_s : r.to_s - r.from_s };
}

/**
 * Per-teacher recordings in a window over the scope's teachers (any version: a recording is a session), each lesson's
 * linked flag, and — when `ref` and `wId` are given — the W's signal on the ref's versions. Teachers are placed at
 * their CURRENT school (scope.teacherSchool, E7). → Map(key → { school, first, sessions: Map(sid → {recorded_at,
 * linked, inDen, hit}) })
 */
async function lessonsByTeacher(q, scope, from, to, wId = null, ref = null) {
  const out = new Map();
  if (!scope.teacherKeys.length) return out;
  const { rows } = await q(
    `SELECT f.teacher_key, f.session_id, f.recorded_at, f.is_lp_linked,
            sg.is_in_denominator, sg.is_hit
       FROM coachip_session_facts f
       LEFT JOIN coachip_session_signals sg ON sg.fact_id = f.id AND sg.w_id = $4
            AND f.grader_model = $5 AND f.framework_version = $6 AND f.pipeline_version = $7
      WHERE f.teacher_key = ANY($1::text[]) AND ${KARACHI_DAY} BETWEEN $2::date AND $3::date
      ORDER BY f.recorded_at ASC, f.session_id`,
    [scope.teacherKeys, from, to, wId, ref ? ref.grader_model : null, ref ? ref.framework_version : null, ref ? ref.pipeline_version : null],
  );
  for (const r of rows) {
    if (!out.has(r.teacher_key)) {
      out.set(r.teacher_key, { school: scope.teacherSchool.get(r.teacher_key), first: new Date(r.recorded_at), sessions: new Map() });
    }
    const t = out.get(r.teacher_key);
    const prev = t.sessions.get(r.session_id) || { recorded_at: r.recorded_at, linked: false, inDen: false, hit: false };
    prev.linked = prev.linked || r.is_lp_linked;
    if (r.is_in_denominator) { prev.inDen = true; prev.hit = prev.hit || r.is_hit; }
    t.sessions.set(r.session_id, prev);
  }
  return out;
}
function tally(lessons) {
  let rec = 0; let graded = 0;
  for (const s of lessons.sessions.values()) { rec += 1; if (s.linked) graded += 1; }
  return { rec, graded };
}

// ── shapes ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** where_first for a W: the school with the highest n (ties by name), then ≤ 2 more; schools with n = 0 never lead. */
function rankSchools(schoolRows, names) {
  return [...schoolRows.values()]
    .filter((r) => r.numerator > 0)
    .sort((a, b) => (b.numerator - a.numerator) || (names.get(a.school_id) || '').localeCompare(names.get(b.school_id) || ''));
}

/**
 * One WCard (API.md §3) for wId from its stored row (or none: an insufficient card on `fallbackWindow`).
 * → { card, used: [rows whose computed_at counts], windows: [Window] }
 */
async function buildCard(ctx, wId, row, fallbackWindow, meta) {
  const q = ctx.deps.query;
  const scope = ctx.coach;
  const parent = meta.get(wId) ? meta.get(wId).parent_w_id : null;
  const words = wText(wId, meta);
  const i = firstTeacherI(wId);
  if (!row) {
    return {
      card: {
        w_id: wId, parent_w_id: parent || null, rank: null, short_name: words.short_name, number_line: S.numberLine(0, 0),
        sentence: words.sentence, cause: null, count: S.count(0, 0, fallbackWindow.id), teacher_count: 0,
        teachers: S.count(0, 0, fallbackWindow.id), window: fallbackWindow, status: 'insufficient', where_first: null,
        moment_id: null, moment_duration_s: null, i_id: i ? i.id : null,
      },
      used: [],
      windows: [fallbackWindow],
    };
  }
  const win = rowWindow(row);
  const used = [row];
  const schoolRows = await schoolRowsFor(q, scope.schoolIds, wId, row);
  used.push(...schoolRows.values());
  const names = await schoolNames(q, [...schoolRows.keys()]);
  const ranked = rankSchools(schoolRows, names);
  let whereFirst = null;
  if (ranked.length) {
    const top = ranked[0];
    const visits = await R.nextVisits(q, ctx.uid, [top.school_id], ctx.today);
    whereFirst = {
      school: schoolOf(top.school_id, names),
      count: S.count(top.numerator, top.denominator, win.id),
      visit: visits.get(top.school_id) || null,
      then: ranked.slice(1, 3).map((r) => schoolOf(r.school_id, names)),
    };
  }
  const hits = await teachersHit(q, scope, row, [wId]);
  let cause = null;
  if (wId === 'W-IP-TIME' && row.stat_kind) {
    const copy = S.loadCopy();
    const v = fmtStat(row.stat_value);
    const also = await alsoExitTime(q, scope, row);
    cause = {
      text: S.text(copy.w_ip_time_cause.en.replace('{stat}', v), copy.w_ip_time_cause.ur.replace('{stat}', S.urDigits(v))),
      stat: S.stat(row.stat_kind, row.stat_value, row.stat_unit, row.stat_base, win.id),
      also: also === null ? null : {
        text: S.text(copy.w_exit_time_cause.sentence.en.replace('{n}', also), copy.w_exit_time_cause.sentence.ur.replace('{n}', S.urDigits(also))),
        count: S.count(also, row.numerator, win.id),
      },
    };
  }
  const status = row.status === 'ok' ? 'ok' : row.status === 'insufficient' ? 'insufficient' : 'failed';
  const moment = status === 'ok' ? await topMoment(q, scope, wId, row) : null;
  return {
    card: {
      w_id: wId,
      parent_w_id: parent || null,
      rank: row.rank === 1 || row.rank === 2 ? row.rank : null,
      short_name: words.short_name,
      number_line: S.numberLine(row.numerator, row.denominator),
      sentence: words.sentence,
      cause,
      count: S.count(row.numerator, row.denominator, win.id),
      teacher_count: row.teacher_count,
      teachers: S.count(hits.get(wId) || 0, row.teacher_count, win.id),
      window: win,
      status,
      where_first: whereFirst,
      moment_id: moment ? moment.id : null,
      moment_duration_s: moment ? moment.duration_s : null,
      i_id: i ? i.id : null,
    },
    used,
    windows: [win],
  };
}

/** A WRow (API.md §3) from a stored row. state 'ranked' | 'also_seen' | 'not_yet'. → { row, used } */
async function buildRow(ctx, wId, row, state, meta, extra = {}) {
  const q = ctx.deps.query;
  const win = rowWindow(row);
  const words = wText(wId, meta);
  let whereFirst = null;
  const used = [row];
  if (state !== 'not_yet') {
    const schoolRows = await schoolRowsFor(q, ctx.coach.schoolIds, wId, row);
    used.push(...schoolRows.values());
    const names = await schoolNames(q, [...schoolRows.keys()]);
    const top = rankSchools(schoolRows, names)[0];
    if (top) whereFirst = { school: schoolOf(top.school_id, names), count: S.count(top.numerator, top.denominator, win.id) };
  }
  let notYet = null;
  if (state === 'not_yet') {
    notYet = {
      graded: row.denominator >= COACH_FLOOR ? null : S.count(row.denominator, COACH_FLOOR, win.id),
      codes_seen: extra.codesSeen || 0,
      codes_needed: CODES_NEEDED,
      coaches_with_5plus: null,
    };
  }
  return {
    row: {
      w_id: wId, short_name: words.short_name, sentence: words.sentence,
      count: state === 'not_yet' ? null : S.count(row.numerator, row.denominator, win.id),
      window: win, state, where_first: whereFirst, not_yet: notYet, sector: null,
    },
    used,
  };
}

function finish(body, used, now) {
  const at = oldest(used.map((r) => r && r.computed_at));
  return { ...body, computed_at: S.isoTime(at || now) };
}

// ── R2 GET /coachip/home ───────────────────────────────────────────────────────────────────────────────────────────
async function phonicsBlock(ctx, set, meta) {
  const q = ctx.deps.query;
  const { rows } = await q(
    `SELECT state::text AS state, read_count, is_kappa_passed FROM coachip_phonics_state ORDER BY created_at DESC, id LIMIT 1`,
  );
  const p = rows[0];
  const block = {
    status: p ? p.state : 'testing', read: p ? p.read_count : 0, needed: 30, kappa_passed: p ? p.is_kappa_passed : false,
    card: null, reading_hours: null,
  };
  const out = { block, used: [], windows: [] };
  if (block.status === 'ok' && set && ctx.coach) {
    const row = set.rows.get('W-PHON');
    if (row) {
      const built = await buildCard(ctx, 'W-PHON', row, null, meta);
      if (row.status === 'ok') block.card = built.card;
      const win = rowWindow(row);
      block.reading_hours = S.count(row.denominator, row.recordings, win.id);
      out.used.push(...built.used);
      out.windows.push(win, ...built.windows);
    }
  }
  return out;
}

async function home(ctx) {
  const q = ctx.deps.query;
  const meta = await weaknessMeta(q);
  const method = { hysteresis_applied: false, query_id: 'q-coachip-home-v1' };
  const emptyBody = async (status, message, detail, extra = {}) => {
    const window = extra.window || await defaultWindow(q, ctx.today);
    const ph = await phonicsBlock(ctx, null, meta);
    return {
      window, moves: [], note: extra.note || null, steps: extra.steps || [],
      coverage: { recordings: S.count(0, 0, window.id) }, not_yet: [], phonics: ph.block, stale: null,
      empty: { status, message, detail: { graded: null, widened_to_weeks: null, as_of: null, ...detail } },
      method, windows: S.windowsOf(window),
    };
  };

  if (!ctx.coach) return S.reply(200, finish(await emptyBody('no_scope', COPY.empty.no_scope, {}), [], ctx.now));

  const [steps, notes, jobs] = await Promise.all([
    R.loadSteps(q, { coachUserId: ctx.uid, openOnly: true, limit: 20 }, ctx.today),
    R.loadNotes(q, { coachUserId: ctx.uid, statuses: ['sent', 'seen'], limit: 1 }),
    jobState(q),
  ]);
  const live = { steps, note: notes[0] || null };

  // freshness (R2 States; INSIGHTS_SCHEMA §4; NIGHTLY_JOB §9)
  if (!jobs.okRun) {
    const status = jobs.latest && jobs.latest.status === 'failed' ? 'failed' : 'pending';
    return S.reply(200, finish(await emptyBody(status, COPY.empty[status], {}, live), [], ctx.now));
  }
  const age = S.daysBetween(jobs.okRun.run_date, ctx.today);
  if (age > FRESH_DAYS) {
    return S.reply(200, finish(await emptyBody('failed', COPY.empty.failed, { as_of: jobs.okRun.run_date }, live), [], ctx.now));
  }
  let stale = null;
  if (jobs.latest !== jobs.okRun && jobs.latest.run_date >= jobs.okRun.run_date && jobs.latest.status === 'failed') {
    stale = { as_of: jobs.okRun.run_date, reason: 'failed' };
  } else if (age > 1) {
    stale = { as_of: jobs.okRun.run_date, reason: 'pending' };
  }

  const set = await coachSet(q, ctx.uid);
  const order = libOrder();
  const eligible = [...set.rows.values()]
    .filter((r) => meta.get(r.w_id) && meta.get(r.w_id).is_s1_eligible)
    .sort((a, b) => (order.get(a.w_id) ?? 999) - (order.get(b.w_id) ?? 999));
  const rank1 = eligible.find((r) => r.rank === 1 && r.status === 'ok') || null;
  const rank2 = eligible.find((r) => r.rank === 2 && r.status === 'ok') || null;

  const used = [];
  const windows = [];
  const moves = [];
  let window;
  let empty = null;
  if (rank1) {
    const c = await buildCard(ctx, rank1.w_id, rank1, null, meta);
    moves.push(c.card); used.push(...c.used); windows.push(...c.windows);
    window = c.card.window;
    if (rank2) {
      const r2 = await buildRow(ctx, rank2.w_id, rank2, 'ranked', meta);
      moves.push(r2.row); used.push(...r2.used); windows.push(r2.row.window);
    }
  } else {
    const widest = eligible.slice().sort((a, b) => b.denominator - a.denominator)[0] || null;
    window = widest ? rowWindow(widest) : await defaultWindow(q, ctx.today);
    if (widest) used.push(widest);
    const graded = widest ? widest.denominator : 0;
    empty = {
      status: 'insufficient',
      message: COPY.insufficient(graded, window.weeks || 4),
      detail: { graded: S.count(graded, COACH_FLOOR, window.id), widened_to_weeks: window.weeks === 8 ? 8 : null, as_of: null },
    };
  }

  // not_yet: eligible, under the floor, not ranked, with lessons; catalogue order; ≤ 3
  const notYetRows = eligible.filter((r) => r.status === 'insufficient' && r.rank == null && r.denominator > 0).slice(0, 3);
  const notYet = [];
  for (const r of notYetRows) {
    const seen = await teachersHit(q, ctx.coach, r, [r.w_id]);   // eslint-disable-line no-await-in-loop
    const built = await buildRow(ctx, r.w_id, r, 'not_yet', meta, { codesSeen: seen.get(r.w_id) || 0 });   // eslint-disable-line no-await-in-loop
    notYet.push(built.row); used.push(...built.used); windows.push(built.row.window);
  }

  // coverage: the rows of the shown window
  const covRow = [...set.rows.values()].filter((r) => rowWindow(r).id === window.id).sort((a, b) => b.recordings - a.recordings)[0];
  const coverage = { recordings: covRow ? S.count(covRow.recordings_linked, covRow.recordings, window.id) : S.count(0, 0, window.id) };
  if (covRow) used.push(covRow);

  const ph = await phonicsBlock(ctx, set, meta);
  used.push(...ph.used); windows.push(...ph.windows);
  method.hysteresis_applied = !!(rank1 && rank1.is_hysteresis_applied);

  return S.reply(200, finish({
    window, moves, note: live.note, steps: live.steps, coverage, not_yet: notYet, phonics: ph.block, stale, empty, method,
    windows: S.windowsOf(window, windows),
  }, used, ctx.now));
}

// ── R4 GET /coachip/schools ────────────────────────────────────────────────────────────────────────────────────────
async function schools(ctx) {
  const q = ctx.deps.query;
  const meta = await weaknessMeta(q);
  const scope = ctx.coach;
  const set = await coachSet(q, ctx.uid);
  const ref = [...set.rows.values()].find((r) => r.rank === 1) || [...set.rows.values()][0] || null;
  const window = ref ? rowWindow(ref) : await defaultWindow(q, ctx.today);
  const used = ref ? [ref] : [];

  // top W per school: the school-scope rollup ranked 1 in the shown window (ok/partial runs)
  const { rows: tops } = await q(
    `SELECT ${ROLLUP_COLS}
       FROM coachip_rollups r JOIN coachip_job_runs j ON j.id = r.job_run_id
      WHERE r.scope_kind = 'school' AND r.school_id = ANY($1::uuid[]) AND r.rank = 1 AND r.window_end = $2::date
        AND j.status IN ('ok', 'partial')
      ORDER BY r.school_id, r.computed_at DESC`,
    [scope.schoolIds, window.to],
  );
  const topBy = new Map();
  for (const r of tops) if (!topBy.has(r.school_id)) topBy.set(r.school_id, r);

  const [names, last, next, lessons] = await Promise.all([
    schoolNames(q, scope.schoolIds),
    R.lastVisits(q, ctx.uid, scope.schoolIds),
    R.nextVisits(q, ctx.uid, scope.schoolIds, ctx.today),
    lessonsByTeacher(q, scope, window.from, window.to),
  ]);
  const graded = new Map(scope.schoolIds.map((id) => [id, { rec: 0, graded: 0 }]));
  for (const t of lessons.values()) {
    const g = graded.get(t.school);
    if (!g) continue;
    const x = tally(t);
    g.rec += x.rec; g.graded += x.graded;
  }
  const windows = [window];
  const list = [];
  for (const id of scope.schoolIds) {
    const top = topBy.get(id);
    let topW = null;
    if (top) {
      // the school's own row: its count, no where_first (it IS the school), state also_seen (FIXTURES `schools`)
      const tw = rowWindow(top);
      const words = wText(top.w_id, meta);
      topW = {
        w_id: top.w_id, short_name: words.short_name, sentence: words.sentence,
        count: S.count(top.numerator, top.denominator, tw.id), window: tw, state: 'also_seen',
        where_first: null, not_yet: null, sector: null,
      };
      used.push(top);
      windows.push(tw);
    }
    const g = graded.get(id);
    list.push({
      school: schoolOf(id, names), top_w: topW, last_visit: last.get(id) || null, next_visit: next.get(id) || null,
      graded: S.count(g.graded, g.rec, window.id),
    });
  }
  // last visit oldest first, never visited first, then name (never by a count)
  list.sort((a, b) => {
    if (a.last_visit !== b.last_visit) {
      if (a.last_visit === null) return -1;
      if (b.last_visit === null) return 1;
      return a.last_visit < b.last_visit ? -1 : 1;
    }
    return a.school.school_name.localeCompare(b.school.school_name);
  });
  return S.reply(200, finish({ window, schools: list, windows: S.windowsOf(window, windows) }, used, ctx.now));
}

// ── R3 GET /coachip/w/:wId ────────────────────────────────────────────────────────────────────────────────────────
function goodLooksLike(wId) {
  const lib = S.library();
  let w = lib.weakness(wId);
  while (w) {
    if (w.what_good_looks_like_en) return S.text(w.what_good_looks_like_en, w.what_good_looks_like_ur || '');
    w = w.parent_w_id ? lib.weakness(w.parent_w_id) : null;
  }
  return S.text('', '');
}

/** The open steps' teacher keys for this coach and W (a code that already has one is never the step card's). */
async function openStepKeys(q, coachUserId, wId) {
  const { rows } = await q(
    `SELECT tc.teacher_key FROM coachip_steps st JOIN coachip_teacher_codes tc ON tc.id = st.code_id
      WHERE st.coach_user_id = $1 AND st.w_id = $2 AND st.status = 'open' AND st.scope = 'coach'`,
    [coachUserId, wId],
  );
  return new Set(rows.map((r) => r.teacher_key));
}

async function weakness(ctx) {
  const q = ctx.deps.query;
  const { codes } = ctx.deps;
  const wId = ctx.params.wId;
  const meta = await weaknessMeta(q);
  if (!inRouteSet(meta, wId)) return S.NOT_FOUND();
  const scope = ctx.coach;
  const set = await coachSet(q, ctx.uid);
  const row = set.rows.get(wId) || null;
  const fallback = row ? null : await defaultWindow(q, ctx.today);
  const built = await buildCard(ctx, wId, row, fallback, meta);
  const card = built.card;
  const win = card.window;
  const used = [...built.used];
  const windows = [win];

  // split: the S1-eligible sub-rows of the card's parent (or of the card itself), on the parent's denominator
  const splitParent = card.parent_w_id || wId;
  const order = libOrder();
  const subIds = [...meta.values()]
    .filter((m) => m.parent_w_id === splitParent && m.is_s1_eligible)
    .map((m) => m.w_id)
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  const split = [];
  for (const id of subIds) {
    const r = set.rows.get(id);
    if (!r) continue;
    const b = await buildRow(ctx, id, r, 'also_seen', meta);   // eslint-disable-line no-await-in-loop
    split.push(b.row); used.push(...b.used); windows.push(b.row.window);
  }

  // schools: state per held school; shows / too_few listed, the rest only counted
  const schoolRows = await schoolRowsFor(q, scope.schoolIds, wId, row);
  const [names, last, next, lessons] = await Promise.all([
    schoolNames(q, scope.schoolIds),
    R.lastVisits(q, ctx.uid, scope.schoolIds),
    R.nextVisits(q, ctx.uid, scope.schoolIds, ctx.today),
    lessonsByTeacher(q, scope, win.from, win.to, wId, row),
  ]);
  const stateOf = (r) => {
    if (!r || r.denominator === 0) return 'no_graded';
    if (r.numerator === 0) return 'does_not_show';
    if (r.numerator < 2) return 'too_few';
    return 'shows';
  };
  let notShowing = 0;
  const listed = [];
  for (const id of scope.schoolIds) {
    const r = schoolRows.get(id);
    const state = stateOf(r);
    if (state === 'no_graded' || state === 'does_not_show') { notShowing += 1; continue; }
    used.push(r);
    listed.push({ id, r, state });
  }
  listed.sort((a, b) => {
    const va = next.get(a.id); const vb = next.get(b.id);
    if ((va && va.date) !== (vb && vb.date)) {
      if (!va) return 1;
      if (!vb) return -1;
      return va.date < vb.date ? -1 : 1;
    }
    return (names.get(a.id) || '').localeCompare(names.get(b.id) || '');
  });
  // the codes: teachers with a recording in the window at a 'shows' school, first appearance = earliest recording
  const teachersAt = (schoolId) => [...lessons.entries()]
    .filter(([, t]) => t.school === schoolId)
    .sort(([ka, a], [kb, b]) => (a.first - b.first) || (ka < kb ? -1 : 1))
    .map(([k]) => k);
  const keysInOrder = listed.filter((s) => s.state === 'shows').flatMap((s) => teachersAt(s.id));
  const codeMap = keysInOrder.length ? await codes.codesFor(ctx.uid, keysInOrder, q) : new Map();
  const schoolsOut = listed.map(({ id, r, state }) => {
    const codesOut = state !== 'shows' ? [] : teachersAt(id).map((k) => {
      const t = lessons.get(k);
      const x = tally(t);
      const den = [...t.sessions.entries()].filter(([, s]) => s.inDen);
      return {
        code: codeMap.get(k),
        graded: S.count(x.graded, x.rec, win.id),
        strip: x.graded >= 4 ? den.map(([sid, s]) => ({ session_id: sid, shows: s.hit === true })) : null,
      };
    }).sort((a, b) => ordinalOf(a.code.code) - ordinalOf(b.code.code));
    return {
      school: schoolOf(id, names), count: S.count(r.numerator, r.denominator, win.id), last_visit: last.get(id) || null,
      next_visit: next.get(id) || null, state, codes: codesOut,
    };
  });

  // G1: the card's moment with its pair
  let moment = null;
  if (card.status === 'ok' && card.moment_id) {
    const m = await buildMomentsWithMeta(q, codes, ctx.uid, [card.moment_id], { withPair: true, coachScope: scope, today: ctx.today });
    moment = m.moments[0] || null;
    if (m.computedAt) used.push({ computed_at: m.computedAt });
  }

  // the step card: the I for this W, for the where-first school's next teacher with a hit and no open step on it
  let stepCard = null;
  const i = firstTeacherI(wId);
  if (i) {
    const schoolId = card.where_first ? card.where_first.school.school_id : null;
    const checkBy = schoolId
      ? await R.checkByFor(q, ctx.uid, schoolId, ctx.today)
      : { date: S.addDays(ctx.today, 14), rule: '14_days', visit: null };
    let code = null;
    if (schoolId) {
      const busy = await openStepKeys(q, ctx.uid, wId);
      const cands = teachersAt(schoolId)
        .filter((k) => !busy.has(k))
        .map((k) => ({ k, hits: [...lessons.get(k).sessions.values()].filter((s) => s.inDen && s.hit).length }))
        .filter((c) => c.hits > 0);
      if (cands.length) {
        const m = await codes.codesFor(ctx.uid, cands.map((c) => c.k), q);
        cands.sort((a, b) => (b.hits - a.hits) || (ordinalOf(m.get(a.k).code) - ordinalOf(m.get(b.k).code)));
        code = m.get(cands[0].k);
      }
    }
    stepCard = {
      i_id: i.id,
      title: S.text(i.title_en, i.title_ur),
      teacher_step: S.text(i.teacher_action_step.step_en, i.teacher_action_step.step_ur),
      check_line: COPY.checkLine[checkBy.rule],
      check_by: { date: checkBy.date, rule: checkBy.rule },
      code,
      visit: checkBy.visit,
    };
  }

  const body = {
    card,
    split,
    good_looks_like: goodLooksLike(wId),
    schools: schoolsOut,
    schools_not_showing: S.count(notShowing, scope.schoolIds.length, win.id),
    moment,
    step_card: stepCard,
    excluded: row
      ? { mismatch: row.excluded_mismatch, unusable: row.excluded_unusable, duplicates: row.excluded_duplicate, failed: row.excluded_failed }
      : { mismatch: 0, unusable: 0, duplicates: 0, failed: 0 },
    method: {
      query_id: `q-coachip-w-${wId.slice(2).toLowerCase()}-v1`,
      grader: win.grader || '',
      framework: win.framework,
      window: win,
      coverage: row ? S.count(row.recordings_linked, row.recordings, win.id) : S.count(0, 0, win.id),
      caveats: [],
      current_school_rule: COPY.currentSchool,
    },
    windows: S.windowsOf(win, windows),
  };
  return S.reply(200, finish(body, used, ctx.now));
}

// ── R9 GET /coachip/i/:wId?school= ────────────────────────────────────────────────────────────────────────────────
/** The library entry as API.md R9's `i`, per INTERVENTIONS.json api_map (Text pairs; a url never leaves). */
function interventionShape(i, version) {
  const t = (en, ur) => S.text(en || '', ur || '');
  const cw = i.check_it_worked || {};
  return {
    i_id: i.id,
    title: t(i.title_en, i.title_ur),
    teacher_action_step: t(i.teacher_action_step && i.teacher_action_step.step_en, i.teacher_action_step && i.teacher_action_step.step_ur),
    with_whom: t(i.with_whom, i.with_whom_ur),
    duration: t(i.duration, i.duration_ur),
    materials: (i.materials || []).map((m) => ({
      kind: ['vidrec', 'fln', 'print', 'other', 'none'].includes(m.api_kind) ? m.api_kind : 'other',
      ref: m.ref == null ? null : String(m.ref),
      title: t(m.name, m.name_ur),
    })),
    rehearsal_script: t(i.rehearsal_script_en, i.rehearsal_script_ur),
    debrief_script: t(i.debrief_script_en, i.debrief_script_ur),
    listen_for: t(cw.look_for, cw.look_for_ur),
    check_it_worked: t(cw.coach_tick, cw.coach_tick_ur),
    evidence: (i.evidence || []).map((e) => ({ source: String(e.source || e.citation || ''), claim: t(e.finding, e.finding_ur) })),
    library_version: i.library_version || version,
  };
}

/** Alternatives (0..2): the parent's first teacher-level I first, then the W's own next ones, then the parent's. */
function alternativesFor(wId, chosenId) {
  const lib = S.library();
  const w = lib.weakness(wId);
  const own = lib.forW(wId).filter((x) => x.level === 'teacher');
  const parent = w && w.parent_w_id ? lib.forW(w.parent_w_id).filter((x) => x.level === 'teacher') : [];
  const seq = [...parent.slice(0, 1), ...own, ...parent.slice(1)];
  const out = [];
  for (const x of seq) {
    if (x.id === chosenId || out.some((o) => o.i_id === x.id)) continue;
    out.push({ i_id: x.id, title: S.text(x.title_en, x.title_ur) });
    if (out.length === 2) break;
  }
  return out;
}

async function intervention(ctx) {
  const q = ctx.deps.query;
  const wId = ctx.params.wId;
  const askedSchool = ctx.query && typeof ctx.query.school === 'string' ? ctx.query.school : null;
  // scope before content: a school not held by this coach is the one 404 (B3), before any read
  if (askedSchool && !ctx.coach.schoolIds.some((id) => id.toLowerCase() === askedSchool.toLowerCase())) return S.NOT_FOUND();
  const meta = await weaknessMeta(q);
  if (!inRouteSet(meta, wId)) return S.NOT_FOUND();
  const i = firstTeacherI(wId);
  if (!i) return S.NOT_FOUND();

  const set = await coachSet(q, ctx.uid);
  const row = set.rows.get(wId) || null;
  const fallback = row ? null : await defaultWindow(q, ctx.today);
  const built = await buildCard(ctx, wId, row, fallback, meta);
  const schoolId = askedSchool
    ? ctx.coach.schoolIds.find((id) => id.toLowerCase() === askedSchool.toLowerCase())
    : (built.card.where_first ? built.card.where_first.school.school_id : null);
  const checkBy = schoolId
    ? await R.checkByFor(q, ctx.uid, schoolId, ctx.today)
    : { date: S.addDays(ctx.today, 14), rule: '14_days', visit: null };

  const planIds = (i.materials || []).filter((m) => m.api_kind === 'fln' && m.ref != null).map((m) => String(m.ref));
  let fln = null;
  if (planIds.length) {
    const share = ctx.deps.flags && typeof ctx.deps.flags.flnShareOn === 'function'
      ? await ctx.deps.flags.flnShareOn(ctx.uid).catch(() => false)
      : false;
    fln = { can_send: share === true, plan_ids: planIds };
  }

  return S.reply(200, finish({
    w: built.card,
    i: interventionShape(i, S.library().version),
    alternatives: alternativesFor(wId, i.id),
    check_by_default: { date: checkBy.date, rule: checkBy.rule, visit: checkBy.visit },
    fln,
    windows: S.windowsOf(built.windows),
  }, built.used, ctx.now));
}

module.exports = {
  home, weakness, schools, intervention,
  // pure helpers, exported for tests
  firstTeacherI, alternativesFor, interventionShape, seriesStart, fmtStat, inRouteSet, rankSchools,
};
