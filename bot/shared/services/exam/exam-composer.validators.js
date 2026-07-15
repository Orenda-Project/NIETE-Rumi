/**
 * Post-generation validators for the exam composer.
 *
 * Four failure classes Alishba flagged on 2026-07-15 (Notion 39dd4a97...):
 *
 *   1. Missing images     — a question references an image URL that isn't fetchable
 *   2. Same-source scatter — questions sharing an image / passage aren't grouped
 *   3. MCQ missing options — MCQ-family questions ship with fewer than 4 options
 *   4. Match-columns half-empty — right-column items missing, placeholder,
 *      or duplicated across items
 *
 * `validateQuestion(q)` returns `{ valid, reason }`. Callers (the composer)
 * reject-and-swap invalid rows with a fresh sample from the same bucket pool.
 *
 * `sourceHashOf(q)` returns the grouping key a batch of picks is sorted by
 * BEFORE position assignment — so same-source questions end up contiguous.
 *
 * These are pure functions: no DB, no I/O.
 */

const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────────────────────────

const MCQ_TYPES = new Set(['MCQs', 'MSQs', 'Circle the Correct Answer']);
const MATCH_TYPES = new Set(['Match the Column']);

// Min options for an MCQ-family question. Alishba's rule: A-D — 4.
const MIN_MCQ_OPTIONS = 4;

// Statements that mention an image but ship no media are broken. Keep the
// wordlist small + language-agnostic-ish (English + Urdu figure/image).
const IMAGE_REF_PATTERNS = [
  /\bfigure\b/i,
  /\bpicture\b/i,
  /\bimage\b/i,
  /\bdiagram\b/i,
  /look at the/i,
  /see (the )?(figure|picture|image|diagram|photo)/i,
  /given (below|above) (figure|picture|image)/i,
  /تصویر/,   // Urdu: picture
  /نقشہ/,     // Urdu: diagram/map
  /شکل/,      // Urdu: figure/shape
];

// Placeholder right-column items in Match-the-Column (Fix 4).
const MATCH_PLACEHOLDER_PATTERNS = [
  /^\s*answer\s*\d+\s*$/i,     // "answer 1", "answer 2"
  /^\s*[xX]\s*$/,               // bare "X" / "x"
  /^\s*[a-z]\s*$/i,             // bare single letter
  /^\s*-\s*$/,                  // just a dash
  /^\s*todo\b/i,
  /^\s*tbd\b/i,
  /^\s*placeholder/i,
  /^\s*opposite of\b/i,         // "opposite of X" duplicated pattern
];

// Passage length threshold — if two un-grouped questions share the exact same
// long statement, treat it as the passage they both hang off (Fix 2 fallback).
const PASSAGE_LENGTH_THRESHOLD = 200;

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function statementReferencesImage(statement) {
  if (!isNonEmptyString(statement)) return false;
  return IMAGE_REF_PATTERNS.some(re => re.test(statement));
}

function optionText(o) {
  if (!o || typeof o !== 'object') return '';
  return String(o.statement ?? o.text ?? '').trim();
}

function hashString(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 1 — missing images
// ─────────────────────────────────────────────────────────────────────────────

function validateImages(q) {
  const media = Array.isArray(q.question_media) ? q.question_media : [];

  // Every entry that CLAIMS to be a media ref must carry a fetchable URL.
  for (const m of media) {
    if (!m || typeof m !== 'object') {
      return { valid: false, reason: 'question_media entry is not an object' };
    }
    if (!isNonEmptyString(m.url)) {
      return { valid: false, reason: 'question_media entry is missing a url (image reference is broken)' };
    }
  }

  // Statement references an image but no media is attached.
  if (statementReferencesImage(q.question_statement) && media.length === 0) {
    return {
      valid: false,
      reason: 'question statement references an image but no question_media is attached',
    };
  }

  return { valid: true, reason: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3 — MCQ options
// ─────────────────────────────────────────────────────────────────────────────

function validateMcq(q) {
  if (!MCQ_TYPES.has(q.type)) return { valid: true, reason: '' };

  const opts = Array.isArray(q.answer_options) ? q.answer_options : [];
  if (opts.length < MIN_MCQ_OPTIONS) {
    return {
      valid: false,
      reason: `MCQ has ${opts.length} options (need >= ${MIN_MCQ_OPTIONS})`,
    };
  }
  for (const o of opts) {
    if (!isNonEmptyString(optionText(o))) {
      return { valid: false, reason: 'MCQ has a blank option statement' };
    }
  }
  return { valid: true, reason: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4 — Match the Column
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the "right column" text from a match-the-column answer_options entry.
 * The bank stores match rows heterogeneously — some as {left, right}, some
 * as {statement, is_correct: true} (the "answer" side) mixed with left-side
 * rows. Return whichever field carries the right-side text; empty if none.
 */
function rightColumnOf(o) {
  if (!o || typeof o !== 'object') return '';
  if (isNonEmptyString(o.right)) return o.right.trim();
  // Fallback for the correct-answer variant.
  if (o.is_correct && isNonEmptyString(o.statement)) return o.statement.trim();
  return '';
}

function validateMatchColumns(q) {
  if (!MATCH_TYPES.has(q.type)) return { valid: true, reason: '' };

  const opts = Array.isArray(q.answer_options) ? q.answer_options : [];
  if (opts.length === 0) {
    return { valid: false, reason: 'match-columns has no answer_options' };
  }

  const rights = opts.map(rightColumnOf);

  // Every row needs a right side.
  if (rights.some(r => !r)) {
    return { valid: false, reason: 'match-columns has a row with an empty right column' };
  }

  // No placeholders.
  for (const r of rights) {
    for (const re of MATCH_PLACEHOLDER_PATTERNS) {
      if (re.test(r)) {
        return {
          valid: false,
          reason: `match-columns right column looks like a placeholder ("${r}")`,
        };
      }
    }
  }

  // No duplicates — if the same string appears on both sides of the "="
  // it's the classic "red / red / red" scatter Alishba flagged.
  const norm = rights.map(r => r.toLowerCase());
  const dupe = norm.find((r, i) => norm.indexOf(r) !== i);
  if (dupe) {
    return {
      valid: false,
      reason: `match-columns right column has duplicates ("${dupe}")`,
    };
  }

  return { valid: true, reason: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// public: validateQuestion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run every post-generation gate. First failure wins.
 *
 * @param {object} q — a row from exam_question_bank (bank shape, pre-snapshot).
 * @returns {{ valid: boolean, reason: string }}
 */
function validateQuestion(q) {
  const gates = [validateImages, validateMcq, validateMatchColumns];
  for (const g of gates) {
    const r = g(q);
    if (!r.valid) return r;
  }
  return { valid: true, reason: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2 — source hash for grouping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return a stable grouping key so questions sharing source material sort
 * next to each other in the final paper. Precedence:
 *
 *   1. Explicit group_ref (comprehension passage / match block / choice group)
 *   2. All media URLs concatenated (questions sharing the same image)
 *   3. Long-statement hash (>PASSAGE_LENGTH_THRESHOLD chars) — the drift case
 *      where a passage got inlined into two unmarked bank rows
 *   4. Unique-per-question fallback (id / index_in_chapter / statement hash)
 *
 * @param {object} q — bank row.
 * @returns {string}
 */
function sourceHashOf(q) {
  if (isNonEmptyString(q.group_ref)) {
    return `group:${q.group_ref}`;
  }
  const media = Array.isArray(q.question_media) ? q.question_media : [];
  const urls = media.map(m => (m && m.url) || '').filter(Boolean);
  if (urls.length > 0) {
    return `media:${hashString(urls.slice().sort().join('|'))}`;
  }
  const stmt = String(q.question_statement || '');
  if (stmt.length >= PASSAGE_LENGTH_THRESHOLD) {
    return `passage:${hashString(stmt)}`;
  }
  // No shared source — key on identity so nothing accidentally groups.
  if (isNonEmptyString(q.id)) return `solo:id:${q.id}`;
  const anchor = `${q.chapter_index || ''}:${q.index_in_chapter || ''}`;
  if (anchor !== ':') return `solo:pos:${anchor}:${hashString(stmt)}`;
  return `solo:stmt:${hashString(stmt)}`;
}

module.exports = {
  validateQuestion,
  sourceHashOf,
  // exported for tests / future callers
  MCQ_TYPES,
  MATCH_TYPES,
  MIN_MCQ_OPTIONS,
};
