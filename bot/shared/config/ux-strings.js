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

  /**
   * Picking a task back up.
   *
   * Every feature's previous answer to "she stopped halfway" was to tell her to
   * start over — the same instruction repeated across the menu, reading, training,
   * quizzes and exam marking. This is the copy that replaces it: we say what she
   * left, and offer to carry on.
   *
   * `{task}` is a teacher-facing task name, never an internal flow id — a teacher
   * should read "lesson plan", not "lesson_plan".
   */
  resumeOfferBody: {
    en: 'Earlier you started a {task} but we did not finish. Shall we pick up where you left off?',
    ur: 'آپ نے پہلے {task} شروع کیا تھا مگر ہم مکمل نہیں کر سکے۔ کیا وہیں سے جاری رکھیں؟',
  },

  /**
   * Button labels. HARD 20-CHARACTER CAP, counted in code points — Urdu counts
   * differently than `.length` suggests, and the sender silently truncates rather
   * than failing, so an over-long label ships as a mangled word instead of an
   * error. Guarded in tests/conversation-state/resume-offer.test.js.
   */
  resumeYesLabel: {
    en: 'Pick up',
    ur: 'جاری رکھیں',
  },

  resumeNoLabel: {
    en: 'Start fresh',
    ur: 'نیا شروع کریں',
  },

  /**
   * Restoring the step is not enough on its own. Caught in review: this used to say
   * only "carrying on with your reading assessment", which leaves her holding a
   * restored state and no idea what to send — and for a step that wants a voice note
   * rather than text, guessing wrong means nothing matches and she is stuck again.
   *
   * So the confirmation carries the ask. `{next}` is the per-step instruction, which
   * makes the message useful rather than merely polite.
   */
  resumeRestored: {
    en: 'Good — carrying on with your {task}. {next}',
    ur: 'بہت خوب — آپ کا {task} جاری ہے۔ {next}',
  },

  resumeDiscarded: {
    en: 'No problem, that one is closed. Send /menu whenever you want something else.',
    ur: 'کوئی مسئلہ نہیں، وہ بند کر دیا۔ کچھ اور چاہیں تو /menu بھیجیں۔',
  },

  // The offer arrived, she tapped, but the task had already been cleared in the
  // meantime. Says so plainly rather than pretending to resume nothing.
  resumeGone: {
    en: 'That one has already been closed. Send /menu to start something new.',
    ur: 'وہ پہلے ہی بند ہو چکا ہے۔ نیا کام شروع کرنے کے لیے /menu بھیجیں۔',
  },

  /**
   * bd-2712 — the /remark Supervisor Remark FLOW (docs/flows/remark-flow.json).
   *
   * These live here rather than beside the rubric because they are Flow CHROME,
   * not rubric content: the indicator names and the four anchor descriptions stay
   * in remark-rubric.js, which is the published contract STEPS reads. Splitting it
   * that way means a rubric revision never touches button copy and vice versa.
   *
   * The old remark-screens.js strings could not be reused: they are chat-shaped
   * ("Reply with 1, 2, 3 or 4", "Reply *submit* to confirm") and instruct the
   * principal to type at a form she taps.
   *
   * Length budgets that apply here (measured in CODE POINTS, not .length):
   *   remarkLevelLabel / remarkPickerLabel — Dropdown labels, kept ≤ 20
   *   remarkContinue / remarkSubmit        — Footer labels, kept short
   * The indicator TextBody lines are body text (1024) and are safe.
   */
  remarkPickHeading: {
    en: 'Which teacher?',
    ur: 'کون سی استاد؟',
  },

  remarkPickHint: {
    en: '{count} still to evaluate this quarter.',
    ur: 'اس سہ ماہی میں {count} باقی ہیں۔',
  },

  remarkPickerLabel: {
    en: 'Teacher',
    ur: 'استاد',
  },

  remarkContinue: {
    en: 'Continue',
    ur: 'آگے بڑھیں',
  },

  remarkRubricHeading: {
    en: 'Rate all five',
    ur: 'پانچوں شعبے',
  },

  remarkLevelLabel: {
    en: 'Level',
    ur: 'درجہ',
  },

  /**
   * TextArea LABEL — cap 20 code points, and labels clip silently rather than
   * erroring.
   *
   * Says NOTHING about being optional: Meta appends its own "(Optional)" to any
   * field with `required: false`, so "Comment (optional)" renders to the
   * principal as "Comment (optional) (Optional)". Exactly the defect recorded
   * against the old attendance flow ("Section (optional) (Optional)", bd-2532).
   * The Flow JSON is the single source of the optionality signal; the label is
   * just the noun.
   */
  remarkCommentLabel: {
    en: 'Comment',
    ur: 'رائے',
  },

  remarkSubmit: {
    en: 'Submit',
    ur: 'جمع کریں',
  },

  // Shown on the Flow's terminal screen. Deliberately does NOT quote a score:
  // the principal keeps the numbers, the teacher gets a narrative with none, and
  // this screen is the handover point between the two.
  remarkFlowSuccess: {
    en: 'Saved. {teacher} will get her coaching note shortly.',
    ur: '{teacher} کو ان کا کوچنگ نوٹ جلد مل جائے گا۔ محفوظ ہو گیا۔',
  },

  // The chat message after the Flow closes (whatsapp-flows rule 11 — never bounce
  // her to "Type /menu"). {left} is the remaining-teachers nudge.
  remarkAckSubmitted: {
    en: 'Saved — {teacher} is done. {left}',
    ur: 'محفوظ ہو گیا — {teacher} مکمل۔ {left}',
  },

  // The post-submit follow-up. ONE button, not two: the principal is done unless
  // she says otherwise, so "move on" must not require a tap. Anything that is not
  // this button — a reply, another command, silence — simply falls through to
  // normal chat. Button title cap is 20 CODE POINTS, the tightest field there is.
  remarkAnotherPrompt: {
    en: 'Grade another teacher?',
    ur: 'کسی اور استاد کا جائزہ لیں؟',
  },

  remarkAnotherButton: {
    en: 'Grade another',
    ur: 'اگلی استاد',
  },

  remarkAckAllDone: {
    en: 'That is every teacher in your school for this quarter.',
    ur: 'اس سہ ماہی کے لیے آپ کے اسکول کی تمام اساتذہ مکمل ہو گئیں۔',
  },

  // The chat message that CARRIES the Flow CTA. Header 60 / button 20 code
  // points — the button is the tightest field in WhatsApp and 20 is 3–4 Urdu
  // words, so it stays a verb phrase, not a sentence.
  remarkFlowHeader: {
    en: 'Teacher Evaluation',
    ur: 'اساتذہ کا جائزہ',
  },

  remarkFlowBody: {
    en: '{cycle} is open. Rate each teacher on the five STEPS indicators — it takes a couple of minutes each.',
    ur: '{cycle} جاری ہے۔ ہر استاد کو پانچ STEPS شعبوں پر پرکھیں — ہر ایک میں دو منٹ لگتے ہیں۔',
  },

  remarkFlowButton: {
    en: 'Start',
    ur: 'شروع کریں',
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
