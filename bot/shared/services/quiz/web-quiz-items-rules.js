'use strict';
/**
 * The prompt rules the web item call shares with the author, read from the one
 * contract module so they cannot drift. The two Urdu rules are not exported by
 * the contract on their own, so they are cut from questionContract()'s text by
 * their opening words; if that text ever moves, the rule is simply absent here
 * (the gates in web-quiz-items.js still run in code).
 */
const { languageRule, MATH_NOTATION_RULE, questionContract } = require('./transcript-quiz-contract');

function cut(text, opening) {
  const i = text.indexOf(opening);
  if (i < 0) return '';
  const end = text.indexOf('\n', i);
  return text.slice(i, end < 0 ? undefined : end);
}

const CONTRACT = questionContract({});
const ADJACENT_TERMS_RULE_TEXT = cut(CONTRACT, 'NEVER TWO ENGLISH TERMS SIDE BY SIDE');
const CHILD_ADDRESS_RULE_TEXT = cut(CONTRACT, 'THE CHILD HAS NO GENDER');

module.exports = { languageRule, MATH_NOTATION_RULE, ADJACENT_TERMS_RULE_TEXT, CHILD_ADDRESS_RULE_TEXT };
