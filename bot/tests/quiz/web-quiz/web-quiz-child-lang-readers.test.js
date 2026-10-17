'use strict';
/**
 * Every place a child's page or link picks the child's language from their quizzes is a known one: the one order lives
 * in web-quiz-child-lang.js (ladder / childLang), and the only other calls of childLanguage() / classLanguage() are the
 * lines listed here — each the switch-off line beside its ladder call, or the /quiz reply's own (student-quiz.service).
 * A new reader that picks a language on its own fails this test: route it through web-quiz-child-lang.js, or add it
 * here with the reason.
 * Outside these services, student-ingress.js's childLanguage(user) is a different function: the language of the
 * family's own chat (the typed-message replies), not a page's — a known line, not a reader of this order.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../../shared/services/quiz');
const CALL = /\b(childLanguage|classLanguage)\(/;

// file → the number of calling lines it may have, and why
const KNOWN = {
  'web-quiz-child-lang.js': [1, 'the order itself (ladder)'],
  'student-quiz.service.js': [1, 'the /quiz reply: whether its quizzes are library lessons only (the switch read last), beside its ladder line'],
  'web-quiz-hub.js': [2, 'switch off: the teacher pick and the library\'s read of the child, beside their ladder lines'],
  'web-quiz-next-offer-result.js': [1, 'after childLang(): a library lesson\'s language before English'],
  'web-quiz-bind.service.js': [1, 'after childLang(): a library lesson\'s language before the family row\'s'],
};

test('every child-language reader in the quiz services is a known one', () => {
  const found = {};
  fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).forEach((f) => {
    const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')
      .filter((l) => CALL.test(l) && !/^\s*(\*|\/\/)/.test(l) && !/^\s*function (childLanguage|classLanguage)\(/.test(l));
    if (lines.length) found[f] = lines.length;
  });
  expect(found).toEqual(Object.fromEntries(Object.entries(KNOWN).map(([f, [n]]) => [f, n])));
});
