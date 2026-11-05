/**
 * The grade gate (contract 1, SPEC §1): which grades and grade x subject cells a user is offered.
 * Grades 1-5 are never touched; 6-12 open only behind assessment_grades_6_12 and both failure
 * modes hide (an unreadable flag is OFF, an unreadable kill row that exists kills all of 6-12).
 */
const G = require('../../bot/shared/services/assessment/grade-gate');

const U = 'u-1';
const V = 'u-2';

describe('grade gate: the contract §2 truth table', () => {
  const NONE = undefined;
  // flag, kill, killCells, user -> gradeAllowed(4), (9), (11), cellAllowed(11 chemistry), (11 physics)
  test.each([
    ['absent', NONE, NONE, NONE, U, [true, false, false, false, false]],
    ['false', false, NONE, NONE, U, [true, false, false, false, false]],
    ['true', true, NONE, NONE, U, [true, true, true, true, true]],
    ['true, no user', true, NONE, NONE, null, [true, false, false, false, false]],
    ['pilot list, on it', [U], NONE, NONE, U, [true, true, true, true, true]],
    ['pilot list, off it', [U], NONE, NONE, V, [true, false, false, false, false]],
    ['numeric list', [1], NONE, NONE, U, [true, false, false, false, false]],
    ['"teachers"', 'teachers', NONE, NONE, U, [true, false, false, false, false]],
    ['kill [11]', true, [11], NONE, U, [true, true, false, false, false]],
    ['kill wrong type "11"', true, '11', NONE, U, [true, false, false, false, false]],
    ['kill ["11"] coerced', true, ['11'], NONE, U, [true, true, false, false, false]],
    ['kill cell 11:chemistry', true, NONE, ['11:chemistry'], U, [true, true, true, false, true]],
    ['kill [4] ignored', true, [4], NONE, U, [true, true, true, true, true]],
    ['kill malformed "[11"', true, '[11', [], U, [true, false, false, false, false]],
  ])('%s', (_name, flag, kill, cells, user, want) => {
    expect([
      G.gradeAllowed(4, flag, kill, user),
      G.gradeAllowed(9, flag, kill, user),
      G.gradeAllowed(11, flag, kill, user),
      G.cellAllowed(11, 'chemistry', flag, kill, cells, user),
      G.cellAllowed(11, 'physics', flag, kill, cells, user),
    ]).toEqual(want);
  });
});

describe('grade gate: reading the flag (§1)', () => {
  test.each([
    [true, U, true], ['true', U, true], [' TRUE ', U, true], ['"true"', U, true],
    [false, U, false], ['false', U, false], [1, U, false], [{}, U, false], ['yes', U, false],
    ['teachers', U, false], [null, U, false], [undefined, U, false], ['[11', U, false],
    [[], U, false], [[U], U, true], ['["u-1"]', U, true], [[U], V, false], [[' u-1'], U, false],
    [['U-1'], U, false], [[1], '1', false], ['u-1', U, false], [[V, U], U, true],
    [true, null, false], [true, '', false], [true, 7, false], [[U], undefined, false],
  ])('flag %j, user %j -> %s', (flag, user, want) => {
    expect(G.isSixTwelveAdmitted(flag, user)).toBe(want);
  });
});

describe('grade gate: kill lists (§1)', () => {
  test.each([
    [[11], [9, 10, 12]], [['11'], [9, 10, 12]], ['[11]', [9, 10, 12]], [[], [9, 10, 11, 12]],
    [[5, 13, 6.5, NaN, null, 'x', ' 11', '11.0'], [9, 10, 11, 12]], [null, [9, 10, 11, 12]],
    [undefined, [9, 10, 11, 12]], [[9, 12], [10, 11]], [[[11], { 11: 1 }, true], [9, 10, 11, 12]],
    ['11', []], [11, []], [{}, []], ['[11', []], [true, []],
  ])('kill %j leaves %j', (kill, want) => {
    expect([9, 10, 11, 12].filter((g) => G.gradeAllowed(g, true, kill, U))).toEqual(want);
  });

  test.each([
    [['9:chemistry'], 'chemistry', false], [['9:chemistry'], 'physics', true],
    ['["9:chemistry"]', 'chemistry', false], [['9:Chemistry'], 'chemistry', true],
    [['13:chemistry', '9-chemistry', 9, null, '9:chemistry1', ' 9:chemistry', '9:chemistry '], 'chemistry', true],
    [['x9:chemistry', '19:chemistry', '9:'], 'chemistry', true], [[], 'chemistry', true],
    [['6:chemistry', '12:physics_ur'], 'chemistry', true],
    [null, 'chemistry', true], ['9:chemistry', 'chemistry', false], [{}, 'physics', false], ['[9', 'physics', false],
  ])('kill cells %j, 9 %s -> %s', (cells, subject, want) => {
    expect(G.cellAllowed(9, subject, true, undefined, cells, U)).toBe(want);
  });

  test('every grade 6-12 and an underscored code can be cell-killed', () => {
    for (let g = 6; g <= 12; g += 1) {
      expect(G.cellAllowed(g, 'physics_ur', true, [], [`${g}:physics_ur`], U)).toBe(false);
      expect(G.cellAllowed(g, 'physics', true, [], [`${g}:physics_ur`], U)).toBe(true);
    }
  });

  test('the kill reaches both band ends', () => {
    expect([6, 7, 12].filter((g) => G.gradeAllowed(g, true, [6, 12], U))).toEqual([7]);
  });

  test('a kill-cells entry must be a whole lower-case code', () => {
    expect(G.cellAllowed(9, 'chemistryX', true, [], ['9:chemistryX'], U)).toBe(true);
    expect(G.cellAllowed(9, 'Chemistry', true, [], ['9:Chemistry'], U)).toBe(true);
    expect(G.cellAllowed(6, 'physics', true, [], ['6:physics'], U)).toBe(false);
  });

  test('a cell kill hides the cell, never the grade', () => {
    expect(G.gradeAllowed(9, true, undefined, U)).toBe(true);
    expect(G.offeredGrades([9], true, undefined, ['9:chemistry'], U)).toEqual([9]);
  });
});

describe('grade gate: grades 1-5 and out-of-range grades', () => {
  test.each([1, 2, 3, 4, 5, '3', 0, -1])('grade %j is open whatever the flag', (g) => {
    expect(G.gradeAllowed(g, undefined, 'junk', null)).toBe(true);
    expect(G.cellAllowed(g, 'maths', undefined, 'junk', 'junk', null)).toBe(true);
    expect(G.cellAllowed(g, undefined, false, [g], [`${g}:maths`], null)).toBe(true);
  });
  test.each([13, 6.5, 5.5, NaN, null, undefined, 'x', '', {}, Infinity, ' ', '\t'])('grade %j is never allowed', (g) => {
    expect(G.gradeAllowed(g, true, [], U)).toBe(false);
    expect(G.cellAllowed(g, 'maths', true, [], [], U)).toBe(false);
  });
  test('a string grade 6-12 is read as its number', () => {
    expect(G.cellAllowed('11', 'chemistry', true, [], ['11:chemistry'], U)).toBe(false);
    expect(G.cellAllowed('11', 'physics', true, [], ['11:chemistry'], U)).toBe(true);
    expect(G.gradeAllowed('11', true, [11], U)).toBe(false);
    expect(G.gradeAllowed('9', true, [11], U)).toBe(true);
  });
  test.each([undefined, '', null, 9])('cell with subject %j at grade 9 is refused', (s) => {
    expect(G.cellAllowed(9, s, true, [], [], U)).toBe(false);
  });
  test('cellAllowed needs the grade itself to be allowed', () => {
    expect(G.cellAllowed(9, 'physics', true, [9], [], U)).toBe(false);
    expect(G.cellAllowed(9, 'physics', [V], [], [], U)).toBe(false);
  });
  test('grade 6 and 12 are the band ends', () => {
    expect(G.gradeAllowed(6, false, [], U)).toBe(false);
    expect(G.gradeAllowed(12, false, [], U)).toBe(false);
    expect(G.gradeAllowed(6, true, [], U)).toBe(true);
    expect(G.gradeAllowed(12, true, [], U)).toBe(true);
  });
});

describe('grade gate: offeredGrades (§2 rule 4, §7)', () => {
  test('flag on sorts 6-12 numerically after 1-5', () => {
    expect(G.offeredGrades([10, 2, 9], true, undefined, undefined, U)).toEqual([2, 9, 10]);
    expect(G.offeredGrades([12, 6, 11, 7], true, undefined, undefined, U)).toEqual([6, 7, 11, 12]);
  });
  test('1-5 keep their input order, flag off or on', () => {
    expect(G.offeredGrades([3, 1, 2], undefined, undefined, undefined, U)).toEqual([3, 1, 2]);
    expect(G.offeredGrades([7, 3, 1, 2], true, undefined, undefined, U)).toEqual([3, 1, 2, 7]);
  });
  test('flag off drops 6-12 and out-of-range grades', () => {
    expect(G.offeredGrades([1, 2, 3, 4, 5, 9, 10, 11, 12, 6, 13, null], false, [], [], U)).toEqual([1, 2, 3, 4, 5]);
  });
  test('the contract §7 example', () => {
    const db = [1, 2, 3, 4, 5, 9, 10, 11, 12, 6];
    const flag = ['u-qa-1', 'u-qa-2'];
    expect(G.offeredGrades(db, flag, [11], ['9:chemistry'], 'u-qa-1')).toEqual([1, 2, 3, 4, 5, 6, 9, 10, 12]);
    expect(G.offeredGrades(db, flag, [11], ['9:chemistry'], 'u-qa-2')).toEqual([1, 2, 3, 4, 5, 6, 9, 10, 12]);
    expect(G.offeredGrades(db, flag, [11], ['9:chemistry'], 'u-teacher-7')).toEqual([1, 2, 3, 4, 5]);
    expect(G.offeredGrades(db, flag, [11], ['9:chemistry'], null)).toEqual([1, 2, 3, 4, 5]);
  });
  test('the element type is kept and duplicates by number dropped, first kept', () => {
    expect(G.offeredGrades(['2', 2, '10', 10, '9'], true, [], [], U)).toEqual(['2', '9', '10']);
    expect(G.offeredGrades([1, 1, '1'], false, [], [], U)).toEqual([1]);
    expect(G.offeredGrades([9, '9'], true, [], [], U)).toEqual([9]);
  });
  test('a lexically sorted DB list comes out 1..12 with the flag on', () => {
    const lexical = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].sort();
    expect(G.offeredGrades(lexical, true, [], [], U)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  test('the kill applies to offeredGrades', () => {
    expect(G.offeredGrades([6, 7, 8], true, [7], [], U)).toEqual([6, 8]);
    expect(G.offeredGrades([6, 7, 8, 4], true, 'bad', [], U)).toEqual([4]);
  });
});

describe('grade gate: total functions', () => {
  test('no function throws on undefined arguments', () => {
    expect(G.offeredGrades()).toEqual([]);
    expect(G.offeredGrades(null)).toEqual([]);
    expect(G.offeredGrades('1,2')).toEqual([]);
    expect(G.gradeAllowed()).toBe(false);
    expect(G.cellAllowed()).toBe(false);
    expect(G.isSixTwelveAdmitted()).toBe(false);
  });
  test('offeredGrades never mutates its input', () => {
    const db = [10, 2, 9];
    G.offeredGrades(db, true, [], [], U);
    expect(db).toEqual([10, 2, 9]);
  });
  test('the module exports exactly the four functions', () => {
    expect(Object.keys(G).sort()).toEqual(['cellAllowed', 'gradeAllowed', 'isSixTwelveAdmitted', 'offeredGrades']);
  });
});
