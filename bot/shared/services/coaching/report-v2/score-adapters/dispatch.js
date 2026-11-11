/**
 * Score-adapter dispatch.
 *
 * Routes a framework key → its per-framework adapter function with the standard
 * dispatch contract: lazy require + an empty-groups fallback for unknown
 * frameworks (so an unknown framework renders an empty scorecard instead of
 * crashing the hero report).
 *
 * Adding a new framework's score adapter = one line here.
 */

const { logToFile } = require('../../../../utils/logger');

const ADAPTERS = {
  oecd:   () => require('./oecd-adapter').buildOecdGroups,
  hots:   () => require('./hots-adapter').buildHotsGroups,
  teach:  () => require('./teach-adapter').buildTeachGroups,
  fico:   () => require('./fico-adapter').buildFicoGroups,
  mewaka: () => require('./mewaka-adapter').buildMewakaGroups,
  // bd-ra8xu.39: a visit scored on FICO17 v6 (its rows live under v6 domain keys, never V3's).
  fico17_v6: () => require('./fico17-v6-adapter').buildFico17V6Groups,
};

/**
 * @param {string} framework  oecd | hots | teach | fico
 * @returns {(analysis:object) => Array<{key,name,score,max,pct}>}
 */
function getScoreAdapter(framework) {
  const key = String(framework || '').toLowerCase();
  const factory = ADAPTERS[key];
  if (!factory) {
    logToFile(`[score-adapter-dispatch] Unknown framework "${framework}", returning empty-groups`);
    return () => [];
  }
  return factory();
}

module.exports = { getScoreAdapter };
