'use strict';
/**
 * Standard marks for a regular (non-board) paper (bd-ipoxhx.7, ICT Feedback AG row 21).
 *
 * The model chose every mark itself and, asked for a 100-mark paper, put 5 or 6 marks on an MCQ.
 * Teachers then re-marked the paper by hand. The standard they asked for:
 *   - objective questions: 1 mark each; a matching question 1 mark per pair;
 *   - short / brief answers: 2 to 3 marks;
 *   - long questions and written work (essay, letter…): 5 to 10 marks.
 * bd-ipoxhx.8 (AG row 27, point 5): an objective question that asks for several responses earns
 * one mark for each — every correct option of an MSQ, every blank of a fill-in, every item a
 * "give two…" stem asks for — up to MAX_OBJECTIVE. A single-choice question stays at 1.
 * Other subjective work (mind map, label the diagram…) keeps the model's marks, and so does a long
 * question marked by its parts. A board-pattern paper (`_layout`) carries the board's own marks and
 * is never touched.
 *
 * Pure: mutates the tree it is given and returns how many marks it changed.
 */

const SHORT = /^(short|brief)\b/i;
const LONG = /^long\b|descriptive|\bwriting$|essay/i;

const MAX_OBJECTIVE = 5;
const MSQ = /^msqs?\b|multiple select/i;
const BLANK = /_{2,}/g;
const ASKS_FOR = /\b(?:give|name|write|list|state|mention|tell)\s+(?:any\s+)?(two|three|four|five|[2-5])\b/i;
const WORDS = { two: 2, three: 3, four: 4, five: 5 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));
const markedByParts = (q) => Array.isArray(q.questions) && q.questions.some((s) => Number(s?.marks) > 0);

/** How many correct options an MSQ answer names (a list, or "a) Cow, c) Goat" / "a, c"). */
function _msqAnswers(q) {
  const a = q.answer;
  const parts = Array.isArray(a) ? a : String(a ?? '').split(/\s*(?:[,;&]|\band\b)\s*/i);
  const n = parts.filter((x) => String(x ?? '').trim()).length;
  const cap = Array.isArray(q.options) && q.options.length ? q.options.length : n;
  return Math.min(n, cap);
}

/** The responses an objective question asks for: correct MSQ options, blanks, or "give two…". */
function _responses(type, q) {
  if (MSQ.test(type)) return _msqAnswers(q);
  if (Array.isArray(q.options) && q.options.length) return 1;
  const text = String(q.question ?? '');
  const blanks = (text.match(BLANK) || []).length;
  if (blanks > 1) return blanks;
  const ask = text.match(ASKS_FOR);
  return ask ? (WORDS[ask[1].toLowerCase()] || Number(ask[1])) : 1;
}

/** The standard mark for one question, or undefined to leave it as written. */
function _standard(category, type, q) {
  if (category === 'objective') {
    if (Array.isArray(q.column_a) && q.column_a.length > 0) return q.column_a.length;
    return clamp(_responses(type, q), 1, MAX_OBJECTIVE);
  }
  if (category !== 'subjective' || markedByParts(q)) return undefined;
  if (SHORT.test(type)) return clamp(q.marks, 2, 3);
  if (LONG.test(type)) return clamp(q.marks, 5, 10);
  return undefined;
}

function standardMarks(examJson) {
  if (!examJson || typeof examJson !== 'object' || examJson._layout) return 0;
  let changed = 0;
  const fix = (category, type, list) => list.forEach((q) => {
    if (!q || typeof q !== 'object') return;
    const m = _standard(category, type, q);
    if (m !== undefined && q.marks !== m) { q.marks = m; changed += 1; }
  });
  for (const section of ['seen', 'unseen']) {
    const branch = examJson[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const [cat, types] of Object.entries(branch)) {
      if (!types || typeof types !== 'object') continue;
      const category = String(cat).trim().toLowerCase();
      for (const [type, entry] of Object.entries(types)) {
        if (Array.isArray(entry)) fix(category, type, entry);
        else if (entry && typeof entry === 'object') {
          for (const [sub, list] of Object.entries(entry)) {
            // A nested list ranks by its parent type ("Long Question" › "Describe"), else its own name.
            if (Array.isArray(list)) fix(category, SHORT.test(type) || LONG.test(type) ? type : sub, list);
          }
        }
      }
    }
  }
  return changed;
}

module.exports = { standardMarks };
