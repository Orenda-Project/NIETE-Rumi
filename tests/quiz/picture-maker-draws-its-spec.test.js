'use strict';
/**
 * The quiz picture-maker draws what its spec says (bd-cu8noh.2.6).
 *
 * Four live G1-5 maths questions were held back by the teacher review (tasks
 * 316/319/322) because the picture contradicted the figure spec stored beside it:
 *   59  money: the spec names the pieces P, Q, R and the options are P/Q/R, but
 *       the coins and note were drawn with no letter, so no option could be read;
 *   67  base_ten: the spec carries three numbers (`items` P/Q/R) to choose from,
 *       but only the top-level number was drawn, with P/Q/R as column heads;
 *   105 geometry: `arc: "full_circle"` (a whole turn, a == b) was drawn as a bare
 *       line, because the arc is always the minor angle between two rays;
 *   107 geometry: `arc: "reflex"` was drawn as the minor (obtuse) angle.
 * Every spec below is the one stored on the live question, verbatim.
 */

jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');

const { renderFigureSvg } = Figure;
const seen = (svg) => Figure.svgText(svg).map((t) => t.trim());
const count = (svg, re) => (svg.match(re) || []).length;
/** The swept degrees of each labelled standalone angle, from its data-angle mark. */
const sweeps = (svg) => Object.fromEntries(
  [...svg.matchAll(/data-angle="([^"]*)" data-deg="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])]));

const Q59 = { type: 'money', items: [{ kind: 'coin', label: 'P', value: 5 }, { kind: 'note', label: 'Q', value: 20 }, { kind: 'coin', label: 'R', value: 1 }], currency: 'Rs' };
const Q67 = {
  ones: 3, tens: 8, type: 'base_ten', model: 'blocks', places: 3, hundreds: 5,
  items: [{ ones: 8, tens: 5, label: 'P', hundreds: 3 }, { ones: 3, tens: 8, label: 'Q', hundreds: 5 }, { ones: 8, tens: 3, label: 'R', hundreds: 5 }],
  labels: { ones: 'R', tens: 'Q', hundreds: 'P' },
};
const Q105 = { type: 'geometry', shapes: [
  { a: [50, 0], b: [50, 0], arc: 'full_circle', kind: 'angle', label: 'P', vertex: [50, 50] },
  { a: [100, 50], b: [200, 50], arc: 'half_circle', kind: 'angle', label: 'Q', vertex: [150, 50] },
  { a: [250, 50], b: [250, 0], arc: 'quarter_circle', kind: 'angle', label: 'R', vertex: [250, 50] },
] };
const Q107 = { type: 'geometry', shapes: [
  { a: [250, 150], b: [100, 230], arc: 'reflex', kind: 'angle', label: 'P', vertex: [150, 150] },
  { a: [400, 150], b: [350, 200], arc: 'normal', kind: 'angle', label: 'Q', vertex: [350, 150] },
  { a: [650, 150], b: [450, 150], arc: 'normal', kind: 'angle', label: 'R', vertex: [550, 150] },
] };

describe('money: a lettered piece carries its letter', () => {
  test.each(['ur', 'en'])('item 59 shows P, Q and R beside the values (%s)', (lang) => {
    const t = seen(renderFigureSvg(Q59, lang));
    expect(t).toEqual(expect.arrayContaining(['P', 'Q', 'R', 'Rs 5', 'Rs 20', 'Rs 1']));
  });
  test('a name that repeats the value is not drawn twice ("25 Cent" on the 25 coin)', () => {
    const t = seen(renderFigureSvg({ type: 'money', currency: 'Cent', items: [{ kind: 'coin', value: 1, label: '1 Cent' }, { kind: 'coin', value: 25, label: '25 Cent' }] }, 'en'));
    expect(t.filter((s) => s)).toEqual(['Cent 1', 'Cent 25']);
  });
  test('a lone named piece draws no name (it would be the answer, not a handle)', () => {
    const t = seen(renderFigureSvg({ type: 'money', items: [{ kind: 'note', value: 50, label: 'پاکستان' }] }, 'ur'));
    expect(t.filter((s) => s)).toEqual(['Rs 50']);
  });
  test('names that tell pieces apart are drawn ("Bunty", "Babloo")', () => {
    const t = seen(renderFigureSvg({ type: 'money', items: [{ kind: 'note', value: 100, label: 'Bunty' }, { kind: 'note', value: 50, count: 2, label: 'Babloo' }] }, 'en'));
    expect(t).toEqual(expect.arrayContaining(['Bunty', 'Babloo']));
    expect(t.filter((s) => s === 'Babloo')).toHaveLength(1);
  });
  test('an unlettered money picture draws no extra text', () => {
    const t = seen(renderFigureSvg({ type: 'money', items: [{ kind: 'coin', value: 5, count: 2 }] }, 'en'));
    expect(t.filter((s) => s)).toEqual(['Rs 5', 'Rs 5']);
  });
});

describe('base_ten: `items` draws one mat per option', () => {
  const svg = renderFigureSvg(Q67, 'en');
  test('item 67 draws all three numbers, not only the top-level one', () => {
    expect(count(svg, /data-bt="hundred"/g)).toBe(3 + 5 + 5);
    expect(count(svg, /data-bt="ten"/g)).toBe(5 + 8 + 3);
    expect(count(svg, /data-bt="one"/g)).toBe(8 + 3 + 8);
  });
  test('each mat is headed by its letter once; the letters are never column heads', () => {
    const t = seen(svg);
    ['P', 'Q', 'R'].forEach((l) => expect(t.filter((s) => s === l)).toHaveLength(1));
    expect(t).toEqual(expect.arrayContaining(['Hundreds', 'Tens', 'Ones']));
  });
  test('a plain base_ten mat is unchanged (no items)', () => {
    const plain = renderFigureSvg({ type: 'base_ten', hundreds: 3, tens: 4, ones: 2 }, 'en');
    expect(count(plain, /data-bt="hundred"/g)).toBe(3);
    expect(count(plain, /data-bt="ten"/g)).toBe(4);
    expect(count(plain, /data-bt="one"/g)).toBe(2);
  });
});

describe('geometry: an angle sweeps the turn its arc names', () => {
  test('item 105: a full turn sweeps 360°, a half turn 180°, a quarter turn 90°', () => {
    const d = sweeps(renderFigureSvg(Q105, 'en'));
    expect(d.P).toBe(360);
    expect(d.Q).toBeCloseTo(180, 0);
    expect(d.R).toBeCloseTo(90, 0);
  });
  test('item 107: the reflex angle sweeps more than 180°; the others stay as drawn', () => {
    const d = sweeps(renderFigureSvg(Q107, 'en'));
    expect(d.P).toBeGreaterThan(180);
    expect(d.P).toBeLessThan(360);
    expect(d.Q).toBeCloseTo(90, 0);
    expect(d.R).toBeCloseTo(180, 0);
  });
  test('the reflex arc takes the long way round (SVG large-arc flag set)', () => {
    const svg = renderFigureSvg(Q107, 'en');
    const p = svg.match(/data-angle="P"[^>]*>\s*<path d="M[\d.,-]+ A[\d.]+,[\d.]+ 0 (\d) /);
    expect(p && p[1]).toBe('1');
  });
  test('an angle with no arc key is still the minor angle', () => {
    const d = sweeps(renderFigureSvg({ type: 'geometry', shapes: [
      { kind: 'angle', vertex: [0, 0], a: [4, 0], b: [-3, 3], label: 'x' }] }, 'en'));
    expect(d.x).toBeCloseTo(135, 0);
  });
});

describe('the figure check refuses an angle with a ray of no length', () => {
  test('a ray ending on its own vertex is refused (item 105, R) unless the angle is a full turn', () => {
    expect(Figure.figureEmptyReason(Q105)).toMatch(/ray of no length/);
    const fixed = { ...Q105, shapes: [Q105.shapes[0], Q105.shapes[1], { ...Q105.shapes[2], a: [300, 50] }] };
    expect(Figure.figureEmptyReason(fixed)).toBeNull();
  });
});
