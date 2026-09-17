/**
 * bd-60113 — pure parsing rules for the I-SAPS Level 1 content import.
 *
 * The source workbooks are partner-authored, one per module, and the columns
 * are consistent in shape but not in spelling. Keeping the parsing PURE (no
 * file I/O, no supabase) means the importer's decisions are testable against
 * the real strings without a database or a spreadsheet library.
 *
 * Shape of a formative sheet:
 *   Q No. | Place After Unit | Type (MCQ/CRQ) | Item Details | Max Score | Key
 *
 * `Place After Unit` is the one that matters and the one that varies — see
 * parseUnitRef.
 */

/**
 * Resolve the "Place After Unit" cell to a unit code (e.g. 101, 705, 903).
 *
 * The workbooks spell this four ways:
 *   "101"                   bare unit code            (M1/M2/M4/M6/M8)
 *   "501 (unit 2 - 08:49)"  code + timestamp note     (M5)
 *   "901 - scene 3 (17:42)" code + scene + timestamp  (M9)
 *   "3"                     ordinal within the module (M7, some M9 rows)
 *
 * A leading three-digit number is taken as the unit code as written — even if
 * it belongs to another module, because a deliberate cross-reference is more
 * likely than a typo and silently rewriting it would hide the link.
 *
 * A bare 1–2 digit number is an ordinal and is resolved as
 * `module * 100 + ordinal`, which is the only reading that can turn M7's "3"
 * into unit 703.
 *
 * @param {string|number|null} cell  raw cell value
 * @param {number} moduleNo          1..9, the module the sheet belongs to
 * @returns {number|null} unit code, or null when nothing parseable is present
 */
function parseUnitRef(cell, moduleNo) {
  if (cell === null || cell === undefined) return null;
  const s = String(cell).trim();
  if (!s) return null;

  // A three-digit code anywhere at the start wins, with any trailing note.
  const three = s.match(/^(\d{3})\b/);
  if (three) return Number(three[1]);

  // Otherwise a bare 1-2 digit ordinal, optionally with trailing punctuation.
  const ord = s.match(/^(\d{1,2})\s*\.?\s*$/);
  if (ord) {
    const n = Number(ord[1]);
    if (n <= 0) return null;
    const mod = Number(moduleNo);
    if (!Number.isFinite(mod) || mod <= 0) return null;
    return mod * 100 + n;
  }

  // Anything else ("n/a", "see module 2") is not a unit reference.
  return null;
}

/**
 * Normalise the Type column to 'MCQ' | 'CRQ' | null.
 *
 * @param {string|null} cell
 * @returns {'MCQ'|'CRQ'|null}
 */
function parseItemType(cell) {
  if (!cell) return null;
  const s = String(cell).toUpperCase();
  if (s.includes('MCQ')) return 'MCQ';
  if (s.includes('CRQ')) return 'CRQ';
  return null;
}

/**
 * Normalise the answer Key column to a single option letter.
 *
 * Sheets carry "C", "c", "C.", "Option C". Anything that is not a single
 * A-D letter returns null so the importer can flag it rather than guess — a
 * wrong key silently marks correct answers wrong for every teacher.
 *
 * @param {string|null} cell
 * @returns {string|null} 'A'..'D'
 */
function parseAnswerKey(cell) {
  if (!cell) return null;
  const m = String(cell).toUpperCase().match(/\b([A-D])\b/);
  return m ? m[1] : null;
}

/**
 * bd-60116 — convert a workbook answer key to the CANONICAL 1-BASED OPTION
 * INDEX that `training_questions.correct_option` actually holds.
 *
 * The workbooks write the key as a letter ("C"). The platform stores an index
 * ("3") — quiz-delivery.service:44-47 defines the button id as
 * `training_quiz_<attempt>_<optionIndex1based>` and calls that index "the one
 * `correct_option` is written in and the one 400k+ historical answer rows
 * hold". The first I-SAPS import wrote the letters through unchanged, so a
 * letter was compared against an index and EVERY answer graded wrong — all
 * four options rejected on Unit 101.
 *
 * Idempotent: an already-numeric key passes through, so re-running the import
 * over repaired rows cannot double-convert.
 *
 * @param {string|number|null} key e.g. 'C', 'c', ' C. ', 'Option C', 'A,C', '3'
 * @returns {string|null} '3', or '1,3' for a multi-select set; null if unusable
 */
function answerKeyToIndex(key) {
  if (key === null || key === undefined) return null;
  const parts = String(key).split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const out = [];
  for (const part of parts) {
    const digits = part.match(/^\d+$/);
    if (digits) {
      const n = Number(digits[0]);
      if (n <= 0) return null; // 0 is not a valid 1-based index
      out.push(String(n));
      continue;
    }
    const letter = part.toUpperCase().match(/\b([A-Z])\b/);
    if (!letter) return null;
    out.push(String(letter[1].charCodeAt(0) - 64)); // 'A' -> 1
  }
  return out.join(',');
}

module.exports = { parseUnitRef, parseItemType, parseAnswerKey, answerKeyToIndex };
