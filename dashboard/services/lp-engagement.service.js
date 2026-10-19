/**
 * LP Engagement for the analytics-only accounts — the schools-analytics v7 LP tab, ported 1 to 1
 * from the ICT dashboard (Orenda-Project/ict-dashboards; PLAN v7 "LP Engagement"). Its own
 * endpoint, GET /api/portal/analytics/lp-engagement, so the tab's cost never slows the others.
 * Same accounts, window, regions and school rule as schools-analytics.service, whose helpers it
 * reuses rather than respells.
 *
 * HER FORMULA (cited from her code):
 *   row            teacher × Sunday-week × grade × subject (sync_lp.py: LPWeeklyStatus is unique on
 *                  teacher_id, week_start, grade, subject; bigquery_queries.py:276-288 buckets the
 *                  week with WEEK(SUNDAY)).
 *   lp_ratio       min(distinct LPs / 5, 1) per row (sync_lp.py:106-108, max_classes = 5), where
 *                  her LPs are core + user-generated completions summed.
 *   teacher ratio  the mean of her rows in the window (views.py LPEngagementView, Avg('effective_ratio')).
 *   band           On-Schedule ≥ 0.60, Moderate ≥ 0.40, else Off-Schedule, on the teacher's ratio;
 *                  a rostered teacher with no row is Off-Schedule (views.py:883-914).
 *   overall/sector Σ teacher ratios ÷ rostered teachers of the band — a teacher with no row counts
 *                  0 (views.py:914 overall, 1060-1066 sector).
 *   school         the same over the school's band teachers (LPSectorView, views.py:1240-1249); its
 *                  status reads the % as shown, rounded (LPEngagement.jsx SectorBreakdownTable).
 *   subject/grade  the same computation over only that subject's / grade's rows; every rostered
 *                  teacher is in every subject and grade row (her page re-asks the endpoint with
 *                  ?subject= / ?grade=, LPEngagement.jsx:135-221). Her "Overall" row sums the band
 *                  counts over the rows and takes the plain mean of the rows' ratios
 *                  (LPEngagement.jsx:957-969, 1041-1054).
 *   sector chart   each sector's ratio within each subject / grade (LPEngagement.jsx:1116-1138).
 *
 * NIETE SUBSTITUTIONS (PLAN v7):
 *   LPs            different plans OPENED that week (niete_lp_opens, logged from LP_OPENS_LOGGED_SINCE)
 *                  + lesson plans GENERATED that week (lesson_plans, which carries grade and subject)
 *                  — her "core + user-gen". A plan opened again in another week counts in that week too.
 *   Primary tab    teachers whose training band (users.teacher_level; training_bands on older
 *                  schemas) includes PRIMARY, over K-5 plans (grades 1-5).
 *   Mid/High tab   teachers whose band includes MIDDLE or HIGH, over 6-12 plans (grades 6-12).
 *                  A teacher with both bands is in both tabs (hers double-counts too); one with no
 *                  band is in neither.
 *   grade/subject  parsed from the plan key with the existing parsers' shapes (subject-resolution.js
 *                  parseCorpusLessonId for K-5; lp612-lifecycle.service.js gradeOfSegmentId /
 *                  subjectOfSegmentId for 6-12, widened for `grade_10_urdu.p1c01…` and `.s903`), and
 *                  every spelling folded to one key by subject-vocabulary.service (math/maths/Mathematics,
 *                  the _en/_ur mediums of Social Studies, General Knowledge and Pakistan Studies).
 *   roster/schools exactly /analytics/schools': role teacher, not a test account, at an active,
 *                  non-test school in one of the six sectors; activity follows her CURRENT school.
 *   window         Pakistan days, both ends inclusive; an event counts when it happened inside it,
 *                  and its row is the Sunday-week of its Pakistan day.
 *
 * Two halves, the schools service's contract style:
 *   loadLpEngagementRows(query, range, band)  three set-based reads in parallel (schools, the band
 *                                             roster, LP activity) — no per-school or per-teacher loop.
 *   summarizeLpEngagement(rows, opts)         PURE: rows in, response shape out.
 * No teacher identity leaves the server.
 */

const {
  bucketOf,
  windowBounds,
  REGION_BUCKETS,
  ROSTER_TEACHER,
} = require('./schools-analytics.service');
const { subjectKey, subjectName, gradeOf } = require('./subject-vocabulary.service');

/** Her max_classes: a week with this many LPs in a grade-subject is fully on schedule. */
const LP_PER_WEEK = 5;

const BANDS = Object.freeze(['primary', 'midhigh']);

/** Which plans count on which tab, and which training bands put a teacher on it. */
const BAND_RULES = Object.freeze({
  primary: Object.freeze({ kind: 'k5', grades: [1, 5], keys: ['PRIMARY'] }),
  midhigh: Object.freeze({ kind: 'g612', grades: [6, 12], keys: ['MIDDLE', 'HIGH'] }),
});

/**
 * The ?band= filter: blank is Primary (her page opens on it); primary | midhigh (mid_high, mid-high).
 * @returns {{ok: true, band: 'primary'|'midhigh'} | {ok: false}}
 */
function parseBandFilter(raw) {
  if (raw === undefined || raw === null) return { ok: true, band: 'primary' };
  if (typeof raw !== 'string') return { ok: false };
  const v = raw.trim().toLowerCase().replace(/[-_\s]/g, '');
  if (v === '' || v === 'primary') return { ok: true, band: 'primary' };
  if (v === 'midhigh') return { ok: true, band: 'midhigh' };
  return { ok: false };
}

// K-5 corpus key: grade_<n>_<subject>_ch<m>_seg<k> (subject-resolution.js parseCorpusLessonId).
const K5_REF = /^grade_(\d{1,2})_(.+?)_ch\d+_seg\d+b?$/i;
// 6-12 segment id: grade_<n>_<subject>.<rest> — lp612-lifecycle's shape, widened: the rest may start
// .c05 (most), .p1c01 (Urdu by part), .s903 / .r990 (single pages); a combined grade_9_10_ book is
// read as its first grade.
const G612_REF = /^grade_(\d{1,2})_(?:\d{1,2}_)?([a-z0-9_]+?)\./i;

/**
 * Any spelling of a subject → one key (subject-vocabulary.service), after dropping the teaching
 * medium a corpus appends: social_studies_en, general_knowledge_ur, pak_studies_english.
 * @returns {string|null}
 */
function lpSubjectKey(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim().toLowerCase();
  if (!t) return null;
  const medium = /^(.+?)_(?:en|ur|english|urdu)$/.exec(t);
  if (medium) t = medium[1];
  return subjectKey(t.replace(/_/g, ' '));
}

/**
 * A plan key → its grade and subject; either is null when it does not parse.
 * @param {'k5'|'g612'} kind
 * @param {string} ref
 * @returns {{grade: number|null, subject: string|null}}
 */
function parsePlanRef(kind, ref) {
  const m = (kind === 'k5' ? K5_REF : kind === 'g612' ? G612_REF : null)?.exec(String(ref || '').trim());
  if (!m) return { grade: null, subject: null };
  return { grade: Number(m[1]), subject: lpSubjectKey(m[2]) };
}

const inGrades = (grade, band) => grade >= BAND_RULES[band].grades[0] && grade <= BAND_RULES[band].grades[1];

/** A Postgres text[] as the driver hands it back (an array, or '{A,B}' if it was not parsed). */
function bandList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/"/g, ''));
  return [];
}

function inBand(bands, band) {
  const keys = BAND_RULES[band].keys;
  return bandList(bands).some((b) => typeof b === 'string' && keys.includes(b.trim().toUpperCase()));
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round4 = (n) => Math.round(n * 1e4) / 1e4;
/** Her display: ratio × 100, rounded (the epsilon keeps an exact half from drifting below it). */
const pctOf = (ratio) => (ratio === null ? null : Math.round(ratio * 100 + 1e-9));
const shareOf = (x, n) => (n > 0 ? Math.round((x / n) * 100 + 1e-9) : null);

/** A teacher's stat over some of her rows, in LP units (min(LPs, 5) per row): exact band edges. */
const ZERO = Object.freeze({ units: 0, rows: 0 });
const ratioOf = (s) => (s.rows > 0 ? s.units / (LP_PER_WEEK * s.rows) : 0);
function bandOf(s) {
  if (s.rows > 0 && s.units >= 3 * s.rows) return 'on'; // mean ≥ 0.60
  if (s.rows > 0 && s.units >= 2 * s.rows) return 'moderate'; // mean ≥ 0.40
  return 'off';
}

function emptyAcc() {
  return { teachers: 0, ratioSum: 0, on: 0, moderate: 0, off: 0, active: 0 };
}

function addTeacher(acc, stat) {
  acc.teachers += 1;
  acc.ratioSum += ratioOf(stat);
  acc[bandOf(stat)] += 1;
  if (stat.rows > 0) acc.active += 1;
}

const accRatio = (acc) => (acc.teachers > 0 ? acc.ratioSum / acc.teachers : null);

/** The numbers every level carries: teachers, the LP ratio (and its %), and the three band counts. */
function block(acc) {
  const ratio = accRatio(acc);
  return {
    teachers: acc.teachers,
    lpRatio: ratio === null ? null : round4(ratio),
    lpPct: pctOf(ratio),
    onSchedule: acc.on,
    moderate: acc.moderate,
    offSchedule: acc.off,
  };
}

/** Her "(16%)": each band's share of the teachers, rounded. */
function shares(on, moderate, off, n) {
  return { onPct: shareOf(on, n), moderatePct: shareOf(moderate, n), offPct: shareOf(off, n) };
}

const withShares = (acc) => ({ ...block(acc), ...shares(acc.on, acc.moderate, acc.off, acc.teachers) });

/** Her school status: from the % as shown (rounded), ≥ 60 On-Schedule, ≥ 40 Moderate. */
function statusOf(pct) {
  if (pct === null) return null;
  if (pct >= 60) return 'on';
  if (pct >= 40) return 'moderate';
  return 'off';
}

/** Her "Overall" row under the subject / grade table; null when the table has no rows. */
function overallOf(rows, ratios) {
  if (!rows.length) return null;
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  const teachers = sum('teachers');
  const on = sum('onSchedule');
  const moderate = sum('moderate');
  const off = sum('offSchedule');
  const known = ratios.filter((r) => r !== null);
  const ratio = known.length ? known.reduce((n, r) => n + r, 0) / ratios.length : null;
  return {
    teachers,
    lpRatio: ratio === null ? null : round4(ratio),
    lpPct: pctOf(ratio),
    onSchedule: on,
    moderate,
    offSchedule: off,
    ...shares(on, moderate, off, teachers),
  };
}

const rowKey = (week, grade, subject) => `${week || ''}|${grade === null ? '' : grade}|${subject || ''}`;

/**
 * @param {{
 *   schools?: Array<{id, name, emis, region, is_active, is_probable_test}>,
 *   teachers?: Array<{id, school_id, bands}>,
 *   activity?: Array<{user_id, week, source: 'open'|'generated', plan_kind?, plan_ref?, grade?, subject?, n?}>
 * }} rows  teachers already the roster (test accounts out); activity of roster teachers in the window
 * @param {{band?: 'primary'|'midhigh', region?: string|null}} [opts]
 */
function summarizeLpEngagement(rows = {}, opts = {}) {
  const band = opts.band === 'midhigh' ? 'midhigh' : 'primary';
  const filter = opts.region || null;
  const src = rows || {};

  // Counted schools: active, not a probable test, in one of the six sectors.
  const schoolById = new Map();
  for (const s of src.schools || []) {
    if (!s || s.is_active !== true || s.is_probable_test === true) continue;
    const bucket = bucketOf(s.region);
    if (bucket) schoolById.set(s.id, { school: s, bucket });
  }

  // The band's roster: a teacher at a counted school whose training band is this tab's.
  const teachers = new Map();
  for (const t of src.teachers || []) {
    if (!t || !inBand(t.bands, band)) continue;
    const at = schoolById.get(t.school_id);
    if (!at) continue;
    teachers.set(t.id, { schoolId: t.school_id, bucket: at.bucket, rows: new Map() });
  }

  // Her rows: LPs per teacher × week × grade × subject. Opens count DIFFERENT plans in the row.
  const rule = BAND_RULES[band];
  for (const a of src.activity || []) {
    const t = a && teachers.get(a.user_id);
    if (!t) continue;
    if (a.source === 'open') {
      if (a.plan_kind !== rule.kind) continue;
      const { grade, subject } = parsePlanRef(a.plan_kind, a.plan_ref);
      if (grade !== null && !inGrades(grade, band)) continue;
      const key = rowKey(a.week, grade, subject);
      const r = t.rows.get(key) || { grade, subject, n: 0, refs: new Set() };
      if (r.refs.has(a.plan_ref)) continue;
      r.refs.add(a.plan_ref);
      r.n += 1;
      t.rows.set(key, r);
    } else if (a.source === 'generated') {
      const g = gradeOf(a.grade);
      if (!g || !inGrades(g.grade, band)) continue;
      const subject = lpSubjectKey(a.subject);
      const key = rowKey(a.week, g.grade, subject);
      const r = t.rows.get(key) || { grade: g.grade, subject, n: 0, refs: new Set() };
      r.n += count(a.n);
      t.rows.set(key, r);
    }
  }

  // Per teacher: overall, per subject and per grade, in LP units.
  const subjectKeys = new Set();
  for (const t of teachers.values()) {
    t.all = { units: 0, rows: 0 };
    t.bySubject = new Map();
    t.byGrade = new Map();
    for (const r of t.rows.values()) {
      const units = Math.min(r.n, LP_PER_WEEK);
      t.all.units += units;
      t.all.rows += 1;
      if (r.subject) {
        subjectKeys.add(r.subject);
        const s = t.bySubject.get(r.subject) || { units: 0, rows: 0 };
        s.units += units; s.rows += 1;
        t.bySubject.set(r.subject, s);
      }
      if (r.grade !== null) {
        const g = t.byGrade.get(r.grade) || { units: 0, rows: 0 };
        g.units += units; g.rows += 1;
        t.byGrade.set(r.grade, g);
      }
    }
  }

  const inScope = (t) => !filter || t.bucket === filter;
  const scoped = [...teachers.values()].filter(inScope);

  // Overview, the six sector cards, the schools.
  const overviewAcc = emptyAcc();
  const regionAcc = new Map(REGION_BUCKETS.map((b) => [b, emptyAcc()]));
  const schoolAcc = new Map();
  for (const t of teachers.values()) {
    addTeacher(regionAcc.get(t.bucket), t.all);
    if (!inScope(t)) continue;
    addTeacher(overviewAcc, t.all);
    if (!schoolAcc.has(t.schoolId)) schoolAcc.set(t.schoolId, emptyAcc());
    addTeacher(schoolAcc.get(t.schoolId), t.all);
  }
  const activeSectors = REGION_BUCKETS.filter((b) => (!filter || b === filter) && regionAcc.get(b).active > 0).length;

  const order = new Map(REGION_BUCKETS.map((b, i) => [b, i]));
  const schools = [...schoolAcc.entries()].map(([id, acc]) => {
    const { school, bucket } = schoolById.get(id);
    const b = block(acc);
    return {
      schoolId: school.id,
      emis: school.emis == null ? null : String(school.emis),
      name: school.name,
      region: bucket,
      teachers: b.teachers,
      lpRatio: b.lpRatio,
      lpPct: b.lpPct,
      status: statusOf(b.lpPct),
    };
  }).sort((a, b) => (order.get(a.region) - order.get(b.region)) || String(a.name || '').localeCompare(String(b.name || '')));

  // Subjects (those with an LP anywhere in the six sectors, by name) and grades (the band's, always).
  const subjects = [...subjectKeys]
    .map((key) => ({ key, name: subjectName(key, 'en') }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const grades = [];
  for (let g = rule.grades[0]; g <= rule.grades[1]; g += 1) grades.push(g);

  const accOver = (list, pick) => {
    const acc = emptyAcc();
    for (const t of list) addTeacher(acc, pick(t) || ZERO);
    return acc;
  };

  const subjectAccs = subjects.map((s) => accOver(scoped, (t) => t.bySubject.get(s.key)));
  const subjectRows = subjects.map((s, i) => ({ subject: s.key, name: s.name, ...withShares(subjectAccs[i]) }));
  const gradeAccs = grades.map((g) => accOver(scoped, (t) => t.byGrade.get(g)));
  const gradeRows = grades.map((g, i) => ({ grade: g, ...withShares(gradeAccs[i]) }));

  // The grouped bars: every sector's % in every subject / grade (all six, whatever the filter).
  const bySector = new Map(REGION_BUCKETS.map((b) => [b, []]));
  for (const t of teachers.values()) bySector.get(t.bucket).push(t);
  const matrix = (keys, pick) => REGION_BUCKETS.map((region) => {
    const list = bySector.get(region);
    const values = {};
    for (const k of keys) values[k] = pctOf(accRatio(accOver(list, (t) => pick(t, k))));
    return { region, values };
  });

  const { teachers: n, lpRatio, lpPct, onSchedule, moderate, offSchedule } = block(overviewAcc);
  return {
    overview: { teachers: n, lpRatio, lpPct, activeSectors, onSchedule, moderate, offSchedule },
    regions: REGION_BUCKETS.map((b) => ({ region: b, ...withShares(regionAcc.get(b)) })),
    schools,
    bySubject: { rows: subjectRows, overall: overallOf(subjectRows, subjectAccs.map(accRatio)) },
    byGrade: { rows: gradeRows, overall: overallOf(gradeRows, gradeAccs.map(accRatio)) },
    sectorSubjects: matrix(subjects.map((s) => s.key), (t, k) => t.bySubject.get(k)),
    sectorGrades: matrix(grades, (t, g) => t.byGrade.get(g)),
  };
}

// ── the reads ────────────────────────────────────────────────────────────────

/**
 * The teacher's band column. Production renamed users.training_bands to users.teacher_level
 * (V1.4.5); the sandbox schema carries both. Looked up once per process, from an allowlist, so
 * the read works on either schema without a per-row to_jsonb (310 ms vs 10 ms on prod, 2026-10-14).
 */
const BAND_COLUMNS = Object.freeze(['teacher_level', 'training_bands']);
const BAND_COLUMNS_SQL = `
  SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name IN ('teacher_level', 'training_bands')`;

/** The SQL for a teacher's bands, given the columns the database has (anything else is ignored). */
function bandsExpression(columns = []) {
  const have = BAND_COLUMNS.filter((c) => columns.includes(c));
  if (have.length === 2) return 'COALESCE(u.teacher_level, u.training_bands)::text[]';
  if (have.length === 1) return `u.${have[0]}::text[]`;
  return 'NULL::text[]';
}

function createBandColumnsMemo() {
  let pending = null;
  return {
    get(query) {
      if (!pending) {
        pending = Promise.resolve(query(BAND_COLUMNS_SQL, []))
          .then((res) => (res.rows || []).map((r) => r.column_name))
          .catch((error) => { pending = null; throw error; });
      }
      return pending;
    },
  };
}

const defaultBandColumns = createBandColumnsMemo();

// Not aliased: tests/setup/raw-sql-schools-columns.test.js reads an alias after `schools` as a column.
const SCHOOLS_SQL = `
  SELECT id, name, emis, region, is_active, is_probable_test
    FROM schools`;

const rosterSql = (columns) => `
  SELECT u.id, u.school_id, ${bandsExpression(columns)} AS bands
    FROM users u
   WHERE ${ROSTER_TEACHER}`;

/** A timestamptz expression → the Sunday that starts its Pakistan-time week, as YYYY-MM-DD. */
const pkWeek = (ts) => `to_char((${ts} AT TIME ZONE 'Asia/Karachi')::date
           - EXTRACT(DOW FROM (${ts} AT TIME ZONE 'Asia/Karachi'))::int, 'YYYY-MM-DD')`;

/**
 * Every LP event of a roster teacher in the window, at her row's grain:
 *   opens      one row per DIFFERENT plan of the band's kind opened in a week (DISTINCT);
 *   generated  lesson plans generated in a week, per grade and subject as stored, of the band's grades.
 * Window bounds are the UTC instants of [from 00:00 PKT, to+1 00:00 PKT). lesson_plans.created_at is
 * a timestamp WITHOUT time zone holding UTC (it tracks now() at UTC), so the instants are turned to
 * UTC wall time for it, and its week is read through AT TIME ZONE 'UTC' first.
 */
function lpActivitySql(bounds, band) {
  const rule = BAND_RULES[band];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const lo = bounds.fromTs ? p(bounds.fromTs) : null;
  const hi = bounds.toTs ? p(bounds.toTs) : null;
  const kind = p(rule.kind);
  const gLo = p(rule.grades[0]);
  const gHi = p(rule.grades[1]);
  const clause = (parts) => parts.filter(Boolean).join(' AND ') || 'TRUE';
  const openWindow = clause([lo && `o.opened_at >= ${lo}::timestamptz`, hi && `o.opened_at < ${hi}::timestamptz`]);
  const genWindow = clause([
    lo && `l.created_at >= (${lo}::timestamptz AT TIME ZONE 'UTC')`,
    hi && `l.created_at < (${hi}::timestamptz AT TIME ZONE 'UTC')`,
  ]);
  const sql = `
  WITH roster AS (
    SELECT u.id FROM users u
     WHERE ${ROSTER_TEACHER}
  )
  SELECT DISTINCT o.user_id, 'open' AS source, o.plan_kind, o.plan_ref,
         NULL::text AS grade, NULL::text AS subject,
         ${pkWeek('o.opened_at')} AS week,
         1 AS n
    FROM niete_lp_opens o
    JOIN roster r ON r.id = o.user_id
   WHERE o.plan_kind = ${kind}
     AND ${openWindow}
  UNION ALL
  SELECT l.user_id, 'generated', NULL, NULL,
         l.grade::text, l.subject::text,
         ${pkWeek("(l.created_at AT TIME ZONE 'UTC')")},
         count(DISTINCT l.id)::int
    FROM lesson_plans l
    JOIN roster r ON r.id = l.user_id
   WHERE ${genWindow}
     AND (CASE WHEN l.grade ~ '^\\s*\\d{1,2}\\s*$' THEN btrim(l.grade)::int END) BETWEEN ${gLo}::int AND ${gHi}::int
   GROUP BY 1, 5, 6, 7`;
  return { sql, params };
}

/**
 * Three reads in parallel — schools, the roster with its bands, the band's LP activity — after the
 * one-time band-column lookup.
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {{from: string|null, to: string|null}} range from analyticsRange (validated)
 * @param {'primary'|'midhigh'} band
 * @param {{memo?: ReturnType<typeof createBandColumnsMemo>}} [opts]
 */
async function loadLpEngagementRows(query, range = {}, band = 'primary', { memo = defaultBandColumns } = {}) {
  const b = BANDS.includes(band) ? band : 'primary';
  const columns = await memo.get(query);
  const lp = lpActivitySql(windowBounds(range || {}), b);
  const [schoolRes, rosterRes, lpRes] = await Promise.all([
    query(SCHOOLS_SQL, []),
    query(rosterSql(columns), []),
    query(lp.sql, lp.params),
  ]);
  return { schools: schoolRes.rows || [], teachers: rosterRes.rows || [], activity: lpRes.rows || [] };
}

module.exports = {
  LP_PER_WEEK,
  BANDS,
  parseBandFilter,
  parsePlanRef,
  lpSubjectKey,
  summarizeLpEngagement,
  bandsExpression,
  createBandColumnsMemo,
  loadLpEngagementRows,
};
