/**
 * Bot-side reader for the shared, fail-closed feature flags in `app_settings`.
 *
 * Mirrors dashboard/lib/feature-flags.js. The two are deliberately separate
 * files rather than a cross-tree require: the dashboard's guarded imports of
 * bot code are allowed to fail in some environments, and a gate that can
 * silently vanish is not a gate. They read the SAME key with the SAME rules;
 * tests/portal/assessment-generator-flag.test.js pins the contract.
 *
 * FAIL CLOSED — absent row, malformed value, or failed lookup all mean OFF.
 */
const supabase = require('./supabase');
const { logToFile } = require('../utils/logger');

const ASSESSMENT_GENERATOR_KEY = 'assessment_generator_enabled';

/**
 * Editing INDIVIDUAL QUESTIONS is a second, narrower switch.
 *
 * Ticking questions off a paper is the safe half — it only ever removes what the
 * model wrote, and it cannot corrupt the stored tree. Editing rewrites exam_json
 * in place, so it ships behind its own flag and can be turned off without taking
 * the whole review layer down with it. Both are fail-closed, so a deployment
 * that has never heard of this key gets ticking only.
 */
const ASSESSMENT_EDITING_KEY = 'assessment_editing_enabled';

async function isFlagEnabled(key) {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return false;
    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { /* keep the raw string */ }
    }
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  } catch (err) {
    logToFile('⚠️ Feature-flag lookup failed — treating as off', { key, error: err?.message });
    return false;
  }
}

const isAssessmentGeneratorEnabled = () => isFlagEnabled(ASSESSMENT_GENERATOR_KEY);
const isAssessmentEditingEnabled = () => isFlagEnabled(ASSESSMENT_EDITING_KEY);

module.exports = {
  ASSESSMENT_GENERATOR_KEY, ASSESSMENT_EDITING_KEY,
  isFlagEnabled, isAssessmentGeneratorEnabled, isAssessmentEditingEnabled,
};
