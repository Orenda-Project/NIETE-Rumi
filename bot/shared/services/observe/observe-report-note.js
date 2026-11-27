'use strict';
/**
 * bd-r2uzg1.23.12 (queue #274, call 28; ICT sheet HITL 49): the coach's note under the report, hers to change on Send.
 *
 * The note (teacher_delivery.companion_text) is made from her talk with the teacher and pre-filled on Send, the same
 * way the form is pre-filled for her to correct. The operator, 27 Nov ~07:4x: "let the coach edit this too. We need
 * telemetry on who edits it and why though." noteEdit decides what a send stores and what it logs. Pure.
 *
 *   stored  companion_text      what goes to the teacher (null: no note)
 *           companion_text_bot  the bot's own text, kept from the first edit on (never overwritten by her later edit)
 *           note_edit           { edited, by, role, at, reason, before_chars, after_chars, added_chars, removed_chars }
 *   logged  counts, who, edited or not, reason. Never the words: they name the teacher, and stay on the row.
 */

const MAX_NOTE = 1000; // code points; the image caption merges it under the report caption within WhatsApp's 1,024
const REASONS = ['context', 'mistake', 'tone', 'other'];

const cps = (s) => [...String(s == null ? '' : s)];
const clean = (s) => cps(String(s == null ? '' : s).trim()).slice(0, MAX_NOTE).join('');

/** How much changed: what is left between the parts that stayed the same at either end. */
function changed(before, after) {
  const b = cps(before);
  const a = cps(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < Math.min(a.length, b.length) - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  return { added: a.length - p - s, removed: b.length - p - s };
}

/**
 * @param {object} td        teacher_delivery as stored
 * @param {string|undefined} note  the note she sent (undefined: none sent, the stored one goes)
 * @param {string|undefined} reason  one of REASONS, else null
 * @param {{by:string, role:string|null, at:string}} who
 * @returns {{patch: object, event: object}}  patch is merged into teacher_delivery; event is logged
 */
function noteEdit(td, note, reason, who) {
  const t = td || {};
  const current = clean(t.companion_text);
  const why = REASONS.includes(reason) ? reason : null;
  const base = {
    editorUserId: who.by, editorRole: who.role || null, channel: 'portal', hadNote: Boolean(current),
  };
  if (typeof note !== 'string' || clean(note) === current) {
    return { patch: {}, event: { ...base, edited: false, reason: null, cleared: false, beforeChars: cps(current).length, afterChars: cps(current).length, addedChars: 0, removedChars: 0 } };
  }
  const after = clean(note);
  const { added, removed } = changed(current, after);
  const bot = Object.prototype.hasOwnProperty.call(t, 'companion_text_bot') ? t.companion_text_bot : (t.companion_text || null);
  const counts = { before_chars: cps(current).length, after_chars: cps(after).length, added_chars: added, removed_chars: removed };
  return {
    patch: {
      companion_text: after || null,
      companion_text_bot: bot,
      note_edit: { edited: true, by: who.by, role: who.role || null, at: who.at, reason: why, ...counts },
    },
    event: {
      ...base, edited: true, reason: why, cleared: !after,
      beforeChars: counts.before_chars, afterChars: counts.after_chars, addedChars: added, removedChars: removed,
    },
  };
}

module.exports = { noteEdit, REASONS, MAX_NOTE };
