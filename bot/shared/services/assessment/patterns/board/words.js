'use strict';
/**
 * Grade words and time phrases shared by board/chrome.js and the per-board chrome modules (fde-chrome.js).
 * Its own module so the board chrome files can share them without a require cycle. Pure data.
 */

const GRADE_WORD = Object.freeze({
  6: { en: 'Grade VI', roman: 'VI', ur: 'جماعت ششم' },
  7: { en: 'Grade VII', roman: 'VII', ur: 'جماعت ہفتم' },
  8: { en: 'Class VIII', roman: 'VIII', ur: 'جماعت ہشتم' },
  9: { en: 'Class IX', roman: 'IX', ur: 'جماعت نہم' },
  10: { en: 'Class X', roman: 'X', ur: 'جماعت دہم' },
  11: { en: 'Class XI', roman: 'XI', ur: 'جماعت یازدہم' },
  12: { en: 'Class XII', roman: 'XII', ur: 'جماعت دوازدہم' },
}); // ur: needs fluent-Urdu review

function timeEn(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} hr${h > 1 ? 's' : ''}` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}
function timeUr(min) { // needs fluent-Urdu review
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} ${h > 1 ? 'گھنٹے' : 'گھنٹہ'}` : '', m ? `${m} منٹ` : ''].filter(Boolean).join(' ');
}

const FRACTION = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
/** "½ mark" / "1 mark" / "2 marks" for a legend's MCQ line; undefined or a non-number reads as 1. */
function markEn(m) {
  const n = typeof m === 'number' && m > 0 ? m : 1;
  return `${FRACTION[n] || n} ${n > 1 ? 'marks' : 'mark'}`;
}
const markNum = (m) => (typeof m === 'number' && m > 0 ? FRACTION[m] || String(m) : '1');

module.exports = { GRADE_WORD, timeEn, timeUr, markEn, markNum };
