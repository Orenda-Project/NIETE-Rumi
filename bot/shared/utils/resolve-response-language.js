/**
 * resolve-response-language — the ONE place that decides which language a reply
 * is written in.
 *
 * WHY THIS EXISTS
 *
 * The text and voice handlers each had their own copy of this decision, and both
 * used `LanguageDetectorService.detectLanguage()` — a SCRIPT detector — to
 * override the teacher's STORED preference. That detector counts Perso-Arabic
 * characters (U+0600–U+06FF) and returns 'en' for everything else, including the
 * empty string.
 *
 * In this market that is wrong in one specific, very common way: ROMAN URDU is
 * Latin-script Urdu. A teacher typing "class ka lesson plan bhej dein" produces
 * zero Perso-Arabic characters, so the detector says 'en', so the handler
 * overrode her stored 'ur' and asked the model for English. The model, seeing
 * Urdu content, answered in Urdu — and `verifyOutputLanguage` logged
 * `language_drift` for a reply that was, in fact, the right one.
 *
 * Measured on prod before this change: 94% of drift events were
 * "expected en -> detected ur"; 59 of 60 sampled drifting users had
 * preferred_language='ur' with language_locked=false.
 *
 * THE RULE
 *
 * Only override a stored preference on UNAMBIGUOUS evidence.
 *
 *   - Perso-Arabic script IS unambiguous evidence of Urdu -> adapt.
 *   - Latin script is NOT evidence of English -> keep the stored preference.
 *
 * The asymmetry is the whole point, and it is why this is not simply "delete
 * auto-adapt". This codebase had previously resolved the same tension in opposite
 * directions in two different subsystems — one made per-turn detection outrank a
 * locked preference, another required the lock be respected. Adapting only on
 * unambiguous evidence keeps the defensible half of each.
 *
 * DELIBERATELY PURE
 *
 * No I/O, no cache, no logging. Callers pass what they already have and log the
 * returned `source`/`autoAdapted` themselves. That keeps it exhaustively testable
 * and means text and voice cannot drift apart again.
 */
const { isOffered, LANGUAGE_OFFER, DEFAULT_LANGUAGE } = require('../config/languages');

/**
 * Languages whose SCRIPT identifies them well enough to override a stored
 * preference. Only Urdu qualifies: its script is exclusive to it here, whereas
 * Latin script is shared by English AND Roman Urdu.
 *
 * If a third language is ever offered, adding it here is a deliberate claim that
 * its script is unambiguous — not a formality.
 */
const SCRIPT_UNAMBIGUOUS = new Set(['ur']);

/** Coerce anything to a language this deployment actually serves. */
const clamp = (code, fallback) => (isOffered(code) ? code : fallback);

/**
 * @param {object}  args
 * @param {object|null} args.user      the users row (may be null pre-registration)
 * @param {string|null} args.stored    her stored/cached preference (getUserLanguage)
 * @param {string|null} args.detected  what the detector saw in THIS message
 * @returns {{language:string, source:'locked'|'stored'|'detected'|'floor', autoAdapted:boolean, reason:string}}
 */
function resolveResponseLanguage({ user, stored, detected } = {}) {
  const floor = clamp(DEFAULT_LANGUAGE, LANGUAGE_OFFER[LANGUAGE_OFFER.length - 1]);
  const storedOk = isOffered(stored) ? stored : null;

  // 1. An explicit choice outranks everything, including the script in front of
  //    us. She told us; we do not second-guess her.
  if (user && user.language_locked === true) {
    const chosen = isOffered(user.preferred_language) ? user.preferred_language : storedOk;
    return {
      language: chosen || floor,
      source: 'locked',
      autoAdapted: false,
      reason: 'teacher locked this language explicitly',
    };
  }

  // 2. Unambiguous script evidence, and it disagrees with what we have stored.
  //    Only ever moves TOWARD a script-identified language, never away from a
  //    stored preference on the strength of Latin characters.
  if (detected && SCRIPT_UNAMBIGUOUS.has(detected) && isOffered(detected) && detected !== storedOk) {
    return {
      language: detected,
      source: 'detected',
      autoAdapted: true,
      reason: `message is in ${detected} script, which is unambiguous — adapting for this turn`,
    };
  }

  // 3. Otherwise her stored preference stands. This is where Roman Urdu lands,
  //    and it is the case the whole file exists for.
  if (storedOk) {
    return {
      language: storedOk,
      source: 'stored',
      autoAdapted: false,
      reason: detected
        ? `detected "${detected}" is not unambiguous evidence — keeping stored preference`
        : 'no detection available — keeping stored preference',
    };
  }

  // 4. Nothing to go on at all: no row, nothing stored, nothing detectable.
  return {
    language: floor,
    source: 'floor',
    autoAdapted: false,
    reason: 'no user, no stored preference, no usable detection — emergency floor',
  };
}

module.exports = { resolveResponseLanguage, SCRIPT_UNAMBIGUOUS };
