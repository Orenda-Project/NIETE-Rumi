/**
 * Free-text class-label parser.
 *
 * Turns the strings production actually holds into a (grade_code, section) pair.
 * Before the classes model existed, class identity WAS a string — typed by a
 * teacher into a free-text field, or by a child into a quiz. NIETE production
 * holds 18 distinct spellings of what are really about three classes:
 *
 *   3 · 3b · 3c · 3-c · 3 C · Class:3 · Grade 3 · 4 · 4A · 4-A · 4 B · 4B
 *   · ⁴ A · 5 · 5th A · class 5-c
 *
 * plus 'Grade One'..'Grade Five' across 62,000 lesson_plan_catalog rows.
 *
 * DESIGN RULE: refuse rather than guess. A digit inside junk text ('Test Class
 * 3A') is incidental, not a grade — the main bot's backfill had to special-case
 * exactly that, and a wrong grade silently picks the wrong reading passage and
 * the wrong lesson plan. Anything this parser does not fully recognise returns
 * null and is left for a human.
 *
 * This module is deliberately PURE — no database, no I/O — so it is cheap to
 * call in a loop over a backfill and trivial to test. Validating a code against
 * the seeded `grade_levels` / `subjects` tables is the vocabulary service's job.
 */

// ---------------------------------------------------------------------------
// Digit folding
// ---------------------------------------------------------------------------

/**
 * Non-ASCII digit forms → ASCII. Production really does contain '⁴ A' (U+2074),
 * and an Urdu-keyboard teacher can just as easily type '۴'. Without this, those
 * rows look like "no digits at all" and get refused for the wrong reason.
 */
const DIGIT_MAP = {
  // Superscripts
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  // Arabic-Indic (U+0660–0669)
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  // Extended Arabic-Indic / Urdu-Persian (U+06F0–06F9)
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

function normalizeDigits(input) {
  if (typeof input !== 'string') return input;
  // Iterate code points, not UTF-16 units — the same reason field caps are
  // measured in code points here.
  return [...input].map((ch) => DIGIT_MAP[ch] || ch).join('');
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Words that carry no information about WHICH class this is. */
const NOISE_TOKENS = new Set([
  'class', 'classes', 'grade', 'section', 'std', 'standard', 'jamaat', 'jamat',
]);

/** Number words, as used by lesson_plan_catalog ('Grade One'..'Grade Five'). */
const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Pre-primary labels, matched against the whole noise-stripped remainder. */
const PRE_PRIMARY = new Set([
  'kg', 'katchi', 'kachi', 'nursery', 'prep', 'ece', 'montessori',
  'early years', 'early year', 'kindergarten', 'k g',
]);

const MIN_GRADE = 1;
const MAX_GRADE = 12;

/** ordinal → the `grade_levels.code` for that ordinal. */
function gradeCodeFor(ordinal) {
  if (ordinal === 0) return 'early_years';
  if (ordinal < MIN_GRADE || ordinal > MAX_GRADE) return null;
  return `grade_${ordinal}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const ORDINAL_SUFFIX_RE = /^(\d{1,2})(?:st|nd|rd|th)$/;   // 5th → 5
const FUSED_RE = /^(\d{1,2})([a-z]{1,2})$/;               // 4a → 4 + A
const BARE_NUMBER_RE = /^\d{1,2}$/;
const SECTION_RE = /^[a-z]{1,2}$/;                        // A, B, 1-2 letters

/**
 * Parse a free-text class label.
 *
 * @param {string} raw
 * @returns {{gradeCode: string, section: string|null}|null} null when the label
 *          cannot be resolved with confidence — the caller must not guess.
 */
function parseClassLabel(raw) {
  if (typeof raw !== 'string') return null;

  const folded = normalizeDigits(raw).toLowerCase();

  // Split on anything that is not a letter or digit, so ':', '-', '–' and
  // runs of whitespace all separate tokens. 'Class:3' and '3-c' both fall out.
  const tokens = folded.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const meaningful = tokens.filter((t) => !NOISE_TOKENS.has(t));
  if (meaningful.length === 0) return null;

  // Pre-primary is matched on the whole remainder, because several of its
  // labels are two words ('early years').
  const joined = meaningful.join(' ');
  if (PRE_PRIMARY.has(joined)) {
    return { gradeCode: 'early_years', section: null };
  }

  let ordinal = null;
  let section = null;

  for (const token of meaningful) {
    // 5th → 5. Must run BEFORE the fused check, or '5th' parses as grade 5
    // section "TH".
    const ord = token.match(ORDINAL_SUFFIX_RE);
    if (ord) {
      if (ordinal !== null) return null;          // two numbers = not a class
      ordinal = Number(ord[1]);
      continue;
    }

    if (BARE_NUMBER_RE.test(token)) {
      if (ordinal !== null) return null;
      ordinal = Number(token);
      continue;
    }

    const fused = token.match(FUSED_RE);
    if (fused) {
      if (ordinal !== null || section !== null) return null;
      ordinal = Number(fused[1]);
      section = fused[2].toUpperCase();
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(WORD_NUMBERS, token)) {
      if (ordinal !== null) return null;
      ordinal = WORD_NUMBERS[token];
      continue;
    }

    // A lone letter or two is a section — but only once we already have a
    // grade, so 'my class' cannot become section "MY".
    if (SECTION_RE.test(token)) {
      if (ordinal === null || section !== null) return null;
      section = token.toUpperCase();
      continue;
    }

    // Anything else means we do not understand this label. Refuse.
    return null;
  }

  // A PARSED number must be a real class grade. Note this deliberately rejects
  // 0: `gradeCodeFor(0)` is legitimately 'early_years' when mapping an ordinal
  // that came out of the grade_levels table, but a teacher who typed a bare "0"
  // has not told us she means KG, and guessing that is exactly what this parser
  // exists not to do.
  if (ordinal === null || ordinal < MIN_GRADE || ordinal > MAX_GRADE) return null;

  const gradeCode = gradeCodeFor(ordinal);
  if (!gradeCode) return null;

  return { gradeCode, section };
}

module.exports = { parseClassLabel, normalizeDigits };
