'use strict';
/**
 * The homonym guard on a list of children a device can tap (web-quiz-homonym.js, pure).
 * Table-driven from the one-phone-three-children fixture: two roster children share a first
 * name and have no father's name; a third is unique. Invented names only.
 */
const H = require('../../../shared/services/quiz/web-quiz-homonym');

const ZK = { id: 'c1', first: 'Zara Khan', father_first: null };
const ZM = { id: 'c2', first: 'Zara Malik', father_first: null };
const BA = { id: 'c3', first: 'Bilal Ahmed', father_first: 'Tariq' };

describe('canonFirst', () => {
  test.each([
    ['Zara Khan', 'zara'],
    ['  ZARA  ', 'zara'],
    ['Muhammad Bilal', 'bilal'],
    ['M. Bilal', 'bilal'],
    ['Md Bilal', 'bilal'],
    ['Mohammad', 'mohammad'],
    ['محمد بلال', 'بلال'],
    ['عائشة', 'عایشہ'],
    ['عائشہ', 'عایشہ'],
    ['عايشه', 'عایشہ'],
    ['Zára', 'zara'],
    ['', ''],
  ])('%s -> %s', (name, want) => {
    expect(H.canonFirst(name)).toBe(want);
  });
});

describe('guard: the class link stranger path (no disambiguator)', () => {
  test('Zara / Zara are identical chips: both low + homonym_in_list; Bilal high + false', () => {
    const out = H.guard([ZK, ZM, BA], { surface: 'j_stranger', playedHere: [] });
    const by = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(by.c1).toMatchObject({ homonym_in_list: true, confidence: 'low' });
    expect(by.c2).toMatchObject({ homonym_in_list: true, confidence: 'low' });
    expect(by.c3).toMatchObject({ homonym_in_list: false, confidence: 'high' });
    expect(out.some((r) => r.line2)).toBe(false);
  });
});

describe('guard: the teacher quiz link (father first name as line 2)', () => {
  test('distinct father names resolve the pair: high, still homonym_in_list', () => {
    const out = H.guard([{ ...ZK, father_first: 'Khalid' }, { ...ZM, father_first: 'Imran' }], { surface: 'q' });
    expect(out.map((r) => r.line2)).toEqual(['Khalid', 'Imran']);
    expect(out.every((r) => r.homonym_in_list === true && r.confidence === 'high')).toBe(true);
  });
  test('no father names: still identical -> both low', () => {
    const out = H.guard([ZK, ZM], { surface: 'q' });
    expect(out.map((r) => r.confidence)).toEqual(['low', 'low']);
  });
});

describe('guard: who is playing on a bound phone', () => {
  test('chips Zara + Ayesha: no collision, both high', () => {
    const out = H.guard([{ id: 'c1', first: 'Zara' }, { id: 'ca', first: 'Ayesha' }], { surface: 'who' });
    expect(out.map((r) => [r.homonym_in_list, r.confidence])).toEqual([[false, 'high'], [false, 'high']]);
  });
  test('the device played as one of two Zaras: that chip carries the avatar line; both resolved', () => {
    const out = H.guard([ZK, ZM], { surface: 'who', playedHere: ['c2'] });
    expect(out[1].avatarLine).toBe('jg.who.played_here');
    expect(out[0].avatarLine).toBeUndefined();
    expect(out.map((r) => r.confidence)).toEqual(['high', 'high']);
    expect(out.every((r) => r.homonym_in_list)).toBe(true);
  });
});

describe('confidenceFor and idSrcFromVia (IDENTITY §1)', () => {
  test.each([
    [{ id_src: 'roster_pick', homonym_in_list: false }, 'high'],
    [{ id_src: 'roster_pick', homonym_in_list: true, resolved: true }, 'high'],
    [{ id_src: 'roster_pick', homonym_in_list: true, resolved: false }, 'low'],
    [{ id_src: 'remembered' }, 'high'],
    [{ id_src: 'hub_chip' }, 'high'],
    [{ id_src: 'phone_bound' }, 'high'],
    [{ id_src: 'teacher_set' }, 'high'],
    [{ id_src: 'class_round', homonym_in_list: true, resolved: false }, 'high'],
    [{ id_src: 'forced_new' }, 'low'],
  ])('%j -> %s', (inp, want) => {
    expect(H.confidenceFor(inp)).toBe(want);
  });
  test.each([
    ['remembered', { id_src: 'remembered' }],
    ['hub', { id_src: 'hub_chip' }],
    ['name', { id_src: 'roster_pick' }],
    ['full_name', { id_src: 'roster_pick' }],
    ['father', { id_src: 'roster_pick' }],
    ['number', { id_src: 'roster_pick' }],
    ['new', { id_src: 'forced_new' }],
    ['preview', { id_src: null, mode: 'practice' }],
    ['bogus', { id_src: null }],
  ])('%s -> %j', (via, want) => {
    expect(H.idSrcFromVia(via)).toEqual(want);
  });
});
