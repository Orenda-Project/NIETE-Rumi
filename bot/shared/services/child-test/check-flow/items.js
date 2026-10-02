'use strict';

/**
 * Child test check Flow (bd-s1oo0.6) — one form's items from the item bank (CONTRACT §2), for the
 * question text, the made-up words, the numbers and the written sums the check shows.
 *
 * Read from, in order: the file named by CHILD_TEST_ITEM_BANK_PATH (tests, the mock lane); L1's
 * accessor item-bank.js; the bank JSON itself. A form the bank does not have is null, and the check
 * then shows item ids instead of their text.
 */

const fs = require('fs');
const path = require('path');

const BANK_JSON = path.join(__dirname, '../../../data/child-test/item-bank.v1.json');
const cache = new Map();

function readJson(file) {
  if (!cache.has(file)) cache.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  return cache.get(file);
}

const fromBank = (bank, grade, form) => {
  const g = bank && bank.grades && bank.grades[String(grade)];
  return (g && g.forms && g.forms[String(form)]) || null;
};

/** @returns {object|null} FORM — { urdu, english, maths } */
function formItems(grade, form) {
  if (process.env.CHILD_TEST_ITEM_BANK_PATH) return fromBank(readJson(process.env.CHILD_TEST_ITEM_BANK_PATH), grade, form);
  try {
    // eslint-disable-next-line global-require
    const bank = require('../item-bank');
    if (bank && typeof bank.getForm === 'function') return bank.getForm(String(grade), String(form)) || null;
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  return fs.existsSync(BANK_JSON) ? fromBank(readJson(BANK_JSON), grade, form) : null;
}

module.exports = { formItems };
