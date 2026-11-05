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

module.exports = { GRADE_WORD, timeEn, timeUr };
