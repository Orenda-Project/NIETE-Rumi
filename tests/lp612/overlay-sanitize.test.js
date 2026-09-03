/**
 * The Urdu toggle the model was told not to write.
 *
 * `ur_overlay` is OPTIONAL and, for an English-medium book asked for in Urdu, the brief tells
 * the model in as many words: "Do NOT emit ur_overlay yourself." It emitted one anyway, and it
 * was not an object — so the renderer refused the whole document:
 *
 *   SCHEMA INVALID — refusing to render:  /ur_overlay must be object
 *
 * That is a REAL staging failure, on grade_10_pak_studies_urdu.c01.p006-007, after the teacher
 * had already waited through a full authoring run. The lesson was written, it was fine, and it
 * died at the last gate on a field nothing needed.
 *
 * This is CLAUDE.md rule 24(c) exactly: a prompt's input contract has to be asserted in CODE,
 * because the model complies ~95% of the time and freestyles the rest. The schema is a wall,
 * not a repair — so the repair happens before the wall.
 *
 * The rule is deliberately narrow: DROP what cannot be valid, never invent. An overlay is a map
 * of JSON-Pointer -> replacement string; anything else is not a lossy overlay, it is not an
 * overlay at all, and the document renders correctly without one.
 */

const { sanitizeOverlay } = require('../../bot/shared/services/lp612-author.service');

const doc = (over) => ({ lesson_id: 'x', sections: [], ...over });

describe('ur_overlay is repaired before it reaches the schema wall', () => {
  test('an ARRAY overlay is dropped — this is the shape that failed on staging', () => {
    const d = sanitizeOverlay(doc({ ur_overlay: [] }));
    expect('ur_overlay' in d).toBe(false);
  });

  test.each([
    ['a string', 'کچھ'],
    ['a number', 42],
    ['a boolean', true],
    ['null', null],
  ])('%s overlay is dropped', (_label, value) => {
    expect('ur_overlay' in sanitizeOverlay(doc({ ur_overlay: value }))).toBe(false);
  });

  test('a VALID overlay is left exactly as it is', () => {
    // The Urdu toggle is the whole point of the field when a book earns one; repairing must
    // never mean discarding a working overlay.
    const ov = { '/objectives/0': 'مقاصد', '/one_screen': 'خلاصہ' };
    expect(sanitizeOverlay(doc({ ur_overlay: ov })).ur_overlay).toEqual(ov);
  });

  test('a mostly-valid overlay keeps its good pointers and drops only the bad entries', () => {
    const d = sanitizeOverlay(doc({
      ur_overlay: {
        '/one_screen': 'خلاصہ',   // good
        'one_screen': 'no slash',  // propertyNames pattern is ^/
        '/objectives/0': 99,       // values must be strings
        '/materials': ['a'],
      },
    }));
    expect(d.ur_overlay).toEqual({ '/one_screen': 'خلاصہ' });
  });

  test('an overlay left with NOTHING valid is dropped rather than left empty', () => {
    // `{}` is schema-valid but meaningless, and it makes "did the model write an overlay?"
    // unanswerable later. Absent means absent.
    expect('ur_overlay' in sanitizeOverlay(doc({ ur_overlay: { bad: 1 } }))).toBe(false);
  });

  test('a document with no overlay at all is untouched', () => {
    const d = doc();
    expect(sanitizeOverlay(d)).toEqual(d);
  });

  test('it never invents an overlay', () => {
    expect('ur_overlay' in sanitizeOverlay(doc())).toBe(false);
  });
});
