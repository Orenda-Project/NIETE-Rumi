/**
 * region-registry — which regions this deployment serves, and which organization owns each.
 *
 * One region_features row per region (bd-97daxo.2): `organization` is the owner (FDE's six ICT
 * sectors are 'niete', Gilgit-Baltistan is 'moawin'), `display_name` is the value schools.region
 * and users.region hold ("Sihala", "Gilgit-Baltistan"), `sort_order` is the order dashboards list
 * them in, and `is_active` retires a region without deleting its row. Rows with no organization
 * (the deployment-wide 'niete' LP row) are not regions and are ignored here.
 *
 * Pure: every function takes the supabase client to read with, so the bot and the dashboard use
 * the same code with their own clients.
 *
 * FAILS CLOSED, unlike region-features.service.js (which fails open so an LP is never blocked):
 * the registry decides whose data a dashboard shows, so a failed read throws. A caller that
 * cannot read it must refuse, never fall back to "every region".
 */

const TTL_MS = 5 * 60 * 1000;
let _cache = null; // { rows, ts }

/** The comparison form of a region value: users.region, schools.region and the row key all meet here. */
function regionKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Every active, owned region row, in sort order. Throws when the table cannot be read. */
async function listRegions(client) {
  if (_cache && Date.now() - _cache.ts < TTL_MS) return _cache.rows;
  let result;
  try {
    result = await client
      .from('region_features')
      .select('region, organization, display_name, sort_order, is_active, curriculum_key');
  } catch (e) {
    throw new Error(`region registry unreadable: ${e.message}`);
  }
  if (!result || result.error) {
    throw new Error(`region registry unreadable: ${(result && result.error && result.error.message) || 'no result'}`);
  }
  const rows = (result.data || [])
    .filter((r) => r && r.organization && r.display_name && r.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.display_name.localeCompare(b.display_name));
  _cache = { rows, ts: Date.now() };
  return rows;
}

/** The regions an organization owns, as schools.region spells them, in dashboard order. */
async function regionsForOrganization(client, organization) {
  return (await listRegions(client))
    .filter((r) => r.organization === organization)
    .map((r) => r.display_name);
}

/** The organization that owns a region value, or null for an unknown or retired region. */
async function organizationForRegion(client, region) {
  const key = regionKey(region);
  if (!key) return null;
  const row = (await listRegions(client))
    .find((r) => regionKey(r.region) === key || regionKey(r.display_name) === key);
  return row ? row.organization : null;
}

/**
 * The curriculum key of a REGISTRY region (its books — 'nbf_snc' for Gilgit-Baltistan, V1.8.6), or null for a
 * region with none, an unknown or retired region, or the deployment-wide row (no organization: its
 * punjab_snc_2020 is not any teacher's region). Throws like every read here; book-curriculum.service
 * is the caller that turns a throw into ICT (bd-97daxo.4).
 */
async function curriculumKeyForRegion(client, region) {
  const key = regionKey(region);
  if (!key) return null;
  const row = (await listRegions(client))
    .find((r) => regionKey(r.region) === key || regionKey(r.display_name) === key);
  return (row && row.curriculum_key) || null;
}

function _clearCache() {
  _cache = null;
}

module.exports = {
  listRegions,
  regionsForOrganization,
  organizationForRegion,
  curriculumKeyForRegion,
  regionKey,
  _clearCache,
};
