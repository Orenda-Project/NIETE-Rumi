/**
 * The `match` figure shipped without a label row, so it printed no `.ftag` badge.
 *
 * OPERATOR, on the English plan: *"wirte on the board section is messed up stil like previous"*.
 * The board plan is now a drawn `match` figure in both English and Urdu (bd-1nv5q), but where
 * Maths' `grid` and `number_line` figures announce themselves with a badge, the English and Urdu
 * board figures printed none -- a drawing with no name sitting where prose used to be.
 *
 * The cause is not the badge markup, which is unconditional (`.ftag` is emitted for every figure).
 * `diagramLabel()` returns "" for a type absent from DIAGRAM_LABELS and the caller then prints
 * nothing, and `match` was simply never added to the table. The comment above DIAGRAM_LABELS says
 * `test/print_quality.js` enumerates the diagram engine's own registry against this table so that
 * "a new type cannot ship without a label" -- `match` is the type that got past it.
 *
 * Rule 20: a teacher-facing label is added to BOTH language blocks, in real Urdu, never a
 * transliteration and never English left standing in an Urdu render.
 */

'use strict';

const { DIAGRAM_LABELS, diagramLabel } = require('../../bot/vendor/lp-v9/lib/template.js');

/** Urdu text must be Arabic-script throughout -- a Latin letter here is an untranslated string. */
const LATIN = /[A-Za-z]/;

describe('bd: the match figure carries a label in both languages', () => {
  test('match has a row in the table', () => {
    expect(DIAGRAM_LABELS).toHaveProperty('match');
  });

  test('the English label names what the teacher is looking at', () => {
    expect(DIAGRAM_LABELS.match.en).toBe('Matching');
  });

  test('the Urdu label is real Urdu, not the English string', () => {
    expect(DIAGRAM_LABELS.match.ur).toBe('جوڑ ملائیں');
    expect(DIAGRAM_LABELS.match.ur).not.toMatch(LATIN);
  });

  test('diagramLabel resolves it in both languages instead of returning nothing', () => {
    expect(diagramLabel('match', 'en')).toBe('Matching');
    expect(diagramLabel('match', 'ur')).toBe('جوڑ ملائیں');
  });

  /** The control: the two Maths types that already worked must not move. */
  test('grid and number_line are unchanged', () => {
    expect(diagramLabel('grid', 'en')).toBe('Grid');
    expect(diagramLabel('number_line', 'en')).toBe('Number line');
  });

  /** No Urdu label anywhere in the table may be English left standing (Rule 20). */
  test('every Urdu label in the table is Arabic-script', () => {
    const latin = Object.entries(DIAGRAM_LABELS)
      .filter(([, v]) => LATIN.test(v.ur))
      .map(([k]) => k);
    expect(latin).toEqual([]);
  });
});
