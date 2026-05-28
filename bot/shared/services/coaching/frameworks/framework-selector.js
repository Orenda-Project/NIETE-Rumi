/**
 * Framework Selector
 *
 * Reads user preferences and region to determine which observation
 * framework module to use for coaching analysis.
 *
 * Priority:
 *   1. Explicit user preference (preferences.observation_framework)
 *   2. Region default — resolved by region-config (REGION_FRAMEWORK_MAP)
 *   3. Deployment default — DEFAULT_OBSERVATION_FRAMEWORK env (else oecd)
 *
 * The deployment default + per-region overrides are the customization foothold:
 * a deployer sets DEFAULT_OBSERVATION_FRAMEWORK=teach (and optionally
 * REGION_FRAMEWORK_MAP={"punjab":"hots"}) in .env to change which framework
 * coaching uses, with no code change. This selector deliberately holds NO
 * hardcoded region→framework routing — region-config owns that single source.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { getFramework, listFrameworks } = require('./framework-registry');
const { defaultFrameworkForRegion } = require('../../../config/region-config');

/** Resolve a framework key to a module, falling back to oecd if unregistered. */
function resolveFramework(key, why) {
  if (key && listFrameworks().includes(key)) {
    logToFile(`[framework-selector] ${why} → ${key}`);
    return getFramework(key);
  }
  if (key) {
    logToFile(`[framework-selector] ${why} resolved "${key}" which is not registered `
      + `(${listFrameworks().join(', ')}); falling back to oecd`);
  }
  return getFramework('oecd');
}

/**
 * Select the appropriate framework module for a user.
 * @param {string} userId - User UUID
 * @returns {Promise<object>} Framework module
 */
async function selectFramework(userId) {
  try {
    const { data } = await supabase
      .from('users')
      .select('region, preferences')
      .eq('id', userId)
      .single();

    if (!data) {
      return resolveFramework(defaultFrameworkForRegion(null), `No user ${userId}, deployment default`);
    }

    // 1. Explicit per-user preference wins.
    const explicit = data.preferences?.observation_framework;
    if (explicit) {
      return resolveFramework(explicit, `User ${userId} explicit preference`);
    }

    // 2 + 3. Region override (REGION_FRAMEWORK_MAP) else deployment default — region-config owns both.
    const region = data.region || '';
    return resolveFramework(defaultFrameworkForRegion(region), `User ${userId} region "${region}"`);

  } catch (err) {
    logToFile(`[framework-selector] Error selecting framework for ${userId}: ${err.message}, using oecd`);
    return getFramework('oecd');
  }
}

module.exports = { selectFramework };
