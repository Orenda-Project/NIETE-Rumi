/**
 * The three lists the schools analytics counts against (PLAN v8, FDE feedback 2026-10-19: "RDFs are the
 * numbers that the others follow"). ONE loader, shared by every analytics tab:
 *
 *   loadAnalyticsLists(supabase[, { query }]) → {
 *     fdeSchoolEmis: Set<string> | null,                 FDE's programme list (EMIS), primary OR middle/high list
 *     primary:  Map<userId, sector> | null,              the RDF Primary population, sector per the RDF
 *     midHigh:  Map<userId, sector> | null,              the RDF Grades 6-12 population, sector per the RDF
 *     sectorByUser: Map<userId, sector> | null,          EVERY user on the RDF allocation file, any role (principals
 *                                                        too), with its RDF sector — the RDF's uid2sect — for a
 *                                                        number counted over people outside the two populations
 *                                                        (training certificates). null when not stored yet.
 *     coaches:  Array<{name, sector, userIds}> | null,   the RDF coach roster
 *     asOf:     { schools, teachers, coaches },          snapshot dates (YYYY-MM-DD) or null, for the Information tab
 *     missing:  { schools, teachers, coaches },          true when that list is not usable (see FAIL-CLOSED)
 *   }
 *
 * WHERE THE LISTS COME FROM. Three app_settings rows, written by scripts/load-analytics-lists.js (dry run by
 * default, project ref asserted). No phone is stored: the script resolves phones to users.id when it runs.
 *   analytics_fde_schools   {asOf, source, emis: [ '401', … ]}                       (415 on prod, 2026-10-19)
 *   analytics_rdf_teachers  {asOf, source, primary: {<sector>: [userId, …]}, midHigh: {<sector>: [userId, …]},
 *                            sectorByUser: {<sector>: [userId, …]}}
 *   analytics_rdf_coaches   {asOf, source, coaches: [{name, sector, userIds: [userId, …]}]}
 *
 * RESOLVED AGAINST LIVE ROWS, each time the cache refreshes:
 *   - an EMIS is kept only when a schools row carries it;
 *   - a Primary id only while that user still exists, is role 'teacher' and teacher_level holds PRIMARY
 *     (the RDF's own test: render.py primary_scope — no test or deleted filter there);
 *   - a 6-12 id only while that user exists, is role 'teacher', is not deleted, and teacher_level holds MIDDLE
 *     or HIGH (the RDF's: rdf_niete612/metrics.py cohort);
 *   - a sectorByUser id while that user exists (any role; the RDF's uid2sect has no other test);
 *   - a coach keeps her roster entry (name and sector are the roster's); her userIds are cut to live users.
 *
 * FAIL-CLOSED. A list whose row is missing, malformed, or resolves to NOTHING (sandbox: no prod phone ever
 * matched a sandbox user) is `null`, `missing.<list>` is true, and it is logged at error level. A consumer
 * MUST then fall back to the v7 rule for that list — never read a null list as empty, which would show zeros:
 *   schools  → every active, non-test school in the six sectors;
 *   teachers → today's roster (role teacher, a school, not a test user) — `missing.teachers` is true when
 *              EITHER band is null, and a consumer that needs both falls back for both;
 *   coaches  → role coach with a leader_schools school.
 * A failed READ is different: the last good answer keeps being served (logged); with none yet, it throws and
 * the route answers 500 ("try again"), as the analytics gate does.
 *
 * Cached for 30 minutes per process, with in-flight sharing (two cold requests share one load).
 */

/**
 * FDE's six ICT sectors as schools.region / users.region store them, in dashboard order — THE one copy in code
 * (bd-97daxo.3): every dashboard module imports it from here. It is the list the region registry seeds for
 * organization 'niete' (V1.8.5; tests/region/region-registry.test.js holds the two equal). The analytics routes
 * read a viewer's regions from the registry; this constant is FDE's lists' own vocabulary and the default for a
 * caller that passes no regions.
 */
const SECTORS = Object.freeze(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);

const LIST_KEYS = Object.freeze({
  schools: 'analytics_fde_schools',
  teachers: 'analytics_rdf_teachers',
  coaches: 'analytics_rdf_coaches',
});

const TTL_MS = 30 * 60 * 1000;
/** ids per PostgREST `in` filter: 200 uuids keep the URL near 8 KB. */
const ID_CHUNK = 200;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const asJson = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return null; }
};
const ymd = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const levelsOf = (u) => (Array.isArray(u && u.teacher_level) ? u.teacher_level.map((x) => String(x).toUpperCase()) : []);

// ── parsing (pure) ───────────────────────────────────────────────────────────

/** analytics_fde_schools → {emis: string[], asOf} | null */
function parseSchools(raw) {
  const v = asJson(raw);
  if (!isObj(v) || !Array.isArray(v.emis)) return null;
  const emis = [...new Set(v.emis.filter((e) => e !== null && e !== undefined && String(e).trim() !== '')
    .map((e) => String(e).trim()))];
  return emis.length ? { emis, asOf: ymd(v.asOf) } : null;
}

/** One band's {sector: [ids]} → Map<id, sector>; a sector outside the six is dropped. */
function bandMap(v) {
  const out = new Map();
  if (!isObj(v)) return out;
  for (const s of SECTORS) {
    for (const id of Array.isArray(v[s]) ? v[s] : []) {
      if (typeof id === 'string' && id && !out.has(id)) out.set(id, s);
    }
  }
  return out;
}

/** analytics_rdf_teachers → {primary: Map, midHigh: Map, asOf} | null */
function parseTeachers(raw) {
  const v = asJson(raw);
  if (!isObj(v)) return null;
  return { primary: bandMap(v.primary), midHigh: bandMap(v.midHigh), sectorByUser: bandMap(v.sectorByUser), asOf: ymd(v.asOf) };
}

/** analytics_rdf_coaches → {coaches: [{name, sector, userIds}], asOf} | null */
function parseCoaches(raw) {
  const v = asJson(raw);
  if (!isObj(v) || !Array.isArray(v.coaches)) return null;
  const coaches = [];
  for (const c of v.coaches) {
    if (!isObj(c)) continue;
    const name = typeof c.name === 'string' ? c.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || !SECTORS.includes(c.sector)) continue;
    const userIds = Array.isArray(c.userIds) ? c.userIds.filter((x) => typeof x === 'string' && x) : [];
    coaches.push({ name, sector: c.sector, userIds: [...new Set(userIds)] });
  }
  return coaches.length ? { coaches, asOf: ymd(v.asOf) } : null;
}

/**
 * The stored lists, resolved against live rows (see the header). PURE.
 * @param {{schools: any, teachers: any, coaches: any}} stored app_settings values by list
 * @param {{schoolEmis: Set<string>, users: Map<string, {role, teacher_level, deleted_at}>}} live
 */
function resolveLists(stored, live) {
  const missing = { schools: false, teachers: false, coaches: false };
  const asOf = { schools: null, teachers: null, coaches: null };

  const sch = parseSchools(stored.schools);
  let fdeSchoolEmis = null;
  if (sch) {
    asOf.schools = sch.asOf;
    const kept = sch.emis.filter((e) => live.schoolEmis.has(e));
    fdeSchoolEmis = kept.length ? new Set(kept) : null;
  }
  if (!fdeSchoolEmis) missing.schools = true;

  const tea = parseTeachers(stored.teachers);
  let primary = null;
  let midHigh = null;
  let sectorByUser = null;
  if (tea) {
    asOf.teachers = tea.asOf;
    const keep = (m, ok) => {
      const out = new Map();
      for (const [id, s] of m) {
        const u = live.users.get(id);
        if (u && u.role === 'teacher' && ok(u)) out.set(id, s);
      }
      return out.size ? out : null;
    };
    primary = keep(tea.primary, (u) => levelsOf(u).includes('PRIMARY'));
    midHigh = keep(tea.midHigh, (u) => !u.deleted_at && levelsOf(u).some((l) => l === 'MIDDLE' || l === 'HIGH'));
    const all = new Map([...tea.sectorByUser].filter(([id]) => live.users.has(id)));
    sectorByUser = all.size ? all : null;
  }
  if (!primary || !midHigh) missing.teachers = true;

  const coa = parseCoaches(stored.coaches);
  let coaches = null;
  if (coa) {
    asOf.coaches = coa.asOf;
    coaches = coa.coaches.map((c) => ({ ...c, userIds: c.userIds.filter((id) => live.users.has(id)) }));
  }
  if (!coaches) missing.coaches = true;

  return { fdeSchoolEmis, primary, midHigh, sectorByUser, coaches, asOf, missing };
}

/** Every id a stored value names (teachers' two bands and the coaches'), for the live read. */
function idsToResolve(stored) {
  const ids = new Set();
  const tea = parseTeachers(stored.teachers);
  if (tea) for (const m of [tea.primary, tea.midHigh, tea.sectorByUser]) for (const id of m.keys()) ids.add(id);
  const coa = parseCoaches(stored.coaches);
  if (coa) for (const c of coa.coaches) for (const id of c.userIds) ids.add(id);
  return [...ids];
}

// ── the reads ────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readStored(supabase) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', Object.values(LIST_KEYS));
  if (error) throw new Error(`app_settings read failed: ${error.message || error}`);
  const byKey = new Map((data || []).map((r) => [r.key, r.value]));
  return {
    schools: byKey.get(LIST_KEYS.schools),
    teachers: byKey.get(LIST_KEYS.teachers),
    coaches: byKey.get(LIST_KEYS.coaches),
  };
}

/**
 * The live rows the lists are resolved against. With a pg `query` (the dashboard's dbQuery) it is two reads;
 * without, PostgREST in chunks of ID_CHUNK ids.
 */
async function readLive(supabase, stored, query) {
  const sch = parseSchools(stored.schools);
  const emis = sch ? sch.emis : [];
  const ids = idsToResolve(stored).filter((id) => UUID.test(id));
  const users = new Map();
  const schoolEmis = new Set();

  if (typeof query === 'function') {
    const [s, u] = await Promise.all([
      emis.length ? query('SELECT emis FROM schools WHERE emis::text = ANY($1::text[])', [emis]) : { rows: [] },
      ids.length ? query('SELECT id, role, teacher_level, deleted_at FROM users WHERE id = ANY($1::uuid[])', [ids]) : { rows: [] },
    ]);
    for (const r of s.rows || []) if (r.emis != null) schoolEmis.add(String(r.emis));
    for (const r of u.rows || []) users.set(String(r.id), r);
    return { schoolEmis, users };
  }

  if (emis.length) {
    const { data, error } = await supabase.from('schools').select('emis').in('emis', emis);
    if (error) throw new Error(`schools read failed: ${error.message || error}`);
    for (const r of data || []) if (r.emis != null) schoolEmis.add(String(r.emis));
  }
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('users').select('id, role, teacher_level, deleted_at').in('id', chunk);
    if (error) throw new Error(`users read failed: ${error.message || error}`);
    for (const r of data || []) users.set(String(r.id), r);
  }
  return { schoolEmis, users };
}

function logMissing(lists, log) {
  for (const [list, gone] of Object.entries(lists.missing)) {
    if (gone) {
      log(`[analytics-lists] app_settings.${LIST_KEYS[list]} is missing, malformed or matches nothing live — `
        + `the analytics fall back to the v7 rule for ${list}. Load it with scripts/load-analytics-lists.js.`);
    }
  }
}

/**
 * A loader with its own cache. The module exports one (loadAnalyticsLists); tests make their own.
 * @param {{ttlMs?: number, now?: () => number, log?: (msg: string) => void}} [opts]
 */
function createAnalyticsListsLoader({ ttlMs = TTL_MS, now = () => Date.now(), log = (m) => console.error(m) } = {}) {
  let cached = null; // {value, expires}
  let inflight = null;

  async function load(supabase, opts = {}) {
    if (cached && cached.expires > now()) return cached.value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const stored = await readStored(supabase);
        const live = await readLive(supabase, stored, opts.query);
        const value = resolveLists(stored, live);
        logMissing(value, log);
        cached = { value, expires: now() + ttlMs };
        return value;
      } catch (err) {
        if (cached) {
          log(`[analytics-lists] refresh failed, serving the lists read before: ${err && err.message}`);
          cached = { value: cached.value, expires: now() + Math.min(ttlMs, 60 * 1000) };
          return cached.value;
        }
        throw err;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return { load, clear() { cached = null; inflight = null; } };
}

const defaultLoader = createAnalyticsListsLoader();

/** @see the header. */
function loadAnalyticsLists(supabase, opts) {
  return defaultLoader.load(supabase, opts);
}

// ── helpers every consumer shares ────────────────────────────────────────────

/** The v8 school rule on top of v7's: on FDE's list (when the list is usable). */
function onFdeList(lists, emis) {
  if (!lists || !lists.fdeSchoolEmis) return true;
  return emis != null && lists.fdeSchoolEmis.has(String(emis).trim());
}

/**
 * Every teacher of the RDF populations (Primary ∪ 6-12) with her RDF sector, or null when the teacher lists are
 * not usable (the consumer then keeps v7's roster). A dual-band teacher is one entry; both bands give her the
 * same sector (both read it off the same allocation file), Primary's is taken.
 * @returns {Map<string, string> | null}
 */
function populationSectors(lists) {
  if (!lists || lists.missing && lists.missing.teachers || !lists.primary || !lists.midHigh) return null;
  const out = new Map(lists.midHigh);
  for (const [id, s] of lists.primary) out.set(id, s);
  return out;
}

/**
 * bd-97daxo.3 — the lists as an organization that has none sees them: every list missing, so every tab keeps its v7
 * rule. FDE's lists are FDE's populations; another organization's view (Moawin's Gilgit-Baltistan) never counts
 * against them.
 */
const NO_LISTS = Object.freeze({
  fdeSchoolEmis: null,
  primary: null,
  midHigh: null,
  sectorByUser: null,
  coaches: null,
  asOf: Object.freeze({ schools: null, teachers: null, coaches: null }),
  missing: Object.freeze({ schools: true, teachers: true, coaches: true }),
});

/** The school-list row a sector's teachers with no (listed) school are summed into. */
const NO_SCHOOL_ID_PREFIX = 'no-school:';
const noSchoolId = (sector) => `${NO_SCHOOL_ID_PREFIX}${sector}`;

module.exports = {
  LIST_KEYS,
  SECTORS,
  NO_LISTS,
  loadAnalyticsLists,
  createAnalyticsListsLoader,
  resolveLists,
  parseSchools,
  parseTeachers,
  parseCoaches,
  onFdeList,
  populationSectors,
  NO_SCHOOL_ID_PREFIX,
  noSchoolId,
};
