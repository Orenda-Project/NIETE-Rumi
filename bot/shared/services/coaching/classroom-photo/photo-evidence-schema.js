'use strict';
/**
 * What a classroom photo reading may carry into a scorer (bd-b3pop.15 / .17, D34): the kinds, the cleaning and the
 * scrub, in one place for the vision pass that writes a reading and the fidelity grader that reads it.
 *
 * Board, chart and notebook writing comes from people in the classroom, so every field is untrusted data:
 *   - a line repeated straight after itself (the vision model's repetition loop) collapses to one;
 *   - a long field is capped on a code-point boundary;
 *   - `<` and `>` become ‹ and ›, so no copied text can open or close the grader's data boundary;
 *   - a run of ten or more digits (a phone or CNIC number copied off a register) becomes [number];
 *   - a reading with no recognised kind, or of something that is not a classroom photo, is dropped: fail closed.
 * looksLikeInstructionText catches writing addressed to a grader or an AI; the vision pass excludes such a photo from
 * both scorers. It is a first filter only: fidelity/photo-credit-guard.js decides what a photo alone can earn.
 */
const KINDS = new Set(['board', 'student_work', 'group_or_pair_work', 'learning_materials', 'wall_display', 'whole_class', 'not_a_classroom_photo']);
const NOT_A_CLASSROOM_PHOTO = 'not_a_classroom_photo';
const MAX_PHOTOS = 3;
const CAPS = { visible_text: 1200, drawings: 400, students: 400, student_work: 400 };
const MATERIALS_MAX = 8;
const MATERIAL_CAP = 80;
const LONG_NUMBER = /\+?\d(?:[ -]?\d){9,}/g;

const INSTRUCTION_PATTERNS = [
  /\b(?:dear|hey|hi|hello|note\s+(?:for|to)|attention|message\s+(?:for|to))\s+(?:the\s+|an?\s+)?(?:ai|a\.i\.|grader|marker|scorer|evaluator|assessor|reviewer|model|llm|chatgpt|gpt|assistant|bot)\b/i,
  /\b(?:ai|a\.i\.|grader|marker|scorer|evaluator|assessor|llm|chatgpt|gpt|assistant)\s*[:,-]\s*(?:please\s+)?(?:mark|grade|score|rate|give|award|credit|ignore)\b/i,
  /\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your|previous|prior|above|earlier)\s+)*(?:instructions?|rules?|prompts?|guidelines?)\b/i,
  /\b(?:mark|grade|score|rate|credit)\s+(?:every|all|each)\s+(?:of\s+the\s+)?(?:moves?|items?|indicators?|steps?|criteria)\b/i,
  /\b(?:give|award)\s+(?:me\s+|this\s+(?:lesson|teacher|class)\s+|the\s+teacher\s+)?(?:full|maximum|max|top|perfect)\s+(?:marks?|scores?|credit|points)\b/i,
  /\b(?:system\s+prompt|prompt\s+injection|as\s+an\s+ai|you\s+are\s+(?:an?\s+)?(?:ai|grader|language\s+model|assistant))\b/i,
];

/** The reading's kind in lower case, or null when it is not one of KINDS. */
function kindOf(value) {
  const k = String(value == null ? '' : value).trim().toLowerCase();
  return KINDS.has(k) ? k : null;
}

function scrubLine(line) {
  return line.replace(/</g, '‹').replace(/>/g, '›').replace(LONG_NUMBER, '[number]');
}

/** Trim and scrub each line, drop blank lines and any line that repeats the one before it. */
function cleanText(value) {
  const lines = String(value == null ? '' : value).replace(/\r/g, '').split('\n').map((l) => scrubLine(l.replace(/\s+/g, ' ').trim()));
  const out = [];
  for (const l of lines) if (l && out[out.length - 1] !== l) out.push(l);
  return out.join('\n');
}

function capText(s, n) {
  if (s.length <= n) return s;
  let cut = s.slice(0, n - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * The per-photo readings a scorer may see: every field present, text cleaned, scrubbed and capped; unknown kinds,
 * not-a-classroom photos and empty readings dropped; at most MAX_PHOTOS. Idempotent.
 * @param {Array<object>} items [{ n, kind, visible_text, drawings, students, learning_materials, student_work }]
 * @returns {Array<object>}
 */
function normalisePhotoEvidence(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (out.length >= MAX_PHOTOS) break;
    if (!it || typeof it !== 'object') continue;
    const kind = kindOf(it.kind);
    if (!kind || kind === NOT_A_CLASSROOM_PHOTO) continue;
    const e = {
      n: Number.isInteger(it.n) ? it.n : null,
      kind,
      visible_text: capText(cleanText(it.visible_text), CAPS.visible_text),
      drawings: capText(cleanText(it.drawings), CAPS.drawings),
      students: capText(cleanText(it.students), CAPS.students),
      learning_materials: (Array.isArray(it.learning_materials) ? it.learning_materials : [])
        .map((m) => capText(cleanText(m).replace(/\n/g, ' '), MATERIAL_CAP))
        .filter(Boolean)
        .slice(0, MATERIALS_MAX),
      student_work: capText(cleanText(it.student_work), CAPS.student_work),
    };
    if (!e.visible_text && !e.drawings && !e.students && !e.learning_materials.length && !e.student_work) continue;
    out.push(e);
  }
  return out;
}

/** True when the text addresses a grader or an AI, or tells one how to mark. */
function looksLikeInstructionText(text) {
  const s = String(text == null ? '' : text);
  return INSTRUCTION_PATTERNS.some((re) => re.test(s));
}

module.exports = { KINDS, NOT_A_CLASSROOM_PHOTO, MAX_PHOTOS, kindOf, cleanText, normalisePhotoEvidence, looksLikeInstructionText };
