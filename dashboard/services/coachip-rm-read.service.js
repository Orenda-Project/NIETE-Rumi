'use strict';
/**
 * bd-sex15q.13 (worker w-listen) — the RM's three reads (contracts/API.md §9 R17 rm/home, R18 rm/coach/:id,
 * R20 rm/circle; §3 Coach / WRow / Note; §8.4 needs-me). Each handler is async (ctx) => {status, body}.
 *
 * An RM sees aggregates per coach and school, never a teacher: no code, code_id, teacher key, session id or T-code is
 * selected into any of these payloads (B21, B22; FIXTURES §1). The circle rows carry school and W only.
 *
 * Scope: ctx.rm (RmScope, computed once by the router). R18 answers the one 404 unless the coach holds a real school in
 * the RM's sector (rm.coachUserIds), checked before anything about that coach is read (B3).
 *
 * A coach's label is the coach's users.name when set (operator default B, SPEC §0.9: coaches are staff, not the
 * protected party) and otherwise the C-code: the coaches of the sector numbered C-01, C-02 … in the order of each
 * coach's first school by name, which is also the order of every coach list here (school-list order, never a rank, B9).
 */
const S = require('./coachip-shapes');
const rules = require('./coachip-rules.service');
const { helpers: H } = require('./coachip-listen-read.service');
const { sectorCoaches } = require('./coachip-sector-coaches');

const UNVISITED_DAYS = 35;   // §8.4: a school unvisited ≥ 5 weeks puts the coach under "needs me"
const lc = (v) => String(v).toLowerCase();

const TEMPLATE_TITLES = {   // COPY §RM-T titles; the Urdu is FIXTURES v2.2's composed line (COPY v1 has none: a COPY gap)
  'RM-T1': S.text('The move at a school', 'ایک اسکول میں قدم'),
  'RM-T2': S.text('A visit is due', 'دورہ باقی ہے'),
  'RM-T3': S.text('Checks are due', 'جانچیں باقی ہیں'),
  'RM-T4': S.text('It worked', 'کام کر گیا'),
};

/**
 * The Coach shape (API.md §3) for each coach, in the given order. fix-r5 s6 (c): every read is one read for all the
 * coaches (the month's debriefs, the checks, the last visits, the open notes), run side by side; it used to be two reads
 * per coach in series, which with ten coaches was most of R17's 7-9 s.
 */
async function buildCoaches(q, ctx, coaches, w) {
  if (!coaches.length) return [];
  const ids = coaches.map((c) => c.coachUserId);
  const sectorSchools = ctx.rm.schoolIds;
  const month = S.monthOf(ctx.today);
  const [debriefs, checks, visits, notes] = await Promise.all([
    q(
      `SELECT os.leader_user_id AS coach_user_id, COUNT(DISTINCT os.id)::int AS d,
              COUNT(DISTINCT os.id) FILTER (WHERE os.session_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM coachip_steps st WHERE st.coach_user_id = os.leader_user_id AND st.source_session_id = os.session_id))::int AS n
         FROM observation_schedules os JOIN schools s ON ${rules.OS_SCHOOL}
        WHERE os.leader_user_id = ANY($1::uuid[]) AND s.id = ANY($2::uuid[]) AND os.status = 'done'
          AND os.scheduled_for BETWEEN $3::date AND $4::date
        GROUP BY os.leader_user_id`,
      [ids, sectorSchools, month.from, ctx.today],
    ),
    q(
      `SELECT coach_user_id, COUNT(*) FILTER (WHERE check_by <= $3::date)::int AS d,
              COUNT(*) FILTER (WHERE status = 'open' AND check_by < $3::date)::int AS n
         FROM coachip_steps
        WHERE scope = 'coach' AND coach_user_id = ANY($1::uuid[]) AND school_id = ANY($2::uuid[])
        GROUP BY coach_user_id`,
      [ids, sectorSchools, ctx.today],
    ),
    lastVisitsOf(q, coaches),
    openNotesOf(q, ctx.uid, ids),
  ]);
  const deb = new Map(debriefs.rows.map((r) => [r.coach_user_id, r]));
  const chk = new Map(checks.rows.map((r) => [r.coach_user_id, r]));
  return coaches.map((c) => {
    const schoolIds = c.schools.map((s) => s.school_id);
    const last = visits.get(lc(c.coachUserId)) || new Map();
    const unvisitedIn4w = schoolIds.filter((id) => !last.has(id) || last.get(id) < w.act4w.from).length;
    const longUnvisited = schoolIds.some((id) => !last.has(id) || S.daysBetween(last.get(id), ctx.today) >= UNVISITED_DAYS);
    const d = deb.get(c.coachUserId) || { n: 0, d: 0 };
    const k = chk.get(c.coachUserId) || { n: 0, d: 0 };
    const activity = {
      schools_unvisited: S.count(unvisitedIn4w, schoolIds.length, w.act4w.id),
      debriefs_with_step: S.count(d.n, d.d, w.actM.id),
      checks_overdue: S.count(k.n, k.d, w.act4w.id),
    };
    let reason = null;
    if (longUnvisited) reason = 'unvisited';
    else if (activity.debriefs_with_step.d >= 1 && activity.debriefs_with_step.n === 0) reason = 'no_steps';
    else if (activity.checks_overdue.n >= 1) reason = 'checks_overdue';
    return {
      coach_user_id: c.coachUserId,
      coach_label: c.label,
      activity,
      needs_me_reason: reason,
      note_open: notes.get(lc(c.coachUserId)) || null,
    };
  });
}

/**
 * rules.lastVisits for many coaches in one read: per coach, the latest completed visit to each of THAT coach's schools
 * (the coach's own bookings only). → Map(lc(coachUserId) → Map(schoolId → ISO date)).
 */
async function lastVisitsOf(q, coaches) {
  const out = new Map(coaches.map((c) => [lc(c.coachUserId), new Map()]));
  const pairs = coaches.flatMap((c) => c.schools.map((s) => [c.coachUserId, s.school_id]));
  if (!pairs.length) return out;
  const { rows } = await q(
    `SELECT os.leader_user_id AS coach_user_id, s.id AS school_id, MAX(os.scheduled_for)::text AS date
       FROM observation_schedules os JOIN schools s ON ${rules.OS_SCHOOL}
      WHERE os.leader_user_id = ANY($1::uuid[]) AND s.id = ANY($2::uuid[]) AND os.status = 'done'
      GROUP BY os.leader_user_id, s.id`,
    [[...new Set(pairs.map((p) => p[0]))], [...new Set(pairs.map((p) => p[1]))]],
  );
  const held = new Set(pairs.map(([c, sc]) => `${lc(c)}|${sc}`));
  for (const r of rows) if (held.has(`${lc(r.coach_user_id)}|${r.school_id}`)) out.get(lc(r.coach_user_id)).set(r.school_id, r.date);
  return out;
}

/**
 * Each coach's newest note from this RM still sent or seen (rules.loadNotes with limit 1, for many coaches): ONE read,
 * the note row and its schools (position order) together, shaped by rules.noteShape. → Map(lc(coachUserId) → Note).
 */
async function openNotesOf(q, rmUserId, coachIds) {
  const out = new Map();
  if (!coachIds.length) return out;
  const { rows } = await q(
    `SELECT DISTINCT ON (n.coach_user_id) n.coach_user_id, n.id, n.template_id, n.w_id, n.body_en, n.body_ur,
            n.due_on::text AS due_on, n.status::text AS status,
            COALESCE((SELECT json_agg(json_build_object('school_id', s.id, 'school_name', s.name) ORDER BY ns.position)
                        FROM coachip_rm_note_schools ns JOIN schools s ON s.id = ns.school_id WHERE ns.rm_note_id = n.id), '[]'::json) AS schools
       FROM coachip_rm_notes n
      WHERE n.rm_user_id = $1 AND n.coach_user_id = ANY($2::uuid[]) AND n.status::text = ANY($3::text[])
      ORDER BY n.coach_user_id, n.created_at DESC`,
    [rmUserId, coachIds, ['sent', 'seen']],
  );
  for (const r of rows) out.set(lc(r.coach_user_id), rules.noteShape(r, r.schools));
  return out;
}

// ── shared pieces ──────────────────────────────────────────────────────────────────────────────────────────────────
async function sectorWindow(ctx) {
  const q = ctx.deps.query;
  const endBy = S.currentGradedRange(ctx.today, 4).to;
  const key = await H.latestWindowKey(q, { scopeKind: 'sector', scopeId: ctx.rm.sector, endBy });
  const window = await H.graderWindow(q, key, ctx.today);
  return { key, window };
}
function activityWindows(ctx) {
  return { act4w: S.activityWindow('4w', ctx.today), actM: S.activityWindow('month', ctx.today) };
}
/** The Listen-week Window the circle's moments come from (the previous Karachi week), on the graded window's grader. */
function circleWeekWindow(ctx, window) {
  const prev = S.addDays(S.mondayOf(ctx.today), -7);
  return { ...S.weekWindow(prev, window.framework, window.grader), scoring_changed_on: window.scoring_changed_on };
}
/**
 * School rollups of the ranked Ws among the sector's schools, most lessons with the W first, then name: the "shows
 * most at" list per W. fix-r5 s6 (c): ONE rollups read and one names read for all the ranked Ws (it was one pair per
 * W, in series). → Map(wId → { list, computed }).
 */
async function bySchoolAll(q, key, wIds, schoolIds, window) {
  const out = new Map(wIds.map((id) => [id, { list: [], computed: [] }]));
  if (!wIds.length) return out;
  const all = (await H.rollupsAt(q, key, { scopeKind: 'school', scopeIds: schoolIds })).filter((r) => out.has(r.w_id) && r.n > 0 && r.status === 'ok');
  if (!all.length) return out;
  const names = await q(`SELECT id, name FROM schools WHERE id = ANY($1::uuid[])`, [[...new Set(all.map((r) => r.school_id))]]);
  const name = new Map(names.rows.map((r) => [r.id, r.name]));
  for (const wId of wIds) {
    const rows = all.filter((r) => r.w_id === wId);
    rows.sort((a, b) => b.n - a.n || (name.get(a.school_id) < name.get(b.school_id) ? -1 : 1));
    out.set(wId, {
      list: rows.slice(0, 3).map((r) => ({ school: { school_id: r.school_id, school_name: name.get(r.school_id) }, count: S.count(r.n, r.d, window.id) })),
      computed: rows.map((r) => r.computed_at),
    });
  }
  return out;
}
function wrow(wId, { count, window, state, whereFirst = null, notYet = null }) {
  const t = H.wText(wId);
  return { w_id: wId, short_name: t.short_name, sentence: t.sentence, count, window, state, where_first: whereFirst, not_yet: notYet, sector: null };
}
/** Open sector steps this RM set for the sector: i_id → the session date (check_by − 14, the R21 rule). Newest first. */
async function sectorStepDates(q, ctx) {
  const { rows } = await q(
    `SELECT i_id, w_id, (check_by - 14)::text AS date FROM coachip_steps
      WHERE scope = 'sector' AND coach_user_id = $1 AND sector = $2 AND status = 'open'
      ORDER BY set_at DESC`,
    [ctx.uid, ctx.rm.sector],
  );
  return rows;
}
/** Per coach: open steps (d) and those due by the end of this Karachi week (n), in the sector's schools. */
async function checksDue(q, ctx, coachIds) {
  if (!coachIds.length) return new Map();
  const sunday = S.addDays(S.mondayOf(ctx.today), 6);
  const { rows } = await q(
    `SELECT coach_user_id, COUNT(*)::int AS d, COUNT(*) FILTER (WHERE check_by <= $3::date)::int AS n
       FROM coachip_steps
      WHERE scope = 'coach' AND status = 'open' AND coach_user_id = ANY($1::uuid[]) AND school_id = ANY($2::uuid[])
      GROUP BY coach_user_id`,
    [coachIds, ctx.rm.schoolIds, sunday],
  );
  return new Map(rows.map((r) => [r.coach_user_id, r]));
}
async function latestRun(q) {
  const { rows } = await q('SELECT run_date::text AS run_date, status::text AS status FROM coachip_job_runs ORDER BY run_date DESC, started_at DESC LIMIT 1');
  return rows[0] || null;
}
const copyEmpty = {
  pending: S.text('Being prepared: your first week\'s moves appear after tonight\'s run.', 'تیاری جاری ہے: آپ کے پہلے ہفتے کے قدم آج رات کے تجزیے کے بعد آئیں گے۔'),
  failed: S.text('The analysis has not run for 7 days. Your open steps still show. Ask your RM.', 'تجزیہ سات دن سے نہیں چلا۔ آپ کے جاری قدم دکھائی دے رہے ہیں۔ اپنے آر ایم سے بات کریں۔'),
};
function insufficientMessage(graded, needed) {
  return S.text(`Not enough recordings yet (${graded} of ${needed})`, `ابھی کافی ریکارڈنگز نہیں (${S.urDigits(needed)} میں سے ${S.urDigits(graded)})`);
}

// ── R17 GET /coachip/rm/home (S8) ─────────────────────────────────────────────────────────────────────────────────
/**
 * fix-r5 s6 (c), GO_PACKAGE v5 §0.4 c: the moves (the sector's ranked rows and where each shows most) change only when
 * the nightly writes rollups, so they are kept per RM, keyed on the graded window's key (its computed_at) and the
 * rollup rows' own fingerprint (count and newest updated_at of the sector and school rows under that key), for at most
 * MOVES_TTL_MS. Everything else on S8 (visits, observed codes, coaches, notes, steps, the circle, the run) is live and
 * read on every open. Memory only, per process.
 */
const MOVES_TTL_MS = 10 * 60 * 1000;
const MOVES_MAX = 500;
const movesCache = new Map();

async function rollupsPrint(q, key, sector, schoolIds) {
  const { rows } = await q(
    `SELECT COUNT(*)::int AS n, MAX(updated_at) AS u
       FROM coachip_rollups
      WHERE window_start = $1::date AND window_end = $2::date AND grader_model = $3 AND framework_version = $4 AND pipeline_version = $5
        AND ((scope_kind = 'sector' AND scope_id = $6) OR (scope_kind = 'school' AND scope_id = ANY($7::text[])))`,
    [key.from, key.to, key.grader, key.frameworkVersion, key.pipeline, String(sector), schoolIds.map(String)],
  );
  const r = rows[0] || {};
  return `${r.n}|${r.u ? new Date(r.u).toISOString() : ''}`;
}

/** The sector's ranked moves (stored rank, never re-ranked, §8.3), then B23 not_yet rows to fill two. → { moves, computed } */
async function sectorMoves(q, ctx, key, window) {
  const rm = ctx.rm;
  const rows = await H.rollupsAt(q, key, { scopeKind: 'sector', scopeIds: [rm.sector] });
  const computed = rows.map((r) => r.computed_at);
  const order = H.catalogueIndex();
  const lib = S.library();
  const moves = [];
  const ranked = rows.filter((x) => x.rank && x.status === 'ok').sort((a, b) => a.rank - b.rank);
  const shows = await bySchoolAll(q, key, ranked.map((r) => r.w_id), rm.schoolIds, window);
  for (const r of ranked) {
    const bs = shows.get(r.w_id);
    computed.push(...bs.computed);
    moves.push({
      row: wrow(r.w_id, { count: S.count(r.n, r.d, window.id), window, state: 'ranked', whereFirst: bs.list[0] || null }),
      by_school: bs.list, agenda: true, coach_count: r.coach_count, coaches_with_5plus: r.coaches_with_5plus,
    });
  }
  const waiting = rows
    .filter((x) => !x.rank && x.status === 'insufficient')
    .filter((x) => { const lw = lib.weakness(x.w_id); return lw && lw.s1_eligible && !lw.is_cause_line; })
    .sort((a, b) => order(a.w_id) - order(b.w_id));
  for (const r of waiting) {
    if (moves.length >= 2) break;
    moves.push({
      row: wrow(r.w_id, {
        count: null, window, state: 'not_yet',
        notYet: { graded: r.d >= H.FLOOR_SECTOR ? null : S.count(r.d, H.FLOOR_SECTOR, window.id), codes_seen: r.teacher_count, codes_needed: 3, coaches_with_5plus: r.coaches_with_5plus },
      }),
      by_school: [], agenda: false, coach_count: r.coach_count, coaches_with_5plus: r.coaches_with_5plus,
    });
  }
  return { moves, computed };
}

/** sectorMoves through the per-RM cache (no key → nothing to keep: the empty states read live). */
async function sectorMovesCached(q, ctx, key, window) {
  if (!key) return sectorMoves(q, ctx, key, window);
  const rm = ctx.rm;
  const print = await rollupsPrint(q, key, rm.sector, rm.schoolIds);
  const id = [lc(ctx.uid), rm.sector, ctx.today, window.id, key.from, key.to, key.grader, key.frameworkVersion, key.pipeline,
    new Date(key.computedAt).toISOString(), print, [...rm.schoolIds].map(lc).sort().join(',')].join('|');
  const hit = movesCache.get(id);
  if (hit && Date.now() - hit.at < MOVES_TTL_MS) return JSON.parse(hit.json);
  const fresh = await sectorMoves(q, ctx, key, window);
  movesCache.delete(id);
  movesCache.set(id, { at: Date.now(), json: JSON.stringify(fresh) });
  while (movesCache.size > MOVES_MAX) movesCache.delete(movesCache.keys().next().value);
  return fresh;
}

async function visitedCount(q, rm, w) {
  if (!rm.schoolIds.length) return 0;
  return (await q(
    `SELECT COUNT(DISTINCT s.id)::int AS n FROM observation_schedules os JOIN schools s ON ${rules.OS_SCHOOL}
      WHERE s.id = ANY($1::uuid[]) AND os.status = 'done' AND os.scheduled_for BETWEEN $2::date AND $3::date`,
    [rm.schoolIds, w.act4w.from, w.act4w.to],
  )).rows[0].n;
}
async function observedCount(q, rm, w) {
  if (!rm.schoolIds.length) return 0;
  return (await q(
    `SELECT COUNT(DISTINCT teacher_key)::int AS n FROM coachip_session_facts
      WHERE school_id = ANY($1::uuid[]) AND (recorded_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2::date AND $3::date`,
    [rm.schoolIds, w.act4w.from, w.act4w.to],
  )).rows[0].n;
}
async function withMomentCount(q, rm, monday, coaches) {
  if (!coaches.length) return 0;
  return (await q(
    `SELECT COUNT(DISTINCT coach_user_id)::int AS n FROM coachip_circle_items WHERE sector = $1 AND week_start = $2::date AND coach_user_id = ANY($3::uuid[])`,
    [rm.sector, monday, coaches.map((c) => c.coachUserId)],
  )).rows[0].n;
}

/**
 * fix-r5 s6 (c, c2): the reads that do not depend on each other run side by side; what needs the graded window (the
 * moves) or the coaches (the coach rows, the circle count, the checks due) starts as soon as that one read is in. The
 * payload is byte-identical to the serial version (tests/coachip/__golden__/rm_home_r17_s6*.json).
 */
async function rmHome(ctx) {
  const q = ctx.deps.query;
  const rm = ctx.rm;
  const w = activityWindows(ctx);
  const thisMonday = S.mondayOf(ctx.today);
  // fix-r5 s6 (c2): each read starts the moment what it needs is in: the moves after the window, the coach rows, the
  // circle count and the checks after the coaches; the rest at once
  const windowP = sectorWindow(ctx);
  const coachesP = sectorCoaches(q, rm);
  const coachIdsP = coachesP.then((cs) => cs.map((c) => c.coachUserId));
  const [{ key, window }, visited, observed, coaches, steps, run, mv, built, withMoment, due] = await Promise.all([
    windowP, visitedCount(q, rm, w), observedCount(q, rm, w), coachesP, sectorStepDates(q, ctx), latestRun(q),
    windowP.then((x) => sectorMovesCached(q, ctx, x.key, x.window)),
    coachesP.then((cs) => buildCoaches(q, ctx, cs, w)),
    coachesP.then((cs) => withMomentCount(q, rm, thisMonday, cs)),
    coachIdsP.then((ids) => checksDue(q, ctx, ids)),
  ]);
  const circleWin = circleWeekWindow(ctx, window);
  const { moves } = mv;
  const computed = [...mv.computed];
  const lib = S.library();

  // the opening: visits and observations in the last 4 weeks, over the sector's schools and teachers
  const nSchools = rm.schoolIds.length;
  const opening = {
    visited: S.count(visited, nSchools, w.act4w.id),
    unobserved_schools: S.count(nSchools - visited, nSchools, w.act4w.id),
    unobserved_codes: S.count(Math.max(0, rm.teacherCount - observed), rm.teacherCount, w.act4w.id),
    floor_weeks: 4,
  };

  // the coaches, grouped (school-list order inside each group)
  const groups = { needs_me: built.filter((c) => c.needs_me_reason), on_track: built.filter((c) => !c.needs_me_reason) };
  const heldBy = new Set(coaches.map((c) => lc(c.coachUserId)));
  const noScope = rm.rosterCoachUserIds.filter((id) => !heldBy.has(lc(id))).length;

  // the circle: coaches with a circle moment this week; open steps due this week
  const dueN = [...due.values()].reduce((a, r) => a + r.n, 0);
  const dueD = [...due.values()].reduce((a, r) => a + r.d, 0);

  // the cluster session: the RM's open sector step, else the first move's school-level intervention (no date yet)
  let cluster = null;
  if (steps[0]) {
    const i = lib.intervention(steps[0].i_id);
    cluster = { i_id: steps[0].i_id, title: i ? S.text(i.title_en, i.title_ur) : S.text(steps[0].i_id, steps[0].i_id), date: steps[0].date };
  } else if (moves[0] && moves[0].row.state === 'ranked') {
    const i = H.firstAtLevel(moves[0].row.w_id, 'school');
    if (i) cluster = { i_id: i.id, title: S.text(i.title_en, i.title_ur), date: null };
  }

  // freshness (coachip_job_runs): no run yet → pending; a failed last run → stale (≤ 7 days), then failed
  let stale = null;
  let empty = null;
  if (!run) {
    empty = { status: 'pending', message: copyEmpty.pending, detail: { graded: null, widened_to_weeks: null, as_of: null } };
  } else if (!key) {
    empty = { status: 'insufficient', message: insufficientMessage(0, H.FLOOR_SECTOR), detail: { graded: S.count(0, H.FLOOR_SECTOR, window.id), widened_to_weeks: null, as_of: null } };
  } else if (run.status === 'failed' || run.status === 'running') {
    const asOf = S.karachiDay(key.computedAt);
    if (S.daysBetween(asOf, ctx.today) > 7) {
      empty = { status: 'failed', message: copyEmpty.failed, detail: { graded: null, widened_to_weeks: null, as_of: asOf } };
    } else {
      stale = { as_of: asOf, reason: run.status === 'failed' ? 'failed' : 'pending' };
    }
  }

  const body = {
    sector: rm.sector,
    window,
    opening,
    moves,
    groups,
    on_track_count: S.count(groups.on_track.length, built.length, w.act4w.id),
    no_scope_coaches: S.count(noScope, rm.rosterCoachUserIds.length, w.act4w.id),
    unassigned_schools: S.count(rm.unassignedSchoolCount, nSchools, w.act4w.id),
    circle: { moments: S.count(withMoment, coaches.length, circleWin.id), checks_due: S.count(dueN, dueD, w.act4w.id) },
    cluster,
    monday: { templates: Object.keys(TEMPLATE_TITLES).map((id) => ({ template_id: id, title: TEMPLATE_TITLES[id] })) },
    stale,
    empty,
    windows: H.sortWindows([window, w.act4w, w.actM, circleWin]),
    computed_at: H.oldestIso(computed, ctx.now),
  };
  return S.reply(200, body);
}

// ── R18 GET /coachip/rm/coach/:coachUserId (S9) ───────────────────────────────────────────────────────────────────
async function rmCoach(ctx) {
  const q = ctx.deps.query;
  const rm = ctx.rm;
  const coachUserId = ctx.params.coachUserId;
  // scope before content (B3): the coach must hold a real school in this RM's sector
  if (!rm.coachUserIds.some((id) => lc(id) === lc(coachUserId))) throw new S.HttpAnswer(S.NOT_FOUND());
  const coaches = await sectorCoaches(q, rm);
  const me = coaches.find((c) => lc(c.coachUserId) === lc(coachUserId));
  if (!me) throw new S.HttpAnswer(S.NOT_FOUND());

  const endBy = S.currentGradedRange(ctx.today, 4).to;
  const sec = await sectorWindow(ctx);
  const coachKey = await H.latestWindowKey(q, { scopeKind: 'coach', scopeId: me.coachUserId, endBy });
  const key = coachKey || sec.key;
  const window = coachKey ? await H.graderWindow(q, coachKey, ctx.today) : sec.window;
  const w = activityWindows(ctx);
  const computed = [];

  const [coach] = await buildCoaches(q, ctx, [me], w);

  // schools held in the sector, by name (never by a count); visits unwindowed (R3 rule); graded of recordings in window
  const schoolIds = me.schools.map((s) => s.school_id);
  const last = await rules.lastVisits(q, me.coachUserId, schoolIds);
  const next = await rules.nextVisits(q, me.coachUserId, schoolIds, ctx.today);
  const graded = await gradedBySchool(q, schoolIds, window, key);
  const schools = me.schools.map((s) => {
    const g = graded.get(s.school_id) || { n: 0, d: 0 };
    const lv = last.get(s.school_id) || null;
    return {
      school: s,
      last_visit: lv,
      next_visit: next.get(s.school_id) || null,
      graded: S.count(g.n, g.d, window.id),
      weeks_since_visit: lv ? Math.floor(S.daysBetween(lv, ctx.today) / 7) : null,
    };
  });

  // steps this coach set this calendar month (Karachi), in the sector's schools
  const month = S.monthOf(ctx.today);
  const st = (await q(
    `SELECT COUNT(*)::int AS d,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status = 'open' AND check_by < $5::date)::int AS overdue
       FROM coachip_steps
      WHERE scope = 'coach' AND coach_user_id = $1 AND school_id = ANY($2::uuid[])
        AND (set_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $3::date AND $4::date`,
    [me.coachUserId, rm.schoolIds, month.from, month.to, ctx.today],
  )).rows[0];
  const steps = {
    open: S.count(st.open, st.d, w.actM.id),
    completed: S.count(st.completed, st.d, w.actM.id),
    overdue: S.count(st.overdue, st.d, w.actM.id),
  };

  // the coach's two moves (the coach's count in the row), each beside the sector's count for that W
  const moves = [];
  if (coachKey) {
    const rows = await H.rollupsAt(q, coachKey, { scopeKind: 'coach', scopeIds: [me.coachUserId] });
    const sectorRows = await H.rollupsAt(q, coachKey, { scopeKind: 'sector', scopeIds: [rm.sector] });
    computed.push(...rows.map((r) => r.computed_at), ...sectorRows.map((r) => r.computed_at));
    const ranked = rows.filter((x) => x.rank && x.status === 'ok').sort((a, b) => a.rank - b.rank).slice(0, 2);
    const shows = await bySchoolAll(q, coachKey, ranked.map((r) => r.w_id), schoolIds, window);
    for (const r of ranked) {
      const bs = shows.get(r.w_id);
      computed.push(...bs.computed);
      const sr = sectorRows.find((x) => x.w_id === r.w_id && x.status === 'ok');
      moves.push({
        row: wrow(r.w_id, { count: S.count(r.n, r.d, window.id), window, state: 'ranked', whereFirst: bs.list[0] || null }),
        sector: sr ? S.count(sr.n, sr.d, window.id) : null,
      });
    }
  }

  const notes = await rules.loadNotes(q, { coachUserId: me.coachUserId, rmUserId: ctx.uid, limit: 10 });
  return S.reply(200, {
    coach,
    schools,
    steps,
    moves,
    notes,
    calibration: { status: 'later_bead' },
    windows: H.sortWindows([window, w.act4w, w.actM]),
    computed_at: H.oldestIso(computed, ctx.now),
  });
}

/** Per school: recordings in the window (d) and those graded on the window's version with a linked plan (n). */
async function gradedBySchool(q, schoolIds, window, key) {
  const out = new Map();
  if (!schoolIds.length) return out;
  const params = [schoolIds, window.from, window.to];
  let graded = "f.status = 'ok' AND f.is_lp_linked";
  if (key) {
    params.push(key.grader, key.frameworkVersion, key.pipeline);
    graded += ' AND f.grader_model = $4 AND f.framework_version = $5 AND f.pipeline_version = $6';
  }
  const { rows } = await q(
    `SELECT f.school_id, COUNT(DISTINCT f.session_id)::int AS d, COUNT(DISTINCT f.session_id) FILTER (WHERE ${graded})::int AS n
       FROM coachip_session_facts f
      WHERE f.school_id = ANY($1::uuid[]) AND (f.recorded_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2::date AND $3::date
      GROUP BY f.school_id`,
    params,
  );
  for (const r of rows) out.set(r.school_id, r);
  return out;
}

// ── R20 GET /coachip/rm/circle (S10) ──────────────────────────────────────────────────────────────────────────────
async function rmCircle(ctx) {
  const q = ctx.deps.query;
  const rm = ctx.rm;
  const weekStart = S.mondayOf(ctx.today);
  const { key, window: graded } = await sectorWindow(ctx);
  const window = circleWeekWindow(ctx, graded);
  const w = activityWindows(ctx);
  const coaches = await sectorCoaches(q, rm);
  const label = new Map(coaches.map((c) => [lc(c.coachUserId), c.label]));
  const pos = new Map(coaches.map((c, i) => [lc(c.coachUserId), i]));

  // one moment per coach (B22: school and W only), the stored circle for this sector and this Monday
  const items = coaches.length ? (await q(
    `SELECT ci.coach_user_id, ci.basis::text AS basis, m.id AS moment_id, m.w_id, (m.to_s - m.from_s) AS duration_s, s.id AS school_id,
            s.name AS school_name, f.computed_at
       FROM coachip_circle_items ci
       JOIN coachip_moments m ON m.id = ci.moment_id
       JOIN coachip_session_facts f ON f.id = m.fact_id
       JOIN schools s ON s.id = f.school_id
      WHERE ci.sector = $1 AND ci.week_start = $2::date AND ci.coach_user_id = ANY($3::uuid[])`,
    [rm.sector, weekStart, coaches.map((c) => c.coachUserId)],
  )).rows : [];
  items.sort((a, b) => pos.get(lc(a.coach_user_id)) - pos.get(lc(b.coach_user_id)));
  const moments = items.map((r) => ({
    coach_user_id: r.coach_user_id,
    coach_label: label.get(lc(r.coach_user_id)),
    moment_id: r.moment_id,
    w_id: r.w_id,
    short_name: H.wText(r.w_id).short_name,
    school: { school_id: r.school_id, school_name: r.school_name },
    duration_s: Number(r.duration_s),
  }));

  const due = await checksDue(q, ctx, coaches.map((c) => c.coachUserId));
  const checksDueRows = coaches.map((c) => {
    const r = due.get(c.coachUserId) || { n: 0, d: 0 };
    return { coach_label: c.label, count: S.count(r.n, r.d, w.act4w.id) };
  });

  // the sector interventions for the sector's ranked moves: the first school-level and sector-level I of each W
  // (sub-row first, then its parent), with the date of the RM's open sector step for that I when one is set
  const rows = await H.rollupsAt(q, key, { scopeKind: 'sector', scopeIds: [rm.sector] });

  // SPEC v2.1 §11.1: the week's basis is stored on the rows (one run writes the whole sector, so a week is never mixed);
  // with no row, the week is on the coach basis exactly when the sector has no rank-1 W. The floor: the sector's best
  // per-W count of coaches with 5+ lessons (null on the sector basis).
  const sectorRanked = rows.some((r) => r.rank === 1 && r.status === 'ok');
  const basis = items.length ? (items.some((r) => r.basis === 'coach') ? 'coach' : 'sector') : (sectorRanked ? 'sector' : 'coach');
  // red-2 20261027T001002: an empty coach week means "no coach over the coach floor" only when no coach ranks; the
  // count of the sector's coaches with an ok coach-level rank-1 W in the same window lets S10 say which (never shown)
  const coachRanks = basis === 'coach'
    ? await H.rollupsAt(q, key, { scopeKind: 'coach', scopeIds: coaches.map((c) => c.coachUserId) }) : [];
  const floor = basis === 'coach'
    ? { coaches_with_5plus: rows.reduce((mx, r) => Math.max(mx, Number(r.coaches_with_5plus) || 0), 0), needed: 3, // B23: 3 coaches with 5+
      coaches_ranked: new Set(coachRanks.filter((r) => r.rank === 1 && r.status === 'ok').map((r) => lc(r.coach_user_id))).size,
      window_id: graded.id } // {c} is a Count on the sector's 4-week graded window (COPY §8), listed in `windows`
    : null;
  const stepDates = await sectorStepDates(q, ctx);
  const dateOf = new Map();
  for (const s of stepDates) if (!dateOf.has(s.i_id)) dateOf.set(s.i_id, s.date);
  const seen = new Set();
  const sectorInterventions = [];
  for (const r of rows.filter((x) => x.rank && x.status === 'ok').sort((a, b) => a.rank - b.rank)) {
    // LIBRARY_RULES §2.2: S10 takes level `sector` only; a school-level I is S2's / S8's, never a sector step (panel 093959 c2)
    for (const level of ['sector']) {
      const i = H.firstAtLevel(r.w_id, level);
      if (!i || seen.has(i.id)) continue;
      seen.add(i.id);
      const cw = i.check_it_worked || {};
      sectorInterventions.push({
        i_id: i.id,
        title: S.text(i.title_en, i.title_ur || i.title_en),
        level,
        date: dateOf.get(i.id) || null,
        attendees: S.text(i.with_whom || '', i.with_whom_ur || i.with_whom || ''),
        check: S.text(cw.look_for || '', cw.look_for_ur || cw.look_for || ''),
      });
    }
  }

  return S.reply(200, {
    week_start: weekStart,
    window,
    basis,
    floor,
    sector_interventions: sectorInterventions,
    moments,
    checks_due: checksDueRows,
    windows: H.sortWindows(floor ? [w.act4w, window, graded] : [w.act4w, window]),
    computed_at: H.oldestIso(items.map((r) => r.computed_at), ctx.now),
  });
}

module.exports = { rmHome, rmCoach, rmCircle, sectorCoaches };
