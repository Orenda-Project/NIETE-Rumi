'use strict';
/**
 * Pick-words key text (bd-5jmnfj.4.58.9.3). A comprehension «pick» part prints the model words plus
 * the open rule («یا پیراگراف کا کوئی اور اسم معرفہ»): any correct word of that kind from the passage
 * earns the mark. The item's common error prints under the rows so the marker sees the wrong
 * classification to refuse (v37f G5 Urdu: اسکول as اسم معرفہ). A closed accept list was tried in
 * loop 6c and refused most correct nouns and verbs (panel verify4), so it is not printed.
 * Pure: strings in, string out.
 */

function pickKeyText(kind, words, scheme, lang) {
  const list = (words || []).join(lang === 'ur' ? '، ' : ', ');
  const tail = lang === 'ur' ? `، یا پیراگراف کا کوئی اور ${kind}` : `, or any other ${kind.toLowerCase().replace(/s$/, '')} in the passage`; // ur: needs fluent-Urdu review
  return list + tail;
}

/** The item's common error for the row under the pick rows, or '' for none. */
function pickKeyError(scheme) {
  return scheme && typeof scheme.common_error === 'string' ? scheme.common_error.trim() : '';
}

module.exports = { pickKeyText, pickKeyError };
