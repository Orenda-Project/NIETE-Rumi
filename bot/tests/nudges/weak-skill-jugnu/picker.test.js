'use strict';
/**
 * bd-ptl6x9.7 — the pure picker: a school+grade's maths-check results → the one skill to name and its Jugnu game.
 * Groups under 5 children say nothing; nothing below the line → nothing; lowest pass rate wins; ties → the
 * links' own order.
 */
const { pick, MIN_GROUP } = require('../../../shared/services/nudges/weak-skill-jugnu/picker');
const LINKS = require('../../../shared/services/nudges/weak-skill-jugnu/links.json');

const s = (egma, scored, passing) => ({ egma, scored, passing });

test('the links are the knowledge graph\'s three same_skill links, nothing else', () => {
  expect(LINKS.links.map((l) => [l.egma, l.game]).sort()).toEqual([
    ['ma.discrimination2', 'bigger'],
    ['ma.missing4', 'missing'],
    ['ma.number_id8', 'numbers'],
  ]);
  LINKS.links.forEach((l) => expect(l.below).toBeGreaterThan(0));
});

test('a group of 5 is the smallest that is spoken about', () => {
  expect(MIN_GROUP).toBe(5);
});

test('the lowest pass rate under the line wins', () => {
  const out = pick([s('ma.missing4', 10, 5), s('ma.number_id8', 10, 3), s('ma.discrimination2', 10, 9)], LINKS);
  expect(out).toEqual({ egma: 'ma.number_id8', game: 'numbers' });
});

test('4 children → null, even when every one of them failed', () => {
  expect(pick([s('ma.missing4', 4, 0), s('ma.number_id8', 4, 0)], LINKS)).toBeNull();
});

test('a skill under 5 is left out; another skill of the same group can still be named', () => {
  const out = pick([s('ma.number_id8', 4, 0), s('ma.missing4', 6, 2)], LINKS);
  expect(out.game).toBe('missing');
});

test('every skill at or above its line → null (nothing to point at)', () => {
  expect(pick([s('ma.missing4', 10, 9), s('ma.number_id8', 10, 8), s('ma.discrimination2', 10, 10)], LINKS)).toBeNull();
});

test('a tie goes to the links\' order, whatever order the results came in', () => {
  const a = pick([s('ma.number_id8', 10, 5), s('ma.missing4', 10, 5)], LINKS);
  const b = pick([s('ma.missing4', 10, 5), s('ma.number_id8', 10, 5)], LINKS);
  const first = LINKS.links.find((l) => ['ma.number_id8', 'ma.missing4'].includes(l.egma)).game;
  expect(a.game).toBe(first);
  expect(b.game).toBe(first);
});

test('a task the graph has no game for is never named', () => {
  expect(pick([s('ma.sub2i', 10, 0)], LINKS)).toBeNull();
});

test('bad input → null, never a throw', () => {
  expect(pick(null, LINKS)).toBeNull();
  expect(pick([s('ma.missing4', 'x', 1)], LINKS)).toBeNull();
  expect(pick([s('ma.missing4', 10, 11)], LINKS)).toBeNull(); // more passing than scored: not trusted
  expect(pick([s('ma.missing4', 10, 2)], null)).toBeNull();
});

test('the answer carries no count and no rate (nothing a message could print)', () => {
  const out = pick([s('ma.missing4', 10, 2)], LINKS);
  expect(Object.values(out).some((v) => typeof v === 'number')).toBe(false);
});
