/**
 * The 6-12 survey's shared vocabulary — the table names, the delays, the button grammar, and the
 * two reads both tap handlers make (bd-86ivw, split out under bd-2dpco).
 *
 * WHY IT EXISTS. `lp612-feedback.service.js` had grown to four jobs in one file — schedule, send,
 * handle two different taps, consume a free-text window — and past the 300-line limit. The split
 * is by LIFECYCLE STAGE, so the seam is where a reader already puts one: this module is everything
 * that has no stage of its own and that more than one stage needs.
 *
 * Nothing here talks to a teacher. Every teacher-facing string comes from the catalog
 * (`resolveUx`) at the point of sending; see the sending modules' headers for why.
 *
 * BUTTON IDS: `lp612_fb_(yes|no)_(en|ur)_<segment_id>` and
 * `lp612_used_(taught|planned|not_yet)_<segment_id>`.
 *   - The prefixes are distinct from `lp_feedback_` and `student_video_feedback_`, and are
 *     dispatched in `whatsapp-bot.js` beside them. An emitted prefix with no dispatcher is the
 *     orphan class the pre-merge checklist opens with: the teacher taps, an unknown id is logged,
 *     and the datum is gone with no error anywhere.
 *   - The DOCUMENT LANGUAGE rides in the Q1 id because a bot restart between the send and the tap
 *     loses any in-memory context, and `lp_variant` must be right. It is re-clamped on the way out
 *     of the id, never trusted.
 *   - Segment ids are `[A-Za-z0-9._-]`, so they are safe inside an id whose parts are underscore-
 *     separated: the segment is taken as EVERYTHING after the language, so an underscore inside it
 *     cannot split the parse.
 */

const supabase = require('../config/supabase');
const { clampLanguage } = require('../config/ux-strings');

const TABLE = 'lp_feedback';
const SEGMENTS = 'niete_lp612_segments';

/**
 * Long enough that she has opened the PDF, short enough that she is still on this task.
 * The same 30s the two sibling surveys use — a different number here would make the three
 * response rates incomparable for no reason.
 */
const FEEDBACK_DELAY_MS = 30 * 1000;
const REASON_WINDOW_SECS = 600;
const REDIS_REASON_KEY = (userId) => `lp612_feedback_pending:${userId}`;

/**
 * Anchored, and the segment is the REST of the string rather than one underscore-free token — a
 * real segment id is `grade_9_chemistry.c01.p007-008`, which is full of underscores.
 */
const BUTTON_RX = /^lp612_fb_(yes|no)_(en|ur)_(.+)$/;

/**
 * Q2 — `lp612_used_(taught|planned|not_yet)_<segment_id>` (bd-b708h).
 *
 * Same shape, one difference: no language token. Q2 writes no language-dependent column, and the
 * document language was already banked by the Q1 row this update lands on.
 *
 * `not_yet` contains the separator, so the answer is matched as a closed alternation rather than
 * split on the next `_` — otherwise the column gets 'not' and the segment gets 'yet_grade_9_…'.
 */
const USAGE_RX = /^lp612_used_(taught|planned|not_yet)_(.+)$/;

/** The lane + document-language discriminator written into the existing `lp_variant` column. */
const variantFor = (lang) => `lp612_${clampLanguage(lang)}`;

/**
 * The language she is SPOKEN to in — her stored preference, not the document's language.
 * An Urdu-UI teacher who ordered an English physics plan is still asked in Urdu
 * (language-protocol invariant 4: the two territories are separate). Never throws.
 */
async function _voiceOf(userId, fallback) {
  try {
    const { data } = await supabase
      .from('users').select('preferred_language').eq('id', userId).maybeSingle();
    if (data && data.preferred_language) return clampLanguage(data.preferred_language);
  } catch (_) { /* fall through */ }
  return clampLanguage(fallback);
}


/**
 * Phone → the teacher's row. Both button handlers need exactly these two fields.
 *
 * It is a helper rather than two inline copies because of `tests/setup/column-completeness.test.js`:
 * that guard attributes a column to the nearest LITERAL `.from('…')` within 600 characters, and
 * `.from(TABLE)` is a variable it cannot resolve. An inline `users` read sitting a few lines above
 * the `lp_feedback` UPDATE therefore made the guard report `users.used_in_class` and `users.user_id`
 * as missing columns — a false gap that would have gone into the snapshot as real debt. Living in
 * its own module now puts a file boundary between the two, which is the same protection by a
 * stronger mechanism.
 */
async function _userByPhone(phone) {
  return supabase
    .from('users').select('id, preferred_language').eq('phone_number', phone).maybeSingle();
}

module.exports = {
  TABLE,
  SEGMENTS,
  FEEDBACK_DELAY_MS,
  REASON_WINDOW_SECS,
  REDIS_REASON_KEY,
  BUTTON_RX,
  USAGE_RX,
  variantFor,
  _voiceOf,
  _userByPhone,
};
