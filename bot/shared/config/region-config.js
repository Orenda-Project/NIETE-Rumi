/**
 * Region Configuration
 *
 * Maps regions to their default observation framework + holds the framework
 * display labels used by the settings flow and confirmation messages.
 * Also owns the coach-role display label (e.g. "Human Coach", "Rumi Digital
 * Coach") surfaced on the coaching card footer / list-message footer /
 * observation-report metadata.
 *
 * Region-agnostic by design: there are NO hardcoded region names here. The
 * default framework is env-driven (DEFAULT_OBSERVATION_FRAMEWORK), and a
 * deployment that wants per-region defaults supplies a JSON map via
 * REGION_FRAMEWORK_MAP (e.g. {"punjab":"hots","coast":"teach"}). Unknown or
 * unset regions fall back to the global default. Services must NEVER hardcode
 * region→framework routing — they read it from here.
 *
 * The coach-role label follows the same pattern: DEFAULT_COACH_ROLE_LABEL
 * sets the deployment-wide fallback ("Rumi Digital Coach" if unset), and
 * REGION_COACH_ROLE_LABEL_MAP (JSON string, keys lowercased region names)
 * lets a multi-region deployment override per region. Callers pass the
 * user's region to coachRoleLabelForRegion() and receive one string to
 * render — no hardcoded region → label routing lives in services.
 */

// Observation framework display names (settings dropdown + confirmations).
const FRAMEWORK_LABELS = {
  oecd: 'OECD 5D Framework',
  hots: 'HOTS Framework',
  teach: 'Teach (World Bank)',
  fico: 'FICO Unified Tool',
};

// Global default framework for regions without an explicit override.
const DEFAULT_FRAMEWORK = process.env.DEFAULT_OBSERVATION_FRAMEWORK || 'oecd';

// Optional per-region overrides, supplied as a JSON object string in the env.
// Keys are lowercased region names; values are framework keys from FRAMEWORK_LABELS.
function parseRegionFrameworkMap() {
  try {
    const parsed = JSON.parse(process.env.REGION_FRAMEWORK_MAP || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const REGION_FRAMEWORK_MAP = parseRegionFrameworkMap();

/**
 * Resolve the default observation framework for a region.
 * @param {string} region - Region name (any case), or empty/undefined.
 * @returns {string} A framework key present in FRAMEWORK_LABELS.
 */
function defaultFrameworkForRegion(region) {
  const key = (region || '').toLowerCase();
  const mapped = REGION_FRAMEWORK_MAP[key];
  if (mapped && FRAMEWORK_LABELS[mapped]) return mapped;
  return DEFAULT_FRAMEWORK;
}

// ─── Coach role label (observer identity surfaced to teachers) ──────
//
// The label rendered wherever the coaching pipeline names the observer role:
// the coaching-card footer (the WhatsApp PNG the teacher receives after a
// lesson), the LP-selection list-message footer, and the observation-report
// observerName metadata.
//
// Historically hardcoded to "Rumi Digital Coach". Now env-driven so a
// deployment (e.g. ICT / NIETE) can render "Human Coach" instead. Same
// two-knob shape as the framework selector — one global default + one
// optional per-region JSON map.

const DEFAULT_COACH_ROLE_LABEL = process.env.DEFAULT_COACH_ROLE_LABEL || 'Rumi Digital Coach';

function parseRegionCoachRoleLabelMap() {
  try {
    const parsed = JSON.parse(process.env.REGION_COACH_ROLE_LABEL_MAP || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const REGION_COACH_ROLE_LABEL_MAP = parseRegionCoachRoleLabelMap();

/**
 * Resolve the coach-role display label for a region.
 * @param {string} [region] - Region name (any case), or empty/undefined.
 * @returns {string} A non-empty display string (falls back to
 *   DEFAULT_COACH_ROLE_LABEL, and to 'Rumi Digital Coach' if that too is
 *   empty — so callers never render a blank footer).
 */
function coachRoleLabelForRegion(region) {
  const key = (region || '').toLowerCase();
  const mapped = REGION_COACH_ROLE_LABEL_MAP[key];
  if (typeof mapped === 'string' && mapped.trim()) return mapped.trim();
  if (DEFAULT_COACH_ROLE_LABEL && DEFAULT_COACH_ROLE_LABEL.trim()) {
    return DEFAULT_COACH_ROLE_LABEL.trim();
  }
  return 'Rumi Digital Coach';
}

module.exports = {
  FRAMEWORK_LABELS,
  DEFAULT_FRAMEWORK,
  REGION_FRAMEWORK_MAP,
  defaultFrameworkForRegion,
  DEFAULT_COACH_ROLE_LABEL,
  REGION_COACH_ROLE_LABEL_MAP,
  coachRoleLabelForRegion,
};
