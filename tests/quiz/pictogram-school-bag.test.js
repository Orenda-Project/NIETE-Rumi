'use strict';
/**
 * The school bag (بستہ) has to read as a school bag.
 *
 * Render QA of an Urdu grade-3 quiz ("تصویر میں کتنے بستے ہیں؟"): the vendored
 * OpenMoji backpack is, in its line-art variant, an arch with a bar across it
 * and a small loop on top — no straps, no pocket — and three of them in a row
 * read as lanterns or birdcages. A child cannot count bags they do not see as
 * bags. The engine now draws its own backpack for `bag` and `bag_school`: a
 * rounded body, a front pocket with its flap, a carry handle, and the two
 * shoulder straps at the sides that make the silhouette a backpack.
 *
 * The replacement keeps the glyph contract every pictogram obeys (72-unit grid,
 * currentColor ink, stroke 2, data-ov="skip" on every element), so every type
 * that draws a pictogram draws it unchanged.
 */

const Pictogram = require('../../bot/vendor/lp-v9/diagrams/lib/pictogram');
const { renderDiagram } = require('../../bot/vendor/lp-v9/diagrams');

const parts = (body) => [...body.matchAll(/data-part="([a-z]+)"/g)].map((m) => m[1]);
const elements = (body) => [...body.matchAll(/<(path|line|rect|circle|ellipse|polyline|polygon)\b[^>]*>/g)].map((m) => m[0]);

describe('the backpack pictogram', () => {
  test.each(['bag', 'bag_school', 'Bag School'])('"%s" draws a body, a pocket, a handle and two straps', (name) => {
    const p = parts(Pictogram.inner(name));
    expect(p.filter((x) => x === 'strap')).toHaveLength(2);
    ['body', 'pocket', 'flap', 'handle'].forEach((x) => expect(p).toContain(x));
  });

  test('it keeps the glyph contract: currentColor ink, stroke 2, every element skipped by the overlap check', () => {
    const els = elements(Pictogram.inner('bag'));
    expect(els.length).toBeGreaterThanOrEqual(6);
    els.forEach((el) => {
      expect(el).toMatch(/data-ov="skip"/);
      expect(el).toMatch(/stroke="currentColor"/);
      expect(el).toMatch(/stroke-width="2"/);
    });
  });

  test('it fits the 72-unit grid every glyph is scaled by', () => {
    const nums = Pictogram.inner('bag').match(/-?\d+(?:\.\d+)?/g).map(Number);
    nums.forEach((n) => { expect(n).toBeGreaterThanOrEqual(-0.001); expect(n).toBeLessThanOrEqual(72); });
  });

  test('a counting figure of bags draws the new backpack, three times', () => {
    const svg = renderDiagram({ type: 'count_objects', count: 3, picto: 'bag_school', lang: 'ur' });
    expect(parts(svg).filter((x) => x === 'strap')).toHaveLength(6);
  });
});
