/**
 * Training progress for the analytics-only accounts: the schools-analytics Trainings tab. Its own endpoint,
 * GET /api/portal/analytics/training-levels, so this tab's read never slows the others.
 *
 * v8 (FDE feedback, operator 2026-10-19: "RDFs are the numbers that the others follow"). The numbers are the RDF's
 * certificate cards (routine-data-flow rdf_niete/render.py training_certificates_block, which the Grades 6-12 brief
 * reuses for its middle/high card); the page keeps NIETE's own level rule for the people without a certificate.
 *
 *   population   the RDF's: a user row that is live (no deleted_at, phone_number not a `merged:` tombstone) holding an
 *                ACTIVE teacher_training_assignments row on the programme — any role, any school or none.
 *                  Primary   niete_primary        NIETE levels 1-4 (Aspiring Teacher … Teacher Leader)
 *                  Mid/High  niete_middle_high    NIETE Skilled Practitioner + Teacher Leader, and the partner cards
 *                A member of both programmes counts on both tabs, as on the RDF's two cards.
 *   Passed       a training_certificates row for the level (the RDF's numerator; one writer, issueCertificate).
 *   In Progress  no certificate, and the bot's own level rule (loadVisibleLevelsWithProgress,
 *                bot/shared/routes/teacher-training-endpoint.js) has the level under way: in progress, ready for its
 *                exam, or the exam passed without a certificate on record.
 *   Not Started  the rest — nothing done, the level locked behind an unpassed one, or not on her programme.
 *   denominator  every member of the population, for every level (the RDF's: certified ÷ assigned).
 *   passed all   Primary: the Teacher Leader certificate. Mid/High: the Skilled Practitioner, Teacher Leader, GBTLA
 *                (Oxbridge) and AI-Powered Subject Pedagogy (Beaconhouse) certificates. The Teacher Development
 *                Programme (I-SAPS) is shown on its own and is not part of it (operator, 2026-10-19).
 *
 * MID/HIGH PARTNER CARDS, over the middle/high population, NIETE's programme names (the vendor KEYS never change;
 * their display names did, on 2026-10-13):
 *   GBTLA (OXBRIDGE)       Passed = the certificate (the RDF's level 17); In Progress = a session passed or an attempt
 *                          without it. Per session (the active modules of its active course) middle / high / total, and
 *                          "Completed all" sessions.
 *   AI-Powered Subject     Passed = a certificate for any of its subjects (the RDF's levels 18-21, once per teacher);
 *   Pedagogy (BEACONHOUSE) In Progress = any activity without one. Per subject middle / high / total.
 *   Teacher Development    over the members ASSIGNED it (an active assignment whose programme scopes the vendor):
 *   Programme (ISAPS)      Passed = its level certificate; In Progress = any unit or module exam without it; Not
 *                          Started = none. Per module (course "Module N", exam = the active grand quiz 900 + N, the
 *                          bot's own mapping) middle / high / total, and "Completed all" (= the certificate).
 * Middle / high come from users.teacher_level (a member with neither counts in the total only).
 *
 * SECTORS AND SCHOOLS (PLAN v8 shared contract, dashboard/lib/analytics-lists.js). A member's sector is her RDF
 * allocation sector: the lists' sectorByUser — every user on the allocation file, any role, the RDF's own uid2sect,
 * which is what its certificate card groups by (principals included) — or, when that is not stored, populationSectors
 * (the two teacher Maps). A member the allocation does not place is in the noSector block — never dropped, so the six
 * sectors plus noSector add up to the whole, as the RDF's "no sector" bar does. A member's school row is her school
 * when it is on FDE's programme list (onFdeList), else her sector's "No school" row (noSchoolId(sector), noSchool:
 * true — the id every analytics tab uses).
 * FAIL-CLOSED, as the lists ask: a list that is not usable is null, never empty, and the v7 rule stands for it —
 * no teacher lists: the sector is her school's when that school counts (active, not a probable test, in the six);
 * no school list: every counted school is a row. The population and every count never depend on the lists.
 *
 * WHOSE MEMBERS (bd-97daxo.3). The population is every programme member in the deployment, and a member the
 * allocation does not place lands in noSector — so without a rule, another organization's teachers (Moawin's
 * Gilgit-Baltistan, on the same programmes) would land in FDE's noSector and overview. opts.regions is the viewer's
 * organization's regions (the region registry, read by the route); opts.foreignRegions every other organization's.
 * A member's HOME is the registry region her school's region names, else the one her users.region names, else none:
 *   - placed in one of `regions` (her sector above)          counted, as before;
 *   - home in `regions`                                      counted (in noSector when not placed);
 *   - home in another organization's region                  NOT counted, anywhere;
 *   - no home (no school, a junk region, nothing on record)  counted only when opts.keepsUnplaced — the default
 *                                                            organization's (FDE's) view, where it always was.
 * No regions passed = FDE's six, keepsUnplaced, no foreign regions: the answer before organizations.
 *
 * WHY A SNAPSHOT. The read touches every member's whole training history (~680k progress rows on prod) and the answer
 * moves slowly, so it is computed at most every 30 minutes per process and kept in memory: the first request computes,
 * concurrent requests share that one computation, and once a snapshot exists a request never waits for a refresh — it
 * is answered from the previous snapshot while one refresh runs. Every band and region is summarised from the same
 * snapshot (cheap, pure). The page says "as of" its time.
 */

const { REGION_BUCKETS, bucketOf } = require('./schools-analytics.service');
const { onFdeList, populationSectors, noSchoolId } = require('../lib/analytics-lists');
const { PER_MODULE_SOURCE_BASE } = require('../../bot/shared/services/training/isaps-module-exam.rules');

/** The RDF's two certificate cards, by programme key (render.py CERT_PROGRAMMES). */
const PROGRAMME_KEYS = Object.freeze({ primary: 'niete_primary', midhigh: 'niete_middle_high' });

/** The two tabs (and all): which members, and which rungs of NIETE's ladder (order_index). */
const BANDS = Object.freeze({
  primary: Object.freeze({ orders: Object.freeze([0, 1, 2, 3]), has: (m) => m.primary_cohort === true }),
  midhigh: Object.freeze({ orders: Object.freeze([2, 3]), has: (m) => m.mh_cohort === true }),
  all: Object.freeze({ orders: Object.freeze([0, 1, 2, 3]), has: (m) => m.primary_cohort === true || m.mh_cohort === true }),
});

const BAND_BY_SPELLING = new Map([
  ['primary', 'primary'],
  ['midhigh', 'midhigh'], ['mid_high', 'midhigh'], ['mid-high', 'midhigh'],
  ['all', 'all'],
]);

/**
 * The ?band= filter. Blank or absent is Primary (the default tab); the Mid/High spellings are taken; anything else is
 * refused rather than guessed at.
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

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (x, n) => (n > 0 ? round1((x / n) * 100) : null);
const hasBit = (mask, bit) => ((Number(mask) || 0) & (2 ** bit)) !== 0;
const levelSet = (v) => new Set((Array.isArray(v) ? v : []).map(String));

// ── the pure summariser ──────────────────────────────────────────────────────

/** The partner catalogue: GBTLA's sessions, Beaconhouse's subjects, I-SAPS's modules, each with its bit in the masks. */
function readCatalogue(rows) {
  const of = (partner) => (rows || [])
    .filter((r) => r && r.partner === partner && Number.isInteger(Number(r.bit)))
    .map((r) => ({ bit: Number(r.bit), name: r.name }))
    .sort((a, b) => a.bit - b.bit);
  return { oxbridge: of('oxbridge'), beaconhouse: of('beaconhouse'), isaps: of('isaps') };
}

const split = () => ({ middle: 0, high: 0, total: 0 });

function emptyPartners(catalogue) {
  return {
    ox: { passed: 0, inProgress: 0, teachers: 0, sessions: catalogue.oxbridge.map(split), completedAll: split() },
    bh: { passed: 0, inProgress: 0, teachers: 0, levels: catalogue.beaconhouse.map(split) },
    isaps: { passed: 0, inProgress: 0, teachers: 0, modules: catalogue.isaps.map(split), completedAll: split() },
  };
}

/** A school, a sector, noSector or the overview, while members are added. */
function emptyAcc(ladder, catalogue, withPartners) {
  return {
    teachers: 0,
    passedAll: 0,
    levels: new Map(ladder.map((l) => [l.key, { passed: 0, inProgress: 0, notStarted: 0 }])),
    partners: withPartners ? emptyPartners(catalogue) : null,
  };
}

/** The school's sector when v7 counts it (active, not a probable test, in `regions`), else null. */
function countedBucket(s, regions = REGION_BUCKETS) {
  if (!s || s.is_active !== true || s.is_probable_test === true) return null;
  return bucketOf(s.region, regions);
}

/** Did this member pass all levels on this tab (see the header)? */
function passedAllLevels(m, ladder, certs, bandKey) {
  if (ladder.length === 0) return false;
  if (bandKey === 'midhigh') {
    return ladder.every((l) => certs.has(l.key)) && m.ox_cert === true && (Number(m.bh_mask) || 0) !== 0;
  }
  return certs.has(ladder[ladder.length - 1].key);
}

function addPartnerFacts(p, m, catalogue) {
  const into = (s) => { if (m.middle_band === true) s.middle += 1; if (m.high_band === true) s.high += 1; s.total += 1; };

  p.ox.teachers += 1;
  const sessions = catalogue.oxbridge.map((s) => hasBit(m.ox_mask, s.bit));
  if (m.ox_cert === true) p.ox.passed += 1;
  else if (m.ox_active === true || sessions.some(Boolean)) p.ox.inProgress += 1;
  sessions.forEach((on, i) => { if (on) into(p.ox.sessions[i]); });
  if (sessions.length > 0 && sessions.every(Boolean)) into(p.ox.completedAll);

  p.bh.teachers += 1;
  if ((Number(m.bh_mask) || 0) !== 0) p.bh.passed += 1;
  else if (m.bh_active === true) p.bh.inProgress += 1;
  catalogue.beaconhouse.forEach((l, i) => { if (hasBit(m.bh_mask, l.bit)) into(p.bh.levels[i]); });

  if (m.isaps_assigned !== true) return;
  p.isaps.teachers += 1;
  const modules = catalogue.isaps.map((x) => hasBit(m.isaps_mask, x.bit));
  if (m.isaps_cert === true) {
    p.isaps.passed += 1;
    into(p.isaps.completedAll);
  } else if (m.isaps_active === true || modules.some(Boolean)) {
    p.isaps.inProgress += 1;
  }
  modules.forEach((on, i) => { if (on) into(p.isaps.modules[i]); });
}

function addMember(acc, m, ladder, catalogue, bandKey) {
  const certs = levelSet(m.cert_levels);
  const active = levelSet(m.active_levels);
  acc.teachers += 1;
  for (const l of ladder) {
    const cell = acc.levels.get(l.key);
    if (certs.has(l.key)) cell.passed += 1;
    else if (active.has(l.key)) cell.inProgress += 1;
    else cell.notStarted += 1;
  }
  if (passedAllLevels(m, ladder, certs, bandKey)) acc.passedAll += 1;
  if (acc.partners) addPartnerFacts(acc.partners, m, catalogue);
}

/** A partner card: three states over its own population. */
function partnerCard(p) {
  return {
    passed: p.passed,
    inProgress: p.inProgress,
    notStarted: Math.max(0, p.teachers - p.passed - p.inProgress),
    teachers: p.teachers,
    pctPassed: pct(p.passed, p.teachers),
  };
}

/** The overview's panels also carry the session, subject and module tables. */
function partnersBlock(p, catalogue, detailed) {
  const oxbridge = partnerCard(p.ox);
  const beaconhouse = partnerCard(p.bh);
  const isaps = partnerCard(p.isaps);
  if (detailed) {
    oxbridge.sessions = catalogue.oxbridge.map((s, i) => ({ name: s.name, ...p.ox.sessions[i] }));
    oxbridge.completedAll = { ...p.ox.completedAll };
    beaconhouse.levels = catalogue.beaconhouse.map((l, i) => ({ name: l.name, ...p.bh.levels[i] }));
    isaps.modules = catalogue.isaps.map((x, i) => ({ name: x.name, ...p.isaps.modules[i] }));
    isaps.completedAll = { ...p.isaps.completedAll };
  }
  return { oxbridge, beaconhouse, isaps };
}

function block(ladder, acc, catalogue, { withName = false, detailed = false } = {}) {
  const levels = ladder.map((l) => {
    const cell = acc.levels.get(l.key);
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
  });
  const out = { teachers: acc.teachers, passedAll: acc.passedAll, levels };
  if (acc.partners) out.partners = partnersBlock(acc.partners, catalogue, detailed);
  return out;
}

/**
 * @param {{
 *   levels?: Array<{id, name, order_index}>,
 *   schools?: Array<{id, name, emis}>,
 *   partners?: Array<{partner: 'oxbridge'|'beaconhouse'|'isaps', bit, name}>,
 *   members?: Array<{user_id, school_id, primary_cohort, mh_cohort, middle_band, high_band, cert_levels, active_levels,
 *                    ox_mask, ox_cert, ox_active, bh_mask, bh_active, isaps_assigned, isaps_cert, isaps_mask,
 *                    isaps_active}>,
 *   lists?: {fdeSchoolEmis: Set<string>|null, primary: Map|null, midHigh: Map|null, missing: object}|null
 * }} rows  one members row per programme member (the RDF population), and loadAnalyticsLists' answer
 * @param {{band?: 'primary'|'midhigh'|'all', region?: string|null, regions?: readonly string[],
 *          foreignRegions?: readonly string[], keepsUnplaced?: boolean}} [opts] see WHOSE MEMBERS in the header
 * @returns {{overview: object, regions: object[], noSector: object, schools: object[]}}
 */
function summarizeTrainingLevels(rows = {}, opts = {}) {
  const bandKey = BANDS[opts.band] ? opts.band : 'primary';
  const band = BANDS[bandKey];
  const withPartners = bandKey === 'midhigh';
  const filter = opts.region || null;
  const regionList = opts.regions || REGION_BUCKETS;
  const known = [...regionList, ...(opts.foreignRegions || [])];
  const keepsUnplaced = opts.keepsUnplaced !== false;
  const src = rows || {};
  const catalogue = readCatalogue(src.partners);
  const lists = src.lists || null;
  // The RDF's uid2sect (any role) when stored; else the two teacher populations' sectors; else (null) v7's.
  const rdfSectors = lists && lists.sectorByUser instanceof Map ? lists.sectorByUser : populationSectors(lists);
  const schoolListUsable = !!(lists && lists.fdeSchoolEmis instanceof Set && !(lists.missing && lists.missing.schools));
  const schoolsById = new Map((src.schools || []).map((s) => [s.id, s]));
  // FAIL-CLOSED: without the teacher lists, v7's sector — her school's, when it counts.
  const sectorOf = rdfSectors
    ? (m) => bucketOf(rdfSectors.get(m.user_id), regionList) || null
    : (m) => countedBucket(schoolsById.get(m.school_id), regionList);
  // FAIL-CLOSED: without the school list, v7's schools — every counted one.
  const listed = (s) => (schoolListUsable ? onFdeList(lists, s.emis) : countedBucket(s, regionList) !== null);
  // Whose member she is when no sector places her (WHOSE MEMBERS, in the header).
  const homeOf = (m) => {
    const s = schoolsById.get(m.school_id);
    return bucketOf(s && s.region, known) || bucketOf(m.region, known);
  };
  const counts = (m, sector) => {
    if (sector) return true;
    const home = homeOf(m);
    return home ? regionList.includes(home) : keepsUnplaced;
  };

  const ladder = (src.levels || [])
    .map((l) => ({ id: Number(l.id), key: String(l.id), name: l.name, order: Number(l.order_index) }))
    .filter((l) => band.orders.includes(l.order))
    .sort((a, b) => a.order - b.order);

  const acc = () => emptyAcc(ladder, catalogue, withPartners);
  const overview = acc();
  const noSector = acc();
  const regionAcc = new Map(regionList.map((b) => [b, acc()]));
  const schoolRows = new Map();

  for (const m of src.members || []) {
    if (!m || !band.has(m)) continue;
    const sector = sectorOf(m);
    if (!counts(m, sector)) continue;
    addMember(sector ? regionAcc.get(sector) : noSector, m, ladder, catalogue, bandKey);
    if (filter && sector !== filter) continue;
    addMember(overview, m, ladder, catalogue, bandKey);
    if (!sector) continue;
    const s = schoolsById.get(m.school_id);
    const school = s && listed(s) ? s : null;
    const key = `${sector}|${school ? school.id : ''}`;
    if (!schoolRows.has(key)) schoolRows.set(key, { sector, school, acc: emptyAcc(ladder, catalogue, false) });
    addMember(schoolRows.get(key).acc, m, ladder, catalogue, bandKey);
  }

  const order = new Map(regionList.map((b, i) => [b, i]));
  const schools = [...schoolRows.values()]
    .sort((a, b) => (order.get(a.sector) - order.get(b.sector))
      || ((a.school ? 0 : 1) - (b.school ? 0 : 1))
      || String((a.school && a.school.name) || '').localeCompare(String((b.school && b.school.name) || '')))
    .map((e) => {
      const b = block(ladder, e.acc, catalogue);
      // A school row: passed all levels of its members, and per level passed of them (kept small for a phone).
      return {
        schoolId: e.school ? e.school.id : noSchoolId(e.sector),
        emis: e.school && e.school.emis != null ? String(e.school.emis) : null,
        name: e.school ? e.school.name : null,
        noSchool: !e.school,
        region: e.sector,
        teachers: b.teachers,
        passedAll: b.passedAll,
        levels: b.levels.map((l) => ({ levelOrder: l.levelOrder, passed: l.passed, teachers: l.teachers, pctPassed: l.pctPassed })),
      };
    });

  return {
    overview: block(ladder, overview, catalogue, { withName: true, detailed: true }),
    regions: regionList.map((b) => ({ region: b, ...block(ladder, regionAcc.get(b), catalogue) })),
    noSector: block(ladder, noSector, catalogue),
    schools,
  };
}

// ── the reads ────────────────────────────────────────────────────────────────

/** NIETE's own ladder. */
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

/** The Mid/High partner programmes, as NIETE's vendors are keyed — never by display name, which changes. */
const OXBRIDGE_KEY = 'OXBRIDGE';
const BEACONHOUSE_KEY = 'BEACONHOUSE';
const ISAPS_KEY = 'ISAPS';

const PARTNER_LEVELS = (vendor) => `
      SELECT l.id, l.order_index, l.vendor_id
        FROM training_levels l
        JOIN training_vendors v ON v.id = l.vendor_id
       WHERE v.key = '${vendor}' AND l.is_active`;

/** The ids of a partner's active levels, for `level_id IN (...)`. */
const PARTNER_LEVEL_IDS = (vendor) => `SELECT pl.id FROM (${PARTNER_LEVELS(vendor)}) pl`;

/** GBTLA's sessions in order: the active modules of its active course(s); bit = position (0-based). */
const OX_SESSION_ORDER = 'row_number() OVER (ORDER BY c.order_index, m.order_index, m.id) - 1';

/** N of an I-SAPS course titled "Module N", the bot's own reading (quiz-delivery: /Module (\d+)/). bit = N - 1. */
const ISAPS_MODULE_NO = "substring(c.title from 'Module (\\d+)')::int";

/**
 * Each I-SAPS module that can be passed: an active course "Module N" of an active I-SAPS level whose exam, the active
 * grand quiz 900 + N, exists. `levels` is the SQL for the I-SAPS level ids.
 */
const ISAPS_MODULES = (levels) => `
      SELECT c.id AS course_id, c.title, q.id AS quiz_id, (${ISAPS_MODULE_NO} - 1) AS bit
        FROM training_courses c
        JOIN training_grand_quizzes q
          ON q.level_id = c.level_id AND q.is_active
         AND q.source_quiz_id = ${PER_MODULE_SOURCE_BASE} + ${ISAPS_MODULE_NO}
       WHERE c.is_active AND c.title ~ 'Module \\d+'
         AND c.level_id IN (${levels})`;

/**
 * The partner catalogue, one row per GBTLA session, Beaconhouse subject and I-SAPS module, with the bit each has in the
 * members read's masks — written with the same ordering as that read, so the two always agree.
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
  UNION ALL
  SELECT 'isaps' AS partner, im.bit, im.title
    FROM (${ISAPS_MODULES(PARTNER_LEVEL_IDS(ISAPS_KEY))}) im
   ORDER BY 1, 2`;

/** The columns every branch of the per-member fold carries, with the value a branch that does not set one gives. */
const FOLD = [
  ['school_id', 'NULL'], ['region', 'NULL::text'], ['mine', 'false'],
  ['primary_cohort', 'false'], ['mh_cohort', 'false'], ['middle_band', 'false'], ['high_band', 'false'],
  ['level_id', 'NULL::bigint'], ['cert', 'false'], ['active', 'false'],
  ['ox_mask', '0'], ['ox_cert', 'false'], ['ox_active', 'false'],
  ['bh_mask', '0'], ['bh_active', 'false'],
  ['isaps_assigned', 'false'], ['isaps_cert', 'false'], ['isaps_mask', '0'], ['isaps_active', 'false'],
];
const fold = (userId, set, from) => `
        SELECT ${userId} AS user_id, ${FOLD.map(([col, dflt]) => `${set[col] || dflt} AS ${col}`).join(', ')}
          ${from}`;

/**
 * One row per programme member (the RDF population) with everything the summariser needs: her school, which
 * programmes, middle / high, the NIETE levels she holds a certificate for, the ones the bot's rule has under way, and
 * the partner facts.
 *
 * Shape — planner-proof, no per-teacher work. Every input is read once into a materialised CTE; the NIETE rule is the
 * bot's, written set-based (visible levels → facts folded by UNION ALL + GROUP BY → windows for the exam check and the
 * level below → states); the member's facts are then folded per member the same way. No two large sets are ever
 * JOINED, so a bad row estimate cannot become a nested loop over 20k × 20k rows (the naive per-level join plan needed
 * nested loops off to finish on prod). The only joins left are to real tables and to the small catalogues (the
 * four-row ladder, module totals, the partner levels, GBTLA's sessions, I-SAPS's exams).
 */
function trainingStatesSql() {
  const band = (test) => `EXISTS (SELECT 1 FROM unnest(u.teacher_level) AS b(v) WHERE upper(btrim(b.v)) ${test})`;
  const scoped = (lvl) => `(s.level_ids IS NULL OR cardinality(s.level_ids) = 0 OR ${lvl}.id = ANY (s.level_ids))`;
  return `
  WITH ladder AS MATERIALIZED (
    -- NIETE's own levels, and whether its vendor chains them (teacher-training-endpoint.js isLevelChainLocked)
    SELECT l.id, l.vendor_id, l.order_index,
           (COALESCE(v.level_unlock_logic, '') <> 'parallel') AS chained
      FROM training_levels l
      JOIN training_vendors v ON v.id = l.vendor_id
     WHERE v.key = '${NIETE_VENDOR_KEY}' AND l.is_active
  ),
  members AS MATERIALIZED (
    -- the RDF's population: an ACTIVE assignment on the primary or middle/high programme, the user row live (no
    -- deleted_at, the phone not a merged: tombstone); any role, any school or none. Middle / high from teacher_level.
    -- users.region rides along: whose member she is when no school places her (bd-97daxo.3).
    SELECT u.id AS user_id, u.school_id, u.region, pm.primary_cohort, pm.mh_cohort,
           ${band("= 'MIDDLE'")} AS middle_band,
           ${band("= 'HIGH'")} AS high_band
      FROM (
        SELECT a.user_id,
               bool_or(p.key = '${PROGRAMME_KEYS.primary}') AS primary_cohort,
               bool_or(p.key = '${PROGRAMME_KEYS.midhigh}') AS mh_cohort
          FROM teacher_training_assignments a
          JOIN training_programs p ON p.id = a.program_id
         WHERE a.is_active AND p.key IN ('${PROGRAMME_KEYS.primary}', '${PROGRAMME_KEYS.midhigh}')
         GROUP BY a.user_id
      ) pm
      JOIN users u ON u.id = pm.user_id
     WHERE u.deleted_at IS NULL
       AND COALESCE(u.phone_number, '') NOT LIKE 'merged%'
  ),
  visible AS MATERIALIZED (
    -- the (member, level) pairs her programmes show: active assignments → scopes; NULL / empty level_ids = all
    SELECT DISTINCT a.user_id, l.id AS level_id
      FROM teacher_training_assignments a
      JOIN training_program_scopes s ON s.program_id = a.program_id
      JOIN ladder l ON l.vendor_id = s.vendor_id
     WHERE a.is_active
       AND a.user_id IN (SELECT user_id FROM members)
       AND ${scoped('l')}
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
    -- the RDF's numerator: a certificate for the level
    SELECT c.user_id, c.level_id FROM training_certificates c WHERE c.level_id IN (SELECT id FROM ladder)
  ),
  facts AS MATERIALIZED (
    -- one row per (member, level) she is shown: certificate?, exam quiz levels, modules done
    SELECT f.user_id, f.level_id,
           max(f.cert) AS cert,
           sum(f.done)::int AS done,
           array_agg(f.quiz_level) FILTER (WHERE f.quiz_level IS NOT NULL) AS quiz_levels
      FROM (
        SELECT user_id, level_id, 1 AS vis, 0 AS cert, 0 AS done, NULL::bigint AS quiz_level FROM visible
        UNION ALL
        SELECT user_id, level_id, 0, 1, 0, NULL FROM certs
        UNION ALL
        SELECT user_id, level_id, 0, 0, done, NULL FROM done
        UNION ALL
        SELECT user_id, level_id, 0, 0, 0, quiz_level FROM exams
      ) f
     GROUP BY f.user_id, f.level_id
    HAVING max(f.vis) = 1
  ),
  judged AS (
    -- the bot's certified: a certificate, or a passed exam whose quiz is of a level she sees (0 = no quiz id, stands)
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
    SELECT o.user_id, o.level_id,
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
  ox_levels AS MATERIALIZED (${PARTNER_LEVELS(OXBRIDGE_KEY)}
  ),
  ox_sessions AS MATERIALIZED (
    -- GBTLA's sessions: the active modules of its active course(s), in order (7 on prod)
    SELECT m.id AS module_id, (${OX_SESSION_ORDER})::int AS bit
      FROM training_modules m
      JOIN training_courses c ON c.id = m.course_id
     WHERE m.is_active AND c.is_active
       AND c.level_id IN (SELECT id FROM ox_levels)
  ),
  bh_levels AS MATERIALIZED (${PARTNER_LEVELS(BEACONHOUSE_KEY)}
  ),
  isaps_levels AS MATERIALIZED (${PARTNER_LEVELS(ISAPS_KEY)}
  ),
  isaps_exams AS MATERIALIZED (
    -- each I-SAPS module's exam (the active grand quiz 900 + N of course "Module N"), its bit N - 1 (9 on prod)
    SELECT im.quiz_id, im.bit FROM (${ISAPS_MODULES('SELECT id FROM isaps_levels')}) im
  ),
  isaps_assigned AS MATERIALIZED (
    -- assigned I-SAPS: an active assignment whose programme scopes the I-SAPS vendor (niete_middle_high, the pilot)
    SELECT DISTINCT a.user_id
      FROM teacher_training_assignments a
      JOIN training_program_scopes s ON s.program_id = a.program_id
      JOIN isaps_levels il ON il.vendor_id = s.vendor_id
     WHERE a.is_active AND ${scoped('il')}
  ),
  member_facts AS MATERIALIZED (
    SELECT f.user_id,
           (array_agg(f.school_id) FILTER (WHERE f.mine))[1] AS school_id,
           (array_agg(f.region) FILTER (WHERE f.mine))[1] AS region,
           bool_or(f.primary_cohort) AS primary_cohort,
           bool_or(f.mh_cohort) AS mh_cohort,
           bool_or(f.middle_band) AS middle_band,
           bool_or(f.high_band) AS high_band,
           array_agg(DISTINCT f.level_id) FILTER (WHERE f.cert) AS cert_levels,
           array_agg(DISTINCT f.level_id) FILTER (WHERE f.active) AS active_levels,
           bit_or(f.ox_mask) AS ox_mask,
           bool_or(f.ox_cert) AS ox_cert,
           bool_or(f.ox_active) AS ox_active,
           bit_or(f.bh_mask) AS bh_mask,
           bool_or(f.bh_active) AS bh_active,
           bool_or(f.isaps_assigned) AS isaps_assigned,
           bool_or(f.isaps_cert) AS isaps_cert,
           bit_or(f.isaps_mask) AS isaps_mask,
           bool_or(f.isaps_active) AS isaps_active
      FROM (
        -- the member herself
        ${fold('m.user_id', {
    school_id: 'm.school_id', region: 'm.region::text', mine: 'true', primary_cohort: 'm.primary_cohort', mh_cohort: 'm.mh_cohort',
    middle_band: 'm.middle_band', high_band: 'm.high_band',
  }, 'FROM members m')}
        UNION ALL
        -- a NIETE level's certificate (Passed)
        ${fold('c.user_id', { level_id: 'c.level_id', cert: 'true' }, 'FROM certs c')}
        UNION ALL
        -- a NIETE level the bot's rule has under way (In Progress when there is no certificate)
        ${fold('s.user_id', { level_id: 's.level_id', active: 'true' },
    "FROM states s WHERE s.state IN ('in_progress', 'ready_for_quiz', 'certified')")}
        UNION ALL
        -- a GBTLA session passed: a progress row on its module
        ${fold('p.user_id', { ox_mask: '(1 << os.bit)', ox_active: 'true' },
    'FROM teacher_training_progress p JOIN ox_sessions os ON os.module_id = p.module_id')}
        UNION ALL
        -- the GBTLA certificate (the RDF's level 17)
        ${fold('c.user_id', { ox_cert: 'true', ox_active: 'true' },
    'FROM training_certificates c WHERE c.level_id IN (SELECT id FROM ox_levels)')}
        UNION ALL
        -- any GBTLA attempt is activity
        ${fold('a.user_id', { ox_active: 'true' },
    'FROM training_assessment_attempts a WHERE a.level_id IN (SELECT id FROM ox_levels)')}
        UNION ALL
        -- a Beaconhouse subject's certificate (the RDF's levels 18-21)
        ${fold('c.user_id', { bh_mask: '(1 << bl.order_index)', bh_active: 'true' },
    'FROM training_certificates c JOIN bh_levels bl ON bl.id = c.level_id')}
        UNION ALL
        -- any Beaconhouse attempt is activity
        ${fold('a.user_id', { bh_active: 'true' },
    'FROM training_assessment_attempts a WHERE a.level_id IN (SELECT id FROM bh_levels)')}
        UNION ALL
        -- a Beaconhouse module passed is activity
        ${fold('p.user_id', { bh_active: 'true' },
    `FROM teacher_training_progress p
          JOIN training_modules tm ON tm.id = p.module_id
          JOIN training_courses tc ON tc.id = tm.course_id
         WHERE tc.level_id IN (SELECT id FROM bh_levels)`)}
        UNION ALL
        -- assigned I-SAPS (the card's population)
        ${fold('ia.user_id', { isaps_assigned: 'true' }, 'FROM isaps_assigned ia')}
        UNION ALL
        -- any I-SAPS attempt is activity; a passed attempt on a module's active exam passes that module
        ${fold('a.user_id', {
    isaps_mask: 'CASE WHEN a.is_passed IS TRUE THEN COALESCE(1 << e.bit, 0) ELSE 0 END', isaps_active: 'true',
  }, `FROM training_assessment_attempts a
          LEFT JOIN isaps_exams e ON e.quiz_id = a.grand_quiz_id
         WHERE a.level_id IN (SELECT id FROM isaps_levels)`)}
        UNION ALL
        -- an I-SAPS unit done is activity
        ${fold('p.user_id', { isaps_active: 'true' },
    `FROM teacher_training_progress p
          JOIN training_modules tm ON tm.id = p.module_id
          JOIN training_courses tc ON tc.id = tm.course_id
         WHERE tc.level_id IN (SELECT id FROM isaps_levels)`)}
        UNION ALL
        -- the I-SAPS level certificate (Passed)
        ${fold('c.user_id', { isaps_cert: 'true', isaps_active: 'true' },
    'FROM training_certificates c WHERE c.level_id IN (SELECT id FROM isaps_levels)')}
      ) f
     GROUP BY f.user_id
    HAVING bool_or(f.mine)
  )
  SELECT * FROM member_facts`;
}

/**
 * Four reads and the lists, in parallel, none taking anything from the request: the ladder, the schools, the partner
 * catalogue, the members, and loadAnalyticsLists' answer (FDE's schools, the RDF sectors).
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @param {() => Promise<object|null>} [loadLists]
 */
async function loadTrainingLevelRows(query, loadLists = async () => null) {
  const [levelRes, schoolRes, partnerRes, memberRes, lists] = await Promise.all([
    query(LEVELS_SQL),
    query(SCHOOLS_SQL),
    query(PARTNERS_SQL),
    query(trainingStatesSql()),
    loadLists(),
  ]);
  return {
    levels: levelRes.rows || [],
    schools: schoolRes.rows || [],
    partners: partnerRes.rows || [],
    members: memberRes.rows || [],
    lists: lists || null,
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
  BANDS,
  PROGRAMME_KEYS,
  NIETE_VENDOR_KEY,
  parseBandFilter,
  summarizeTrainingLevels,
  trainingStatesSql,
  loadTrainingLevelRows,
  createSnapshot,
};
