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

module.exports = { ASSESSMENT_GENERATOR_KEY, isFlagEnabled, isAssessmentGeneratorEnabled };
