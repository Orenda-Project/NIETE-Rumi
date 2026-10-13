/**
 * School-wise analytics across every region, for the analytics-only accounts (federal and
 * sector officials). One page, filterable by region: per school, how many teachers made a
 * lesson plan, how many used the Digital Coach, how many observations of each kind, and
 * the average FICO (Digital Coach) and HITL (human observation) score.
 *
 * Two halves, same contract style as school-analytics.service:
 *
 *   loadSchoolsAnalyticsRows(query, range)  three set-based reads (+ one score read), no
 *                                           per-school loop — portal outages have been
 *                                           pool exhaustion, so the cost must not grow
 *                                           with the number of schools.
 *   summarizeSchoolsAnalytics(rows, opts)   PURE: rows in, response shape out.
 *
 * WHY THE SCORES ARE MEMOISED. The overall score lives only inside
 * coaching_sessions.analysis_data, a ~23 KB (compressed, out-of-line) JSONB per session.
 * Reading it for one month of sessions measured 9.2 s cold and 0.76 s warm on NIETE prod
 * (2026-10-13, 4,404 sessions), against 0.03 s for the same rows without it. A terminal
 * session's score rarely changes, and when it does its updated_at moves (a BEFORE UPDATE
 * trigger maintains it), so each process remembers {updated_at, pct} per session id and
 * only reads the score of a session it has not seen in that state.
 *
 * Definitions (window = Pakistan days, both ends inclusive, either end open):
 *   school    schools.is_active and not is_probable_test. A region that is not one of the
 *             six sectors (NULL, blank, or anything else) is "Unassigned".
 *   teacher   users.role = 'teacher' with that school_id, not is_test_user.
 *   LP eng.   teachers with >= 1 lesson_plans row in the window / teachers.
 *   DC eng.   teachers with >= 1 completed Digital Coach session in the window / teachers.
 *   DC        coaching_sessions.observation_type IS NULL and status = 'completed'.
 *   human     observation_type = 'leader_observation' and status terminal (TERMINAL).
 *   FICO      mean overall percentage over scored DC sessions.
 *   HITL      mean overall percentage over scored human observations. That is the score
 *             AFTER the observer's review: applying her edits re-scores analysis_data
 *             (the AI draft is kept separately in autofill_analysis_data), and a field-form
 *             visit is scored from the observer's own levels.
 * Region and overview figures are POOLED over teachers and sessions — a 3-teacher school
 * never weighs the same as a 40-teacher one. No denominator means null, never 0.
 */

const { getOverall } = require('./coaching-frameworks.service');
const { HUMAN_OBSERVATION } = require('./steps-grid.service');
// Imported, never respelled: two spellings of "finished" is how observations went missing once.
const { TERMINAL } = require('./leader-patch.service');

/** The six ICT sectors as schools.region stores them, then everything else. */
const SECTORS = Object.freeze(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
const UNASSIGNED = 'Unassigned';
const REGION_BUCKETS = Object.freeze([...SECTORS, UNASSIGNED]);

const SECTOR_BY_LOWER = new Map(SECTORS.map((s) => [s.toLowerCase(), s]));

/** schools.region → its bucket. */
function bucketOf(region) {
  if (typeof region !== 'string') return UNASSIGNED;
  return SECTOR_BY_LOWER.get(region.trim().toLowerCase()) || UNASSIGNED;
}

/**
 * The ?region= filter. Blank or "all" is every region; a sector or "unassigned" in any
 * case is that bucket; anything else is refused rather than guessed at.
 * @returns {{ok: true, region: string|null, key: string} | {ok: false}}
 */
function parseRegionFilter(raw) {
  if (raw === undefined || raw === null) return { ok: true, region: null, key: 'all' };
  if (typeof raw !== 'string') return { ok: false };
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'all') return { ok: true, region: null, key: 'all' };
  if (v === UNASSIGNED.toLowerCase()) return { ok: true, region: UNASSIGNED, key: UNASSIGNED };
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

function emptyAcc() {
  return {
    schools: 0, teachers: 0, lpTeachers: 0, dcTeachers: 0,
    dcSessions: 0, humanObservations: 0, ficoSum: 0, ficoN: 0, hitlSum: 0, hitlN: 0,
  };
}

function addInto(into, a) {
  for (const k of Object.keys(into)) into[k] += a[k];
  return into;
}

/** The metric block shared by a school row, a region card and the overview. */
function metrics(a) {
  return {
    teachers: a.teachers,
    lpEngagementPct: a.teachers > 0 ? round1((a.lpTeachers / a.teachers) * 100) : null,
    dcEngagementPct: a.teachers > 0 ? round1((a.dcTeachers / a.teachers) * 100) : null,
    dcSessions: a.dcSessions,
    humanObservations: a.humanObservations,
    avgFico: a.ficoN > 0 ? round1(a.ficoSum / a.ficoN) : null,
    avgHitl: a.hitlN > 0 ? round1(a.hitlSum / a.hitlN) : null,
    ficoN: a.ficoN,
    hitlN: a.hitlN,
  };
}

function rollup(acc) {
  const { teachers, ...rest } = metrics(acc);
  return { schools: acc.schools, teachers, ...rest };
}

/**
 * @param {{
 *   schools?: Array<{id, name, emis, region, is_active, is_probable_test}>,
 *   teachers?: Array<{school_id, is_test, teachers, lp_teachers}>,
 *   sessions?: Array<{school_id, user_id, is_test, observation_type, pct}>
 * }} rows
 * @param {{region?: string|null}} [opts] a bucket name from parseRegionFilter, or null for all
 * @returns {{overview: object, regions: object[], schools: object[]}}
 */
function summarizeSchoolsAnalytics(rows = {}, opts = {}) {
  const filter = opts.region || null;

  // Included schools only: active and not a probable test school.
  const bySchool = new Map();
  for (const s of rows.schools || []) {
    if (!s || s.is_active !== true || s.is_probable_test === true) continue;
    bySchool.set(s.id, { school: s, bucket: bucketOf(s.region), acc: emptyAcc(), dcTeacherIds: new Set() });
  }

  for (const t of rows.teachers || []) {
    if (!t || t.is_test === true) continue;
    const entry = bySchool.get(t.school_id);
    if (!entry) continue; // a test/inactive school, or a school_id that names no school
    entry.acc.teachers += Number(t.teachers) || 0;
    entry.acc.lpTeachers += Number(t.lp_teachers) || 0;
  }

  for (const s of rows.sessions || []) {
    if (!s || s.is_test === true) continue;
    const entry = bySchool.get(s.school_id);
    if (!entry) continue;
    const pct = typeof s.pct === 'number' && Number.isFinite(s.pct) ? s.pct : null;
    if (s.observation_type === null || s.observation_type === undefined) {
      entry.acc.dcSessions += 1;
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
    entry.acc.dcTeachers = entry.dcTeacherIds.size;
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

/** `col` inside the window; $1/$2 are timestamptz instants. `naiveUtc` for a timestamp-without-zone column stored in UTC. */
function windowClause(col, bounds, { naiveUtc = false } = {}) {
  const cast = (p) => (naiveUtc ? `(${p}::timestamptz AT TIME ZONE 'UTC')` : `${p}::timestamptz`);
  const parts = [];
  if (bounds.fromTs) parts.push(`${col} >= ${cast('$1')}`);
  if (bounds.toTs) parts.push(`${col} < ${cast(bounds.fromTs ? '$2' : '$1')}`);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function windowParams(bounds) {
  return [bounds.fromTs, bounds.toTs].filter(Boolean);
}

const SCHOOLS_SQL = `
  SELECT id, name, emis, region, is_active, is_probable_test
    FROM schools`;

function teachersSql(bounds) {
  // One row per (school, test flag). lesson_plans.created_at is a timestamp WITHOUT time
  // zone holding UTC, so the instants are converted to UTC wall time for the comparison.
  return `
  SELECT u.school_id,
         (u.is_test_user IS TRUE) AS is_test,
         count(*)::int AS teachers,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM lesson_plans l
            WHERE l.user_id = u.id
              AND ${windowClause('l.created_at', bounds, { naiveUtc: true })}
         ))::int AS lp_teachers
    FROM users u
   WHERE u.role = 'teacher'
     AND u.school_id IS NOT NULL
   GROUP BY u.school_id, (u.is_test_user IS TRUE)`;
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
     AND ${windowClause('c.created_at', bounds)}`;
}

const SCORES_SQL = `
  SELECT id, updated_at, analysis_data->'scores' AS scores
    FROM coaching_sessions
   WHERE id = ANY($1::uuid[])`;

/**
 * At most four reads: schools, teachers (with LP engagement), counted sessions — in
 * parallel — then the scores of only those sessions the memo does not already hold.
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {{from: string|null, to: string|null}} range
 * @param {{memo?: ReturnType<typeof createScoreMemo>}} [opts]
 * @returns {Promise<{schools: any[], teachers: any[], sessions: any[], scoreReads: number}>}
 */
async function loadSchoolsAnalyticsRows(query, range, { memo = defaultMemo } = {}) {
  const bounds = windowBounds(range);
  const params = windowParams(bounds);
  const [schoolRes, teacherRes, sessionRes] = await Promise.all([
    query(SCHOOLS_SQL, []),
    query(teachersSql(bounds), params),
    query(sessionsSql(bounds), params),
  ]);

  const sessions = (sessionRes.rows || []).map((r) => ({ ...r, updated_at: stamp(r.updated_at) }));
  const misses = sessions.filter((s) => !memo.get(s.id, s.updated_at)).map((s) => s.id);
  if (misses.length) {
    const scoreRes = await query(SCORES_SQL, [misses]);
    for (const r of scoreRes.rows || []) memo.set(r.id, stamp(r.updated_at), sessionPct(r.scores));
  }

  return {
    schools: schoolRes.rows || [],
    teachers: teacherRes.rows || [],
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
  REGION_BUCKETS,
  SECTORS,
  UNASSIGNED,
  bucketOf,
  parseRegionFilter,
  windowBounds,
  sessionPct,
  summarizeSchoolsAnalytics,
  createScoreMemo,
  loadSchoolsAnalyticsRows,
  createResponseCache,
};
