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

// The stub carries the fields its overlays address. It did not need to while `sanitizeOverlay`
// only inspected the KEY's shape; since bd-vnyuw it also asks whether the pointer RESOLVES, and
// a pointer into an empty stub resolves to nothing. Sharpening the fixture, not the rule: the
// assertions below are unchanged and still say what they always said.
const doc = (over) => ({
  lesson_id: 'x',
  one_screen: 'Today the class multiplies two matrices.',
  objectives: ['State the order of a product'],
  sections: [],
  ...over,
});

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

// ── fields the model invents ────────────────────────────────────────────────

/**
 * MEASURED ON STAGING, twice in one morning, on two different segments:
 *
 *   SCHEMA INVALID — / must NOT have additional properties ('provenance_note')
 *   SCHEMA INVALID — /ur_overlay must be object
 *
 * Both are the same failure: the model adds something `lp_doc` forbids, and a lesson that is
 * otherwise finished — 265 s and three revision rounds in — is thrown away at the last gate. The
 * teacher gets an apology for a document that was fine.
 *
 * The root schema is `additionalProperties: false`, which means an unknown key is BY DEFINITION
 * one the renderer can never read. Dropping it cannot lose anything, and the alternative is
 * discarding the whole lesson — so this is not a judgement call being automated, it is a
 * mechanical repair of a mechanically-decidable defect.
 *
 * The allowed set is read FROM THE SCHEMA, never hardcoded: a hardcoded list silently starts
 * deleting real fields the day someone adds one.
 */

const schema = require('../../bot/vendor/lp-v9/schema/lp_doc.schema.json');
const { sanitizeUnknownTopLevel } = require('../../bot/shared/services/lp612-author.service');

describe('a field the schema does not know is dropped, not fatal', () => {
  test("the exact key that killed a staging render is removed", () => {
    const d = sanitizeUnknownTopLevel({ lesson_id: 'x', provenance_note: 'invented' });
    expect('provenance_note' in d).toBe(false);
    expect(d.lesson_id).toBe('x');
  });

  test('EVERY real schema property survives', () => {
    // The guard against the obvious way to get this wrong: dropping something real.
    const doc = {};
    for (const k of Object.keys(schema.properties)) doc[k] = 'keep';
    const out = sanitizeUnknownTopLevel(doc);
    expect(Object.keys(out).sort()).toEqual(Object.keys(schema.properties).sort());
  });

  test('the allowed set comes from the schema, not a copy of it', () => {
    // If this ever drifts, a newly-added schema field starts being deleted in production.
    const invented = `definitely_not_in_the_schema_${Date.now()}`;
    expect(Object.keys(schema.properties)).not.toContain(invented);
    expect(invented in sanitizeUnknownTopLevel({ [invented]: 1 })).toBe(false);
  });

  test('it only touches the TOP level — nested shapes are the schema\'s business', () => {
    // Nested additionalProperties failures are real defects the ladder should fix, not hide.
    const d = sanitizeUnknownTopLevel({ page2: { board_final: {}, invented_here: 1 } });
    expect(d.page2.invented_here).toBe(1);
  });

  test('a clean document is returned untouched', () => {
    const d = { lesson_id: 'x', sections: [], page2: {} };
    expect(sanitizeUnknownTopLevel({ ...d })).toEqual(d);
  });
});
