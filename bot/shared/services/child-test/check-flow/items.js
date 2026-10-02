'use strict';

/**
 * Child test check Flow — one form's items from the item bank (CONTRACT §2), for the
 * question text, the made-up words, the numbers and the written sums the check shows.
 *
 * Read through the item bank accessor (../item-bank). A grade or form the bank does not have is null,
 * and the check then shows item ids instead of their text.
 */

const itemBank = require('../item-bank');

/** @returns {object|null} FORM — { urdu, english, maths } */
function formItems(grade, form) {
  if (!itemBank.GRADES.includes(String(grade)) || !itemBank.FORMS.includes(String(form || '').toUpperCase())) return null;
  return itemBank.getForm(String(grade), String(form)) || null;
}

module.exports = { formItems };
