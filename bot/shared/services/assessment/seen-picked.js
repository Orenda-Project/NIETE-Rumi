'use strict';
/**
 * AG row 21 (Amena 21 Nov) — the book questions the teacher ticked herself, from her chapters' own exercises.
 *
 * A request may carry `seenPicked: [{ chapter, ref, text, type }]`. They become the per-type Seen counts the
 * paper already understands (seenTypes, bd-e5n2jf), so counting, trimming and the 50-question rule are
 * unchanged; the prompt then names the exact questions, to be copied word for word. A request without
 * seenPicked never reaches this file.
 */

/** app_settings switch for Select from the book (portal list + seenPicked on create). Off until switched on. */
const BOOK_PICKER_KEY = 'assessment_book_picker_enabled';
/** Read through the shared flag reader (fails closed: an unreadable setting is off). */
const isPickerOn = () => require('../../config/feature-flags').isFlagEnabled(BOOK_PICKER_KEY).catch(() => false);

const MAX_PICKS = 100; // the printed-item ceiling (QuestionTypes.MAX_ITEMS)
const MAX_TEXT = 1200;
const MAX_REF = 80;

/**
 * Her ticks, checked. `allowed` = the subject's type ids, `chapters` = the chapters on her paper.
 * Returns { picks } (null when she ticked none) or { error } in words she can act on.
 */
function clean(list, { allowed, chapters }) {
  if (!Array.isArray(list) || list.length === 0) return { picks: null };
  if (list.length > MAX_PICKS) return { error: `Pick up to ${MAX_PICKS} questions from the book.` };
  const out = [];
  const seen = new Set();
  for (const p of list) {
    const text = typeof p?.text === 'string' ? p.text.trim() : '';
    const ref = typeof p?.ref === 'string' ? p.ref.trim().slice(0, MAX_REF) : '';
    const type = typeof p?.type === 'string' ? p.type.trim() : '';
    const chapter = Number(p?.chapter);
    if (!text) return { error: 'A picked question has no words.' };
    if (text.length > MAX_TEXT) return { error: 'A picked question is too long.' };
    if (!allowed.includes(type)) return { error: `${type || 'That type'} is not a question type for this subject.` };
    if (!Number.isInteger(chapter) || !chapters.includes(chapter)) {
      return { error: 'A picked question is from a chapter not on this paper.' };
    }
    const key = `${chapter}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chapter, ref, text, type });
  }
  return { picks: out };
}

/** Her picks as Seen counts per type, in the order each type first appears. */
function toTypes(picks, categoryOf) {
  const byId = new Map();
  for (const p of picks) {
    if (!byId.has(p.type)) byId.set(p.type, { id: p.type, count: 0, category: categoryOf(p.type) === 'objective' ? 'objective' : 'subjective' });
    byId.get(p.type).count += 1;
  }
  return [...byId.values()];
}

/** The Seen lines of the prompt: the exact questions, grouped by type, and the rule. */
function promptItems(picks) {
  const groups = new Map();
  for (const p of picks) {
    if (!groups.has(p.type)) groups.set(p.type, []);
    groups.get(p.type).push(p.text.replace(/\s+/g, ' '));
  }
  const lines = [...groups.entries()].map(([type, texts]) => `Seen ${type} — ${texts.length}:\n${texts.map((t) => `    - ${t}`).join('\n')}`);
  return [
    ...lines,
    `Seen questions are exactly these ${picks.length} from the book, which the teacher picked. Copy each one word for word `
    + '(an MCQ keeps the options printed with it), each under the type it is listed under; add its marks and its answer. '
    + 'Write no other Seen question',
  ];
}

module.exports = { clean, toTypes, promptItems, isPickerOn, BOOK_PICKER_KEY, MAX_PICKS, MAX_TEXT };
