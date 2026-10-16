'use strict';
/**
 * The optional neighbours are looked up by the file names their own changes ship under. A wrong name is silent (the
 * module reads as "absent" forever), so the names are pinned here. The walk-through module is `walk-persona`:
 * `bot/.gitignore` ignores `test-*.js`, so a `test-persona.js` would never reach a pull request.
 */
const path = require('path');
const Optional = require('../../shared/services/first-touch/optional-modules');

const FT = path.join(__dirname, '..', '..', 'shared', 'services', 'first-touch');

describe('optional-modules — the neighbours by name', () => {
  afterEach(() => Optional._reset());

  test('the walk-through module is first-touch/walk-persona', () => {
    expect(Optional.PATHS.testPersona).toBe(path.join(FT, 'walk-persona'));
  });

  test('the other neighbours keep their names', () => {
    expect(Optional.PATHS.studentJoin).toBe(path.join(FT, '..', 'quiz', 'web-quiz-student-join'));
    expect(Optional.PATHS.teacherHomeToken).toBe(path.join(FT, 'teacher-home.token'));
    expect(Optional.PATHS.makerToken).toBe(path.join(FT, 'maker.token'));
  });

  test('an absent neighbour answers null; an unknown name answers null; a stand-in wins', () => {
    expect(Optional.load('nope')).toBeNull();
    const mod = { get: () => null };
    Optional._set('testPersona', mod);
    expect(Optional.load('testPersona')).toBe(mod);
  });
});
