'use strict';
/**
 * bd-sex15q.13 (worker w-listen) — the coach's Listen, player, Stats and Results reads (contracts/API.md §7 R5, R6,
 * R14, R15; §3 shapes; §12 field → table map). Each handler is async (ctx) => {status, body} for the COACHIP router.
 *
 * What they read, and only that (API.md §1): coachip_rollups (counts, windows, versions), coachip_session_facts (the
 * week's recordings, the failed sessions; teacher_key stays in SQL, never selected into a payload),
 * coachip_moments + coachip_session_steps through the shared Moment builder (dashboard/services/coachip-moment.js),
 * coachip_result_cells (S7), coachip_circle_items (the RM's circle form of R6), coachip_job_runs, schools, and the
 * library JSON. Nothing reads coaching_sessions.analysis_data.
 *
 * The window helpers here (latestWindowKey, scoringChangedOn, graderWindow, wText) are shared with the RM reads
 * (coachip-rm-read.service.js) so a coach's count and the RM's view of it are cut from the same rollup row.
 */
const S = require('./coachip-shapes');
const { buildMomentsWithMeta, chapterLabel, questionFor, wShape } = require('./coachip-moment');
const { sectorCoaches } = require('./coachip-sector-coaches');

const FLOOR_COACH = 20;
const FLOOR_SECTOR = 40;
const CHILD_FLOOR = 5;
const SAME_POINTS = 5;

const family = (frameworkVersion) => String(frameworkVersion || '').split(':')[0];

// ── windows (API.md §3 Window; §12 "Window.grader/framework ← rollups; scoring_changed_on from the version boundary") ──

/**
 * The newest stored rollup window for one scope: its dates and its version key (grader, framework, pipeline).
 * → { from, to, weeks, grader, frameworkVersion, pipeline, computedAt } | null. Windows ending after `endBy` (the
 * last full week) are not read: a rollup is a closed window.
 */
async function latestWindowKey(q, { scopeKind, scopeId, fam = 'lp_fidelity', weeks = 4, endBy, before = null }) {
  const params = [scopeKind, String(scopeId), fam, weeks, endBy];
  let extra = '';
  if (before) { params.push(before); extra = ` AND window_end < $${params.length}::date`; }
  const { rows } = await q(
    `SELECT window_start::text AS w_from, window_end::text AS w_to, window_weeks AS weeks, grader_model AS grader,
            framework_version AS framework_version, pipeline_version AS pipeline, MIN(computed_at) AS computed_at
       FROM coachip_rollups
      WHERE scope_kind = $1 AND scope_id = $2 AND split_part(framework_version, ':', 1) = $3 AND window_weeks = $4
        AND window_end <= $5::date${extra}
      GROUP BY window_start, window_end, window_weeks, grader_model, framework_version, pipeline_version
      ORDER BY window_end DESC, MAX(computed_at) DESC
      LIMIT 1`,
    params,
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { from: r.w_from, to: r.w_to, weeks: r.weeks, grader: r.grader, frameworkVersion: r.framework_version, pipeline: r.pipeline, computedAt: r.computed_at };
}

/**
 * The day a grader + framework version took over (B19): the first window start stored under this version, when an
 * EARLIER window of the same framework family exists under another version anywhere; else null (nothing changed).
 */
async function scoringChangedOn(q, key) {
  if (!key) return null;
  const { rows } = await q(
    `WITH v AS (SELECT MIN(window_start) AS first FROM coachip_rollups WHERE grader_model = $1 AND framework_version = $2)
     SELECT v.first::text AS first,
            EXISTS (SELECT 1 FROM coachip_rollups r, v
                     WHERE split_part(r.framework_version, ':', 1) = $3 AND (r.grader_model <> $1 OR r.framework_version <> $2)
                       AND r.window_start < v.first) AS changed
       FROM v`,
    [key.grader, key.frameworkVersion, family(key.frameworkVersion)],
  );
  return rows[0] && rows[0].changed ? rows[0].first : null;
}

/** The Window of a stored key (with its version boundary), or the empty current window when there is no key. */
async function graderWindow(q, key, todayIso, fam = 'lp_fidelity') {
  if (!key) {
    const { from, to } = S.currentGradedRange(todayIso, 4);
    return S.gradedWindow({ framework: fam, weeks: 4, from, to, grader: null });
  }
  return S.gradedWindow({
    framework: family(key.frameworkVersion), weeks: key.weeks, from: key.from, to: key.to, grader: key.grader,
    scoringChangedOn: await scoringChangedOn(q, key),
  });
}

/** Every rollup row of one scope under one key. */
async function rollupsAt(q, key, { scopeKind, scopeIds }) {
  if (!key || !scopeIds.length) return [];
  const { rows } = await q(
    `SELECT scope_kind::text AS scope_kind, coach_user_id, school_id, sector, w_id, numerator AS n, denominator AS d,
            teacher_count, coach_count, coaches_with_5plus, recordings, recordings_linked, rank, status::text AS status, computed_at
       FROM coachip_rollups
      WHERE scope_kind = $1 AND scope_id = ANY($2::text[]) AND window_start = $3::date AND window_end = $4::date
        AND grader_model = $5 AND framework_version = $6 AND pipeline_version = $7`,
    [scopeKind, scopeIds.map(String), key.from, key.to, key.grader, key.frameworkVersion, key.pipeline],
  );
  return rows;
}

// ── words (COPY §W first; the library's own short name when the deck has no row) ──────────────────────────────────
function wText(wId) {
  const c = S.wCopy(wId);
  if (c) return c;
  const w = S.library().weakness(wId);
  const sn = w ? S.text(w.short_name_en || w.name_en, w.short_name_ur || w.name_ur) : S.text(wId, wId);
  return { short_name: sn, sentence: sn };
}
/** The library's catalogue order (the order every list of Ws keeps; never a count). */
function catalogueIndex() {
  const idx = new Map();
  S.library().raw.weaknesses.forEach((w, i) => idx.set(w.id, i));
  return (wId) => (idx.has(wId) ? idx.get(wId) : 1e6);
}
/** The first intervention at `level` for a W, walking up its parents (LIBRARY_RULES: sub-row first). */
function firstAtLevel(wId, level) {
  const lib = S.library();
  let w = lib.weakness(wId);
  while (w) {
    const i = lib.forW(w.id).find((x) => x.level === level);
    if (i) return i;
    w = w.parent_w_id ? lib.weakness(w.parent_w_id) : null;
  }
  return null;
}
const oldestIso = (dates, fallback) => {
  const ts = dates.filter(Boolean).map((d) => new Date(d).getTime());
  return S.isoTime(ts.length ? new Date(Math.min(...ts)) : fallback);
};
const sortWindows = (ws) => S.windowsOf(ws).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const isCauseLine = (wId) => { const w = S.library().weakness(wId); return !!(w && w.is_cause_line); };
const rowStatus = (s) => (s === 'ok' ? 'ok' : s === 'insufficient' ? 'insufficient' : 'failed');
/** A week Window on the graded window's grader and version boundary (Listen, Stats' weekly bars). */
const weekOn = (monday, graded) => ({ ...S.weekWindow(monday, 'lp_fidelity', graded.grader), scoring_changed_on: graded.scoring_changed_on });

/**
 * "Graded" for a recording (one rule for Listen and Stats): an lp_fidelity fact with status ok and a linked plan, on
 * the coach's current grader version when one is stored. → SQL predicate over alias f, with params from `start`.
 */
function gradedSql(key, start) {
  let sql = "split_part(f.framework_version, ':', 1) = 'lp_fidelity' AND f.status = 'ok' AND f.is_lp_linked";
  const params = [];
  if (key) {
    sql += ` AND f.grader_model = $${start} AND f.framework_version = $${start + 1} AND f.pipeline_version = $${start + 2}`;
    params.push(key.grader, key.frameworkVersion, key.pipeline);
  }
  return { sql, params };
}

/** The coach's sector: the region most of the coach's schools are in (then by name). */
async function coachSector(q, schoolIds) {
  if (!schoolIds.length) return null;
  const { rows } = await q(
    `SELECT region FROM schools WHERE id = ANY($1::uuid[]) AND region IS NOT NULL
      GROUP BY region ORDER BY COUNT(*) DESC, region LIMIT 1`,
    [schoolIds],
  );
  return rows[0] ? rows[0].region : null;
}

// ── R14 GET /coachip/stats (S6) ───────────────────────────────────────────────────────────────────────────────────
const STATS_CAVEAT = S.text(
  'Scoring changed on the first day of this window; windows before it are not compared.',
  'نمبر دینے کا طریقہ اس مدت کے پہلے دن بدلا؛ اس سے پہلے کی مدت کا موازنہ نہیں کیا جاتا۔',
);
const FICO_FAMILIES = ['fico_v3', 'fico_v4', 'fico17'];

function changeOf(now, before) {
  if (!before) return null;
  if (now.status !== 'ok' || before.status !== 'ok' || now.d < FLOOR_COACH || before.d < FLOOR_COACH) return 'same';
  const points = 100 * (now.n / now.d - before.n / before.d);
  if (Math.abs(points) < SAME_POINTS) return 'same';
  return points < 0 ? 'fewer' : 'more';
}

async function stats(ctx) {
  const q = ctx.deps.query;
  const uid = ctx.uid;
  const coach = ctx.coach;
  const endBy = S.currentGradedRange(ctx.today, 4).to;
  const key = await latestWindowKey(q, { scopeKind: 'coach', scopeId: uid, endBy });
  const now = await graderWindow(q, key, ctx.today);
  // the window before (any version): comparable only under the same grader + framework version (B19)
  const beforeKey = key ? await latestWindowKey(q, { scopeKind: 'coach', scopeId: uid, endBy, before: key.from }) : null;
  const comparable = !!beforeKey && beforeKey.grader === key.grader && beforeKey.frameworkVersion === key.frameworkVersion;
  const state = !beforeKey ? 'first_window' : comparable ? 'two_windows' : 'marker';
  const before = beforeKey ? await graderWindow(q, beforeKey, ctx.today) : null;

  const order = catalogueIndex();
  const all = await rollupsAt(q, key, { scopeKind: 'coach', scopeIds: [uid] });
  const nowRows = all.filter((r) => !isCauseLine(r.w_id)).sort((a, b) => order(a.w_id) - order(b.w_id));
  const beforeRows = comparable ? await rollupsAt(q, beforeKey, { scopeKind: 'coach', scopeIds: [uid] }) : [];
  const sector = await coachSector(q, coach.schoolIds);
  const sectorRows = sector ? await rollupsAt(q, key, { scopeKind: 'sector', scopeIds: [sector] }) : [];
  const computed = [];

  const rows = nowRows.map((r) => {
    const b = beforeRows.find((x) => x.w_id === r.w_id) || null;
    const sr = sectorRows.find((x) => x.w_id === r.w_id && x.status === 'ok') || null;
    computed.push(r.computed_at);
    if (b) computed.push(b.computed_at);
    if (sr) computed.push(sr.computed_at);
    const t = wText(r.w_id);
    return {
      w_id: r.w_id,
      short_name: t.short_name,
      sentence: t.sentence,
      now: S.count(r.n, r.d, now.id),
      before: b ? S.count(b.n, b.d, before.id) : null,
      change: comparable ? changeOf(r, b) : null,
      sector: sr ? S.count(sr.n, sr.d, now.id) : null,
      status: rowStatus(r.status),
    };
  });

  // the AI coach's report on the same dates (recordings without a linked plan; FICO_CROSSWALK §3), one row per W
  const fico = [];
  const ficoWindows = [];
  if (key) {
    const { rows: fr } = await q(
      `SELECT r.w_id, r.numerator AS n, r.denominator AS d, r.grader_model, r.framework_version, r.pipeline_version, r.window_weeks, r.computed_at
         FROM coachip_rollups r
        WHERE r.scope_kind = 'coach' AND r.scope_id = $1 AND r.window_start = $2::date AND r.window_end = $3::date
          AND split_part(r.framework_version, ':', 1) = ANY($4::text[]) AND r.status IN ('ok', 'insufficient')
          AND NOT EXISTS (SELECT 1 FROM coachip_weakness_signals ws
                           WHERE ws.w_id = r.w_id AND ws.source::text = split_part(r.framework_version, ':', 1) AND ws.role = 'never')
        ORDER BY r.computed_at DESC`,
      [String(uid), key.from, key.to, FICO_FAMILIES],
    );
    const seen = new Set();
    const picked = fr.filter((r) => (seen.has(r.w_id) ? false : seen.add(r.w_id))).sort((a, b) => order(a.w_id) - order(b.w_id));
    const sig = picked.length ? (await q(
      `SELECT w_id, source::text AS source, indicator_id FROM coachip_weakness_signals WHERE w_id = ANY($1::text[]) AND role <> 'never'
        ORDER BY role, indicator_id`,
      [picked.map((r) => r.w_id)],
    )).rows : [];
    for (const r of picked) {
      const fk = { from: key.from, to: key.to, weeks: r.window_weeks, grader: r.grader_model, frameworkVersion: r.framework_version, pipeline: r.pipeline_version };
      const fw = await graderWindow(q, fk, ctx.today);   // eslint-disable-line no-await-in-loop
      ficoWindows.push(fw);
      computed.push(r.computed_at);
      const fam = family(r.framework_version);
      const s = sig.find((x) => x.w_id === r.w_id && x.source === fam);
      fico.push({ indicator: `${fam}.${s ? s.indicator_id : r.w_id}`, label: wText(r.w_id).short_name, lowest_share: S.count(r.n, r.d, fw.id) });
    }
  }

  // recordings per week of the window: graded (on this version) of recordings, the coach's current teachers only
  const weeks = [];
  for (let i = 0; i < now.weeks; i += 1) weeks.push(S.addDays(now.from, 7 * i));
  const byWeek = new Map();
  if (coach.teacherKeys.length) {
    const g = gradedSql(key, 4);
    const { rows: wr } = await q(
      `SELECT date_trunc('week', (f.recorded_at AT TIME ZONE 'Asia/Karachi')::date)::date::text AS monday,
              COUNT(DISTINCT f.session_id)::int AS d, COUNT(DISTINCT f.session_id) FILTER (WHERE ${g.sql})::int AS n
         FROM coachip_session_facts f
        WHERE f.teacher_key = ANY($1::text[]) AND (f.recorded_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2::date AND $3::date
        GROUP BY 1`,
      [coach.teacherKeys, now.from, now.to, ...g.params],
    );
    for (const r of wr) byWeek.set(r.monday, r);
  }
  const weekWindows = weeks.map((m) => weekOn(m, now));
  const recordingsByWeek = weeks.map((m, i) => {
    const r = byWeek.get(m) || { n: 0, d: 0 };
    return { week_start: m, graded: S.count(r.n, r.d, weekWindows[i].id) };
  });

  const coverage = S.count(Math.max(0, ...all.map((r) => r.recordings_linked)), Math.max(0, ...all.map((r) => r.recordings)), now.id);
  const sc = now.scoring_changed_on;
  return S.reply(200, {
    window_pair: { now, before },
    rows,
    opening: {
      state,
      first_trend_after: state === 'two_windows' ? now.to : S.addDays(now.to, 28),
      scoring_changed_on: sc,
    },
    fico_panel: fico,
    recordings_by_week: recordingsByWeek,
    coverage,
    method: {
      query_id: 'q-coachip-stats-v1',
      grader: key ? key.grader : '',
      framework: now.framework,
      caveats: sc && sc >= now.from && sc <= now.to ? [STATS_CAVEAT] : [],
    },
    windows: sortWindows([now, before, ficoWindows, weekWindows]),
    computed_at: oldestIso(computed, ctx.now),
  });
}

// ── R15 GET /coachip/results (S7) ─────────────────────────────────────────────────────────────────────────────────
const RESULTS_NONE = S.text('No reading check in your schools yet.', 'ابھی آپ کے اسکولوں میں کوئی پڑھائی کی جانچ نہیں ہوئی۔');

/** The cell's one debrief line and its intervention: the W with the largest share among the cell's ok rows. */
function cellAdvice(okRows) {
  if (!okRows.length) return { i: null };
  const focal = [...okRows].sort((a, b) => b.numerator / b.tested - a.numerator / a.tested)[0];
  const lib = S.library();
  let w = lib.weakness(focal.w_id);
  while (w) {
    const i = lib.forW(w.id)[0];
    if (i) return { i };
    w = w.parent_w_id ? lib.weakness(w.parent_w_id) : null;
  }
  return { i: null };
}

async function results(ctx) {
  const q = ctx.deps.query;
  const schoolIds = ctx.coach.schoolIds;
  const { rows } = schoolIds.length ? await q(
    `SELECT DISTINCT ON (c.school_id, c.grade, c.language, c.w_id)
            c.school_id, s.name AS school_name, c.grade, c.language::text AS language, c.w_id, c.term_start::text AS term_start,
            c.tested, c.numerator, c.status::text AS status, c.grader_model, c.computed_at
       FROM coachip_result_cells c JOIN schools s ON s.id = c.school_id
      WHERE c.school_id = ANY($1::uuid[])
        AND c.term_start = (SELECT MAX(term_start) FROM coachip_result_cells WHERE school_id = ANY($1::uuid[]))
      ORDER BY c.school_id, c.grade, c.language, c.w_id, c.computed_at DESC`,
    [schoolIds],
  ) : { rows: [] };

  if (!rows.length) {
    const { from } = S.currentGradedRange(ctx.today, 4);
    const window = S.gradedWindow({ framework: 'egra', weeks: 4, from, to: S.addDays(from, 27), grader: null });
    return S.reply(200, {
      window, cells: [],
      empty: { status: 'pending', message: RESULTS_NONE, detail: { graded: null, widened_to_weeks: null, as_of: null } },
      windows: [window], computed_at: S.isoTime(ctx.now),
    });
  }
  const newest = [...rows].sort((a, b) => new Date(b.computed_at) - new Date(a.computed_at))[0];
  const term = rows[0].term_start;
  const window = S.gradedWindow({ framework: 'egra', weeks: 4, from: term, to: S.addDays(term, 27), grader: newest.grader_model });

  const order = catalogueIndex();
  const cells = new Map();
  for (const r of rows) {
    const k = `${r.school_id}|${r.grade}|${r.language}`;
    if (!cells.has(k)) cells.set(k, { school: { school_id: r.school_id, school_name: r.school_name }, grade: Number(r.grade), language: r.language, rows: [] });
    cells.get(k).rows.push(r);
  }
  const out = [...cells.values()]
    .sort((a, b) => (a.school.school_name < b.school.school_name ? -1 : a.school.school_name > b.school.school_name ? 1 : 0)
      || a.school.school_id.localeCompare(b.school.school_id) || a.grade - b.grade || a.language.localeCompare(b.language))
    .map((c) => {
      const tested = Math.max(...c.rows.map((r) => r.tested));
      const under = tested < CHILD_FLOOR;   // B20: under the floor every count is withheld
      const sorted = c.rows.sort((a, b) => order(a.w_id) - order(b.w_id));
      const okRows = under ? [] : sorted.filter((r) => r.status === 'ok' && r.numerator !== null && r.tested > 0);
      const { i } = cellAdvice(okRows);
      const plans = i ? (Array.isArray(i.materials) ? i.materials : []).filter((m) => m.api_kind === 'fln' && m.ref).map((m) => String(m.ref)) : [];
      const step = i && i.teacher_action_step ? i.teacher_action_step : null;
      return {
        school: c.school,
        grade: c.grade,
        language: c.language,
        tested: { n: tested, floor: CHILD_FLOOR, window_id: window.id },
        rows: sorted.map((r) => {
          const t = wText(r.w_id);
          const ok = !under && r.status === 'ok' && r.numerator !== null;
          return {
            w_id: r.w_id, short_name: t.short_name, sentence: t.sentence,
            count: ok ? S.count(r.numerator, r.tested, window.id) : null,
            status: under ? 'insufficient' : r.status,
          };
        }),
        fln: { plan_ids: plans, can_send: plans.length > 0 },
        debrief_line: step ? S.text(`Try this tomorrow: ${step.step_en}`, `کل یہ آزمائیں: ${step.step_ur || step.step_en}`) : null,
        i_id: i ? i.id : null,
      };
    });
  return S.reply(200, {
    window, cells: out, empty: null, windows: [window], computed_at: oldestIso(rows.map((r) => r.computed_at), ctx.now),
  });
}

// ── R5 GET /coachip/moments?w=&week= (Listen) ─────────────────────────────────────────────────────────────────────
const GOOD_FILTER = S.text('Good examples', 'اچھی مثالیں');   // COPY l.filter.good
const LISTEN_MAX = 50;
const FAILED_MAX = 20;

async function moments(ctx) {
  const q = ctx.deps.query;
  const coach = ctx.coach;
  const week = ctx.query.week || S.mondayOf(ctx.today);
  const wq = ctx.query.w || null;
  if (wq && wq !== 'good') {
    const { rows } = await q('SELECT 1 FROM coachip_weaknesses WHERE w_id = $1', [wq]);
    if (!rows[0]) throw new S.HttpAnswer(S.NOT_FOUND());
  }
  const endBy = S.currentGradedRange(ctx.today, 4).to;
  const key = await latestWindowKey(q, { scopeKind: 'coach', scopeId: ctx.uid, endBy });
  const graded = await graderWindow(q, key, ctx.today);
  const window = weekOn(week, graded);
  const to = S.addDays(week, 6);

  // the week's recordings by the coach's CURRENT teachers (scope before content: teacher_key ∈ coachScope)
  const g = gradedSql(key, 4);
  const sessions = coach.teacherKeys.length ? (await q(
    `SELECT f.session_id, BOOL_OR(${g.sql}) AS graded, BOOL_OR(f.status = 'failed') AS failed, BOOL_OR(f.status <> 'failed') AS analysed,
            MAX(f.recorded_at) AS recorded_at, ((MAX(f.recorded_at) AT TIME ZONE 'Asia/Karachi')::date)::text AS recorded_on,
            (ARRAY_AGG(f.school_id ORDER BY f.computed_at DESC))[1] AS school_id, MAX(f.audio_s) AS audio_s, MIN(f.computed_at) AS computed_at
       FROM coachip_session_facts f
      WHERE f.teacher_key = ANY($1::text[]) AND (f.recorded_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2::date AND $3::date
      GROUP BY f.session_id`,
    [coach.teacherKeys, week, to, ...g.params],
  )).rows : [];
  const gradedIds = sessions.filter((s) => s.graded).map((s) => s.session_id);

  // moments on graded recordings, newest first; one per (recording, W, kind)
  const rows = gradedIds.length ? (await q(
    `SELECT m.id, m.w_id, m.kind::text AS kind, f.session_id
       FROM coachip_moments m JOIN coachip_session_facts f ON f.id = m.fact_id
      WHERE f.session_id = ANY($1::uuid[]) AND f.teacher_key = ANY($2::text[])
      ORDER BY f.recorded_at DESC, m.id`,
    [gradedIds, coach.teacherKeys],
  )).rows : [];
  const seen = new Set();
  const list = rows.filter((r) => { const k = `${r.session_id}|${r.w_id}|${r.kind}`; return seen.has(k) ? false : seen.add(k); });

  const base = S.count(new Set(list.map((r) => r.session_id)).size, gradedIds.length, window.id);
  const order = catalogueIndex();
  const perW = new Map();
  let good = 0;
  for (const r of list) {
    if (r.kind === 'good') { good += 1; continue; }
    perW.set(r.w_id, (perW.get(r.w_id) || 0) + 1);
  }
  const filters = [...perW.keys()].sort((a, b) => order(a) - order(b))
    .map((wId) => ({ w_id: wId, short_name: wText(wId).short_name, count: S.count(perW.get(wId), base.d, window.id) }));
  if (good) filters.push({ w_id: 'good', short_name: GOOD_FILTER, count: S.count(good, base.d, window.id) });

  const shown = list
    .filter((r) => (!wq ? true : wq === 'good' ? r.kind === 'good' : r.w_id === wq && r.kind !== 'good'))
    .slice(0, LISTEN_MAX);
  const built = await buildMomentsWithMeta(q, ctx.deps.codes, ctx.uid, shown.map((r) => r.id), { withPair: false, coachScope: coach, today: ctx.today });
  const momentsOut = built.moments.map((m) => ({ ...m, steps: [], pair: null }));

  // a recording whose analysis failed is not a moment: it lists here, with no code (B10)
  const failed = sessions.filter((s) => s.failed && !s.analysed)
    .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at)).slice(0, FAILED_MAX);
  const names = failed.length ? new Map((await q(`SELECT id, name FROM schools WHERE id = ANY($1::uuid[])`, [failed.map((s) => s.school_id)])).rows.map((r) => [r.id, r.name])) : new Map();

  return S.reply(200, {
    window,
    base,
    recordings: S.count(gradedIds.length, sessions.length, window.id),
    filters,
    moments: momentsOut,
    failed_sessions: failed.map((s) => ({
      session_id: s.session_id,
      school: { school_id: s.school_id, school_name: names.get(s.school_id) || '' },
      recorded_on: s.recorded_on,
      duration_s: s.audio_s == null ? 0 : Number(s.audio_s),
    })),
    windows: [window],
    computed_at: oldestIso(sessions.map((s) => s.computed_at), ctx.now),
  });
}

// ── R6 GET /coachip/m/:momentId (S4): the coach's Moment, or the RM's circle form ───────────────────────────────────
// `?as=rm` (the RM surface, fix-r5 s5, B22): RM context only. A dual who is RM of the sector they coach in would
// otherwise get the coach form (T-code, session, full recording) on the RM circle; with it the coach path is never
// tried, and a session with no RmScope answers the one 404.
async function moment(ctx) {
  const q = ctx.deps.query;
  const id = ctx.params.momentId;
  const asRm = ctx.query && ctx.query.as === 'rm';
  // coach: the moment's recording must be one of the coach's current teachers' (inScope), checked before any content
  if (ctx.coach && !asRm) {
    const { rows } = await q('SELECT session_id FROM coachip_moments WHERE id = $1', [id]);
    if (rows[0] && await ctx.deps.scope.inScope(ctx.coach, rows[0].session_id)) {
      const built = await buildMomentsWithMeta(q, ctx.deps.codes, ctx.uid, [id], { withPair: true, coachScope: ctx.coach, today: ctx.today });
      if (built.moments[0]) {
        return S.reply(200, { ...built.moments[0], windows: [], computed_at: S.isoTime(built.computedAt || ctx.now) });
      }
    }
  }
  // RM: only a moment of this sector's circle for this week (the stored predicate, B3); school and W only (B22)
  if (ctx.rm && await ctx.deps.scope.circleAllows(ctx.rm, id)) {
    const body = await circleForm(q, ctx, id);
    if (body) return S.reply(200, body);
  }
  throw new S.HttpAnswer(S.NOT_FOUND());
}

async function circleForm(q, ctx, momentId) {
  const { rows } = await q(
    `SELECT m.id, m.w_id, m.kind::text AS kind, m.from_s, m.to_s, m.moment_s, m.confidence::text AS confidence,
            m.gloss_en, m.gloss_ur, m.gloss_status::text AS gloss_status, m.clip_status::text AS clip_status, m.fact_id,
            f.school_id, s.name AS school_name, f.audio_s, f.computed_at, ci.coach_user_id
       FROM coachip_moments m
       JOIN coachip_session_facts f ON f.id = m.fact_id
       JOIN schools s ON s.id = f.school_id
       JOIN coachip_circle_items ci ON ci.moment_id = m.id AND ci.sector = $2 AND ci.week_start = $3::date
      WHERE m.id = $1
      LIMIT 1`,
    [momentId, ctx.rm.sector, S.mondayOf(ctx.today)],
  );
  const r = rows[0];
  if (!r) return null;
  const { rows: steps } = await q(
    'SELECT phase, verdict::text AS verdict, from_s, to_s FROM coachip_session_steps WHERE fact_id = $1 ORDER BY ordinal',
    [r.fact_id],
  );
  const coaches = await sectorCoaches(q, ctx.rm);
  const c = coaches.find((x) => String(x.coachUserId).toLowerCase() === String(r.coach_user_id).toLowerCase());
  const none = r.confidence === 'none';
  const durationS = r.audio_s != null ? Number(r.audio_s) : Math.max(r.to_s, ...steps.map((s) => (s.to_s == null ? 0 : s.to_s)));
  return {
    moment_id: r.id,
    school: { school_id: r.school_id, school_name: r.school_name },
    w: wShape(r.w_id, null),
    kind: r.kind,
    steps: steps.map((s) => ({
      phase: s.phase, label: chapterLabel(s.phase), verdict: s.verdict,
      from_s: none || s.from_s == null ? null : s.from_s, to_s: none || s.to_s == null ? null : s.to_s,
    })),
    lesson_s: none || r.moment_s == null ? null : r.moment_s,
    confidence: r.confidence,
    clip: none
      ? { from_s: 0, to_s: durationS, duration_s: durationS, status: r.clip_status }
      : { from_s: r.from_s, to_s: r.to_s, duration_s: r.to_s - r.from_s, status: r.clip_status },
    gloss: !none && r.gloss_status === 'ok' && r.gloss_en && r.gloss_ur ? S.text(r.gloss_en, r.gloss_ur) : null,
    gloss_status: r.gloss_status,
    question: questionFor(r.w_id),
    coach_label: c ? c.label : '',
    pair: null,
    full_recording: null,
    windows: [],
    computed_at: S.isoTime(r.computed_at),
  };
}

module.exports = {
  moments,
  moment,
  stats,
  results,
  // shared with coachip-rm-read.service.js
  helpers: {
    FLOOR_COACH, FLOOR_SECTOR, CHILD_FLOOR, SAME_POINTS, family, latestWindowKey, scoringChangedOn, graderWindow, rollupsAt,
    wText, catalogueIndex, firstAtLevel, oldestIso, sortWindows,
  },
};
