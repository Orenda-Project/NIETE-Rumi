'use strict';
/**
 * One eligibility rule for every Jugnu door (the serve's who(), the hub tile, the scorecard card): the form comes from
 * web-quiz-challenge.js formForChild(grade), which reads the grade-1 switches itself. A door that calls formFor(grade)
 * on its own forgets the grade-1 switch, and a grade-1 child then never meets the form, so no module outside the
 * challenge's own files calls formFor( directly.
 */
const fs = require('fs');
const path = require('path');

const QUIZ = path.join(__dirname, '..', '..', '..', 'shared', 'services', 'quiz');

test('no Jugnu door outside the challenge modules calls formFor( directly (they call formForChild)', () => {
  const hits = fs.readdirSync(QUIZ)
    .filter((f) => f.endsWith('.js') && !/^web-quiz-challenge/.test(f))
    .filter((f) => /\bformFor\(/.test(fs.readFileSync(path.join(QUIZ, f), 'utf8')));
  expect(hits).toEqual([]);
});
