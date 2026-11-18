/**
 * bd-97daxo.33 — areas: a non-FDE analytics view split by district (Moawin's Gilgit-Baltistan → Gilgit and
 * Baltistan), as data (dashboard/config/gb-areas.json), never as code.
 *
 * The rule, for a view whose region has areas in that file (FDE's six have none, so FDE's view never meets this file):
 *   access    stays on schools.region. Every read is narrowed to the view's regions exactly as before; a school
 *             outside them is in no number, whatever its district says.
 *   bucket    a counted school's AREA: its schools.district looked up in the file; a district the file does not
 *             list, or none, is AREA_NOT_SET — shown as its own card only when some counted school is in it, so
 *             the areas always add up to the region's total.
 *   ?region=  one of the areas (or AREA_NOT_SET), any case; blank, "all" or the region's own name
 *             ("Gilgit-Baltistan", what the page sent before areas) is the whole region; anything else is refused.
 *
 * Every summariser already buckets a school by `region` against the list of buckets it is given, so the areas are
 * applied by handing it school rows whose `region` is the area (placeSchools) and the areas as its bucket list. The
 * districts are their own small read (loadPlacement), made only for an area view: FDE's reads and answers are
 * untouched. Until schools.district exists on a tier (before the migration) that read finds no column and every
 * school reads as AREA_NOT_SET, rather than the view failing.
 */

const AREA_CONFIG = require('../config/gb-areas.json');

const AREA_NOT_SET = 'Area not set';

const norm = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : '');

/**
 * The area plan for a view's regions, or null when none of them has areas (FDE's view, or a region not in the file).
 * @param {readonly string[]} regions the view's regions (the region registry's display names)
 * @param {object} [config] gb-areas.json's shape; the file by default
 * @returns {null | {regions: string[], areas: string[], buckets: string[], districts: Record<string, string[]>,
 *   areaOf: (district: unknown) => string|null}} districts: each area's districts, in the file's order
 */
function areasFor(regions, config = AREA_CONFIG) {
  if (!Array.isArray(regions) || regions.length === 0) return null;
  const areas = [];
  const districts = {};
  const byDistrict = new Map();
  for (const region of regions) {
    const key = Object.keys(config || {}).find((k) => !k.startsWith('_') && norm(k) === norm(region));
    if (!key || !Array.isArray(config[key])) continue;
    for (const a of config[key]) {
      if (!a || typeof a.area !== 'string' || !Array.isArray(a.districts)) continue;
      if (!areas.includes(a.area)) areas.push(a.area);
      districts[a.area] = [...(districts[a.area] || []), ...a.districts];
      for (const d of a.districts) byDistrict.set(norm(d), a.area);
    }
  }
  if (areas.length === 0) return null;
  return {
    regions: [...regions],
    areas,
    buckets: [...areas, AREA_NOT_SET],
    districts,
    areaOf: (district) => byDistrict.get(norm(district)) || null,
  };
}

const inRegions = (plan, region) => plan.regions.some((r) => norm(r) === norm(region));

/**
 * The ?region= filter of an area view: an area (or AREA_NOT_SET) in any case; blank, "all" or the region's own name
 * is the whole region; anything else is refused. Same answer shape as schools-analytics parseRegionFilter.
 * @returns {{ok: true, region: string|null, key: string} | {ok: false}}
 */
function parseAreaFilter(raw, plan) {
  if (raw === undefined || raw === null) return { ok: true, region: null, key: 'all' };
  if (typeof raw !== 'string') return { ok: false };
  const v = norm(raw);
  if (v === '' || v === 'all' || inRegions(plan, raw)) return { ok: true, region: null, key: 'all' };
  const bucket = plan.buckets.find((b) => norm(b) === v);
  return bucket ? { ok: true, region: bucket, key: bucket } : { ok: false };
}

/**
 * The districts of the view's schools, and whether any counted one (active, not a probable test) has no area.
 * One small read, narrowed to the view's regions. No schools.district column yet (Postgres 42703) = no districts.
 * @param {(sql: string, params?: any[]) => Promise<{rows: any[]}>} query
 * @returns {Promise<{districtById: Map<string, string|null>, needsNotSet: boolean}>}
 */
async function loadPlacement(query, plan) {
  let rows = [];
  try {
    const res = await query(
      'SELECT id, district, is_active, is_probable_test FROM schools WHERE region = ANY($1::text[])',
      [plan.regions],
    );
    rows = res.rows || [];
  } catch (err) {
    if (!err || err.code !== '42703') throw err;
    console.warn('analytics areas: schools.district is not on this database yet; every school reads as Area not set');
    const res = await query(
      'SELECT id, NULL::text AS district, is_active, is_probable_test FROM schools WHERE region = ANY($1::text[])',
      [plan.regions],
    );
    rows = res.rows || [];
  }
  const districtById = new Map();
  let needsNotSet = false;
  for (const r of rows) {
    const district = typeof r.district === 'string' && r.district.trim() ? r.district.trim() : null;
    districtById.set(r.id, district);
    if (r.is_active === true && r.is_probable_test !== true && !plan.areaOf(district)) needsNotSet = true;
  }
  return { districtById, needsNotSet };
}

/**
 * School rows with `region` replaced by the school's area (AREA_NOT_SET when its district has none) and `district`
 * added; a school outside the view's regions gets region null, so it is in no bucket. PURE.
 */
function placeSchools(plan, schools, districtById) {
  return (schools || []).map((s) => {
    if (!s) return s;
    if (!inRegions(plan, s.region)) return { ...s, region: null, district: null };
    const district = districtById.has(s.id) ? districtById.get(s.id) : null;
    return { ...s, region: plan.areaOf(district) || AREA_NOT_SET, district };
  });
}

/**
 * Training-programme members: one whose users.region is the view's region (her home when no school places her)
 * reads as AREA_NOT_SET, so she is still the view's member; her school, when it counts, still decides her area.
 */
function placeMembers(plan, members) {
  return (members || []).map((m) => (m && inRegions(plan, m.region) ? { ...m, region: AREA_NOT_SET } : m));
}

// The per-region lists an analytics answer carries (schools, coaching, training, LP engagement, observations, observers).
const REGION_LISTS = ['regions', 'sectorSubjects', 'sectorGrades'];

/** An answer without its AREA_NOT_SET entries, unless a counted school is in it. Returns a new object. */
function trimAreaNotSet(body, needsNotSet) {
  if (needsNotSet || !body || typeof body !== 'object') return body;
  const out = { ...body };
  const trim = (o) => {
    const c = { ...o };
    for (const k of REGION_LISTS) if (Array.isArray(c[k])) c[k] = c[k].filter((x) => !x || x.region !== AREA_NOT_SET);
    return c;
  };
  Object.assign(out, trim(out));
  for (const kind of ['dc', 'human']) if (out[kind] && typeof out[kind] === 'object') out[kind] = trim(out[kind]);
  return out;
}

module.exports = {
  AREA_NOT_SET,
  areasFor,
  parseAreaFilter,
  loadPlacement,
  placeSchools,
  placeMembers,
  trimAreaNotSet,
};
