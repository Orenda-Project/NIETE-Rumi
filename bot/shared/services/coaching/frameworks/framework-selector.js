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
 *
 * Two entry points:
 *   • selectFramework(userId) — returns the framework module (legacy signature).
 *   • selectFrameworkWithReason(userId) — returns { framework, frameworkKey, reason }.
 *     `reason` is the audit signal callers persist to coaching_sessions.
 *     Values: 'user_preference' | 'region_default' | 'deployment_default'
 *           | 'fallback_no_user' | 'fallback_error' | 'fallback_unknown_key'.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { getFramework, listFrameworks } = require('./framework-registry');
const {
  defaultFrameworkForRegion,
  DEFAULT_FRAMEWORK,
  REGION_FRAMEWORK_MAP,
} = require('../../../config/region-config');

/**
 * Resolve a framework key to a module, falling back to oecd if unregistered.
 * Returns both the resolved module and the actual key used, so callers can
 * distinguish "asked for fico, got fico" from "asked for xyz, got oecd fallback".
 */
function resolveFramework(key, why) {
  if (key && listFrameworks().includes(key)) {
    logToFile(`[framework-selector] ${why} → ${key}`);
    return { framework: getFramework(key), frameworkKey: key, unknown: false };
  }
  if (key) {
    logToFile(`[framework-selector] ${why} resolved "${key}" which is not registered `
      + `(${listFrameworks().join(', ')}); falling back to oecd`);
  }
  return { framework: getFramework('oecd'), frameworkKey: 'oecd', unknown: !!key };
}

/**
 * Select the appropriate framework for a user AND record which selection
 * path fired. This is the primary API — callers that need the provenance
 * (analysis-processor persisting to coaching_sessions.framework_selection_reason)
 * use this directly; the legacy selectFramework() just discards the reason.
 *
 * @param {string} userId - User UUID
 * @returns {Promise<{framework: object, frameworkKey: string, reason: string}>}
 */
async function selectFrameworkWithReason(userId) {
  try {
    const { data } = await supabase
      .from('users')
      .select('region, preferences')
      .eq('id', userId)
      .single();

    if (!data) {
      const key = defaultFrameworkForRegion(null);
      const resolved = resolveFramework(key, `No user ${userId}, deployment default`);
      return { ...pickResult(resolved), reason: 'fallback_no_user' };
    }

    // 1. Explicit per-user preference wins.
    const explicit = data.preferences && data.preferences.observation_framework;
    if (explicit) {
      const resolved = resolveFramework(explicit, `User ${userId} explicit preference`);
      const reason = resolved.unknown ? 'fallback_unknown_key' : 'user_preference';
      return { ...pickResult(resolved), reason };
    }

    // 2. Region override (REGION_FRAMEWORK_MAP)?
    const region = (data.region || '').toLowerCase();
    if (region && REGION_FRAMEWORK_MAP && REGION_FRAMEWORK_MAP[region]) {
      const mapped = REGION_FRAMEWORK_MAP[region];
      const resolved = resolveFramework(mapped, `User ${userId} region "${region}" (region_default)`);
      return { ...pickResult(resolved), reason: 'region_default' };
    }

    // 3. Deployment default.
    const resolved = resolveFramework(DEFAULT_FRAMEWORK,
      `User ${userId} region "${region}" (deployment_default)`);
    return { ...pickResult(resolved), reason: 'deployment_default' };

  } catch (err) {
    logToFile(`[framework-selector] Error selecting framework for ${userId}: `
      + `${err.message}, using oecd (fallback_error)`);
    return {
      framework: getFramework('oecd'),
      frameworkKey: 'oecd',
      reason: 'fallback_error',
    };
  }
}

function pickResult(resolved) {
  return { framework: resolved.framework, frameworkKey: resolved.frameworkKey };
}

/**
 * Legacy signature — returns the framework module directly.
 * Retained for backwards compatibility with older callers/tests that just
 * want the module. New code should prefer selectFrameworkWithReason().
 *
 * @param {string} userId - User UUID
 * @returns {Promise<object>} Framework module
 */
async function selectFramework(userId) {
  const { framework } = await selectFrameworkWithReason(userId);
  return framework;
}

module.exports = { selectFramework, selectFrameworkWithReason };
