/**
 * Training level progress for the analytics-only accounts — the schools-analytics v7 Trainings tab
 * (bd-97x22y.4, PLAN v7 "Trainings"), the ICT dashboard's Trainings page 1 to 1 on NIETE's own data.
 * Its own endpoint, GET /api/portal/analytics/training-levels, so this tab's read never slows the others.
 *
 * Hers (ict-dashboards backend/api/bigquery_queries.py:2649-2729, views.py:1504-1579, frontend
 * pages/Trainings.jsx): per level Passed / In Progress / Not Started over the band's teachers, % passed;
 * per sector the % of teachers who passed each level; per sector "N of M teachers have passed all levels"
 * where passed all = passed Teacher Leader (views.py: passed_all_levels = teacher_leader_passed). All time:
 * her tab has no date filter.
 *
 * THE RULE IS NIETE'S, NOT HERS. Her states come from her BigQuery tables; ours are the bot's own
 * (loadVisibleLevelsWithProgress, bot/shared/routes/teacher-training-endpoint.js:1148, states at
 * :1312-1319), written here as one set-based read so it costs one statement, not a call per teacher:
 *
 *   visible levels  the teacher's ACTIVE teacher_training_assignments → training_program_scopes → the
 *                   vendor's active levels (NULL or empty level_ids = the whole vendor). Only NIETE's own
 *                   ladder (vendor TALEEMABAD: Aspiring Teacher, Emerging Practitioner, Skilled
 *                   Practitioner, Teacher Leader) is read — the four levels her page shows.
 *   locked          the vendor chains its levels (level_unlock_logic is not 'parallel') and the level just
 *                   below, when the teacher's programme shows it, is not certified. Checked FIRST, as the
 *                   bot does: a certificate above an unpassed level still reads locked.
 *   certified       a training_certificates row, or a passed level EXAM: quiz_kind grand|capstone, is_passed,
 *                   and the quiz an active grand_quiz|capstone of a level the teacher sees (a diagnostic
 *                   certifies nothing, bd-43491; a row with no quiz id predates diagnostics and stands).
 *   ready_for_quiz  every active module of every active course of the level done (a progress row each).
 *   in_progress     at least one of them done.
 *   not_started     none.
 *
 * Her three states (PLAN v7): Passed = certified; In Progress = in_progress + ready_for_quiz; Not Started =
 * not_started + locked. The denominator of a level is the band's teachers whose programme shows it.
 *
 * HER MID/HIGH PARTNER PANELS (operator, 2026-10-15: include them, her rules, NIETE's data). Over the Mid/High
 * cohort — every teacher holding MIDDLE or HIGH, her total_non_primary — as hers (bigquery_queries.py
 * get_oxbridge_counts_direct / get_beaconhouse_counts / get_beaconhouse_level_breakdown /
 * get_oxbridge_session_funnel / get_mid_high_passed_all_by_sector, views.py TrainingView MID_HIGH):
 *   Oxbridge     her sessions are the active modules of Oxbridge's active course (7 on prod); a session passed is
 *                a progress row on it (the module's check passed at Oxbridge's 70%, or the migrated record).
 *                Passed = every session; In Progress = at least one; Not Started = none. Per session the
 *                teachers who passed it, middle / high / total (a teacher in both counts in both, once in total),
 *                and "Completed all".
 *   Beaconhouse  a level (English / Mathematics / General Science / Computer Science) passed = its certificate
 *                or a passed exam attempt (grand or capstone). Passed = at least one level; In Progress = any
 *                Beaconhouse activity (a module passed or any attempt) without a pass; Not Started = none. Per
 *                level, middle / high / total.
 *   passed all   on Mid/High = NIETE Skilled Practitioner AND Teacher Leader passed AND Oxbridge passed AND
 *                Beaconhouse passed — her get_mid_high_passed_all_by_sector; on Primary, passed Teacher Leader.
 * The Mid/High "teachers" of a school, sector or the overview is that cohort (her total_teachers there).
 *
 * Bands — her Primary / Mid-High toggle — come from users.teacher_level (bot/shared/utils/teacher-level.js:
 * the single source; renamed from training_bands, bd-60095): Primary = holds PRIMARY, levels 1-4; Mid/High =
 * holds MIDDLE or HIGH, levels 3-4 (her Mid/High tab shows only Skilled Practitioner and Teacher Leader). A
 * teacher in both bands counts in both tabs, as hers does; one with no band is in neither. `all` (every
 * teacher, band or none) is the denominator the prod sanity check uses.
 *
 * School, region and roster: the /analytics/schools rules (schools-analytics.service) — teachers with a
 * school, test accounts out; only active, non-test schools in the six ICT sectors count, anything else is in
 * no number. Counts sum school → region → overview (a teacher belongs to one school).
 *
 * WHY A SNAPSHOT. The read touches every teacher's whole training history (~680k progress rows on prod) and
 * the answer moves slowly, so it is computed at most every 30 minutes per process and kept in memory: the
 * first request computes, concurrent requests share that one computation, and once a snapshot exists a
 * request never waits for a refresh — it is answered from the previous snapshot while one refresh runs.
 * Every band and region is summarised from the same snapshot (cheap, pure). The page says "as of" its time.
 */

const { REGION_BUCKETS, bucketOf } = require('./schools-analytics.service');

/** The bot's five states → her three buckets. */
const STATE_GROUP = Object.freeze({
  certified: 'passed',
  in_progress: 'inProgress',
  ready_for_quiz: 'inProgress',
  not_started: 'notStarted',
  locked: 'notStarted',
});

/** Her two tabs (and all): which teachers, and which rungs of the ladder (order_index). */
const BANDS = Object.freeze({
  primary: Object.freeze({ orders: Object.freeze([0, 1, 2, 3]), has: (r) => r.primary_band === true }),
  midhigh: Object.freeze({
    orders: Object.freeze([2, 3]),
    has: (r) => r.midhigh_band === true || r.middle_band === true || r.high_band === true,
  }),
  all: Object.freeze({ orders: Object.freeze([0, 1, 2, 3]), has: () => true }),
});

const BAND_BY_SPELLING = new Map([
  ['primary', 'primary'],
  ['midhigh', 'midhigh'], ['mid_high', 'midhigh'], ['mid-high', 'midhigh'],
  ['all', 'all'],
]);

/**
 * The ?band= filter. Blank or absent is Primary (her default tab); her spellings of Mid/High are taken;
 * anything else is refused rather than guessed at.
 * @returns {{ok: true, band: 'primary'|'midhigh'|'all'} | {ok: false}}
 */
function parseBandFilter(raw) {
  if (raw === undefined || raw === null) return { ok: true, band: 'primary' };
  if (typeof raw !== 'string') return { ok: false };
  const v = raw.trim().toLowerCase();
  if (v === '') return { ok: true, band: 'primary' };
  const band = BAND_BY_SPELLING.get(v);
  return band ? { ok: true, band } : { ok: false };
}

const count = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round1 = (n) => Math.round(n * 10) / 10;

/** The school's sector when it is counted (active, not a probable test, in the six), else null. */
function countedBucket(s) {
  if (!s || s.is_active !== true || s.is_probable_test === true) return null;
  return bucketOf(s.region);
}

// ── the pure summariser ──────────────────────────────────────────────────────

const emptyCell = () => ({ passed: 0, inProgress: 0, notStarted: 0 });

function emptyAcc(ladder) {
  return new Map(ladder.map((l) => [l.key, emptyCell()]));
}

function addInto(into, from) {
  for (const [k, cell] of from) {
    const t = into.get(k);
    t.passed += cell.passed;
    t.inProgress += cell.inProgress;
    t.notStarted += cell.notStarted;
  }
}

const pct = (x, n) => (n > 0 ? round1((x / n) * 100) : null);

function levelBlock(l, cell, withName) {
  const teachers = cell.passed + cell.inProgress + cell.notStarted;
  return {
    levelId: l.id,
    levelOrder: l.order,
    ...(withName ? { name: l.name } : {}),
    passed: cell.passed,
    inProgress: cell.inProgress,
    notStarted: cell.notStarted,
    teachers,
    pctPassed: pct(cell.passed, teachers),
  };
}

/** Her Mid/High cohort numbers for one school (summed to a sector and the overview). */
function emptyPartners(catalogue) {
  const split = () => ({ middle: 0, high: 0, total: 0 });
  return {
    cohort: 0,
    passedAll: 0,
    ox: { passed: 0, inProgress: 0, sessions: catalogue.oxbridge.map(split), completedAll: split() },
    bh: { passed: 0, inProgress: 0, levels: catalogue.beaconhouse.map(split) },
  };
}

function addPartners(into, from) {
  into.cohort += from.cohort;
  into.passedAll += from.passedAll;
  for (const k of ['passed', 'inProgress']) {
    into.ox[k] += from.ox[k];
    into.bh[k] += from.bh[k];
  }
  const addSplit = (a, b) => { a.middle += b.middle; a.high += b.high; a.total += b.total; };
  from.ox.sessions.forEach((x, i) => addSplit(into.ox.sessions[i], x));
  addSplit(into.ox.completedAll, from.ox.completedAll);
  from.bh.levels.forEach((x, i) => addSplit(into.bh.levels[i], x));
}

/** A partner card: her three states over the cohort. */
function partnerCard(p, cohort) {
  return {
    passed: p.passed,
    inProgress: p.inProgress,
    notStarted: Math.max(0, cohort - p.passed - p.inProgress),
    teachers: cohort,
    pctPassed: pct(p.passed, cohort),
  };
}

/** The overview's panels also carry her session funnel and her per-level table. */
function partnersBlock(acc, catalogue, detailed) {
  const oxbridge = partnerCard(acc.ox, acc.cohort);
  const beaconhouse = partnerCard(acc.bh, acc.cohort);
  if (detailed) {
    oxbridge.sessions = catalogue.oxbridge.map((s, i) => ({ name: s.name, ...acc.ox.sessions[i] }));
    oxbridge.completedAll = { ...acc.ox.completedAll };
    beaconhouse.levels = catalogue.beaconhouse.map((l, i) => ({ name: l.name, ...acc.bh.levels[i] }));
  }
  return { oxbridge, beaconhouse };
}

/**
 * A school, a region or the overview: its levels, and "N of M teachers have passed all levels". On Primary
 * that is passed Teacher Leader (the top rung) of the teachers whose programme shows it (hers:
 * passed_all_levels = teacher_leader_passed); on Mid/High it is hers over the cohort (see the header).
 */
function block(ladder, acc, partners, catalogue, { withName = false, detailed = false } = {}) {
  const levels = ladder.map((l) => levelBlock(l, acc.get(l.key), withName));
  if (partners) {
    return {
      teachers: partners.cohort,
      passedAll: partners.passedAll,
      levels,
      partners: partnersBlock(partners, catalogue, detailed),
    };
  }
  const top = levels[levels.length - 1];
  return {
    teachers: top ? top.teachers : 0,
    passedAll: top ? top.passed : 0,
    levels,
  };
}

/** The partner catalogue: Oxbridge's sessions and Beaconhouse's levels, each with its bit in the masks. */
function readCatalogue(rows) {
  const of = (partner) => (rows || [])
    .filter((r) => r && r.partner === partner && Number.isInteger(Number(r.bit)))
    .map((r) => ({ bit: Number(r.bit), name: r.name }))
    .sort((a, b) => a.bit - b.bit);
  return { oxbridge: of('oxbridge'), beaconhouse: of('beaconhouse') };
}

const hasBit = (mask, bit) => ((Number(mask) || 0) & (2 ** bit)) !== 0;

/** One 'partner' row (n teachers alike) into a school's cohort numbers. */
function addPartnerRow(acc, r, catalogue) {
  const n = count(r.teachers);
  const middle = r.middle_band === true;
  const high = r.high_band === true;
  const into = (split) => { if (middle) split.middle += n; if (high) split.high += n; split.total += n; };

  const sessions = catalogue.oxbridge.map((s) => hasBit(r.ox_mask, s.bit));
  const oxAll = sessions.length > 0 && sessions.every(Boolean);
  const oxAny = sessions.some(Boolean);
  const bhLevels = catalogue.beaconhouse.map((l) => hasBit(r.bh_mask, l.bit));
  const bhAny = bhLevels.some(Boolean);

  acc.cohort += n;
  if (oxAll) acc.ox.passed += n;
  else if (oxAny) acc.ox.inProgress += n;
  sessions.forEach((on, i) => { if (on) into(acc.ox.sessions[i]); });
  if (oxAll) into(acc.ox.completedAll);

  if (bhAny) acc.bh.passed += n;
  else if (r.bh_active === true) acc.bh.inProgress += n;
  bhLevels.forEach((on, i) => { if (on) into(acc.bh.levels[i]); });

  if (r.niete_both === true && oxAll && bhAny) acc.passedAll += n;
}

/**
 * @param {{
 *   levels?: Array<{id, name, order_index}>,
 *   schools?: Array<{id, name, emis, region, is_active, is_probable_test}>,
 *   partners?: Array<{partner: 'oxbridge'|'beaconhouse', bit, name}>,
 *   states?: Array<{kind?, school_id, primary_band, middle_band, high_band, midhigh_band, level_id, state,
 *                   ox_mask, bh_mask, bh_active, niete_both, teachers}>
 * }} rows  states: 'level' rows, one per (school, bands, level, state); 'partner' rows, one per (school, bands,
 *          Oxbridge sessions, Beaconhouse levels, activity, NIETE two passed), Mid/High teachers only
 * @param {{band?: 'primary'|'midhigh'|'all', region?: string|null}} [opts]
 * @returns {{overview: object, regions: object[], schools: object[]}}
 */
function summarizeTrainingLevels(rows = {}, opts = {}) {
  const bandKey = BANDS[opts.band] ? opts.band : 'primary';
  const band = BANDS[bandKey];
  const withPartners = bandKey === 'midhigh';
  const filter = opts.region || null;
  const src = rows || {};
  const catalogue = readCatalogue(src.partners);

  const ladder = (src.levels || [])
    .map((l) => ({ id: Number(l.id), key: String(l.id), name: l.name, order: Number(l.order_index) }))
    .filter((l) => band.orders.includes(l.order))
    .sort((a, b) => a.order - b.order);
  const keys = new Set(ladder.map((l) => l.key));

  const bySchool = new Map();
  for (const s of src.schools || []) {
    const bucket = countedBucket(s);
    if (!bucket) continue;
    bySchool.set(s.id, {
      school: s,
      bucket,
      acc: emptyAcc(ladder),
      partners: withPartners ? emptyPartners(catalogue) : null,
    });
  }

  for (const r of src.states || []) {
    if (!r || !band.has(r)) continue;
    const entry = bySchool.get(r.school_id);
    if (!entry) continue;
    if (r.kind === 'partner') {
      if (entry.partners) addPartnerRow(entry.partners, r, catalogue);
      continue;
    }
    const key = String(r.level_id);
    if (!keys.has(key)) continue;
    const group = STATE_GROUP[r.state];
    if (!group) continue;
    entry.acc.get(key)[group] += count(r.teachers);
  }

  const regionAcc = new Map(REGION_BUCKETS.map((b) => [b, {
    acc: emptyAcc(ladder), partners: withPartners ? emptyPartners(catalogue) : null,
  }]));
  const overview = { acc: emptyAcc(ladder), partners: withPartners ? emptyPartners(catalogue) : null };
  const schools = [];

  for (const entry of bySchool.values()) {
    const region = regionAcc.get(entry.bucket);
    addInto(region.acc, entry.acc);
    if (withPartners) addPartners(region.partners, entry.partners);
    if (filter && entry.bucket !== filter) continue;
    addInto(overview.acc, entry.acc);
    if (withPartners) addPartners(overview.partners, entry.partners);
    const b = block(ladder, entry.acc, entry.partners, catalogue);
    // A school with none of the band's teachers has nothing to show in this tab.
    if (!(b.teachers > 0) && !b.levels.some((l) => l.teachers > 0)) continue;
    // Her school row is "passed all levels" of the teachers; per level the passed count and % (no
    // in-progress / not-started split) keeps ~420 schools × 4 levels small enough for a phone.
    schools.push({
      schoolId: entry.school.id,
      emis: entry.school.emis == null ? null : String(entry.school.emis),
      name: entry.school.name,
      region: entry.bucket,
      teachers: b.teachers,
      passedAll: b.passedAll,
      levels: b.levels.map((l) => ({ levelOrder: l.levelOrder, passed: l.passed, teachers: l.teachers, pctPassed: l.pctPassed })),
    });
  }

  const order = new Map(REGION_BUCKETS.map((b, i) => [b, i]));
  schools.sort((a, b) => (order.get(a.region) - order.get(b.region))
    || String(a.name || '').localeCompare(String(b.name || '')));

  return {
    overview: block(ladder, overview.acc, overview.partners, catalogue, { withName: true, detailed: true }),
    regions: REGION_BUCKETS.map((b) => {
      const r = regionAcc.get(b);
      return { region: b, ...block(ladder, r.acc, r.partners, catalogue) };
    }),
    schools,
  };
}

// ── the reads ────────────────────────────────────────────────────────────────

/** NIETE's own ladder: the vendor whose levels her page shows. */
const NIETE_VENDOR_KEY = 'TALEEMABAD';

const LEVELS_SQL = `
  SELECT l.id, l.name, l.order_index
    FROM training_levels l
    JOIN training_vendors v ON v.id = l.vendor_id
   WHERE v.key = '${NIETE_VENDOR_KEY}' AND l.is_active
   ORDER BY l.order_index`;

const SCHOOLS_SQL = `
  SELECT id, name, emis, region, is_active, is_probable_test
    FROM schools`;

/** Her two Mid/High partner programmes, as NIETE's vendors are keyed. */
const OXBRIDGE_KEY = 'OXBRIDGE';
const BEACONHOUSE_KEY = 'BEACONHOUSE';

const PARTNER_LEVELS = (vendor) => `
      SELECT l.id, l.order_index
        FROM training_levels l
        JOIN training_vendors v ON v.id = l.vendor_id
       WHERE v.key = '${vendor}' AND l.is_active`;

/** The ids of a partner's active levels, for `level_id IN (...)`. */
const PARTNER_LEVEL_IDS = (vendor) => `SELECT pl.id FROM (${PARTNER_LEVELS(vendor)}) pl`;

/** Oxbridge's sessions in order: the active modules of its active course(s); bit = position (0-based). */
const OX_SESSION_ORDER = 'row_number() OVER (ORDER BY c.order_index, m.order_index, m.id) - 1';

/**
 * The partner catalogue, one row per Oxbridge session and per Beaconhouse level, with the bit each has in the
 * states read's masks — written with the same ordering as the states read, so the two always agree.
 */
const PARTNERS_SQL = `
  SELECT 'oxbridge' AS partner, (${OX_SESSION_ORDER})::int AS bit, m.title AS name
    FROM training_modules m
    JOIN training_courses c ON c.id = m.course_id
   WHERE m.is_active AND c.is_active
     AND c.level_id IN (${PARTNER_LEVEL_IDS(OXBRIDGE_KEY)})
  UNION ALL
  SELECT 'beaconhouse' AS partner, l.order_index AS bit, l.name
    FROM training_levels l
    JOIN training_vendors v ON v.id = l.vendor_id
   WHERE v.key = '${BEACONHOUSE_KEY}' AND l.is_active
   ORDER BY 1, 2`;

/**
 * One row per (school, bands, level, state) — kind 'level': how many of the school's teachers are in that state
 * — and, for Mid/High teachers, one per (school, bands, Oxbridge sessions passed, Beaconhouse levels passed,
 * Beaconhouse activity, NIETE Skilled Practitioner + Teacher Leader passed) — kind 'partner'.
 *
 * Shape — planner-proof, no per-teacher work. Every input is read once into a materialised CTE: the roster,
 * the (teacher, level) pairs her programmes show (carrying her school and bands), modules done per
 * (teacher, level), certificates, and passed level-exam attempts with their quiz's level. Those facts are
 * folded into one row per (teacher, level) by a GROUP BY over a UNION ALL, and everything after that is
 * window functions over that one set: her visible levels (for the exam check), then the level below (lag).
 * The partner facts are folded per teacher the same way. No two large sets are ever JOINED, so a bad row
 * estimate on a CTE cannot turn into a nested loop over 20k × 20k rows (the naive per-level join plan needed
 * nested loops off to finish on prod). The only joins left are to the small catalogues (the four-row ladder,
 * module totals, the partner levels, Oxbridge's seven sessions) and to the real tables, whose statistics the
 * planner has.
 *
 * The roster is spelled as schools-analytics.service's ROSTER_TEACHER; the school rule is applied after, in
 * the summariser, with the same bucketOf.
 */
function trainingStatesSql() {
  const band = (test) => `EXISTS (SELECT 1 FROM unnest(u.teacher_level) AS b(v) WHERE upper(btrim(b.v)) ${test})`;
  return `
  WITH ladder AS MATERIALIZED (
    -- NIETE's own levels, and whether its vendor chains them (teacher-training-endpoint.js isLevelChainLocked)
    SELECT l.id, l.vendor_id, l.order_index,
           (COALESCE(v.level_unlock_logic, '') <> 'parallel') AS chained
      FROM training_levels l
      JOIN training_vendors v ON v.id = l.vendor_id
     WHERE v.key = '${NIETE_VENDOR_KEY}' AND l.is_active
  ),
  roster AS MATERIALIZED (
    -- today's roster (schools-analytics ROSTER_TEACHER) with her bands (teacher-level.js: trimmed, upper-cased)
    SELECT u.id AS user_id, u.school_id,
           ${band("= 'PRIMARY'")} AS primary_band,
           ${band("= 'MIDDLE'")} AS middle_band,
           ${band("= 'HIGH'")} AS high_band
      FROM users u
     WHERE u.role = 'teacher'
       AND u.school_id IS NOT NULL
       AND u.is_test_user IS NOT TRUE
  ),
  visible AS MATERIALIZED (
    -- the (teacher, level) pairs her programmes show: active assignments → scopes; NULL / empty level_ids = all
    SELECT DISTINCT r.user_id, r.school_id, r.primary_band, r.middle_band, r.high_band, l.id AS level_id
      FROM roster r
      JOIN teacher_training_assignments a ON a.user_id = r.user_id AND a.is_active
      JOIN training_program_scopes s ON s.program_id = a.program_id
      JOIN ladder l ON l.vendor_id = s.vendor_id
     WHERE s.level_ids IS NULL OR cardinality(s.level_ids) = 0 OR l.id = ANY (s.level_ids)
  ),
  done AS MATERIALIZED (
    -- modules done per (teacher, level): a progress row is a passed module (one per user and module); only
    -- active modules of active courses make a level
    SELECT p.user_id, c.level_id, count(*)::int AS done
      FROM teacher_training_progress p
      JOIN training_modules m ON m.id = p.module_id AND m.is_active
      JOIN training_courses c ON c.id = m.course_id AND c.is_active
     WHERE c.level_id IN (SELECT id FROM ladder)
     GROUP BY p.user_id, c.level_id
  ),
  module_totals AS MATERIALIZED (
    SELECT c.level_id, count(*)::int AS total
      FROM training_modules m
      JOIN training_courses c ON c.id = m.course_id
     WHERE m.is_active AND c.is_active AND c.level_id IN (SELECT id FROM ladder)
     GROUP BY c.level_id
  ),
  exams AS MATERIALIZED (
    -- passed level-exam attempts (isGrandPass): kind grand|capstone; quiz_level = the level of the quiz when it
    -- is an active grand_quiz|capstone, 0 when the attempt has no quiz id (it predates diagnostics and stands),
    -- NULL otherwise (a diagnostic certifies nothing)
    SELECT a.user_id, a.level_id,
           CASE WHEN a.grand_quiz_id IS NULL THEN 0 ELSE q.level_id END AS quiz_level
      FROM training_assessment_attempts a
      LEFT JOIN training_grand_quizzes q
             ON q.id = a.grand_quiz_id AND q.is_active AND q.quiz_type IN ('grand_quiz', 'capstone')
     WHERE a.is_passed IS TRUE
       AND a.quiz_kind IN ('grand', 'capstone')
       AND a.level_id IN (SELECT id FROM ladder)
  ),
  certs AS MATERIALIZED (
    SELECT c.user_id, c.level_id FROM training_certificates c WHERE c.level_id IN (SELECT id FROM ladder)
  ),
  facts AS MATERIALIZED (
    -- one row per (teacher, level) she is shown: her school and bands, certificate?, exam quiz levels, done
    SELECT f.user_id, f.level_id,
           (array_agg(f.school_id) FILTER (WHERE f.vis = 1))[1] AS school_id,
           bool_or(f.primary_band) AS primary_band,
           bool_or(f.middle_band) AS middle_band,
           bool_or(f.high_band) AS high_band,
           max(f.cert) AS cert,
           sum(f.done)::int AS done,
           array_agg(f.quiz_level) FILTER (WHERE f.quiz_level IS NOT NULL) AS quiz_levels
      FROM (
        SELECT user_id, level_id, school_id, primary_band, middle_band, high_band, 1 AS vis, 0 AS cert, 0 AS done, NULL::bigint AS quiz_level FROM visible
        UNION ALL
        SELECT user_id, level_id, NULL, NULL, NULL, NULL, 0, 1, 0, NULL FROM certs
        UNION ALL
        SELECT user_id, level_id, NULL, NULL, NULL, NULL, 0, 0, done, NULL FROM done
        UNION ALL
        SELECT user_id, level_id, NULL, NULL, NULL, NULL, 0, 0, 0, quiz_level FROM exams
      ) f
     GROUP BY f.user_id, f.level_id
    HAVING max(f.vis) = 1
  ),
  judged AS (
    -- certified: a certificate, or a passed exam whose quiz is of a level she sees (0 = no quiz id, stands)
    SELECT x.*,
           (x.cert = 1 OR COALESCE(x.quiz_levels && (x.visible_levels || 0::bigint), false)) AS certified
      FROM (
        SELECT f.*, l.order_index, l.vendor_id, l.chained,
               array_agg(f.level_id) OVER (PARTITION BY f.user_id) AS visible_levels
          FROM facts f
          JOIN ladder l ON l.id = f.level_id
      ) x
  ),
  ordered AS (
    -- the level below among her VISIBLE levels of the same vendor (the bot's prevLevel)
    SELECT j.*,
           lag(j.order_index) OVER w AS prev_order,
           lag(j.certified) OVER w AS prev_certified
      FROM judged j
    WINDOW w AS (PARTITION BY j.user_id, j.vendor_id ORDER BY j.order_index)
  ),
  states AS MATERIALIZED (
    -- the bot's precedence: locked, certified, ready_for_quiz, in_progress, not_started
    SELECT o.user_id, o.school_id, o.primary_band, o.middle_band, o.high_band, o.level_id, o.order_index,
           CASE
             WHEN o.chained AND o.prev_order = o.order_index - 1 AND NOT o.prev_certified THEN 'locked'
             WHEN o.certified THEN 'certified'
             WHEN mt.total > 0 AND o.done >= mt.total THEN 'ready_for_quiz'
             WHEN o.done > 0 THEN 'in_progress'
             ELSE 'not_started'
           END AS state
      FROM ordered o
      LEFT JOIN module_totals mt ON mt.level_id = o.level_id
  ),
  ox_sessions AS MATERIALIZED (
    -- her Oxbridge sessions: the active modules of its active course(s), in order (7 on prod)
    SELECT m.id AS module_id, (${OX_SESSION_ORDER})::int AS bit
      FROM training_modules m
      JOIN training_courses c ON c.id = m.course_id
     WHERE m.is_active AND c.is_active
       AND c.level_id IN (${PARTNER_LEVEL_IDS(OXBRIDGE_KEY)})
  ),
  bh_levels AS MATERIALIZED (${PARTNER_LEVELS(BEACONHOUSE_KEY)}
  ),
  partner_facts AS MATERIALIZED (
    -- one row per Mid/High teacher: sessions passed (bits), Beaconhouse levels passed (bits), activity, and
    -- whether NIETE's Skilled Practitioner and Teacher Leader are both passed
    SELECT f.user_id,
           (array_agg(f.school_id) FILTER (WHERE f.mine))[1] AS school_id,
           bool_or(f.primary_band) AS primary_band,
           bool_or(f.middle_band) AS middle_band,
           bool_or(f.high_band) AS high_band,
           bit_or(f.ox_mask) AS ox_mask,
           bit_or(f.bh_mask) AS bh_mask,
           bool_or(f.bh_active) AS bh_active,
           bool_or(f.niete_both) AS niete_both
      FROM (
        SELECT user_id, school_id, primary_band, middle_band, high_band, true AS mine,
               0 AS ox_mask, 0 AS bh_mask, false AS bh_active, false AS niete_both
          FROM roster
         WHERE middle_band OR high_band
        UNION ALL
        -- an Oxbridge session passed: a progress row on its module
        SELECT p.user_id, NULL, NULL, NULL, NULL, false, (1 << s.bit), 0, false, false
          FROM teacher_training_progress p
          JOIN ox_sessions s ON s.module_id = p.module_id
        UNION ALL
        -- a Beaconhouse level passed: its certificate
        SELECT c.user_id, NULL, NULL, NULL, NULL, false, 0, (1 << bl.order_index), true, false
          FROM training_certificates c
          JOIN bh_levels bl ON bl.id = c.level_id
        UNION ALL
        -- any Beaconhouse attempt is activity; a passed exam (grand or capstone) passes the level
        SELECT a.user_id, NULL, NULL, NULL, NULL, false, 0,
               CASE WHEN a.is_passed IS TRUE AND a.quiz_kind IN ('grand', 'capstone') THEN (1 << bl.order_index) ELSE 0 END,
               true, false
          FROM training_assessment_attempts a
          JOIN bh_levels bl ON bl.id = a.level_id
        UNION ALL
        -- a Beaconhouse module passed is activity
        SELECT p.user_id, NULL, NULL, NULL, NULL, false, 0, 0, true, false
          FROM teacher_training_progress p
          JOIN training_modules m ON m.id = p.module_id
          JOIN training_courses c ON c.id = m.course_id
         WHERE c.level_id IN (SELECT id FROM bh_levels)
        UNION ALL
        -- NIETE Skilled Practitioner AND Teacher Leader passed (her sp_tl)
        SELECT user_id, NULL, NULL, NULL, NULL, false, 0, 0, false, true
          FROM states
         WHERE state = 'certified' AND order_index IN (2, 3)
         GROUP BY user_id
        HAVING count(*) = 2
      ) f
     GROUP BY f.user_id
    HAVING bool_or(f.mine)
  )
  SELECT 'level' AS kind, school_id, primary_band, middle_band, high_band, (middle_band OR high_band) AS midhigh_band,
         level_id, state, NULL::int AS ox_mask, NULL::int AS bh_mask, NULL::boolean AS bh_active,
         NULL::boolean AS niete_both, count(*)::int AS teachers
    FROM states
   GROUP BY school_id, primary_band, middle_band, high_band, level_id, state
  UNION ALL
  SELECT 'partner', school_id, primary_band, middle_band, high_band, (middle_band OR high_band),
         NULL, NULL, ox_mask, bh_mask, bh_active, niete_both, count(*)::int
    FROM partner_facts
   GROUP BY school_id, primary_band, middle_band, high_band, ox_mask, bh_mask, bh_active, niete_both`;
}

/**
 * Four reads, in parallel, none taking anything from the request: the ladder, the schools, the partner
 * catalogue and the grouped states.
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 */
async function loadTrainingLevelRows(query) {
  const [levelRes, schoolRes, partnerRes, stateRes] = await Promise.all([
    query(LEVELS_SQL),
    query(SCHOOLS_SQL),
    query(PARTNERS_SQL),
    query(trainingStatesSql()),
  ]);
  return {
    levels: levelRes.rows || [],
    schools: schoolRes.rows || [],
    partners: partnerRes.rows || [],
    states: stateRes.rows || [],
  };
}

/**
 * An in-memory snapshot, refreshed at most every `maxAgeMs`, never waited on once it exists.
 *
 *   - no snapshot yet: the request computes it; concurrent requests share that one computation; a failure
 *     rejects (there is nothing to show) and the next request tries again;
 *   - fresh: returned as is;
 *   - stale: returned AT ONCE, and one refresh starts behind it (later requests share it); a failed refresh
 *     keeps the old snapshot, is reported to onError, and the next request tries again.
 *
 * computedAt is when the computation that produced the snapshot began — the data is as of then.
 */
function createSnapshot({
  load,
  maxAgeMs = 30 * 60 * 1000,
  now = () => Date.now(),
  onError = (err) => console.error('training-levels snapshot refresh failed:', err && err.message),
} = {}) {
  let current = null;
  let inflight = null;

  function refresh() {
    if (!inflight) {
      const startedAt = now();
      inflight = Promise.resolve()
        .then(() => load())
        .then((rows) => {
          current = { rows, computedAt: new Date(startedAt).toISOString(), at: startedAt };
          return current;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  return {
    async get() {
      if (!current) return refresh();
      if (now() - current.at >= maxAgeMs) refresh().catch(onError);
      return current;
    },
    clear() { current = null; },
  };
}

module.exports = {
  STATE_GROUP,
  BANDS,
  NIETE_VENDOR_KEY,
  parseBandFilter,
  summarizeTrainingLevels,
  trainingStatesSql,
  loadTrainingLevelRows,
  createSnapshot,
};
