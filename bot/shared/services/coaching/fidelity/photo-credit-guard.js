'use strict';
/**
 * Photo credit guard (bd-b3pop, security review F1). The grader is told that a photo only adds credit, but board text is
 * written by the person being graded, so the prompt cannot be the only thing between a line of chalk and a full mark.
 * Code decides what a photo ALONE can earn:
 *   - a full-credit verdict whose evidence cites a photo ([photo N]) and no transcript moment ([MM:SS]) keeps full credit
 *     only when a cited photo carries the move's own content: two of the move's distinctive words, or its only one;
 *   - at most MAX_PHOTO_ONLY_FULL moves per grading earn full credit from photos alone;
 *   - anything else is capped at partial, never lower, so a photo still never costs a teacher credit.
 * Verdicts below full credit, and every verdict that quotes a transcript moment, pass through untouched.
 */
const { FULL_CREDIT } = require('./fidelity-scorer');

const MAX_PHOTO_ONLY_FULL = 3;
const TIMESTAMP = /\[\d{1,3}:\d{2}\]/;
const BRACKETED = /\[([^\]]*)\]/g;
const PHOTO_NUMBER = /photo\s*(\d+)/gi;

// Function words and the words every plan uses for every move. What is left is the move's own content: the words,
// numbers and examples a photo has to show.
const STOP = new Set(`a an the and or but of to in on at for with from into onto by as is are was were be been being it its
this that these those they them their he she his her we our you your i me my then than so if not no do does did will would
can could should may might must shall has have had each every all any some other another there here what which who how when
where while about after before again now first next last also only very more most up down out over under same such own
teacher teachers pupil pupils student students child children learner learners class classroom board whiteboard blackboard
chalkboard write writes writing written wrote read reads reading say says said tell tells ask asks asked answer answers
question questions word words sentence sentences lesson page pages book books textbook textbooks notebook notebooks copy
copies pair pairs group groups activity activities task tasks practice practise exercise exercises work works show shows use
uses using make makes give gives let lets get gets new together aloud whole
کی کے کا کو میں سے پر اور ہے ہیں تھا تھے یہ وہ ایک بھی نے تو ہی کر کریں کرے کرتے لیے لئے جو کہ بچے بچوں استاد اساتذہ
سبق کتاب کاپی بورڈ تختہ لکھیں پڑھیں`.split(/\s+/).filter(Boolean));

function contentWords(text) {
  const out = new Set();
  for (const m of String(text == null ? '' : text).toLowerCase().matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const w = m[0];
    if (STOP.has(w) || /^[a-z]$/.test(w)) continue;
    out.add(w);
  }
  return out;
}

function citedPhotos(evidence) {
  const ns = new Set();
  for (const group of String(evidence || '').matchAll(BRACKETED)) {
    for (const m of group[1].matchAll(PHOTO_NUMBER)) ns.add(Number(m[1]));
  }
  return ns;
}

function photoWords(photo) {
  const p = photo || {};
  const materials = Array.isArray(p.learning_materials) ? p.learning_materials.join(' ') : '';
  return contentWords([p.visible_text, p.drawings, p.student_work, p.students, materials].join('\n'));
}

function carriesMoveContent(move, photos) {
  const want = contentWords(move && move.text);
  if (!want.size) return false;
  const need = Math.min(2, want.size);
  return photos.some((photo) => {
    const have = photoWords(photo);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared += 1;
    return shared >= need;
  });
}

/**
 * @param {Array<{move_id:string, text?:string}>} moves   the prescribed moves
 * @param {Array<object>} verdicts                         the grader's verdicts
 * @param {Array<{n:number}>} photos                       the photo readings the grader saw
 * @returns {{verdicts:Array<object>, guarded:Array<{move_id:string, before:string, reason:'uncorroborated'|'photo_only_cap'}>}}
 */
function guardPhotoCredit(moves, verdicts, photos) {
  if (!Array.isArray(photos) || !photos.length || !Array.isArray(verdicts)) return { verdicts, guarded: [] };
  const moveById = new Map((Array.isArray(moves) ? moves : []).map((m) => [String(m && m.move_id), m]));
  const photoByN = new Map(photos.filter((p) => p && Number.isInteger(p.n)).map((p) => [p.n, p]));
  const guarded = [];
  let photoOnlyFull = 0;
  const out = verdicts.map((v) => {
    if (!v || !FULL_CREDIT.has(v.verdict)) return v;
    const evidence = String(v.evidence || '');
    const cited = citedPhotos(evidence);
    if (!cited.size || TIMESTAMP.test(evidence)) return v;
    const shown = [...cited].map((n) => photoByN.get(n)).filter(Boolean);
    let reason = null;
    if (!carriesMoveContent(moveById.get(String(v.move_id)), shown)) reason = 'uncorroborated';
    else if (photoOnlyFull >= MAX_PHOTO_ONLY_FULL) reason = 'photo_only_cap';
    else photoOnlyFull += 1;
    if (!reason) return v;
    guarded.push({ move_id: v.move_id, before: v.verdict, reason });
    return { ...v, verdict: 'partial' };
  });
  return { verdicts: out, guarded };
}

module.exports = { guardPhotoCredit, MAX_PHOTO_ONLY_FULL };
