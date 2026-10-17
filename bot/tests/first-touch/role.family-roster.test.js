'use strict';
/**
 * Rung 3b's class-roster read (`familyKids`), against a table double that applies the query's filters and its limit.
 * The rule is the join page's, word for word, so the landing's chips and the pick's acceptance never disagree about one
 * phone: the row filters run IN the query (active, unmerged, on a list), a phone on more rows than a scan reads is a
 * class's number (nothing offered), THEN this school year's active lists, THEN at most 4 children of ONE school
 * (`students.school_id`). Old or left rows never crowd out this year's child.
 */
const { fixturePhone } = require('../quiz/web-quiz/fixture-phone');
const { fakeDb } = require('../quiz/teacher-quiz-menu/fake-db');

let mockDb;
jest.mock('../../shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a), rpc: (...a) => mockDb.rpc(...a) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Role = require('../../shared/services/first-touch/role.service');
const { normalisePhone } = require('../../shared/services/quiz/student-identity.service');

const PHONE = fixturePhone(311);
const NORM = normalisePhone(PHONE);
const NOW = new Date('2026-10-16T12:00:00Z');
const THIS_YEAR = '2026-06-01T00:00:00Z';
const LAST_YEAR = '2025-06-01T00:00:00Z';

const lists = [
  { id: 'l-new', user_id: 't-1', is_active: true, created_at: THIS_YEAR },
  { id: 'l-new2', user_id: 't-2', is_active: true, created_at: THIS_YEAR },
  { id: 'l-old', user_id: 't-1', is_active: true, created_at: LAST_YEAR },
  { id: 'l-off', user_id: 't-1', is_active: false, created_at: THIS_YEAR },
];
const kid = (id, name, extra = {}) => ({
  id, student_name: name, parent_phone: NORM, list_id: 'l-new', school_id: 'sch-1',
  is_active: true, status: 'active', merged_into: null, ...extra,
});
const world = (students, users = [{ id: 't-1', school_id: 'sch-1' }, { id: 't-2', school_id: 'sch-1' }]) => {
  mockDb = fakeDb({ students, student_lists: lists, users });
};
const family = () => Role.familyKids(PHONE, NOW);

describe('familyKids — rung 3b, the filters before the count', () => {
  test('five last-year rows + one this-year child → that child only (old rows never crowd out this year)', async () => {
    world([
      ...[1, 2, 3, 4, 5].map((i) => kid(`old-${i}`, `Old${i} Testwala`, { list_id: 'l-old' })),
      kid('s-now', 'Sara Testwala'),
    ]);
    expect(await family()).toEqual([{ id: 's-now', first: 'Sara' }]);
  });

  test('four last-year rows + one this-year child → that child (not "a family of five")', async () => {
    world([...[1, 2, 3, 4].map((i) => kid(`old-${i}`, `Old${i} Testwala`, { list_id: 'l-old' })), kid('s-now', 'Sara Testwala')]);
    expect(await family()).toEqual([{ id: 's-now', first: 'Sara' }]);
  });

  test('left, inactive, merged rows and rows on an inactive list never count and are never offered', async () => {
    world([
      ...[1, 2, 3, 4, 5].map((i) => kid(`m-${i}`, `Merged${i} Testwala`, { merged_into: 's-now' })),
      kid('gone', 'Gone Testwala', { is_active: false }),
      kid('left', 'Left Testwala', { status: 'left' }),
      kid('off', 'Off Testwala', { list_id: 'l-off' }),
      kid('s-now', 'Sara Testwala'),
    ]);
    expect(await family()).toEqual([{ id: 's-now', first: 'Sara' }]);
  });

  test('one school is keyed by students.school_id: two lists of two teachers in ONE school → both children', async () => {
    world([kid('s-1', 'Ali Testwala'), kid('s-2', 'Hina Testwala', { list_id: 'l-new2' })],
      [{ id: 't-1', school_id: 'sch-1' }, { id: 't-2', school_id: 'sch-9' }]);
    expect(await family()).toEqual([{ id: 's-1', first: 'Ali' }, { id: 's-2', first: 'Hina' }]);
  });

  test('two schools by students.school_id → nothing offered (even when the list owners share a school)', async () => {
    world([kid('s-1', 'Ali Testwala'), kid('s-2', 'Hina Testwala', { school_id: 'sch-2' })]);
    expect(await family()).toEqual([]);
  });

  test('five children this year → nothing; four → all four, first names only', async () => {
    world([1, 2, 3, 4, 5].map((i) => kid(`s-${i}`, `Kid${i} Testwala`)));
    expect(await family()).toEqual([]);
    world([1, 2, 3, 4].map((i) => kid(`s-${i}`, `Kid${i} Testwala`)));
    expect(await family()).toEqual([1, 2, 3, 4].map((i) => ({ id: `s-${i}`, first: `Kid${i}` })));
  });

  test('a phone on 40 or more roster rows is a class\'s number → nothing, even if only one row is this year\'s', async () => {
    world([...Array.from({ length: 39 }, (_, i) => kid(`old-${i}`, 'Old Testwala', { list_id: 'l-old' })), kid('s-now', 'Sara Testwala')]);
    expect(await family()).toEqual([]);
    world([...Array.from({ length: 38 }, (_, i) => kid(`old-${i}`, 'Old Testwala', { list_id: 'l-old' })), kid('s-now', 'Sara Testwala')]);
    expect(await family()).toEqual([{ id: 's-now', first: 'Sara' }]);
  });

  test('the family number as the teacher typed it: +92…, 92… and 0… all match', async () => {
    const local = `0${NORM.slice(2)}`;
    world([kid('s-1', 'Ali Testwala', { parent_phone: `+${NORM}` }), kid('s-2', 'Hina Testwala', { parent_phone: local })]);
    expect((await family()).map((k) => k.id).sort()).toEqual(['s-1', 's-2']);
  });

  test('the read is one students query with the row filters in it, one lists query, and no users read', async () => {
    world([kid('s-1', 'Ali Testwala')]);
    await family();
    const s = mockDb.reads.filter((r) => r.table === 'students');
    expect(s).toHaveLength(1);
    expect(s[0].filters).toEqual(expect.arrayContaining([['eq', 'is_active', true], ['eq', 'status', 'active'], ['is', 'merged_into', null]]));
    expect(mockDb.reads.filter((r) => r.table === 'student_lists')).toHaveLength(1);
    expect(mockDb.reads.filter((r) => r.table === 'users')).toHaveLength(0);
    expect(mockDb.writes).toEqual([]);
  });
});
