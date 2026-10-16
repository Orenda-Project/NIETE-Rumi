'use strict';
/**
 * THE HOMONYM GUARD on every list of children a device can tap (pure; no I/O).
 *
 * About a third of roster children share a first name with a classmate, and most roster rows carry no
 * father's name, so two chips reading "Zara" are common. This module decides, for ONE rendered list:
 *   canonFirst(name)             the folded first name two chips are compared on
 *   guard(rows, {surface, playedHere})
 *                                rows [{id, first, father_first?, avatar?}] gain `line2` (the father's first name,
 *                                on the teacher's quiz link and "Who is playing?" only, never to a stranger device),
 *                                `avatarLine` (the copy KEY 'jg.who.played_here', when this device played as that
 *                                child), `homonym_in_list` (a collision was found in THIS list, whatever resolved it)
 *                                and `confidence` ('low' only when two chips are still identical after the rules)
 *   confidenceFor({id_src, homonym_in_list, resolved})   the id_src -> id_confidence map
 *   idSrcFromVia(via)            identity v2's logged `via` -> the pick source written on the row
 */

// The Urdu/Arabic letter variants one name is typed with (the same table the analysis fold uses).
const LETTERS = {
  'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ه': 'ہ', 'ة': 'ہ', 'ۀ': 'ہ', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا',
  'ٱ': 'ا', 'ؤ': 'و', 'ئ': 'ی', 'ے': 'ی', 'ھ': 'ہ',
};
const LETTER_RX = new RegExp(`[${Object.keys(LETTERS).join('')}]`, 'g');
const TITLES = new Set(['master', 'mr', 'miss', 'ms', 'baby', 'student']);
// A Muhammad-form first token: the second token is the name the child answers to.
const MUHAMMAD = new Set(['محمد', 'muhammad', 'mohammad', 'md', 'm']);
const PLAYED_HERE = 'jg.who.played_here';

/** Case-folded, diacritics and harakat dropped, Urdu letter variants unified, punctuation and digits dropped. */
function foldTokens(name) {
  if (!name) return [];
  let s = String(name).normalize('NFKD').replace(/\p{M}/gu, '');
  s = s.replace(/[ً-ٰٟۖ-ۭـ]/g, '');
  s = s.replace(LETTER_RX, (c) => LETTERS[c]).toLowerCase();
  s = s.replace(/[^\p{L}\s]|_/gu, ' ');
  return s.split(/\s+/).filter((t) => t && !TITLES.has(t));
}

function canonFirst(name) {
  const toks = foldTokens(name);
  if (!toks.length) return '';
  return MUHAMMAD.has(toks[0]) && toks.length > 1 ? toks[1] : toks[0];
}

const firstWord = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/**
 * One rendered list -> the same rows with line2 / avatarLine / homonym_in_list / confidence.
 * surface: 'q' (teacher quiz link), 'j_stranger' (standing class link on a device new to the class), 'who'.
 */
function guard(rows, { surface = 'who', playedHere = [] } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const played = new Set((playedHere || []).map(String));
  const counts = new Map();
  list.forEach((r) => { const k = canonFirst(r.first); counts.set(k, (counts.get(k) || 0) + 1); });
  const out = list.map((r) => {
    const k = canonFirst(r.first);
    const row = { ...r, homonym_in_list: Boolean(k) && counts.get(k) > 1 };
    if (surface !== 'j_stranger' && r.father_first && String(r.father_first).trim()) row.line2 = firstWord(r.father_first);
    if (surface !== 'j_stranger' && played.has(String(r.id))) row.avatarLine = PLAYED_HERE;
    return row;
  });
  // What the child actually sees on the chip: the first name, line 2, and the avatar line (with that child's avatar).
  const face = (r) => [canonFirst(r.first), canonFirst(r.line2 || ''), r.avatarLine ? `${r.avatarLine}|${r.avatar || r.id}` : ''].join('|');
  const faces = new Map();
  out.forEach((r) => faces.set(face(r), (faces.get(face(r)) || 0) + 1));
  return out.map((r) => ({ ...r, confidence: faces.get(face(r)) > 1 ? 'low' : 'high' }));
}

const HIGH_ALWAYS = new Set(['remembered', 'hub_chip', 'phone_bound', 'teacher_set', 'class_round']);

/** IDENTITY §1: the confidence written at serve time for a pick. `resolved` = the chips were distinct after the guard. */
function confidenceFor({ id_src: src, homonym_in_list: homonym = false, resolved = true } = {}) {
  if (HIGH_ALWAYS.has(src)) return 'high';
  if (src === 'roster_pick') return homonym && !resolved ? 'low' : 'high';
  return 'low';
}

const VIA_SRC = { remembered: 'remembered', hub: 'hub_chip', name: 'roster_pick', full_name: 'roster_pick', father: 'roster_pick', number: 'roster_pick', new: 'forced_new' };

function idSrcFromVia(via) {
  const v = String(via || '');
  if (v === 'preview') return { id_src: null, mode: 'practice' };
  return { id_src: Object.prototype.hasOwnProperty.call(VIA_SRC, v) ? VIA_SRC[v] : null };
}

module.exports = { canonFirst, guard, confidenceFor, idSrcFromVia, PLAYED_HERE };
