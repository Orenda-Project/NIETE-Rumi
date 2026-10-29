'use strict';
/**
 * A part's name on the teacher notes (bd-5jmnfj.33.4): its letter where the paper heads it
 * "Section …", its heading otherwise. The Urdu name drops «معروضی»/«موضوعی» when a word of the
 * heading is left; a heading that is only that word (Grade 3-4 section A) keeps it, so the note
 * never reads «کلاس کو بتائیں: ، …». Pure.
 */

const LETTERED = /\bsection\b/i;
const KIND = /\s*(معروضی|موضوعی)\s*/g;

function partName(sec, lang) {
  if (lang === 'ur') {
    if (!sec.label_ur) return sec.id;
    const bare = sec.label_ur.replace(/[()]/g, '');
    return bare.replace(KIND, ' ').trim() || bare.trim() || sec.id;
  }
  const label = String(sec.label_en || '').replace(/[\s:.]+$/, '').trim();
  return !label || LETTERED.test(label) ? sec.id : label;
}

module.exports = { partName };
