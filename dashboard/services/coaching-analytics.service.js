/**
 * Coaching analytics for the analytics-only accounts — the schools-analytics v6 Coaching tab
 * (bd-97x22y.1, PLAN v6 §3). Its own endpoint, GET /api/portal/analytics/coaching, so the
 * tab's cost never slows the others. Same accounts, window, regions and school rule as
 * schools-analytics.service, whose helpers it reuses rather than respells.
 *
 * Two halves, the schools service's contract style:
 *
 *   loadCoachingAnalyticsRows(query, range)  two set-based reads, in parallel, no
 *                                            per-school loop (portal outages have been pool
 *                                            exhaustion): schools with their coach visits,
 *                                            and (coach, school) assignment pairs.
 *   summarizeCoachingAnalytics(rows, opts)   PURE: rows in, response shape out.
 *
 * Definitions (window = Pakistan days, both ends inclusive, either end open):
 *   school          schools.is_active and not is_probable_test, and schools.region one of the
 *                   six sectors — the /analytics/schools rule (bd-s6qbts.4). Any other school
 *                   is in no row, no card, no total, and neither are its visits or coaches.
 *   coachVisits     observation_schedules with status 'done', dated by scheduled_for (a DATE —
 *                   the visit's own Pakistan day; an after-the-fact visit is recorded with the
 *                   day it happened), matched to a school by school_id, else by school_ext_id =
 *                   'niete:' || emis (every done row on prod carries only the ext id, 2026-10-14).
 *                   EMIS is unique, so a visit resolves to at most one school; one that
 *                   resolves to none (12 on prod) is not counted. The v3 rule (PR #2196).
 *   coaches         users.role 'coach', not is_test_user, with at least one leader_schools
 *                   school in the region — matched by school_id OR 'niete:' || emis, the join
 *                   leader-patch.service builds a coach's roster with. NOT window-dependent
 *                   ("coaches assigned"). A coach covering two regions counts in both region
 *                   cards; the overview counts distinct coaches.
 *   schoolsVisited  distinct counted schools with at least one counted visit.
 * Visits and schools visited SUM from school to region to overview; coaches do not (a coach
 * is one person in many places), so they are counted as distinct sets at each level. Counts
 * are never null. No coach or teacher identity leaves the server.
 */

const {
  REGION_BUCKETS,
  bucketOf,
} = require('./schools-analytics.service');

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The school's sector when it is counted (active, not a probable test, in the six), else null. */
function countedBucket(s) {
  if (!s || s.is_active !== true || s.is_probable_test === true) return null;
  return bucketOf(s.region);
}

// ── the pure summariser ──────────────────────────────────────────────────────

/**
 * @param {{
 *   schools?: Array<{id, name, emis, region, is_active, is_probable_test, coach_visits}>,
 *   coachSchools?: Array<{coach_id, school_id}>
 * }} rows  coachSchools already holds only non-test coaches; a missing number is 0
 * @param {{region?: string|null}} [opts] a bucket name from parseRegionFilter, or null for all
 * @returns {{overview: object, regions: object[], schools: object[]}}
 */
function summarizeCoachingAnalytics(rows = {}, opts = {}) {
  const filter = opts.region || null;
  const src = rows || {};

  const bucketBySchool = new Map();
  const regionAcc = new Map(REGION_BUCKETS.map((b) => [b, { coaches: new Set(), coachVisits: 0, schoolsVisited: 0 }]));
  const schools = [];

  for (const s of src.schools || []) {
    const bucket = countedBucket(s);
    if (!bucket) continue;
    bucketBySchool.set(s.id, bucket);
    const visits = count(s.coach_visits);
    const acc = regionAcc.get(bucket);
    acc.coachVisits += visits;
    if (visits > 0) acc.schoolsVisited += 1;
    if (filter && bucket !== filter) continue;
    schools.push({
      schoolId: s.id,
      emis: s.emis == null ? null : String(s.emis),
      name: s.name,
      region: bucket,
      coachVisits: visits,
    });
  }

  // A coach is counted where her counted schools are; a pair naming any other school is out.
  const overviewCoaches = new Set();
  for (const p of src.coachSchools || []) {
    if (!p || p.coach_id == null) continue;
    const bucket = bucketBySchool.get(p.school_id);
    if (!bucket) continue;
    regionAcc.get(bucket).coaches.add(p.coach_id);
    if (!filter || bucket === filter) overviewCoaches.add(p.coach_id);
  }

  const order = new Map(REGION_BUCKETS.map((b, i) => [b, i]));
  schools.sort((a, b) => (order.get(a.region) - order.get(b.region))
    || String(a.name || '').localeCompare(String(b.name || '')));

  const regions = REGION_BUCKETS.map((b) => {
    const acc = regionAcc.get(b);
    return { region: b, coaches: acc.coaches.size, coachVisits: acc.coachVisits, schoolsVisited: acc.schoolsVisited };
  });
  const inScope = regions.filter((r) => !filter || r.region === filter);

  return {
    overview: {
      coaches: overviewCoaches.size,
      coachVisits: inScope.reduce((n, r) => n + r.coachVisits, 0),
      schoolsVisited: inScope.reduce((n, r) => n + r.schoolsVisited, 0),
    },
    regions,
    schools,
  };
}

// ── the reads ────────────────────────────────────────────────────────────────

/**
 * `col` (a DATE column) inside the window's Pakistan days, both ends inclusive, either end
 * open: the days themselves as $1/$2 — a date column needs no instants (contrast
 * schools-analytics windowBounds, which is for timestamptz columns).
 */
function dateWindowClause(col, range) {
  const parts = [];
  if (range.from) parts.push(`${col} >= $1::date`);
  if (range.to) parts.push(`${col} <= ${range.from ? '$2' : '$1'}::date`);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function schoolsSql(range) {
  // Every school, with its coach visits in the window — the shape PR #2196 measured on prod.
  // A visit names its school by school_id or (every done row on prod) only by school_ext_id
  // 'niete:<emis>'. A visit resolving to no school groups under NULL and joins to nothing.
  return `
  SELECT sch.id, sch.name, sch.emis, sch.region, sch.is_active, sch.is_probable_test,
         COALESCE(v.coach_visits, 0)::int AS coach_visits
    FROM schools sch
    LEFT JOIN (
      SELECT COALESCE(s.school_id, byemis.id) AS school_id, count(*)::int AS coach_visits
        FROM observation_schedules s
        LEFT JOIN schools byemis
          ON s.school_id IS NULL AND byemis.emis IS NOT NULL AND s.school_ext_id = 'niete:' || byemis.emis
       WHERE s.status = 'done'
         AND ${dateWindowClause('s.scheduled_for', range)}
       GROUP BY 1
    ) v ON v.school_id = sch.id`;
}

// Which schools each non-test coach covers — one row per (coach, school). The match is
// leader-patch.service's PATCH_TEACHERS_SQL join, `lsch.school_id = sch.id OR 'niete:' ||
// sch.emis = lsch.school_ext_id`, written as the UNION of its two equi-joins: the OR made the
// planner recheck every school for each assignment (91 ms on prod); the UNION is two hash
// joins (4.5 ms) and returned the same 469 pairs (2026-10-14). UNION, not UNION ALL, also
// de-duplicates a school matched both ways or by two of a coach's ext ids. No window:
// coaches are "assigned", not active.
const COACH_WHERE = `u.role = 'coach'
     AND u.is_test_user IS NOT TRUE`;
const COACH_SCHOOLS_SQL = `
  SELECT lsch.leader_user_id AS coach_id, sch.id AS school_id
    FROM leader_schools lsch
    JOIN users u ON u.id = lsch.leader_user_id
    JOIN schools sch ON sch.id = lsch.school_id
   WHERE ${COACH_WHERE}
  UNION
  SELECT lsch.leader_user_id AS coach_id, sch.id AS school_id
    FROM leader_schools lsch
    JOIN users u ON u.id = lsch.leader_user_id
    JOIN schools sch ON 'niete:' || sch.emis = lsch.school_ext_id
   WHERE ${COACH_WHERE}`;

/**
 * Two reads in parallel: schools with their coach visits, and coach-school pairs.
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {{from: string|null, to: string|null}} range from analyticsRange (validated YYYY-MM-DD or null)
 * @returns {Promise<{schools: any[], coachSchools: any[]}>}
 */
async function loadCoachingAnalyticsRows(query, range = {}) {
  const r = { from: range.from || null, to: range.to || null };
  const days = [r.from, r.to].filter(Boolean);
  const [schoolRes, coachRes] = await Promise.all([
    query(schoolsSql(r), days),
    query(COACH_SCHOOLS_SQL, []),
  ]);
  return { schools: schoolRes.rows || [], coachSchools: coachRes.rows || [] };
}

module.exports = {
  REGION_BUCKETS,
  summarizeCoachingAnalytics,
  loadCoachingAnalyticsRows,
};
