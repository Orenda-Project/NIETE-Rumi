'use strict';
/**
 * bd-kijmb8 (queue #318) — what lesson plan is linked to a coaching session, and can a page open it?
 *
 * ONE definition, read by the bot's observation view (the coach's and principal's page) and by the portal's session
 * detail (the teacher's report page), so the two never disagree about whether a "Lesson plan" button shows.
 *
 *   source 'library'  a NIETE plan she picked: `lesson_plan_structured._fidelity_ref` (lesson id + the version she
 *                     downloaded), or a written grade 6-12 lesson's PDF (a key outside lesson_plans/<id>/).
 *   source 'own'      her own file under lesson_plans/<id>/: a PDF, a photo, or a Word file.
 *   source 'none'     nothing linked.
 *
 * `openable` is the button's only condition: something real is there to open. Pure: no database, no storage.
 */

const OWN_PLAN_KEY_RX = /^lesson_plans\/[^/]+\/[^/]+$/;

const IMAGE_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const WORD_EXT = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

const extOf = (s) => { const m = /\.([a-z0-9]+)$/i.exec(String(s || '')); return m ? m[1].toLowerCase() : ''; };

/** 'pdf' | 'image' | 'word' from the row's format, else from the key's extension; a plan with no hint is a PDF. */
function fileKindOf(format, key) {
  const f = String(format || '').toLowerCase() || extOf(key);
  if (IMAGE_EXT[f]) return 'image';
  if (WORD_EXT[f]) return 'word';
  return 'pdf';
}

/** The library lesson this session was taught from, as the linker stored it, or null. */
function libraryRefOf(row) {
  const ref = row && row.lesson_plan_structured && row.lesson_plan_structured._fidelity_ref;
  return ref && typeof ref === 'object' && ref.lesson_id ? ref : null;
}

function planRef(row) {
  const none = { source: 'none', openable: false, fileKind: null, title: null, ref: null, key: null };
  if (!row || typeof row !== 'object') return none;
  const key = String(row.lesson_plan_r2_key || '');
  const structured = row.lesson_plan_structured && typeof row.lesson_plan_structured === 'object' ? row.lesson_plan_structured : {};
  const title = typeof structured.topic === 'string' && structured.topic.trim() ? structured.topic.trim() : null;
  const ref = libraryRefOf(row);
  if (ref) return { source: 'library', openable: true, fileKind: 'pdf', title, ref, key: null };
  if (!key) return none;
  const source = OWN_PLAN_KEY_RX.test(key) ? 'own' : 'library';
  return { source, openable: true, fileKind: fileKindOf(row.lesson_plan_format, key), title, ref: null, key };
}

/** The Content-Type a file of this kind is served with. */
function contentTypeOf(fileKind, key) {
  if (fileKind === 'image') return IMAGE_EXT[extOf(key)] || 'image/jpeg';
  if (fileKind === 'word') return WORD_EXT[extOf(key)] || WORD_EXT.docx;
  return 'application/pdf';
}

module.exports = { planRef, contentTypeOf, fileKindOf, OWN_PLAN_KEY_RX };
