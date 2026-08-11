/**
 * The language registry — the single list every other list derives from.
 *
 * NIETE ICT serves exactly two languages: Urdu and English. Before this module
 * there were six independent definitions of "the supported languages", with
 * different memberships and inconsistent code shapes, which is why adding or
 * removing a language meant editing six files and why two pickers could offer
 * different sets (five in /settings, ten in /language).
 *
 * Adding a language is a row here plus reviewed copy. Never control flow.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OFFER IS A FLAT CONSTANT AND NOT KEYED BY REGION
 *
 * The parent bot keys its offer by region because one codebase serves five
 * markets. NIETE-Rumi is single-tenant: it serves ICT only, and users.region
 * holds SUB-DISTRICTS (Urban-I, Tarnol, Sihala), not markets. Language has no
 * region dependency here — region drives the observation framework, nothing
 * else.
 *
 * A region-keyed offer would also have broken staging outright. The environment
 * carries two region variables with different values, DEFAULT_REGION
 * ("niete-staging") and REGION ("niete"), and nothing normalises between them.
 * A lookup would either fail closed on staging (no languages at all) or fail
 * open to the old five-language default — which is the bug being fixed. A flat
 * constant removes the whole class.
 * ---------------------------------------------------------------------------
 */

/**
 * The languages this deployment offers, in preference order.
 * OFFER[0] is the default for a teacher who has not chosen — Urdu, because ICT
 * government-school teaching is predominantly Urdu-medium.
 */
const LANGUAGE_OFFER = ['ur', 'en'];

/**
 * Everything a language implies, in one place. A surface that needs the font,
 * the voice or the template code reads it from here rather than keeping its own
 * map — that duplication is what let the report render Urdu in the wrong script
 * while the reply was correct.
 */
const SUPPORTED_LANGUAGES = [
  {
    code: 'ur',
    settingsTitle: 'اردو (Urdu)',
    languageTitle: 'اردو',
    languageDescription: 'Urdu',
    direction: 'rtl',
    script: 'Nastaliq',
    // Nastaliq is correct for Urdu readers but crashes fontkit (pdfkit's shaper)
    // on its GPOS anchor tables, so Urdu documents must render through the
    // Playwright HTML path, which shapes with HarfBuzz. Phase 3 moves them.
    documentFont: 'NotoNastaliqUrdu',
    ttsProvider: 'uplift',
    ttsVoice: 'urdu-female',
    // Meta template language code. NOT the same namespace as `code` — see below.
    templateCode: 'ur',
  },
  {
    code: 'en',
    settingsTitle: 'English',
    languageTitle: 'English',
    languageDescription: 'English',
    direction: 'ltr',
    script: 'Latin',
    documentFont: null,
    ttsProvider: 'elevenlabs',
    ttsVoice: null,
    // 'en_US', not 'en'. Meta's template language codes are locale-shaped and a
    // template approved as en_US will NOT match a send asking for 'en' — Meta
    // hard-fails rather than falling back. Confirmed against the live account
    // by bot/scripts/audit/template-language-matrix.js; re-run it per account
    // before trusting this value anywhere new.
    templateCode: 'en_US',
  },
];

const BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));

/**
 * The language a teacher is OFFERED first — the picker's top row, and the seed
 * for a new registration once Phase 4 asks the question.
 *
 * Deliberately NOT the same thing as language-cache's DEFAULT_LANGUAGE, which is
 * the emergency floor when we cannot determine a language at all. That floor is
 * English by resolved decision; this default is Urdu because ICT teaching is
 * predominantly Urdu-medium. Conflating the two would either seed everyone
 * English again or answer English-preferring teachers in Urdu on failure.
 */
function offerDefaultLanguage() {
  return LANGUAGE_OFFER[0];
}

/** Is this code one this deployment actually serves? */
function isOffered(code) {
  return typeof code === 'string' && LANGUAGE_OFFER.includes(code);
}

/**
 * The offer as full registry rows, in offer order. Both pickers build from this,
 * so they cannot drift apart again.
 */
function getOfferedLanguages() {
  return LANGUAGE_OFFER.map((code) => BY_CODE.get(code)).filter(Boolean);
}

/** Full registry row for a code, or undefined. */
function getLanguage(code) {
  return BY_CODE.get(code);
}

/**
 * The Meta template language code for one of our codes. Returns null for an
 * unknown code so a caller fails loudly rather than sending 'undefined' to Meta.
 */
function templateCodeFor(code) {
  return BY_CODE.get(code)?.templateCode ?? null;
}

/**
 * A minimal language + script anchor for LLM calls, so a model cannot drift to
 * a neighbouring Perso-Arabic language or fall back to Roman transliteration.
 * Returns null for English: it is the well-resourced default and adding an
 * instruction there only risks changing output that is already correct.
 */
function languageAnchor(code) {
  const lang = BY_CODE.get(code);
  if (!lang || code === 'en') return null;
  return (
    `LANGUAGE & SCRIPT (most important rule): Write your ENTIRE response in ` +
    `${lang.languageDescription}, using its native ${lang.languageTitle} script. ` +
    `Common English technical terms (e.g. "lesson plan", "quiz", "PDF") may stay ` +
    `inline in English as a Pakistani teacher would naturally say them, but every ` +
    `other word MUST be in ${lang.languageTitle} script. Do NOT use Roman/Latin ` +
    `transliteration. Do NOT switch to another language.`
  );
}

module.exports = {
  LANGUAGE_OFFER,
  SUPPORTED_LANGUAGES,
  offerDefaultLanguage,
  isOffered,
  getOfferedLanguages,
  getLanguage,
  templateCodeFor,
  languageAnchor,
};
