/**
 * A child's challenge form (grade 1 included) is decided in one place.
 *
 * formFor(grade, { g1 }) in bot/shared/services/quiz/web-quiz-challenge.js turns a grade into the challenge form, and
 * only it knows when grade 1 has a form (the grade-1 switch). A caller elsewhere that asks formFor on its own — without
 * the switch — answers "no challenge" for a grade-1 child the challenge itself serves, so a door shows on one surface
 * and not on the next. So in production code (bot/ and dashboard/, tests excluded) a `formFor(` call sits only in
 * bot/shared/services/quiz/web-quiz-challenge*.js; any other caller asks the challenge for its answer instead.
 * Comments and strings are not read as calls; the declaration `function formFor(` is not a call.
 *
 * grade-form-one-home.allowlist.json: { "<file>": <calls> } for the callers when this gate landed; it only shrinks
 * (a new file or a higher count fails; a lower count fails until the entry is lowered or removed).
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./grade-form-one-home.allowlist.json');
const { REPO, rel, walk, formForCalls, isFormHome, countRatchet } = require('./test-seam-gates-lib');

const isProduction = (name, full) => name.endsWith('.js')
  && !/\.(test|spec)\.js$/.test(name)
  && !/[\\/](tests?|__tests__|__mocks__|fixtures)[\\/]/.test(path.relative(REPO, full));

function scan() {
  const out = {};
  for (const root of ['bot', 'dashboard']) {
    for (const f of walk(path.join(REPO, root), isProduction)) {
      const id = rel(f);
      if (isFormHome(id)) continue;
      const n = formForCalls(fs.readFileSync(f, 'utf8')).length;
      if (n) out[id] = n;
    }
  }
  return out;
}

describe('the rule, on in-memory sources', () => {
  test('a bare or a member formFor( call is a hit; the declaration, a comment and a string are not', () => {
    const src = [
      'function formFor(grade, { g1 = false } = {}) { return grade; }',
      "// formFor(1) stays null when the switch is off",
      "const note = 'formFor(2)';",
      'const a = formFor(gi.grade);',
      'return Boolean(Challenge.formFor(await Challenge.gradeOf({ studentId })));',
      'const b = myformFor(3);',
    ].join('\n');
    expect(formForCalls(src)).toEqual([4, 5]);
  });

  test('the home is web-quiz-challenge*.js under the quiz services, nowhere else', () => {
    expect(isFormHome('bot/shared/services/quiz/web-quiz-challenge.js')).toBe(true);
    expect(isFormHome('bot/shared/services/quiz/web-quiz-challenge-grade1.js')).toBe(true);
    expect(isFormHome('bot/shared/services/quiz/web-quiz-card.js')).toBe(false);
    expect(isFormHome('dashboard/routes/web-quiz-challenge.js')).toBe(false);
  });
});

describe('the tree', () => {
  test('no new formFor caller outside the challenge; the allowlist matches today exactly', () => {
    expect(countRatchet(scan(), ALLOW, 'formFor( call(s): ask the challenge for the form instead')).toEqual([]);
  });
});
