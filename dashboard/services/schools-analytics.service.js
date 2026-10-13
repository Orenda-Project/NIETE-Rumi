/**
 * School-wise analytics across every region, for the analytics-only accounts (federal and
 * sector officials). One page, filterable by region. OBJECTIVE COUNTS only — things that
 * happened, "x of N teachers" where it applies, and score averages with their n. No
 * percentages, no bands, no thresholds (operator, 2026-10-13).
 *
 * Two halves, same contract style as school-analytics.service:
 *
 *   loadSchoolsAnalyticsRows(query, range)  two set-based reads (+ one score read), no
 *                                           per-school loop — portal outages have been
 *                                           pool exhaustion, so the cost must not grow
 *                                           with the number of schools. Training rides
 *                                           in the schools read (bd-9vkl9x): no third.
 *   summarizeSchoolsAnalytics(rows, opts)   PURE: rows in, response shape out.
 *
 * No "LPs generated" and no "Coach visits" (operator, 2026-10-13, bd-wfl8oz): human
 * observations already are the coach's visits, so neither is read, summed or sent.
 *
 * WHY THE SCORES ARE MEMOISED. The overall score lives only inside
 * coaching_sessions.analysis_data, a ~23 KB (compressed, out-of-line) JSONB per session.
 * Reading it for a fortnight of sessions measured 9.2 s cold and 0.76 s warm on NIETE prod
 * (2026-10-13, 4,404 sessions), against 0.03 s for the same rows without it. A terminal
 * session's score rarely changes, and when it does its updated_at moves (a BEFORE UPDATE
 * trigger maintains it), so each process remembers {updated_at, pct} per session id and
 * only reads the score of a session it has not seen in that state.
 *
 * Definitions (window = Pakistan days, both ends inclusive, either end open):
 *   school            schools.is_active and not is_probable_test, and schools.region one of
 *                     the six sectors. A school with no region (NULL, blank) or any other
 *                     region is left out of EVERYTHING — no row, no card, no total — and so
 *                     are its teachers and their activity (operator, 2026-10-13, bd-s6qbts.4).
 *   teachers (N)      today's roster: users.role = 'teacher' with that school_id, not
 *                     is_test_user. Activity follows the teacher's CURRENT school.
 *   lpsOpened         distinct (user, plan_kind, plan_ref) in niete_lp_opens by opened_at —
 *                     different plans opened; re-opening one counts once per teacher.
 *                     Logged only since LP_OPENS_LOGGED_SINCE.
 *   teachersOpenedLp  distinct teachers among those opens ("x of N").
 *   trainingModules   distinct (user, module) in teacher_training_progress with completed_at
 *                     in the window — modules finished; each counted once per teacher, the
 *                     leader roster's rule (leader-patch.service). History runs from
 *                     2025-09-15 (migrated), so All time needs no special case (bd-9vkl9x).
 *   teachersTrained   distinct teachers among those completions ("x of N").
 *   dcObservations    coaching_sessions observation_type IS NULL, status 'completed'.
 *   teachersWithDc    distinct teachers among them ("x of N").
 *   humanObservations observation_type 'leader_observation', status terminal (TERMINAL).
 *   avgFico / ficoN   mean overall percentage over scored DC observations, and how many.
 *   avgHitl / hitlN   the same over human observations. That is the score AFTER the
 *                     observer's review: applying her edits re-scores analysis_data (the AI
 *                     draft is kept separately in autofill_analysis_data), and a field-form
 *                     visit is scored from the observer's own levels.
 * Region cards and the overview SUM every count; averages are pooled (sum of scores / n),
 * so a 3-teacher school never weighs the same as a 40-teacher one. A count is never null;
 * an average is null exactly when its n is 0.
 */

const { getOverall } = require('./coaching-frameworks.service');
const { HUMAN_OBSERVATION } = require('./steps-grid.service');
// Imported, never respelled: two spellings of "finished" is how observations went missing once.
const { TERMINAL } = require('./leader-patch.service');

/** The six ICT sectors as schools.region stores them — the only regions counted. */
const SECTORS = Object.freeze(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
const REGION_BUCKETS = SECTORS;

const SECTOR_BY_LOWER = new Map(SECTORS.map((s) => [s.toLowerCase(), s]));

/** niete_lp_opens has rows from this Pakistan day on; earlier windows undercount opens. */
const LP_OPENS_LOGGED_SINCE = '2026-10-04';

/** schools.region → its sector, or null for a school outside the six (it is not counted). */
function bucketOf(region) {
  if (typeof region !== 'string') return null;
  return SECTOR_BY_LOWER.get(region.trim().toLowerCase()) || null;
}

/**
 * The ?region= filter. Blank or "all" is every region; a sector in any case is that
 * sector; anything else ("unassigned" included) is refused rather than guessed at.
 * @returns {{ok: true, region: string|null, key: string} | {ok: false}}
 */
function parseRegionFilter(raw) {
  if (raw === undefined || raw === null) return { ok: true, region: null, key: 'all' };
  if (typeof raw !== 'string') return { ok: false };
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'all') return { ok: true, region: null, key: 'all' };
  const sector = SECTOR_BY_LOWER.get(v);
  return sector ? { ok: true, region: sector, key: sector } : { ok: false };
}

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Asia/Karachi is UTC+5 all year (no DST).
const DAY_MS = 24 * 60 * 60 * 1000;

function pkMidnightUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - PKT_OFFSET_MS;
}

/**
 * A window of Pakistan days → UTC instants: [from 00:00 PKT, to+1 00:00 PKT).
 * Bounds on the raw column keep every dated read on its created_at index; reading each
 * row's column through a time-zone conversion does not.
 * @param {{from: string|null, to: string|null}} range from analyticsRange (validated)
 */
function windowBounds(range = {}) {
  return {
    fromTs: range.from ? new Date(pkMidnightUtc(range.from)).toISOString() : null,
    toTs: range.to ? new Date(pkMidnightUtc(range.to) + DAY_MS).toISOString() : null,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * One session's overall percentage, read exactly as the principal Analytics page reads
 * it (getOverall), and only when the session was measured against something: an empty
 * or max-less score is "no score", never a zero.
 * @param {object|null} scores analysis_data.scores
 * @returns {number|null}
 */
function sessionPct(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return null;
  const o = getOverall({ scores });
  if (o.percentage == null || !Number.isFinite(o.percentage)) return null;
  if (!Number.isFinite(o.maxPoints) || o.maxPoints <= 0) return null;
  return o.percentage;
}

// ── the pure summariser ──────────────────────────────────────────────────────

const COUNT_FIELDS = Object.freeze([
  'teachers', 'lpsOpened', 'teachersOpenedLp', 'trainingModules', 'teachersTrained',
  'dcObservations', 'teachersWithDc', 'humanObservations', 'ficoN', 'hitlN',
]);

function emptyAcc() {
  const acc = { schools: 0, ficoSum: 0, hitlSum: 0 };
  for (const k of COUNT_FIELDS) acc[k] = 0;
  return acc;
}

function addInto(into, a) {
  for (const k of Object.keys(into)) into[k] += a[k];
  return into;
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The metric block shared by a school row, a region card and the overview — counts and averages only. */
function metrics(a) {
  return {
    teachers: a.teachers,
    lpsOpened: a.lpsOpened,
    teachersOpenedLp: a.teachersOpenedLp,
    trainingModules: a.trainingModules,
    teachersTrained: a.teachersTrained,
    dcObservations: a.dcObservations,
    teachersWithDc: a.teachersWithDc,
    humanObservations: a.humanObservations,
    avgFico: a.ficoN > 0 ? round1(a.ficoSum / a.ficoN) : null,
    ficoN: a.ficoN,
    avgHitl: a.hitlN > 0 ? round1(a.hitlSum / a.hitlN) : null,
    hitlN: a.hitlN,
  };
}

const rollup = (acc) => ({ schools: acc.schools, ...metrics(acc) });

/**
 * @param {{
 *   schools?: Array<{id, name, emis, region, is_active, is_probable_test,
 *                    teachers, lps_opened, teachers_opened_lp,
 *                    training_modules, teachers_trained}>,
 *   sessions?: Array<{school_id, user_id, is_test, observation_type, pct}>
 * }} rows  a school row carries its own roster numbers, test teachers already left out
 *          by the read; a missing number is 0
 * @param {{region?: string|null}} [opts] a bucket name from parseRegionFilter, or null for all
 * @returns {{overview: object, regions: object[], schools: object[]}}
 */
function summarizeSchoolsAnalytics(rows = {}, opts = {}) {
  const filter = opts.region || null;

  // Included schools only: active, not a probable test school, and in one of the six
  // sectors. The roster arrives on the school row; an excluded school is never in
  // bySchool, so its roster and its sessions fall out below.
  const bySchool = new Map();
  for (const s of rows.schools || []) {
    if (!s || s.is_active !== true || s.is_probable_test === true) continue;
    const bucket = bucketOf(s.region);
    if (!bucket) continue;
    const acc = emptyAcc();
    acc.teachers = count(s.teachers);
    acc.lpsOpened = count(s.lps_opened);
    acc.teachersOpenedLp = count(s.teachers_opened_lp);
    // Distinct per teacher, and a teacher belongs to one school: these sum to the region's.
    acc.trainingModules = count(s.training_modules);
    acc.teachersTrained = count(s.teachers_trained);
    bySchool.set(s.id, { school: s, bucket, acc, dcTeacherIds: new Set() });
  }

  // Sessions of test teachers are out, and so is one whose school is not counted.
  for (const s of rows.sessions || []) {
    if (!s || s.is_test === true) continue;
    const entry = bySchool.get(s.school_id);
    if (!entry) continue;
    const pct = typeof s.pct === 'number' && Number.isFinite(s.pct) ? s.pct : null;
    if (s.observation_type === null || s.observation_type === undefined) {
      entry.acc.dcObservations += 1;
      if (s.user_id) entry.dcTeacherIds.add(s.user_id);
      if (pct !== null) { entry.acc.ficoSum += pct; entry.acc.ficoN += 1; }
    } else if (s.observation_type === HUMAN_OBSERVATION) {
      entry.acc.humanObservations += 1;
      if (pct !== null) { entry.acc.hitlSum += pct; entry.acc.hitlN += 1; }
    }
  }

  const regionAcc = new Map(REGION_BUCKETS.map((b) => [b, emptyAcc()]));
  const overviewAcc = emptyAcc();
  const schools = [];

  for (const entry of bySchool.values()) {
    // A teacher belongs to one school, so distinct-per-school sums to distinct-per-region.
    entry.acc.teachersWithDc = entry.dcTeacherIds.size;
    entry.acc.schools = 1;
    addInto(regionAcc.get(entry.bucket), entry.acc);
    if (filter && entry.bucket !== filter) continue;
    addInto(overviewAcc, entry.acc);
    schools.push({
      schoolId: entry.school.id,
      emis: entry.school.emis == null ? null : String(entry.school.emis),
      name: entry.school.name,
      region: entry.bucket,
      ...metrics(entry.acc),
    });
  }

  const order = new Map(REGION_BUCKETS.map((b, i) => [b, i]));
  schools.sort((a, b) => (order.get(a.region) - order.get(b.region))
    || String(a.name || '').localeCompare(String(b.name || '')));

  return {
    overview: rollup(overviewAcc),
    regions: REGION_BUCKETS.map((b) => ({ region: b, ...rollup(regionAcc.get(b)) })),
    schools,
  };
}

// ── the reads ────────────────────────────────────────────────────────────────

/**
 * Per-process memo of session scores, keyed by id and stamped with the row's updated_at.
 * Bounded: past maxEntries it starts again empty rather than growing without limit.
 */
function createScoreMemo({ maxEntries = 200000 } = {}) {
  const map = new Map();
  return {
    get(id, updatedAt) {
      const hit = map.get(id);
      return hit && hit.u === updatedAt ? hit : null;
    },
    set(id, updatedAt, pct) {
      if (map.size >= maxEntries) map.clear();
      map.set(id, { u: updatedAt, pct });
    },
    get size() { return map.size; },
  };
}

const defaultMemo = createScoreMemo();

/** updated_at as a stable string key, whatever the driver handed back. */
function stamp(v) {
  if (v instanceof Date) return v.toISOString();
  return v == null ? '' : String(v);
}

/**
 * `col` (a timestamptz) inside the window, either end open: the UTC instants from
 * windowBounds as $1/$2.
 */
function windowClause(col, ends) {
  const [lo, hi] = ends;
  const parts = [];
  if (lo) parts.push(`${col} >= $1::timestamptz`);
  if (hi) parts.push(`${col} < ${lo ? '$2' : '$1'}::timestamptz`);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

const present = (...xs) => xs.filter(Boolean);

/**
 * Today's roster, the teacher base of every roster number: teachers with a school, test
 * accounts out. One spelling, used by the roster and by training alike.
 */
const ROSTER_TEACHER = `u.role = 'teacher'
         AND u.school_id IS NOT NULL
         AND u.is_test_user IS NOT TRUE`;

function schoolsSql(bounds) {
  // Every school, each with its roster in the same read: today's teachers (test accounts
  // out), their LP opens and their training completions in the window. Opens count
  // DIFFERENT plans per teacher; summed over teachers that is distinct (user, kind, ref).
  // Training counts DIFFERENT modules per teacher, so the sum is distinct (user, module).
  // A school with no teachers still comes back, with zeros.
  //
  // Training is grouped per teacher over the window, then rolled up per school with users
  // reached by primary key (bd-9vkl9x, EXPLAIN ANALYZE on prod, 721,497 rows):
  //   - not a per-teacher LATERAL: with no index on completed_at it walks each teacher's
  //     whole history through (user_id, module_id) — 2.45 s for 1–13 Oct 2026;
  //   - not joined per teacher into the roster: completed_at only grows, so a recent window
  //     always lies past its statistics and is estimated at 1 row, and the planner then
  //     filter-joins every teacher against every trained one (3.2 M comparisons, ~0.7 s);
  //   - this shape: 0.08 s for 1–13 Oct, 0.28 s for all time, the same numbers.
  const ends = [bounds.fromTs, bounds.toTs];
  return `
  SELECT sch.id, sch.name, sch.emis, sch.region, sch.is_active, sch.is_probable_test,
         COALESCE(r.teachers, 0)::int AS teachers,
         COALESCE(r.lps_opened, 0)::int AS lps_opened,
         COALESCE(r.teachers_opened_lp, 0)::int AS teachers_opened_lp,
         COALESCE(trn.training_modules, 0)::int AS training_modules,
         COALESCE(trn.teachers_trained, 0)::int AS teachers_trained
    FROM schools sch
    LEFT JOIN (
      SELECT u.school_id,
             count(*)::int AS teachers,
             COALESCE(sum(op.plans), 0)::int AS lps_opened,
             count(*) FILTER (WHERE op.plans > 0)::int AS teachers_opened_lp
        FROM users u
        LEFT JOIN LATERAL (
          SELECT count(DISTINCT (o.plan_kind, o.plan_ref)) AS plans FROM niete_lp_opens o
           WHERE o.user_id = u.id
             AND ${windowClause('o.opened_at', ends)}
        ) op ON TRUE
       WHERE ${ROSTER_TEACHER}
       GROUP BY u.school_id
    ) r ON r.school_id = sch.id
    LEFT JOIN (
      SELECT u.school_id,
             sum(t.modules)::int AS training_modules,
             count(*)::int AS teachers_trained
        FROM (
          SELECT tp.user_id, count(DISTINCT tp.module_id) AS modules
            FROM teacher_training_progress tp
           WHERE tp.completed_at IS NOT NULL
             AND ${windowClause('tp.completed_at', ends)}
           GROUP BY tp.user_id
        ) t
        JOIN users u ON u.id = t.user_id
       WHERE ${ROSTER_TEACHER}
       GROUP BY u.school_id
    ) trn ON trn.school_id = sch.id`;
}

function sessionsSql(bounds) {
  // One row per counted session — ids and flags only, no analysis_data (see the header).
  return `
  SELECT c.id, c.updated_at, c.user_id, u.school_id,
         (u.is_test_user IS TRUE) AS is_test,
         c.observation_type
    FROM coaching_sessions c
    JOIN users u ON u.id = c.user_id
   WHERE u.role = 'teacher'
     AND u.school_id IS NOT NULL
     AND ((c.observation_type IS NULL AND c.status = 'completed')
          OR (c.observation_type = '${HUMAN_OBSERVATION}' AND c.status IN ${TERMINAL}))
     AND ${windowClause('c.created_at', [bounds.fromTs, bounds.toTs])}`;
}

const SCORES_SQL = `
  SELECT id, updated_at, analysis_data->'scores' AS scores
    FROM coaching_sessions
   WHERE id = ANY($1::uuid[])`;

/**
 * At most three reads: schools (each with its roster, LP opens and training) and counted
 * sessions — in parallel — then the scores of only those sessions the memo does not
 * already hold.
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {{from: string|null, to: string|null}} range
 * @param {{memo?: ReturnType<typeof createScoreMemo>}} [opts]
 * @returns {Promise<{schools: any[], sessions: any[], scoreReads: number}>}
 */
async function loadSchoolsAnalyticsRows(query, range, { memo = defaultMemo } = {}) {
  const bounds = windowBounds(range);
  const instants = present(bounds.fromTs, bounds.toTs);
  const [schoolRes, sessionRes] = await Promise.all([
    query(schoolsSql(bounds), instants),
    query(sessionsSql(bounds), instants),
  ]);

  const sessions = (sessionRes.rows || []).map((r) => ({ ...r, updated_at: stamp(r.updated_at) }));
  const misses = sessions.filter((s) => !memo.get(s.id, s.updated_at)).map((s) => s.id);
  if (misses.length) {
    const scoreRes = await query(SCORES_SQL, [misses]);
    for (const r of scoreRes.rows || []) memo.set(r.id, stamp(r.updated_at), sessionPct(r.scores));
  }

  return {
    schools: schoolRes.rows || [],
    sessions: sessions.map((s) => {
      const hit = memo.get(s.id, s.updated_at);
      return {
        id: s.id,
        school_id: s.school_id,
        user_id: s.user_id,
        is_test: s.is_test === true,
        observation_type: s.observation_type == null ? null : s.observation_type,
        pct: hit ? hit.pct : null,
      };
    }),
    scoreReads: misses.length,
  };
}

/**
 * A small TTL cache for whole responses, with in-flight sharing: two requests for the
 * same key while it is cold share one load instead of each taking a pool connection.
 */
function createResponseCache({ ttlMs = 10 * 60 * 1000, maxEntries = 100, now = () => Date.now() } = {}) {
  const done = new Map();
  const inflight = new Map();
  return {
    async getOrLoad(key, load) {
      const hit = done.get(key);
      if (hit && hit.expires > now()) return hit.value;
      if (hit) done.delete(key);
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        try {
          const value = await load();
          if (done.size >= maxEntries) done.delete(done.keys().next().value);
          done.set(key, { value, expires: now() + ttlMs });
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
    clear() { done.clear(); },
  };
}

module.exports = {
  LP_OPENS_LOGGED_SINCE,
  REGION_BUCKETS,
  parseRegionFilter,
  windowBounds,
  sessionPct,
  summarizeSchoolsAnalytics,
  createScoreMemo,
  loadSchoolsAnalyticsRows,
  createResponseCache,
};
