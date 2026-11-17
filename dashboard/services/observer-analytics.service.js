/**
 * bd-97daxo.33 — observers analytics: a non-FDE view's (Moawin's Gilgit-Baltistan's) human observations by WHO
 * observed WHOM, scored on FICO17 v6. GET /api/portal/analytics/observers; FDE's view does not have it (404), and no
 * FDE read or answer changes for it.
 *
 * Why (Moawin's head office, 17 Nov; the operator approved the plan the same evening): in Gilgit-Baltistan principals are the
 * main observers and FMOs the second; every FINISHED observation counts, whoever was observed; each school shows who
 * observed whom; GB has scored human visits on FICO17 v6 since 11 Nov (every grade, #156), so v6 is the main score and
 * the V3 visits and the HOTS visits copied from old Rumi stay out of it. Names: FMOs by name, principals by role only,
 * teachers never (operator, 17 Nov).
 *
 * Two halves, the schools service's contract style:
 *
 *   loadObserverAnalyticsRows(query, range, {regions})  three set-based reads narrowed to the view's regions (its
 *                                                       schools, their roster, the visits), then one score read of
 *                                                       the finished visits only. No per-school loop.
 *   summarizeObserverAnalytics(rows, opts)              PURE: rows in, response shape out.
 *
 * Definitions (window = Pakistan days by the visit's created_at, both ends inclusive, either end open):
 *   school            active, not a probable test, in one of opts.regions — the route hands rows whose `region` is
 *                     already the AREA (lib/analytics-areas placeSchools), so the buckets are Gilgit / Baltistan.
 *   observation       coaching_sessions observation_type 'leader_observation', status TERMINAL (completed or
 *                     observer_review_complete), of a user whose role is teacher OR principal at a counted school.
 *                     A test observed user, or a test observer (QA accounts), is out. Unlike /analytics/schools'
 *                     human observations, a visit that observed a principal counts.
 *   byObserver        the observer's users.role: principal → principal, coach → fmo (Moawin's FMOs hold the coach
 *                     role), anything else → other (counted, never dropped).
 *   pairs             observer kind × observed role (teacher / principal).
 *   observers         distinct observers of each kind.
 *   teachersObserved / principalsObserved   distinct observed users of each role; teachers / principals = today's
 *                     roster at the counted schools (live, not test, not a merged account — the schools roster rule).
 *   v6                FICO17 v6 visits (scores.rubric or framework 'fico17_v6'): avg = mean of each visit's own
 *                     overall_percentage (each out of its own maximum), and sections C / D / F (domains v6_teacher /
 *                     v6_children / v6_subject, domain_score ÷ domain_max per visit, then the mean). n with each.
 *   v3                FICO V3 visits (framework fico or none, a V3 overall score): their mean, beside, never mixed in.
 *   hots              visits scored on HOTS (copied from old Rumi): counted, no score.
 *   fde612            visits on FDE's grade 6-8 tools (obs612-*: GB visits before #156 moved GB back to v6): counted,
 *                     no score.
 *   unscored          any other finished visit with no score of these.
 *   awaitingReview    visits in the window still awaiting the observer's review, by observer kind: not observations.
 *   areasActive       (overview) areas with at least one observation.
 *   visits            (school rows) each observation: Pakistan day, observer kind, the FMO's name (else null),
 *                     observed role, rubric (v6 / v3 / hots / fde612 / other) and the visit's v6 or V3 % (else null).
 * Counts sum from school to area to overview; distinct sets are distinct at each level; an average is null exactly when
 * its n is 0. The filter (opts.region, an area) scopes the overview and the schools; the area list always has them all.
 * No user id leaves the server.
 */

const { windowBounds, sessionPct, countedSchoolBucket } = require('./schools-analytics.service');
const { ownRubricOf } = require('./coaching-frameworks.service');
// Imported, never respelled: two spellings of "finished" is how observations went missing once.
const { TERMINAL } = require('./leader-patch.service');
const { HUMAN_OBSERVATION } = require('./steps-grid.service');

const AWAITING = 'awaiting_observer_review';
const V6 = 'fico17_v6';
const V6_SECTIONS = Object.freeze({ c: 'v6_teacher', d: 'v6_children', f: 'v6_subject' });
const OBSERVER_KIND = Object.freeze({ principal: 'principal', coach: 'fmo' });
const OBSERVED = Object.freeze(['teacher', 'principal']);
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Asia/Karachi is UTC+5 all year.

const round1 = (n) => Math.round(n * 10) / 10;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const nameOf = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const kindOf = (role) => OBSERVER_KIND[role] || 'other';

/** The Pakistan day of an instant, YYYY-MM-DD. */
function pkDay(ts) {
  const t = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return new Date(t + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * A finished visit's rubric and score: v6 (with its C / D / F), v3, hots, fde612 or other.
 * @param {{framework?: string|null}} s the visit
 * @param {object|undefined} row its score row (scores + the six v6 section columns)
 */
function scoreOf(s, row) {
  const scores = row && row.scores && typeof row.scores === 'object' && !Array.isArray(row.scores) ? row.scores : null;
  const own = ownRubricOf({ framework: s.framework, scores });
  if (own === V6) {
    const pct = scores ? num(scores.overall_percentage) : NaN;
    const sections = {};
    for (const k of Object.keys(V6_SECTIONS)) {
      const score = num(row && row[`${k}_score`]);
      const max = num(row && row[`${k}_max`]);
      sections[k] = Number.isFinite(score) && Number.isFinite(max) && max > 0 ? (score / max) * 100 : null;
    }
    return { rubric: 'v6', pct: Number.isFinite(pct) ? pct : null, sections };
  }
  if (own) return { rubric: 'fde612', pct: null };
  if (s.framework === 'hots') return { rubric: 'hots', pct: null };
  const fico = s.framework === null || s.framework === undefined || s.framework === 'fico';
  const pct = fico && scores ? sessionPct(scores) : null;
  return pct === null ? { rubric: 'other', pct: null } : { rubric: 'v3', pct };
}

function emptyAcc() {
  return {
    observations: 0,
    byObserver: { principal: 0, fmo: 0, other: 0 },
    pairs: { principalTeacher: 0, principalPrincipal: 0, fmoTeacher: 0, fmoPrincipal: 0, otherTeacher: 0, otherPrincipal: 0 },
    observers: { principal: new Set(), fmo: new Set() },
    teachersObserved: new Set(),
    principalsObserved: new Set(),
    teachers: 0,
    principals: 0,
    v6: [0, 0],
    v6s: { c: [0, 0], d: [0, 0], f: [0, 0] },
    v3: [0, 0],
    hots: 0,
    fde612: 0,
    unscored: 0,
    awaitingReview: { principal: 0, fmo: 0, other: 0 },
  };
}

const pairKey = (observer, observed) => `${observer}${observed === 'teacher' ? 'Teacher' : 'Principal'}`;

function addVisit(acc, v) {
  acc.observations += 1;
  acc.byObserver[v.observer] += 1;
  acc.pairs[pairKey(v.observer, v.observed)] += 1;
  if (v.observerId && acc.observers[v.observer]) acc.observers[v.observer].add(v.observerId);
  (v.observed === 'teacher' ? acc.teachersObserved : acc.principalsObserved).add(v.observedId);
  const sc = v.score;
  if (sc.rubric === 'v6') {
    if (sc.pct !== null) { acc.v6[0] += sc.pct; acc.v6[1] += 1; }
    for (const k of Object.keys(V6_SECTIONS)) {
      if (sc.sections[k] !== null) { acc.v6s[k][0] += sc.sections[k]; acc.v6s[k][1] += 1; }
    }
  } else if (sc.rubric === 'v3') {
    acc.v3[0] += sc.pct; acc.v3[1] += 1;
  } else if (sc.rubric === 'hots') acc.hots += 1;
  else if (sc.rubric === 'fde612') acc.fde612 += 1;
  else acc.unscored += 1;
}

function mergeInto(into, a) {
  into.observations += a.observations;
  for (const k of Object.keys(into.byObserver)) into.byObserver[k] += a.byObserver[k];
  for (const k of Object.keys(into.pairs)) into.pairs[k] += a.pairs[k];
  for (const k of Object.keys(into.observers)) for (const id of a.observers[k]) into.observers[k].add(id);
  for (const id of a.teachersObserved) into.teachersObserved.add(id);
  for (const id of a.principalsObserved) into.principalsObserved.add(id);
  into.teachers += a.teachers;
  into.principals += a.principals;
  into.v6[0] += a.v6[0]; into.v6[1] += a.v6[1];
  for (const k of Object.keys(V6_SECTIONS)) { into.v6s[k][0] += a.v6s[k][0]; into.v6s[k][1] += a.v6s[k][1]; }
  into.v3[0] += a.v3[0]; into.v3[1] += a.v3[1];
  into.hots += a.hots;
  into.fde612 += a.fde612;
  into.unscored += a.unscored;
  for (const k of Object.keys(into.awaitingReview)) into.awaitingReview[k] += a.awaitingReview[k];
}

const mean = ([sum, n]) => ({ avg: n > 0 ? round1(sum / n) : null, n });

/** The block a school row, an area card and the overview share. */
function metrics(a) {
  return {
    observations: a.observations,
    byObserver: { ...a.byObserver },
    pairs: { ...a.pairs },
    observers: { principal: a.observers.principal.size, fmo: a.observers.fmo.size },
    teachersObserved: a.teachersObserved.size,
    principalsObserved: a.principalsObserved.size,
    teachers: a.teachers,
    principals: a.principals,
    v6: { ...mean(a.v6), sections: { c: mean(a.v6s.c), d: mean(a.v6s.d), f: mean(a.v6s.f) } },
    v3: mean(a.v3),
    hots: a.hots,
    fde612: a.fde612,
    unscored: a.unscored,
    awaitingReview: { ...a.awaitingReview },
  };
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * @param {{schools?: object[], roster?: Array<{school_id, teachers, principals}>, sessions?: object[],
 *          scores?: Map<string, object>}} rows schools placed by area (region = the area, district added)
 * @param {{region?: string|null, regions?: readonly string[]}} [opts] regions: the view's buckets (its areas)
 * @returns {{overview: object, regions: object[], schools: object[]}}
 */
function summarizeObserverAnalytics(rows = {}, opts = {}) {
  const src = rows || {};
  const filter = opts.region || null;
  const buckets = opts.regions || [];
  const scores = src.scores instanceof Map ? src.scores : new Map();

  const bySchool = new Map();
  for (const s of src.schools || []) {
    const bucket = countedSchoolBucket(s, null, buckets);
    if (!bucket) continue;
    bySchool.set(s.id, { school: s, bucket, acc: emptyAcc(), visits: [] });
  }
  for (const r of src.roster || []) {
    const e = r && bySchool.get(r.school_id);
    if (!e) continue;
    e.acc.teachers += count(r.teachers);
    e.acc.principals += count(r.principals);
  }

  const sorted = [...(src.sessions || [])].filter(Boolean)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  for (const s of sorted) {
    const e = bySchool.get(s.school_id);
    if (!e || s.observed_test === true || s.observer_test === true || !OBSERVED.includes(s.observed_role)) continue;
    const observer = kindOf(s.observer_role);
    if (s.status === AWAITING) { e.acc.awaitingReview[observer] += 1; continue; }
    const v = {
      observer,
      observerId: s.observer_user_id || null,
      observed: s.observed_role,
      observedId: s.user_id,
      score: scoreOf(s, scores.get(s.id)),
    };
    addVisit(e.acc, v);
    e.visits.push({
      date: pkDay(s.created_at),
      observer,
      observerName: observer === 'fmo' ? (nameOf(s.observer_name) || null) : null,
      observed: v.observed,
      rubric: v.score.rubric,
      pct: v.score.pct === null ? null : round1(v.score.pct),
    });
  }

  const areaAcc = new Map(buckets.map((b) => [b, { schools: 0, acc: emptyAcc() }]));
  const overview = { schools: 0, acc: emptyAcc() };
  const schools = [];
  const order = new Map(buckets.map((b, i) => [b, i]));
  const entries = [...bySchool.values()].sort((a, b) => (order.get(a.bucket) - order.get(b.bucket))
    || String(a.school.name || '').localeCompare(String(b.school.name || '')));
  for (const e of entries) {
    const area = areaAcc.get(e.bucket);
    area.schools += 1;
    mergeInto(area.acc, e.acc);
    if (filter && e.bucket !== filter) continue;
    overview.schools += 1;
    mergeInto(overview.acc, e.acc);
    schools.push({
      schoolId: e.school.id,
      emis: e.school.emis == null ? null : String(e.school.emis),
      name: e.school.name,
      region: e.bucket,
      district: typeof e.school.district === 'string' ? e.school.district : null,
      ...metrics(e.acc),
      visits: e.visits,
    });
  }
  const regions = buckets.map((b) => ({ region: b, schools: areaAcc.get(b).schools, ...metrics(areaAcc.get(b).acc) }));
  const areasActive = regions.filter((r) => (!filter || r.region === filter) && r.observations > 0).length;
  return {
    overview: { schools: overview.schools, ...metrics(overview.acc), areasActive },
    regions,
    schools,
  };
}

// ── the reads ────────────────────────────────────────────────────────────────

/** `col` (a timestamptz) inside the window's UTC instants, $1 / $2; either end open. */
function windowClause(col, bounds) {
  const parts = [];
  if (bounds.fromTs) parts.push(`${col} >= $1::timestamptz`);
  if (bounds.toTs) parts.push(`${col} < ${bounds.fromTs ? '$2' : '$1'}::timestamptz`);
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

const SCHOOLS_SQL = `
  SELECT id, name, emis, region, is_active, is_probable_test
    FROM schools
   WHERE region = ANY($1::text[])`;

// Today's teachers and principals per school: live, not a test account, not a merged spare (the schools roster rule).
const ROSTER_SQL = `
  SELECT u.school_id,
         count(*) FILTER (WHERE u.role = 'teacher')::int AS teachers,
         count(*) FILTER (WHERE u.role = 'principal')::int AS principals
    FROM users u
   WHERE u.role IN ('teacher', 'principal')
     AND u.school_id IN (SELECT id FROM schools WHERE region = ANY($1::text[]))
     AND u.is_test_user IS NOT TRUE
     AND u.deleted_at IS NULL
     AND COALESCE(u.phone_number, '') NOT LIKE 'merged%'
   GROUP BY u.school_id`;

/** One row per visit in the window — ids, roles and flags only, no analysis_data. The FMO's name only for a coach. */
function sessionsSql(bounds, regionParam) {
  return `
  SELECT c.id, c.user_id, u.school_id,
         u.role AS observed_role, (u.is_test_user IS TRUE) AS observed_test,
         c.observer_user_id, ou.role AS observer_role, (ou.is_test_user IS TRUE) AS observer_test,
         CASE WHEN ou.role = 'coach' THEN ou.name END AS observer_name,
         c.status, c.framework, c.created_at
    FROM coaching_sessions c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN users ou ON ou.id = c.observer_user_id
   WHERE c.observation_type = '${HUMAN_OBSERVATION}'
     AND u.role IN ('teacher', 'principal')
     AND (c.status IN ${TERMINAL} OR c.status = '${AWAITING}')
     AND ${windowClause('c.created_at', bounds)}
     AND u.school_id IN (SELECT id FROM schools WHERE region = ANY(${regionParam}::text[]))`;
}

// Each finished visit's scores and its three v6 sections, from ONE read of analysis_data (detoasted once below the
// OFFSET 0, as schools-analytics' score read): six plain columns, never the domains object with its indicators.
const V6_COLUMNS = Object.entries(V6_SECTIONS).flatMap(([k, key]) => [
  `s.a #>> '{domains,${key},domain_score}'::text[] AS ${k}_score`,
  `s.a #>> '{domains,${key},domain_max}'::text[] AS ${k}_max`,
]);
const SCORES_SQL = `
  SELECT s.id, s.a -> 'scores' AS scores,
         ${V6_COLUMNS.join(',\n         ')}
    FROM (SELECT id, analysis_data #> '{}'::text[] AS a
            FROM coaching_sessions
           WHERE id = ANY($1::uuid[])
          OFFSET 0) s`;

/**
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {{from: string|null, to: string|null}} range from analyticsRange (validated)
 * @param {{regions: string[]}} opts the view's regions (schools.region): every read is narrowed to them
 * @returns {Promise<{schools: object[], roster: object[], sessions: object[], scores: Map<string, object>}>}
 */
async function loadObserverAnalyticsRows(query, range = {}, { regions } = {}) {
  if (!Array.isArray(regions) || regions.length === 0) throw new Error('observer analytics needs the view\'s regions');
  const bounds = windowBounds(range || {});
  const instants = [bounds.fromTs, bounds.toTs].filter(Boolean);
  const [schoolRes, rosterRes, sessionRes] = await Promise.all([
    query(SCHOOLS_SQL, [regions]),
    query(ROSTER_SQL, [regions]),
    query(sessionsSql(bounds, `$${instants.length + 1}`), [...instants, regions]),
  ]);
  const sessions = sessionRes.rows || [];
  const finished = sessions.filter((s) => s && s.status !== AWAITING).map((s) => s.id);
  const scores = new Map();
  if (finished.length) {
    const scoreRes = await query(SCORES_SQL, [finished]);
    for (const r of scoreRes.rows || []) scores.set(r.id, r);
  }
  return { schools: schoolRes.rows || [], roster: rosterRes.rows || [], sessions, scores };
}

module.exports = {
  summarizeObserverAnalytics,
  loadObserverAnalyticsRows,
  pkDay,
};
