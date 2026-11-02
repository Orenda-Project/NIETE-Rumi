/**
 * LP Engagement for the analytics-only accounts — schools analytics v8 (FDE feedback, 2026-10-19): ACTIVE /
 * NON-ACTIVE teachers, on the RDF's numbers. Its own endpoint, GET /api/portal/analytics/lp-engagement, so the
 * tab's cost never slows the others.
 *
 * THE FEEDBACK (verbatim): "Remove the three existing categories: Moderate Teachers, On-Schedule Teachers,
 * Off-Schedule Teachers. Instead, introduce two categories: Active Teachers: Teachers who are using lesson plans.
 * Non-Active Teachers: Teachers who are not using lesson plans." — in the sector breakdowns, the subject and grade
 * tables and the graphs, for Primary and Mid / High alike. "RDFs are the numbers that the others follow."
 *
 * THE RULE (the RDF's "used a lesson plan", reach not intensity):
 *   population   the band's RDF teacher population — lib/analytics-lists `primary` / `midHigh`, userId → the
 *                RDF's sector. Sectors therefore sum to the total.
 *   Active       at least one lesson-plan use in the selected period (Pakistan days, both ends inclusive), by the
 *                RDF's rule for the band; once per teacher however many plans she used:
 *     Primary    a `lesson_plans` row (any grade — the RDF counts every row), OR a `niete_lp_opens` row with
 *                plan_kind 'k5' (an app open; rdf_niete/lp_use.py).
 *     Mid/High   the RDF 6-12 rule (rdf_niete612/metrics.py): the U1 floor — a `niete_lp612_renders` row she
 *                requested, an `lp_feedback` row carrying `lp612_segment_id`, a `niete_lp_opens` 'g612' open —
 *                UNION a lesson served to her on WhatsApp. The RDF reads the serve from the bot's Axiom log (from
 *                19 Sep); its database record is `niete_lp612_deliveries` (surface 'backfill' 6–24 Sep, 'whatsapp'
 *                from 25 Sep). A 'portal' row there is her claim on a shared render, not a delivery; her portal
 *                open is the 'g612' open. No source exists before its first row, so the cut-overs need no dates.
 *   Non-Active   population − Active.
 *   %            Active ÷ population, one decimal, as the RDF writes it (16 Oct: 357 of 3,552 = 10.1%).
 *   subject /    a teacher is Active in a subject (grade) when one of her plans in the period is of that subject
 *   grade        (grade); the row is that ÷ the band's population, so one teacher can be Active in several rows.
 *                The "Overall" row is the tab's overall. Grade and subject come from the `lesson_plans` row, or
 *                are parsed from the plan key (K-5 catalogue id, 6-12 segment id); a plan whose key does not
 *                parse, or whose grade is outside the band, still makes her Active, in no row.
 *   schools      a teacher's school is `users.school_id` when its EMIS is on FDE's programme list
 *                (`fdeSchoolEmis`) and it is in her RDF sector; otherwise — no school on record, one off the
 *                list, or one in another sector — she is on her sector's "No school" line (noSchool true,
 *                schoolId `noSchoolId(sector)`, emis and name null), as on the other analytics tabs.
 *   sectors      Active sectors = sectors with at least one Active teacher.
 *
 * FAIL-CLOSED (lib/analytics-lists): a list that is not loaded — sandbox, where no prod list matches a
 * user — is null, never empty, and the tab keeps the v7 rule for it rather than show zeros:
 *   schools   every active, non-test school in the six sectors;
 *   teachers  (when either band's list is missing) today's roster — role teacher, a school, not a test
 *             user — whose teacher_level holds the band (PRIMARY; MIDDLE or HIGH), at a counted school,
 *             in that school's sector.
 *
 * Two halves, the schools service's contract style:
 *   loadLpEngagementRows(query, range, band, opts)  three set-based reads in parallel, over the lists the
 *                                                   route loaded (lib/analytics-lists).
 *   summarizeLpEngagement(rows, opts)               PURE: rows in, response shape out.
 * No teacher identity leaves the server.
 *
 * WHOSE REGIONS (bd-97daxo.3): "the six sectors" is the default; opts.regions — the regions the viewer's
 * organization owns, from the region registry — replaces it in both halves (the v7 population, the sector cards and
 * matrices), so a teacher counts only in the viewer's regions (schools-analytics.service's rule).
 */

const { windowBounds, REGION_BUCKETS, bucketOf, ROSTER_TEACHER } = require('./schools-analytics.service');
const { subjectKey, subjectName, gradeOf } = require('./subject-vocabulary.service');
const { noSchoolId } = require('../lib/analytics-lists');

const BANDS = Object.freeze(['primary', 'midhigh']);

/** Which analytics-lists population, which plan keys and which grades belong to each band. */
const BAND_RULES = Object.freeze({
  primary: Object.freeze({ list: 'primary', kind: 'k5', grades: [1, 5], levels: ['PRIMARY'] }),
  midhigh: Object.freeze({ list: 'midHigh', kind: 'g612', grades: [6, 12], levels: ['MIDDLE', 'HIGH'] }),
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

/** Active ÷ teachers as a %, one decimal (the RDF's `_pct`); null when there is no teacher. */
function activePct(active, teachers) {
  if (!(teachers > 0)) return null;
  return Math.round((active / teachers) * 1000 + 1e-9) / 10;
}

const emptyAcc = () => ({ teachers: 0, active: 0 });
function addTeacher(acc, active) {
  acc.teachers += 1;
  if (active) acc.active += 1;
}
/** The numbers every level carries. */
const block = (acc) => ({
  teachers: acc.teachers,
  active: acc.active,
  nonActive: acc.teachers - acc.active,
  activePct: activePct(acc.active, acc.teachers),
});

/** One activity row → its grade and subject (either null), by the band's plan key or the stored columns. */
function gradeAndSubject(a, band) {
  if (a.ref) return parsePlanRef(BAND_RULES[band].kind, a.ref);
  const g = gradeOf(a.grade);
  return { grade: g ? g.grade : null, subject: lpSubjectKey(a.subject) };
}

/** A counted school when FDE's list is not loaded: the v7 rule — active, not a test, in the viewer's regions. */
const v7School = (s, regions = REGION_BUCKETS) => s.is_active === true && s.is_probable_test !== true
  && bucketOf(s.region, regions) !== null;

/** A Postgres text[] as the driver hands it back (an array, or '{A,B}' if it was not parsed). */
function levelList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/"/g, ''));
  return [];
}
const inBand = (levels, band) => levelList(levels)
  .some((l) => typeof l === 'string' && BAND_RULES[band].levels.includes(l.trim().toUpperCase()));

/**
 * The v7 population, for when the RDF teacher lists are not loaded: roster teachers of the band at a counted
 * school (v7's school rule), each in her school's sector.
 * @returns {Map<string, string>}
 */
function v7Population(roster, schools, band, regions = REGION_BUCKETS) {
  const sectorOf = new Map();
  for (const s of schools || []) if (s && v7School(s, regions)) sectorOf.set(s.id, bucketOf(s.region, regions));
  const out = new Map();
  for (const t of roster || []) {
    if (t && inBand(t.bands, band) && sectorOf.has(t.school_id)) out.set(t.id, sectorOf.get(t.school_id));
  }
  return out;
}

/**
 * @param {{
 *   population?: Map<string, string>,              the band's population: userId → sector
 *   fdeSchoolEmis?: Set<string>|string[]|null,     FDE's programme list; null = not loaded (v7 school rule)
 *   schools?: Array<{id, name, emis, region, is_active, is_probable_test}>,
 *   teachers?: Array<{id, school_id}>,             the population's current school
 *   activity?: Array<{user_id, grade?, subject?, ref?}>  one row per plan use in the window
 * }} rows
 * @param {{band?: 'primary'|'midhigh', region?: string|null, regions?: readonly string[]}} [opts] regions: the
 *   viewer's regions (FDE's six when omitted)
 */
function summarizeLpEngagement(rows = {}, opts = {}) {
  const band = opts.band === 'midhigh' ? 'midhigh' : 'primary';
  const filter = opts.region || null;
  const regionList = opts.regions || REGION_BUCKETS;
  const src = rows || {};
  const fde = src.fdeSchoolEmis ? new Set([...src.fdeSchoolEmis].map(String)) : null;
  const listed = (s) => (fde ? s.emis != null && fde.has(String(s.emis)) : v7School(s, regionList));

  const schoolById = new Map();
  for (const s of src.schools || []) {
    if (s && listed(s)) schoolById.set(s.id, s);
  }
  const schoolOf = new Map((src.teachers || []).filter(Boolean).map((t) => [t.id, t.school_id]));

  // The population, each teacher in her RDF sector, at her FDE-list school or none.
  const teachers = new Map();
  for (const [id, sector] of src.population || []) {
    const bucket = bucketOf(sector, regionList);
    if (!bucket) continue;
    const sid = schoolOf.get(id);
    const at = schoolById.get(sid);
    teachers.set(id, {
      bucket,
      // Her school's row only when the school is counted AND in her sector; else the sector's No school line.
      schoolId: at && bucketOf(at.region, regionList) === bucket ? sid : null,
      active: false,
      subjects: new Set(),
      grades: new Set(),
    });
  }

  const subjectKeys = new Set();
  for (const a of src.activity || []) {
    const t = a && teachers.get(a.user_id);
    if (!t) continue;
    t.active = true;
    const { grade, subject } = gradeAndSubject(a, band);
    if (grade !== null && !inGrades(grade, band)) continue;
    if (grade !== null) t.grades.add(grade);
    if (subject) {
      t.subjects.add(subject);
      subjectKeys.add(subject);
    }
  }

  const inScope = (t) => !filter || t.bucket === filter;
  const scoped = [...teachers.values()].filter(inScope);

  // Overview, the six sector cards, the schools (and each sector's "No school" line).
  const overviewAcc = emptyAcc();
  const regionAcc = new Map(regionList.map((b) => [b, emptyAcc()]));
  const schoolAcc = new Map();
  for (const t of teachers.values()) {
    addTeacher(regionAcc.get(t.bucket), t.active);
    if (!inScope(t)) continue;
    addTeacher(overviewAcc, t.active);
    const key = `${t.bucket}|${t.schoolId || ''}`;
    if (!schoolAcc.has(key)) schoolAcc.set(key, { bucket: t.bucket, schoolId: t.schoolId, acc: emptyAcc() });
    addTeacher(schoolAcc.get(key).acc, t.active);
  }
  const activeSectors = regionList.filter((b) => (!filter || b === filter) && regionAcc.get(b).active > 0).length;

  const order = new Map(regionList.map((b, i) => [b, i]));
  const schools = [...schoolAcc.values()].map(({ bucket, schoolId, acc }) => {
    const s = schoolId ? schoolById.get(schoolId) : null;
    return {
      region: bucket,
      schoolId: s ? s.id : noSchoolId(bucket),
      emis: s ? String(s.emis) : null,
      name: s ? s.name : null,
      noSchool: !s,
      ...block(acc),
    };
  }).sort((a, b) => (order.get(a.region) - order.get(b.region))
    || (a.noSchool - b.noSchool)
    || String(a.name || '').localeCompare(String(b.name || '')));

  // Subjects (any Active teacher anywhere in the viewer's regions, by name) and grades (the band's, always).
  const subjects = [...subjectKeys]
    .map((key) => ({ key, name: subjectName(key, 'en') }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const grades = [];
  for (let g = BAND_RULES[band].grades[0]; g <= BAND_RULES[band].grades[1]; g += 1) grades.push(g);

  const accOver = (list, isActive) => {
    const acc = emptyAcc();
    for (const t of list) addTeacher(acc, isActive(t));
    return acc;
  };
  const overall = block(overviewAcc);
  const subjectRows = subjects.map((s) => ({ subject: s.key, name: s.name, ...block(accOver(scoped, (t) => t.subjects.has(s.key))) }));
  const gradeRows = grades.map((g) => ({ grade: g, ...block(accOver(scoped, (t) => t.grades.has(g))) }));

  // The grouped bars: every sector's Active % in every subject / grade (all of them, whatever the filter).
  const bySector = new Map(regionList.map((b) => [b, []]));
  for (const t of teachers.values()) bySector.get(t.bucket).push(t);
  const matrix = (keys, has) => regionList.map((region) => {
    const list = bySector.get(region);
    const values = {};
    for (const k of keys) {
      const acc = accOver(list, (t) => has(t, k));
      values[k] = activePct(acc.active, acc.teachers);
    }
    return { region, values };
  });

  return {
    overview: { ...overall, activeSectors },
    regions: regionList.map((b) => ({ region: b, ...block(regionAcc.get(b)) })),
    schools,
    bySubject: { rows: subjectRows, overall: subjectRows.length ? overall : null },
    byGrade: { rows: gradeRows, overall },
    sectorSubjects: matrix(subjects.map((s) => s.key), (t, k) => t.subjects.has(k)),
    sectorGrades: matrix(grades, (t, g) => t.grades.has(g)),
  };
}

// ── the reads ────────────────────────────────────────────────────────────────

// Not aliased: tests/setup/raw-sql-schools-columns.test.js reads an alias after `schools` as a column.
const SCHOOLS_SQL = `
  SELECT id, name, emis, region, is_active, is_probable_test
    FROM schools`;

/** Today's roster with its levels — read only when the RDF teacher lists are not loaded. */
const ROSTER_SQL = `
  SELECT u.id, u.school_id, u.teacher_level::text[] AS bands
    FROM users u
   WHERE ${ROSTER_TEACHER}`;

/** The population's current school, by primary key. */
const TEACHER_SCHOOLS_SQL = `
  SELECT u.id, u.school_id
    FROM users u
   WHERE u.id = ANY($1::uuid[])`;

/**
 * Every plan use of a population teacher in the window, one row per (teacher, plan) — the summariser
 * needs only whether she used one, and of which grades and subjects. $1 = the population's ids; the
 * window bounds are the UTC instants of [from 00:00 PKT, to+1 00:00 PKT). lesson_plans.created_at is a
 * timestamp WITHOUT time zone holding UTC, so the instants are turned to UTC wall time for it.
 */
function lpActivitySql(bounds, band, ids) {
  const params = [ids];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const lo = bounds.fromTs ? p(bounds.fromTs) : null;
  const hi = bounds.toTs ? p(bounds.toTs) : null;
  const within = (col) => [lo && `${col} >= ${lo}::timestamptz`, hi && `${col} < ${hi}::timestamptz`]
    .filter(Boolean).map((c) => `\n     AND ${c}`).join('');
  const withinUtc = (col) => [
    lo && `${col} >= (${lo}::timestamptz AT TIME ZONE 'UTC')`,
    hi && `${col} < (${hi}::timestamptz AT TIME ZONE 'UTC')`,
  ].filter(Boolean).map((c) => `\n     AND ${c}`).join('');

  const sql = band === 'midhigh'
    ? `
  WITH pop AS (SELECT unnest($1::uuid[]) AS id),
  traces AS (
    SELECT o.user_id, o.plan_ref AS ref
      FROM niete_lp_opens o
     WHERE o.plan_kind = 'g612'${within('o.opened_at')}
    UNION ALL
    SELECT g.user_id, g.segment_id
      FROM niete_lp612_deliveries g
     WHERE g.surface <> 'portal'${within('g.delivered_at')}
    UNION ALL
    SELECT rr.requested_by, rr.segment_id
      FROM niete_lp612_renders rr
     WHERE rr.requested_by IS NOT NULL${within('rr.created_at')}
    UNION ALL
    SELECT f.user_id, f.lp612_segment_id
      FROM lp_feedback f
     WHERE f.lp612_segment_id IS NOT NULL${within('f.created_at')}
  )
  SELECT DISTINCT t.user_id, NULL::text AS grade, NULL::text AS subject, t.ref
    FROM traces t
    JOIN pop ON pop.id = t.user_id`
    : `
  WITH pop AS (SELECT unnest($1::uuid[]) AS id)
  SELECT l.user_id, l.grade::text AS grade, l.subject::text AS subject, NULL::text AS ref
    FROM lesson_plans l
    JOIN pop ON pop.id = l.user_id
   WHERE TRUE${withinUtc('l.created_at')}
  UNION
  SELECT o.user_id, NULL, NULL, o.plan_ref
    FROM niete_lp_opens o
    JOIN pop ON pop.id = o.user_id
   WHERE o.plan_kind = 'k5'${within('o.opened_at')}`;
  return { sql, params };
}

/**
 * Over the lists the route loaded (lib/analytics-lists loadAnalyticsLists): the band's RDF population, then
 * three reads in parallel — the schools, the population's schools, and its plan use in the window. When the
 * teacher lists are not loaded, the v7 roster is read first and the population built from it.
 *
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {{from: string|null, to: string|null}} range from analyticsRange (validated)
 * @param {'primary'|'midhigh'} band
 * @param {{lists?: object, regions?: readonly string[]}} [opts] regions: the viewer's (the v7 population's); FDE's
 *   six when omitted
 */
async function loadLpEngagementRows(query, range = {}, band = 'primary', { lists = {}, regions = REGION_BUCKETS } = {}) {
  const b = BANDS.includes(band) ? band : 'primary';
  lists = lists || {};
  const rdf = !(lists.missing && lists.missing.teachers) && lists[BAND_RULES[b].list] ? lists[BAND_RULES[b].list] : null;
  const bounds = windowBounds(range || {});

  if (rdf) {
    const ids = [...rdf.keys()];
    const lp = lpActivitySql(bounds, b, ids);
    const [schoolRes, teacherRes, lpRes] = await Promise.all([
      query(SCHOOLS_SQL, []),
      query(TEACHER_SCHOOLS_SQL, [ids]),
      query(lp.sql, lp.params),
    ]);
    return {
      population: rdf,
      fdeSchoolEmis: lists.fdeSchoolEmis || null,
      schools: schoolRes.rows || [],
      teachers: teacherRes.rows || [],
      activity: lpRes.rows || [],
    };
  }

  const [schoolRes, rosterRes] = await Promise.all([query(SCHOOLS_SQL, []), query(ROSTER_SQL, [])]);
  const schools = schoolRes.rows || [];
  const roster = rosterRes.rows || [];
  const population = v7Population(roster, schools, b, regions);
  const lp = lpActivitySql(bounds, b, [...population.keys()]);
  const lpRes = await query(lp.sql, lp.params);
  return {
    population,
    fdeSchoolEmis: lists.fdeSchoolEmis || null,
    schools,
    teachers: roster,
    activity: lpRes.rows || [],
  };
}

module.exports = {
  BANDS,
  parseBandFilter,
  parsePlanRef,
  lpSubjectKey,
  activePct,
  summarizeLpEngagement,
  loadLpEngagementRows,
};
