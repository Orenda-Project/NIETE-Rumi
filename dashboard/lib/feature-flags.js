/**
 * bd-2460 — shared, fail-closed feature flags backed by `app_settings`.
 *
 * Why the database and not an env var: the bot and the dashboard are separate
 * Railway services with separate environments. An env var would have to be set
 * twice and could drift, which is exactly the "two surfaces, two answers"
 * problem this exists to prevent. They share one Supabase, so one row is one
 * answer for both.
 *
 * `app_settings` is already the home for config flags (pic_lp_backend_ab) —
 * no new table.
 *
 * FAIL CLOSED, always. An absent row, a malformed value, or a failed lookup
 * all read as OFF. Turning a feature on has to be a deliberate act, and a
 * database hiccup must never expose something unfinished to teachers.
 */

/** app_settings key for the UG_EG-backed Assessment Generator. */
const ASSESSMENT_GENERATOR_KEY = 'assessment_generator_enabled';

/** app_settings key for editing a generated paper (bd-hb8qs). */
const ASSESSMENT_EDITING_KEY = 'assessment_editing_enabled';

/**
 * What every surface says while the Assessment Generator is off. Kept
 * character-identical to the bot's /assessment fallback
 * (bot/shared/handlers/text-message.handler.js) so a teacher who tries
 * WhatsApp and then the portal gets one consistent answer.
 */
const ASSESSMENT_GENERATOR_OFF_MESSAGE =
  "The assessment generator is being prepared for you. We'll notify you when it's live.";

/**
 * Read a boolean flag from app_settings.
 *
 * Only a real `true` (JSON boolean, or the string "true") counts as on.
 * Anything else — including 1, "yes", an object, or no row at all — is off.
 * Guessing at intent is how a half-configured flag turns a feature on by
 * accident.
 *
 * @param {object} supabase client for whichever service is asking
 * @param {string} key app_settings.key
 * @returns {Promise<boolean>}
 */
async function isFlagEnabled(supabase, key) {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return false;

    let value = data.value;
    if (typeof value === 'string') {
      // JSONB can round-trip as a quoted string; tolerate both '"true"' and 'true'.
      try { value = JSON.parse(value); } catch (_) { /* fall through to the raw string */ }
    }
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * @param {object} supabase
 * @returns {Promise<boolean>} whether the Assessment Generator is live
 */
function isAssessmentGeneratorEnabled(supabase) {
  return isFlagEnabled(supabase, ASSESSMENT_GENERATOR_KEY);
}

/** bd-3bvfj — app_settings key for teacher self-observation from the portal. */
const PORTAL_SELF_OBSERVATION_KEY = 'portal_self_observation';

/**
 * bd-5rz1v.6 — app_settings key for a COACH running an /observe observation from
 * the portal (record or send the lesson, check the draft, the talk with the
 * teacher, send her the report). Same shape and rule as the key above.
 */
const PORTAL_COACH_OBSERVATION_KEY = 'portal_coach_observation';

/**
 * bd-5rz1v.12 — app_settings key for the portal's NEW UI (Direction B: light
 * screens, big rows, one bottom button, an indigo menu bar). It is designed and
 * shipped screen by screen behind this one row. Same shape and rule as the keys
 * above: true = everyone, a list of users.id = a pilot, absent = off.
 */
const PORTAL_NEW_UI_KEY = 'portal_new_ui';

/**
 * bd-3bvfj — a flag that can be on for EVERYONE or for a PILOT.
 *
 *   true (or "true")            → on for every user
 *   ["<user id>", …] (or JSON)  → on only for those users.id values
 *   anything else, no row, or a failed read → OFF
 *
 * Same fail-closed rule as isFlagEnabled: the only way on is a deliberate,
 * well-formed value. An object, a number or an empty list is OFF, and a pilot
 * list never matches a missing user.
 *
 * @param {object} supabase
 * @param {string} key app_settings.key
 * @param {string|null} userId the SESSION user
 * @returns {Promise<boolean>}
 */
async function isFlagEnabledForUser(supabase, key, userId) {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return false;

    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { /* fall through to the raw string */ }
    }
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    if (Array.isArray(value)) return value.some((id) => typeof id === 'string' && id === userId);
    return false;
  } catch (_) {
    return false;
  }
}

function isAssessmentEditingEnabled(supabase) {
  return isFlagEnabled(supabase, ASSESSMENT_EDITING_KEY);
}

module.exports = {
  PORTAL_SELF_OBSERVATION_KEY,
  PORTAL_COACH_OBSERVATION_KEY,
  PORTAL_NEW_UI_KEY,
  isFlagEnabledForUser,
  ASSESSMENT_GENERATOR_KEY,
  ASSESSMENT_EDITING_KEY,
  ASSESSMENT_GENERATOR_OFF_MESSAGE,
  isFlagEnabled,
  isAssessmentGeneratorEnabled,
  isAssessmentEditingEnabled,
};
