/**
 * Observations analytics for the analytics-only accounts — the schools-analytics v7 Observations
 * tab (bd-97x22y.5, PLAN v7 "Observations"): the ICT dashboard's Observations tab, 1 to 1, for
 * Human and Digital Coach observations. Its own endpoint, GET /api/portal/analytics/observations,
 * so /analytics/schools keeps its answer exactly; same accounts, window, regions and school rule
 * as that route, whose helpers (and per-session score memo) it reuses rather than respells.
 *
 * Two halves, the schools service's contract style:
 *
 *   loadObservationsAnalyticsRows(query, range)  two set-based reads, no per-school loop: the
 *                                                schools (no roster), and the counted sessions
 *                                                with their FICO sections from the SHARED memo —
 *                                                analysis_data is read at most once per session
 *                                                per process for both routes.
 *   summarizeObservationsAnalytics(rows, opts)   PURE: rows in, response shape out.
 *
 * Her metrics and their NIETE source (her code: views.py ObservationsView ~2082 and
 * DigitalCoachView ~2629; sync_observations.py:38-41, 102-162; Observations.jsx):
 *   observations      counted sessions of that kind in the window — Digital Coach: observation_type
 *                     NULL, status 'completed'; Human: 'leader_observation', a TERMINAL status
 *                     (her "Total observations" / "Total DC observations").
 *   teachersObserved  distinct roster teachers with >=1 of them (her "Teachers observed",
 *                     Count(teacher_id, distinct)). Roster = role teacher, a school, not a test
 *                     user, at a counted school — the /analytics/schools teacher base.
 *   sectorsActive     overview only: sectors in scope with >=1 observation of that kind (her
 *                     "Sectors active" = data.sectors.length).
 *   sectionB / C / D  her FICO Section B (LP Fidelity), C (Teaching Practices), D (Engagement).
 *                     Hers is, per observation, the share of the section's marks (yes 1, partial
 *                     0.5, no 0); ours is the session's own FICO domain, points-pooled (steps-grid
 *                     sectionPct): B = lesson_plan_fidelity, C = high_leverage_practices,
 *                     D = student_engagement. A section marked assessed:false (no lesson plan) is
 *                     not scored — NIETE's rule (fico-framework.js:796). Out of 100, one decimal;
 *                     null exactly when its n is 0.
 *   sectionBN / CN / DN  how many sessions that section was scored on (at every level, so B's smaller
 *                     base — scored only with a lesson plan — is visible).
 * Counts SUM from school to region to overview; teachers are distinct sets at each level. Section
 * averages follow HER rule (operator, 2026-10-15: "follow HER rule for the sections ported"): a
 * school's and the overview's average their observations (Σ % ÷ n — her Avg over observations,
 * views.py ObservationsView type_summary / school_stats); a SECTOR's is the mean of its schools'
 * averages, each school with a score counting once (views.py:2300-2330, sector_summary). So with a
 * sector chosen the overview (pooled) and that sector's card (school mean) can differ, as on hers.
 * The /analytics/schools averages (avgFico / avgHitl) stay pooled, unchanged.
 * No cycles (NIETE has none) and no TEACH / FLN counts (no source): omitted, not sent as 0.
 * No teacher identity leaves the server.
 */

const {
  REGION_BUCKETS,
  bucketOf,
  loadCountedSessions,
} = require('./schools-analytics.service');
const { HUMAN_OBSERVATION, FICO_SECTIONS } = require('./steps-grid.service');

const KINDS = Object.freeze({
  dc: (s) => s.observation_type === null || s.observation_type === undefined,
  human: (s) => s.observation_type === HUMAN_OBSERVATION,
});

const SECTION_OUT = Object.freeze({ b: ['sectionB', 'sectionBN'], c: ['sectionC', 'sectionCN'], d: ['sectionD', 'sectionDN'] });

function round1(n) {
  return Math.round(n * 10) / 10;
}

function emptyAcc() {
  return { observations: 0, teachers: new Set(), b: [0, 0], c: [0, 0], d: [0, 0] };
}

function addSession(acc, s) {
  acc.observations += 1;
  if (s.user_id) acc.teachers.add(s.user_id);
  const sections = s.sections || {};
  for (const k of Object.keys(FICO_SECTIONS)) {
    const v = sections[k];
    if (typeof v === 'number' && Number.isFinite(v)) { acc[k][0] += v; acc[k][1] += 1; }
  }
}

function mergeInto(into, a) {
  into.observations += a.observations;
  for (const t of a.teachers) into.teachers.add(t);
  for (const k of Object.keys(FICO_SECTIONS)) { into[k][0] += a[k][0]; into[k][1] += a[k][1]; }
}

/**
 * A sector's sections, her rule: the mean of its schools' (unrounded) averages, each school with a
 * score counting once; n stays the observations scored.
 */
function sectorSections(schoolAccs) {
  const out = {};
  for (const [k, [avg, n]] of Object.entries(SECTION_OUT)) {
    let sum = 0;
    let schools = 0;
    let scored = 0;
    for (const a of schoolAccs) {
      if (a[k][1] > 0) { sum += a[k][0] / a[k][1]; schools += 1; scored += a[k][1]; }
    }
    out[avg] = schools > 0 ? round1(sum / schools) : null;
    out[n] = scored;
  }
  return out;
}

/** The block a school row, a region card and the overview share. */
function metrics(acc) {
  const out = { observations: acc.observations, teachersObserved: acc.teachers.size };
  for (const [k, [avg, n]] of Object.entries(SECTION_OUT)) {
    out[avg] = acc[k][1] > 0 ? round1(acc[k][0] / acc[k][1]) : null;
    out[n] = acc[k][1];
  }
  return out;
}

/**
 * @param {{
 *   schools?: Array<{id, name, emis, region, is_active, is_probable_test}>,
 *   sessions?: Array<{school_id, user_id, is_test, observation_type, sections: {b, c, d}}>
 * }} rows
 * @param {{region?: string|null}} [opts] a bucket name from parseRegionFilter, or null for all
 * @returns {{dc: {overview, regions, schools}, human: {overview, regions, schools}}}
 */
function summarizeObservationsAnalytics(rows = {}, opts = {}) {
  const filter = opts.region || null;
  const src = rows || {};

  // Counted schools only: active, not a probable test, in one of the six sectors.
  const bySchool = new Map();
  for (const s of src.schools || []) {
    if (!s || s.is_active !== true || s.is_probable_test === true) continue;
    const bucket = bucketOf(s.region);
    if (!bucket) continue;
    bySchool.set(s.id, { school: s, bucket, acc: { dc: emptyAcc(), human: emptyAcc() } });
  }

  // A test teacher's session is out, and so is one at a school that is not counted.
  for (const s of src.sessions || []) {
    if (!s || s.is_test === true) continue;
    const entry = bySchool.get(s.school_id);
    if (!entry) continue;
    for (const [kind, is] of Object.entries(KINDS)) {
      if (is(s)) addSession(entry.acc[kind], s);
    }
  }

  const order = new Map(REGION_BUCKETS.map((b, i) => [b, i]));
  const entries = [...bySchool.values()].sort((a, b) => (order.get(a.bucket) - order.get(b.bucket))
    || String(a.school.name || '').localeCompare(String(b.school.name || '')));

  const out = {};
  for (const kind of Object.keys(KINDS)) {
    const regionAcc = new Map(REGION_BUCKETS.map((b) => [b, { schools: 0, acc: emptyAcc(), schoolAccs: [] }]));
    const overview = { schools: 0, acc: emptyAcc() };
    const schools = [];
    for (const e of entries) {
      const acc = e.acc[kind];
      const r = regionAcc.get(e.bucket);
      r.schools += 1;
      mergeInto(r.acc, acc);
      r.schoolAccs.push(acc);
      if (filter && e.bucket !== filter) continue;
      overview.schools += 1;
      mergeInto(overview.acc, acc);
      schools.push({
        schoolId: e.school.id,
        emis: e.school.emis == null ? null : String(e.school.emis),
        name: e.school.name,
        region: e.bucket,
        ...metrics(acc),
      });
    }
    const regions = REGION_BUCKETS.map((b) => {
      const r = regionAcc.get(b);
      return { region: b, schools: r.schools, ...metrics(r.acc), ...sectorSections(r.schoolAccs) };
    });
    const sectorsActive = regions.filter((r) => (!filter || r.region === filter) && r.observations > 0).length;
    out[kind] = {
      overview: { schools: overview.schools, ...metrics(overview.acc), sectorsActive },
      regions,
      schools,
    };
  }
  return out;
}

// ── the reads ────────────────────────────────────────────────────────────────

// Every school, as the summariser decides what counts — no roster: this tab has no "of N teachers".
// Unaliased on purpose (the table is read whole; nothing to disambiguate).
const SCHOOLS_SQL = `
  SELECT id, name, emis, region, is_active, is_probable_test
    FROM schools`;

/**
 * Two reads in parallel — the schools, and the counted sessions with their scores and sections
 * from the memo /analytics/schools shares (plus, for sessions neither route has read yet, one
 * score read).
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {{from: string|null, to: string|null}} range from analyticsRange (validated YYYY-MM-DD or null)
 * @param {{memo?: object}} [opts] the score memo (schools-analytics' own by default)
 * @returns {Promise<{schools: any[], sessions: any[], scoreReads: number}>}
 */
async function loadObservationsAnalyticsRows(query, range = {}, opts = {}) {
  const r = { from: range.from || null, to: range.to || null };
  const [schoolRes, counted] = await Promise.all([
    query(SCHOOLS_SQL, []),
    loadCountedSessions(query, r, opts.memo ? { memo: opts.memo } : undefined),
  ]);
  return {
    schools: schoolRes.rows || [],
    sessions: counted.sessions.map(({ pct, ...s }) => s),
    scoreReads: counted.scoreReads,
  };
}

module.exports = {
  REGION_BUCKETS,
  summarizeObservationsAnalytics,
  loadObservationsAnalyticsRows,
};
