/**
 * Teacher-facing fixed copy, and the one language clamp.
 *
 * Two things live here because they are the same problem seen from two sides:
 * the clamp answers "which language may this surface render in", and the catalog
 * answers "what does it say in that language".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT config/system-messages.js
 *
 * That file looks like this one and is deliberately NOT reused. It is the open
 * platform's CUSTOMIZATION SEAM — docs/agent-customization.md points an adopter
 * at it as "the file you translate to add a language", it carries nine languages
 * on purpose, and tests/setup/orphan-modules.allowlist.json registers it as an
 * intentional orphan. Folding this deployment's en/ur copy into it would break
 * that contract for every downstream cloner and drag seven languages ICT does
 * not serve back into a live read path.
 *
 * This module is the opposite: narrow, deployment-specific, and wired in.
 * ---------------------------------------------------------------------------
 */

const { LANGUAGE_OFFER, getLanguage } = require('./languages');

/**
 * The emergency floor. English by resolved decision, and the same floor as
 * language-cache's DEFAULT_LANGUAGE — the "fallbacks disagree" defect was two
 * modules each picking their own, so this one does not get an opinion.
 */
const FLOOR = 'en';

/**
 * Collapse any language code to one this deployment can actually render.
 *
 * Replaces 23 inline copies of `lang === 'ur' ? 'ur' : 'en'`. Every one of those
 * was correct; the problem was structural — nothing stopped the 24th from being
 * written differently, and several were already drifting (some clamped a
 * `preferred_language`, some a detected language, some a Flow field).
 *
 * Total by construction: junk, null and non-strings return the floor rather than
 * throwing, because this sits on render paths that must not fail closed.
 *
 * @param {*} lang
 * @param {string[]} [offered] narrow the offer further; cannot widen it
 * @returns {string} an offered language code
 */
function clampLanguage(lang, offered = LANGUAGE_OFFER) {
  if (typeof lang !== 'string') return FLOOR;
  const code = lang.trim();
  if (!code) return FLOOR;
  // Intersected with the deployment offer so a caller passing a wider list
  // cannot re-introduce a language we do not serve.
  return offered.includes(code) && LANGUAGE_OFFER.includes(code) ? code : FLOOR;
}

/**
 * The copy. One entry per key, one string per offered language.
 *
 * Urdu here is not newly invented — it follows the phrasing already used
 * elsewhere in this codebase (`سیٹنگز` as in the /settings entry points,
 * `محفوظ ہو گئی` as in the attendance and observation confirmations) so the
 * teacher hears one consistent voice rather than a second translator's.
 */
const UX_STRINGS = {
  // Shown on the Settings SUCCESS screen. Previously English-only, so a teacher
  // who had just switched to Urdu was congratulated in English.
  settingsSaved: {
    en: 'Your settings have been saved.',
    ur: 'آپ کی سیٹنگز محفوظ ہو گئی ہیں۔',
  },

  settingsDetails: {
    en: 'Language: {language} | Observation: {framework}',
    ur: 'زبان: {language} | مشاہدہ: {framework}',
  },

  /**
   * The language picker's footer. Bilingual — see languagePickerHeader below —
   * but on a HARD 60-CHARACTER BUDGET, which is why it is terse to the point of
   * being telegraphic rather than a full sentence in each language.
   *
   * The first bilingual version of this was 87 characters and Meta rejected the
   * whole message (#131009, "Footer text length invalid. Min length: 0, Max
   * length: 60"), so /language sent nothing at all. The command name appears once
   * instead of twice, and each language gets a phrase rather than a sentence.
   * tests/config/ux-strings-whatsapp-limits.test.js enforces the budget with
   * headroom, so the next edit here cannot repeat it.
   */
  languagePickerFooter: {
    en: '/language — change anytime · کسی بھی وقت تبدیل کریں',
    ur: '/language — کسی بھی وقت تبدیل کریں · change anytime',
  },

  /**
   * The picker's own chrome stays BILINGUAL in both slots, which looks like the
   * stapled-language bug this workstream removes but is the one place it is
   * correct: this is the screen a teacher uses when the current language is
   * wrong for her. Rendering it only in the language she is trying to leave is
   * how a picker becomes unusable. Kept here rather than inline so the choice is
   * visible and reviewable instead of buried in a request body.
   */
  languagePickerHeader: {
    en: 'Select Language / زبان منتخب کریں',
    ur: 'زبان منتخب کریں / Select Language',
  },

  languagePickerBody: {
    en: 'Choose your preferred language. I will respond in this language for all conversations.\n\nاپنی پسندیدہ زبان منتخب کریں۔ میں اسی زبان میں جواب دوں گی۔',
    ur: 'اپنی پسندیدہ زبان منتخب کریں۔ میں اسی زبان میں جواب دوں گی۔\n\nChoose your preferred language. I will respond in this language.',
  },

  /**
   * Reading assessment — the welcome, and the passage-language picker's chrome.
   *
   * The welcome used to be generated by gpt-4o-mini at temperature 0.3, per
   * teacher, per session, from a prompt asking it to "write a friendly message in
   * language code X". Interface text that is non-deterministic, unreviewable and
   * billed per teacher. Now it is copy.
   *
   * The picker chrome below lands in a WhatsApp interactive list, so it is on the
   * same hard caps as the /language picker (header 60, body 1024, footer 60) and
   * is covered by tests/config/ux-strings-whatsapp-limits.test.js.
   */
  readingWelcome: {
    en: "Let's check a student's reading. It takes about 3–5 minutes. First, choose the language for the passage.",
    ur: 'آئیے ایک طالب علم کی قرائت جانچیں۔ اس میں تقریباً 3 سے 5 منٹ لگیں گے۔ پہلے اقتباس کی زبان منتخب کریں۔',
  },

  // Concurrent sessions: the teacher is assessing more than one student, so the
  // message names which one. The old prompt merely ASKED the model to mention it.
  readingWelcomeNamed: {
    en: "Let's check {student}'s reading. It takes about 3–5 minutes. First, choose the language for the passage.",
    ur: '{student} کی قرائت جانچتے ہیں۔ اس میں تقریباً 3 سے 5 منٹ لگیں گے۔ پہلے اقتباس کی زبان منتخب کریں۔',
  },

  readingPickerHeader: {
    en: 'Select Language',
    ur: 'زبان منتخب کریں',
  },

  readingPickerBody: {
    en: 'What language should the reading passage be in?',
    ur: 'قرائت کا اقتباس کس زبان میں ہونا چاہیے؟',
  },

  // Was English-only, like the /language footer before it was fixed.
  readingPickerFooter: {
    en: 'Reading assessment · قرائت کا جائزہ',
    ur: 'قرائت کا جائزہ · Reading assessment',
  },

  // Returned when the writer rejects a language, i.e. a stale client replayed a
  // row for a language this deployment no longer offers.
  languageNotAvailable: {
    en: 'That language is not available. Please choose from the list.',
    ur: 'یہ زبان دستیاب نہیں ہے۔ براہ کرم فہرست میں سے منتخب کریں۔',
  },
};

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Resolve one catalog key for one teacher.
 *
 * Throws on an unknown key or a missing parameter. That is deliberate: the
 * alternative — the empty string, or the literal `{language}` — reaches a
 * teacher silently and nothing downstream notices. A throw surfaces in test.
 *
 * @param {string} key
 * @param {object} opts
 * @param {object} [opts.user] a users row; preferred_language is read from it
 * @param {string} [opts.language] explicit language, wins over user
 * @param {object} [opts.params] values for {placeholders}
 */
function resolveUx(key, { user, language, params } = {}) {
  const variants = UX_STRINGS[key];
  if (!variants) {
    throw new Error(`resolveUx: unknown string key "${key}"`);
  }

  const lang = clampLanguage(language || user?.preferred_language);
  const template = variants[lang] ?? variants[FLOOR];

  return template.replace(PLACEHOLDER, (_, name) => {
    const value = params?.[name];
    if (value === undefined || value === null) {
      throw new Error(`resolveUx: missing param "${name}" for key "${key}"`);
    }
    return String(value);
  });
}

/**
 * The label for a language, in the reader's own language — for use inside
 * settingsDetails. Derived from the registry so it cannot drift from the picker.
 */
function languageLabelFor(code) {
  const row = getLanguage(clampLanguage(code));
  return row ? row.languageDescription : 'English';
}

module.exports = {
  UX_STRINGS,
  resolveUx,
  clampLanguage,
  languageLabelFor,
  FLOOR,
};
