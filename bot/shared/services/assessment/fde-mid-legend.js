'use strict';
/**
 * The legend's chip names on Grade 3-4 papers (bd-5jmnfj.33.4): the early legend names L
 * «نام»/"label", but on these papers L pays for language (Urdu, English) or for order (General
 * Knowledge Q5), so the key says so. Other letters and other subjects are left as they are.
 * Pure data.
 */

const L_NAME = {
  urdu: { ur: 'زبان', en: 'language' },
  english: { ur: 'زبان', en: 'language' },
  general_knowledge: { ur: 'ترتیب', en: 'order' },
};

const BASE_UR = { M: 'طریقہ', A: 'جواب', U: 'اکائی', K: 'اہم نکتہ', L: 'نام' };
const BASE_EN = { M: 'method', A: 'answer', U: 'unit', K: 'key point', L: 'label' };

/** {key_names_ur, key_names_en} to spread over the legend; {} when the subject keeps «نام». */
function midKeyNames(subjectKey) {
  const l = L_NAME[subjectKey];
  if (!l) return {};
  return { key_names_ur: { ...BASE_UR, L: l.ur }, key_names_en: { ...BASE_EN, L: l.en } };
}

module.exports = { midKeyNames };
