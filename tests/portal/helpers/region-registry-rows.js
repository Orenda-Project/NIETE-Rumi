/**
 * region_features as migration V1.8.5 leaves it (bd-97daxo.2), for route tests whose supabase stand-in must answer
 * the region registry (bot/shared/services/region-registry.js): FDE's six ICT sectors owned by 'niete', in dashboard
 * order, Gilgit-Baltistan owned by 'moawin', and the deployment-wide 'niete' LP row, which is not a region.
 *
 * Every analytics route reads the registry for the viewer's regions (bd-97daxo.3), and an empty registry answers
 * an empty page, so a route test seeds these rows: `tableStates.region_features = { rows: REGION_REGISTRY_ROWS }`.
 */
const FDE_SECTORS = ['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol'];

const REGION_REGISTRY_ROWS = Object.freeze([
  { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true },
  ...FDE_SECTORS.map((name, i) => ({
    region: name.toLowerCase(), organization: 'niete', display_name: name, sort_order: i + 1, is_active: true,
  })),
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true },
]);

module.exports = { REGION_REGISTRY_ROWS };
