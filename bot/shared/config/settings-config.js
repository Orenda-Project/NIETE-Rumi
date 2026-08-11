/**
 * Settings Flow Data Configuration
 *
 * Static data for the WhatsApp Flow settings form — {id, title} arrays used as
 * Flow dropdown data-sources.
 *
 * Flow JSON references:
 *   SETTINGS_MAIN: ${data.languages}, ${data.frameworks}
 *
 * The language list is derived from the language registry
 * (shared/config/languages.js), so /settings and /language cannot offer
 * different sets. The framework list is derived from region-config
 * FRAMEWORK_LABELS.
 *
 * This used to read a SETTINGS_LANGUAGES environment variable and fall back to a
 * five-language default. Two problems, both live: the variable was not set on
 * this deployment, so the dropdown offered Kiswahili, Arabic and Spanish —
 * languages with no content support — and the parser returned that same default
 * on a MALFORMED value, so a typo could not be detected by reading the config.
 * A fail-open path to the wrong answer is worse than no path at all.
 */

const { FRAMEWORK_LABELS } = require('./region-config');
const { getOfferedLanguages } = require('./languages');

// Language options, straight from the registry. Offer order is preserved:
// the first entry is the default for a teacher who has not chosen.
const LANGUAGES_DROPDOWN = getOfferedLanguages().map(({ code, settingsTitle }) => ({
  id: code,
  title: settingsTitle,
}));

// Observation framework options — built from region-config labels.
const FRAMEWORKS_DROPDOWN = Object.entries(FRAMEWORK_LABELS).map(([id, title]) => ({
  id,
  title,
}));

module.exports = {
  LANGUAGES_DROPDOWN,
  FRAMEWORKS_DROPDOWN,
};
