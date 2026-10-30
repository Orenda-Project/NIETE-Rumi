'use strict';
/**
 * v27 G5 Maths Q2 i printed «Write the number 6,408,schedule in words.» with the answer «placeholder» and
 * a marking point «placeholder» (bd-5jmnfj.4.58.3): a splice the model left in, which no later check read.
 * Every string of a question the child or teacher reads — stem, sub-questions, options, answer, marking
 * points, accept lines — is read for a placeholder word, or a word glued into a number's thousands groups.
 * The picture description is the artist's brief, not print, and is skipped (as fde-banned-words does).
 *
 * Pure: exam JSON in, shortfall rows out in the shape fde-banned-words uses, so the re-ask and the
 * fail-closed throw in the service read them like any other shortfall.
 */

const WORDS = [/placeholder/i, /\bTODO\b/, /\(tbd\)/i, /lorem ipsum/i];
// «6,408,schedule», «ninety,345»: a digit group and a word of four or more letters joined by a comma.
// «1,250» has no letters; «2024,the» is a missing space after a comma, not a splice (three letters).
const SPLICE = /\S*(?:\d,[A-Za-z]{4,}|[A-Za-z]{4,},\d)\S*/g;

function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k !== 'picture' && k !== 'checked') strings(x, out);
    }
  }
  return out;
}

function hitsIn(text) {
  const hits = [];
  WORDS.forEach((re) => { const m = re.exec(text); if (m) hits.push(m[0]); });
  (text.match(SPLICE) || []).forEach((m) => hits.push(m.replace(/[.,;:]+$/, '')));
  return hits;
}

/** `[{slot, reason:'placeholder', items:['<question> → <what was found>']}]`, one row a slot; [] when clean. */
function placeholderShortfall(examJson) {
  if (!examJson || typeof examJson !== 'object') return [];
  const bySlot = new Map();
  for (const branch of ['seen', 'unseen']) {
    const cats = examJson[branch];
    if (!cats || typeof cats !== 'object') continue;
    for (const types of Object.values(cats)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        for (const q of list) {
          if (!q || typeof q !== 'object' || q.removed === true) continue;
          const hits = [...new Set(strings(q, []).flatMap(hitsIn))];
          if (!hits.length) continue;
          const row = bySlot.get(q.slot) || { slot: q.slot, reason: 'placeholder', items: [] };
          row.items.push(`${String(q.question || '').trim()} → ${hits.join(', ')}`);
          bySlot.set(q.slot, row);
        }
      }
    }
  }
  return [...bySlot.values()];
}

/** The re-ask's note naming the placeholder text found; null when the shortfall holds none. */
function placeholderNote(shortfall) {
  const rows = (Array.isArray(shortfall) ? shortfall : []).filter((r) => r && r.reason === 'placeholder');
  const items = rows.flatMap((r) => r.items || []);
  if (!items.length) return null;
  return `These items carry placeholder text the model left in: ${items.join('; ')}. `
    + 'Write every question, answer and marking point out in full, with its real numbers and words: '
    + 'no placeholder word, no "TODO" or "tbd", and never a word spliced into a number.';
}

module.exports = { placeholderShortfall, placeholderNote };
