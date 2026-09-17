/**
 * bd-60118 — questions whose OPTIONS are pictures, not text.
 *
 * I-SAPS M1 summative item 1.6 ships its four choices as one embedded image: a
 * 2x2 grid of lesson-plan drafts the teacher compares. There is no option text
 * to extract, so the item imported with `options: []` and was unanswerable.
 *
 * WhatsApp interactive options are text rows and will stay that way. So the
 * panels are split out, each stamped with its OPTION NUMBER, uploaded to R2 and
 * sent as their own image messages ahead of the question; the interactive list
 * then carries plain numbered rows matching what the teacher just saw.
 *
 * Why the NUMBER and never the source letter: `correct_option` holds a 1-based
 * index (bd-60116) and the button id is
 * `training_quiz_<attempt>_<optionIndex1based>`. A panel captioned "B" beside a
 * button reading "2" is the same letter/index mismatch that made every I-SAPS
 * answer grade wrong before it was caught in sandbox.
 *
 * Pure: no I/O, no supabase, no WhatsApp client, so the delivery path and the
 * importer cannot drift on what an image-option question is.
 */

/** WhatsApp caps an interactive row title at 24 characters. */
const ROW_TITLE_MAX = 24;

/**
 * Normalise `training_questions.option_images` to a list of URL strings.
 *
 * Accepts the jsonb array, or the same array as a JSON string (some PostgREST
 * client paths hand jsonb back as text). Anything unparseable yields an empty
 * list rather than throwing — a malformed column must degrade to "no images"
 * and let the text path run, never strand a teacher mid-exam.
 *
 * @param {string[]|string|null} raw
 * @returns {string[]}
 */
function parseOptionImages(raw) {
  let v = raw;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      v = JSON.parse(s);
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.filter((u) => typeof u === 'string' && u.trim().length > 0);
}

/**
 * Does this question deliver its options as pictures?
 *
 * @param {{option_images?: string[]|string|null}|null} question
 * @returns {boolean}
 */
function hasImageOptions(question) {
  if (!question) return false;
  return parseOptionImages(question.option_images).length > 0;
}

/**
 * Interactive list rows for an image-option question.
 *
 * One row per panel, numbered to match the stamp burned into each image and the
 * 1-based index the grader compares against.
 *
 * @param {string[]|string|null} images
 * @param {string} attemptId
 * @returns {Array<{id: string, title: string, description: string}>}
 */
function imageOptionRows(images, attemptId) {
  const urls = parseOptionImages(images);
  return urls.map((_, i) => {
    const n = i + 1;
    const title = `Option ${n}`;
    return {
      id: `training_quiz_${attemptId}_${n}`,
      title: [...title].slice(0, ROW_TITLE_MAX).join(''),
      description: `See image ${n} above`,
    };
  });
}

module.exports = {
  ROW_TITLE_MAX,
  parseOptionImages,
  hasImageOptions,
  imageOptionRows,
};
