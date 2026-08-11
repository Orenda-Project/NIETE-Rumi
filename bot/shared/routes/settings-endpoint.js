/**
 * Settings Flow Endpoint Handler
 *
 * Handles the endpoint-based WhatsApp Flow for user settings.
 * Uses data_api_version 3.0 with encrypted data exchange.
 *
 * Flow screens:
 *   SETTINGS_MAIN → SUCCESS
 *
 * SETTINGS_MAIN: language, observation_framework
 *   Endpoint provides: languages, frameworks (dropdown data-sources),
 *     current_language, current_framework, info_text (pre-selected values)
 *
 * SUCCESS: terminal screen
 *   Endpoint provides: confirmation_message, details_message, extension_message_response
 *
 * Key patterns (shared with the registration endpoint):
 * - Response format: {screen, data} ONLY — NO version field
 * - INIT returns dropdown data + current values for init-values
 * - data_exchange saves preferences and returns SUCCESS
 *
 * Region-agnostic: the default observation framework comes from
 * region-config (env-driven), never a hardcoded region list.
 */

const { logToFile } = require('../utils/logger');
const { LANGUAGES_DROPDOWN, FRAMEWORKS_DROPDOWN } = require('../config/settings-config');
const { FRAMEWORK_LABELS, defaultFrameworkForRegion } = require('../config/region-config');
const { setUserLanguage } = require('../utils/language-cache');
const { offerDefaultLanguage } = require('../config/languages');
const { resolveUx } = require('../config/ux-strings');
const supabase = require('../config/supabase');

// Look up a language's display label from the configured dropdown.
function languageLabel(code) {
  const match = LANGUAGES_DROPDOWN.find(l => l.id === code);
  return match ? match.title : (LANGUAGES_DROPDOWN[0]?.title || 'English');
}

/**
 * Handle INIT action — return SETTINGS_MAIN with current user preferences
 */
async function handleSettingsInit(userId) {
  logToFile('⚙️ Settings flow INIT', { userId });

  // Fetch user's current preferences + region
  const { data: user } = await supabase
    .from('users')
    .select('preferred_language, preferences, region')
    .eq('id', userId)
    .single();

  const prefs = user?.preferences || {};
  const region = (user?.region || '').toLowerCase();
  const regionDefault = defaultFrameworkForRegion(region);

  // Read the column, and only the column. This used to prefer the JSONB blob,
  // which is the other half of the dual-store bug: the screen would show
  // whatever the blob said while every reply used the column. Falling back to
  // the blob for one release would just keep the divergence alive, and no rows
  // have it set today — so the column is simply the answer.
  const currentLang = user?.preferred_language || offerDefaultLanguage();
  const currentFramework = prefs.observation_framework || regionDefault;

  const regionLabel = region ? region.charAt(0).toUpperCase() + region.slice(1) : 'your region';
  const defaultLabel = FRAMEWORK_LABELS[regionDefault] || regionDefault;

  const response = {
    screen: 'SETTINGS_MAIN',
    data: {
      languages: LANGUAGES_DROPDOWN,
      frameworks: FRAMEWORKS_DROPDOWN,
      current_language: currentLang,
      current_framework: currentFramework,
      info_text: `Default for ${regionLabel}: ${defaultLabel}. You can change this anytime.`
    }
  };

  logToFile('📤 Settings INIT response', { userId, response: JSON.stringify(response) });
  return response;
}

/**
 * Handle data_exchange for settings screens
 */
async function handleSettingsDataExchange(userId, screen, screenData, flowToken) {
  logToFile('⚙️ Settings flow data_exchange', {
    userId,
    screen,
    screenDataKeys: Object.keys(screenData || {}),
    screenData
  });

  if (screen === 'SETTINGS_MAIN') {
    return await handleSettingsMainSubmit(userId, screenData, flowToken);
  }

  logToFile('⚠️ Unknown screen in settings flow', { screen });
  return { data: { error: { message: 'Unknown screen' } } };
}

/**
 * Handle SETTINGS_MAIN submission — validate and save preferences to DB
 */
async function handleSettingsMainSubmit(userId, screenData, flowToken) {
  const framework = screenData.observation_framework || 'oecd';

  // Validate framework is one we support
  if (!FRAMEWORK_LABELS[framework]) {
    logToFile('⚠️ Invalid framework in settings', { userId, framework });
    return { data: { error: { message: 'Invalid observation framework' } } };
  }

  // Fetch existing state. preferred_language is read so we can tell an actual
  // change from a no-op — the lock must only be set when she really chose.
  const { data: user } = await supabase
    .from('users')
    .select('preferences, preferred_language')
    .eq('id', userId)
    .single();

  const existingPrefs = user?.preferences || {};
  const currentLanguage = user?.preferred_language || null;

  // A submission that never touched the language dropdown must not touch her
  // language. This previously read `screenData.language || 'en'`, so a
  // framework-only save silently rewrote an Urdu teacher to English.
  const languageSubmitted = Object.prototype.hasOwnProperty.call(screenData, 'language')
    && screenData.language !== null
    && screenData.language !== '';
  const language = languageSubmitted ? screenData.language : currentLanguage;
  const languageChanged = languageSubmitted && screenData.language !== currentLanguage;

  // Framework still lives in the preferences JSONB. Language deliberately does
  // NOT: it used to be written to both the blob and the column, with Settings
  // reading the blob first and the rest of the bot reading the column, so the
  // two could disagree permanently and the screen could show one language while
  // the bot spoke another. The column is now the single home.
  const updatedPrefs = {
    ...existingPrefs,
    observation_framework: framework,
  };
  delete updatedPrefs.language;

  await supabase
    .from('users')
    .update({ preferences: updatedPrefs })
    .eq('id', userId);

  // Language goes through the ONE writer, which validates against the offer,
  // sets the lock and invalidates both Redis keys. Writing the column directly
  // from here is what left the 24-hour cache serving the old language and left
  // the choice unlocked, so a coaching recording could overwrite it.
  if (languageChanged) {
    const ok = await setUserLanguage(userId, screenData.language, true);
    if (!ok) {
      logToFile('⚠️ Settings language write rejected by the writer', {
        userId,
        requested: screenData.language,
      });
      return {
        data: {
          error: {
            message: resolveUx('languageNotAvailable', { language: currentLanguage }),
          },
        },
      };
    }
    logToFile('✅ Settings language updated via writer', {
      userId,
      from: currentLanguage,
      to: screenData.language,
      locked: true,
    });
  } else {
    logToFile('ℹ️ Settings saved without a language change', {
      userId,
      language: language || '(unset)',
      languageSubmitted,
    });
  }

  const langLabel = languageLabel(language);
  const frameworkLabel = FRAMEWORK_LABELS[framework] || framework;

  // Confirm in the language she just chose, not the one she is leaving. The
  // success screen was hardcoded English, so the single most common Urdu journey
  // — open /settings, switch to Urdu, save — ended by telling her in English
  // that Rumi would now speak Urdu. The first message after a switch
  // contradicting the switch is its own bug, and the most visible one left.
  const replyLanguage = language;

  const response = {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: {
          flow_token: flowToken,
          language,
          observation_framework: framework,
        }
      },
      confirmation_message: resolveUx('settingsSaved', { language: replyLanguage }),
      details_message: resolveUx('settingsDetails', {
        language: replyLanguage,
        params: { language: langLabel, framework: frameworkLabel },
      }),
    }
  };

  logToFile('📤 SETTINGS_MAIN → SUCCESS', {
    userId, language, framework, response: JSON.stringify(response)
  });

  return response;
}

/**
 * Handle BACK navigation — return to SETTINGS_MAIN with current values
 */
async function handleSettingsBack(userId, screen, flowToken) {
  logToFile('⚙️ Settings flow BACK', { userId, screen });
  return await handleSettingsInit(userId);
}

module.exports = {
  handleSettingsInit,
  handleSettingsDataExchange,
  handleSettingsBack,
};
