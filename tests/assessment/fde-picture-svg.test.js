/**
 * The Grade 1-2 pictures drawn as SVG (bd-5jmnfj.4.3): dots, shapes (whole or cut
 * into shaded parts) and a clock face. A picture this module cannot draw throws,
 * so a paper never prints an empty box.
 */

const Svg = require('../../bot/shared/services/assessment/fde-picture-svg');

const count = (svg, rx) => (svg.match(rx) || []).length;

test('dots: exactly n dots, five to a row', () => {
  const svg = Svg.svgFor({ kind: 'dots', n: 7 });
  expect(svg.startsWith('<svg')).toBe(true);
  expect(count(svg, /<circle /g)).toBe(7);
  expect(Svg.svgFor({ kind: 'dots', n: 10 })).toMatch(/viewBox="0 0 \d+ \d+"/);
});

test('dots: a count outside 1-20 is refused', () => {
  expect(() => Svg.svgFor({ kind: 'dots', n: 0 })).toThrow('dots');
  expect(() => Svg.svgFor({ kind: 'dots', n: 21 })).toThrow('dots');
  expect(() => Svg.svgFor({ kind: 'dots', n: 'five' })).toThrow('dots');
});

test.each(['circle', 'square', 'rectangle', 'triangle', 'oval', 'semicircle', 'star', 'heart'])('shapes: %s is drawn', (shape) => {
  const svg = Svg.svgFor({ kind: 'shapes', shapes: [{ shape }] });
  expect(svg).toContain(`data-shape="${shape}"`);
  expect(svg).not.toContain('fill="#999"');
});

test('shapes: several sit side by side, in order', () => {
  const svg = Svg.svgFor({ kind: 'shapes', shapes: [{ shape: 'circle' }, { shape: 'Square' }] });
  expect(svg.indexOf('data-shape="circle"')).toBeLessThan(svg.indexOf('data-shape="square"'));
});

test.each([
  ['circle', 4, 3],
  ['square', 2, 1],
  ['rectangle', 3, 2],
])('fractions: a %s in %i equal parts with %i shaded', (shape, parts, shaded) => {
  const svg = Svg.svgFor({ kind: 'shapes', shapes: [{ shape, parts, shaded }] });
  expect(count(svg, /data-part="shaded"/g)).toBe(shaded);
  expect(count(svg, /data-part="plain"/g)).toBe(parts - shaded);
});

test('fractions: a shape that cannot be cut, or more shaded than parts, is refused', () => {
  expect(() => Svg.svgFor({ kind: 'shapes', shapes: [{ shape: 'star', parts: 2, shaded: 1 }] })).toThrow('cannot be cut');
  expect(() => Svg.svgFor({ kind: 'shapes', shapes: [{ shape: 'circle', parts: 2, shaded: 3 }] })).toThrow('shaded');
  expect(() => Svg.svgFor({ kind: 'shapes', shapes: [{ shape: 'circle', parts: 5, shaded: 1 }] })).toThrow('parts');
});

test('shapes: an unknown shape or an empty list is refused', () => {
  expect(() => Svg.svgFor({ kind: 'shapes', shapes: [{ shape: 'hexagon' }] })).toThrow('unknown shape hexagon');
  expect(() => Svg.svgFor({ kind: 'shapes', shapes: [] })).toThrow('shapes');
});

test('clock: a face with twelve marks and two hands at the time given', () => {
  const svg = Svg.svgFor({ kind: 'clock', hour: 3, minute: 0 });
  expect(count(svg, /data-mark/g)).toBe(12);
  expect(svg).toContain('data-hand="hour"');
  expect(svg).toContain('data-hand="minute"');
  expect(() => Svg.svgFor({ kind: 'clock', hour: 13, minute: 0 })).toThrow('clock');
  expect(() => Svg.svgFor({ kind: 'clock', hour: 3, minute: 7 })).toThrow('clock');
});

test('kinds drawn elsewhere return null; drawable kinds are listed', () => {
  expect(Svg.svgFor({ kind: 'object', name: 'apple' })).toBeNull();
  expect(Svg.SVG_KINDS).toEqual(['dots', 'shapes', 'clock', 'plant']);
});

test('dataUri wraps the svg as base64', () => {
  const uri = Svg.dataUri('<svg/>');
  expect(uri).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);
});
