/**
 * Bot-side reader for the shared, fail-closed feature flags in `app_settings`.
 *
 * Mirrors dashboard/lib/feature-flags.js. The two are deliberately separate
 * files rather than a cross-tree require: the dashboard's guarded imports of
 * bot code are allowed to fail in some environments, and a gate that can
 * silently vanish is not a gate. They read the SAME key with the SAME rules;
 * tests/portal/assessment-generator-flag.test.js pins the contract.
 *
 * FAIL CLOSED — absent row, malformed value, or failed lookup all mean OFF.
 */
const supabase = require('./supabase');
const { logToFile } = require('../utils/logger');

const ASSESSMENT_GENERATOR_KEY = 'assessment_generator_enabled';

/**
 * Editing INDIVIDUAL QUESTIONS is a second, narrower switch.
 *
 * Ticking questions off a paper is the safe half — it only ever removes what the
 * model wrote, and it cannot corrupt the stored tree. Editing rewrites exam_json
 * in place, so it ships behind its own flag and can be turned off without taking
 * the whole review layer down with it. Both are fail-closed, so a deployment
 * that has never heard of this key gets ticking only.
 */
const ASSESSMENT_EDITING_KEY = 'assessment_editing_enabled';

/**
 * Word output is BUILT but not good enough to offer.
 *
 * The .docx is a genuine Word file — the bytes are a zip, `file(1)` calls it
 * "Microsoft Word 2007+", and the renderer/extension contract holds. What it is
 * not yet is a good PAPER: the marking header stacks as separate lines instead
 * of a table, there are no borders, and the layout is flat. A teacher who picks
 * Word to edit her paper would get something worse than the PDF she can already
 * print, so it stays dark until the layout is worth having.
 */
const ASSESSMENT_DOCX_KEY = 'assessment_docx_enabled';

/**
 * Versioned editing (the Edit button on the paper, the ✓/✗ list, every "Make
 * my paper" a new version). TRANSITIONAL: it decides which entry screen INIT
 * returns, so it has to flip together with the review Flow publish, and it is
 * deleted once the old KEEP/PICK path is. Seeded false by migration V1.5.6.
 * `assessment_editing_enabled` stays the kill switch above it.
 */
const ASSESSMENT_VERSIONS_KEY = 'assessment_versions_enabled';

/**
 * The quiz author's source gates (every question quotes the moment that carries
 * its answer; grade 1-2 stems at most 8 words; a teaching error recorded). Off
 * by default: with it off, quiz authoring is exactly what it was. One key and
 * one reader for every lane that adds a gate behind it.
 */
const QUIZ_AUTHOR_GATES_V2_KEY = 'quiz_author_gates_v2';

/**
 * Board-pattern papers (a grade's exam laid out the way the board sets it: fixed
 * sections, fixed marks, a marking scheme). Off by default. Read in exactly two
 * places — /assessment/options (offer it) and /assessment/create (accept it) —
 * never by the worker: a job already queued with a pattern finishes as one.
 */
const ASSESSMENT_FDE_PATTERN_KEY = 'assessment_fde_pattern_enabled';

/**
 * Which subjects the pattern may be offered for, as a JSON array of subject keys
 * (e.g. ["maths","science"]). A narrower switch under the flag above, so one
 * subject can be held back without turning the others off. Absent or unreadable
 * means EVERY subject the pattern holds: the flag is the kill switch, this only
 * narrows, and a typo here must not silently take the whole feature down.
 */
const ASSESSMENT_FDE_PATTERN_SUBJECTS_KEY = 'assessment_fde_pattern_subjects';

async function isFlagEnabled(key) {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return false;
    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { /* keep the raw string */ }
    }
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  } catch (err) {
    logToFile('⚠️ Feature-flag lookup failed — treating as off', { key, error: err?.message });
    return false;
  }
}

const isAssessmentGeneratorEnabled = () => isFlagEnabled(ASSESSMENT_GENERATOR_KEY);
const isAssessmentEditingEnabled = () => isFlagEnabled(ASSESSMENT_EDITING_KEY);
const isAssessmentDocxEnabled = () => isFlagEnabled(ASSESSMENT_DOCX_KEY);
const isAssessmentVersionsEnabled = () => isFlagEnabled(ASSESSMENT_VERSIONS_KEY);
const isAssessmentFdePatternEnabled = () => isFlagEnabled(ASSESSMENT_FDE_PATTERN_KEY);

/**
 * The subject keys the pattern may be offered for, lower-cased, or null for "all".
 * Null on an absent row, a value that is not an array of strings, or a failed
 * read — see ASSESSMENT_FDE_PATTERN_SUBJECTS_KEY for why that direction. An
 * empty array is a real answer: no subject.
 */
async function fdePatternSubjects() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', ASSESSMENT_FDE_PATTERN_SUBJECTS_KEY)
      .maybeSingle();
    if (error || !data) return null;
    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { return null; }
    }
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return null;
    return value.map((v) => v.trim().toLowerCase()).filter(Boolean);
  } catch (err) {
    logToFile('Feature-flag lookup failed — treating as every subject', { key: ASSESSMENT_FDE_PATTERN_SUBJECTS_KEY, error: err?.message });
    return null;
  }
}
/**
 * Same rules as isFlagEnabled, and the row must BE this key: a reader that took
 * whatever row came back would turn the author's gates on from another flag.
 */
async function isQuizAuthorGatesV2() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .eq('key', QUIZ_AUTHOR_GATES_V2_KEY)
      .maybeSingle();
    if (error || !data || data.key !== QUIZ_AUTHOR_GATES_V2_KEY) return false;
    let value = data.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) { /* keep the raw string */ }
    }
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  } catch (err) {
    logToFile('⚠️ Feature-flag lookup failed — treating as off', { key: QUIZ_AUTHOR_GATES_V2_KEY, error: err?.message });
    return false;
  }
}

module.exports = {
  ASSESSMENT_GENERATOR_KEY, ASSESSMENT_EDITING_KEY, ASSESSMENT_DOCX_KEY, ASSESSMENT_VERSIONS_KEY,
  isFlagEnabled, isAssessmentGeneratorEnabled, isAssessmentEditingEnabled,
  isAssessmentDocxEnabled, isAssessmentVersionsEnabled,
  QUIZ_AUTHOR_GATES_V2_KEY, isQuizAuthorGatesV2,
  ASSESSMENT_FDE_PATTERN_KEY, isAssessmentFdePatternEnabled,
  ASSESSMENT_FDE_PATTERN_SUBJECTS_KEY, fdePatternSubjects,
};
