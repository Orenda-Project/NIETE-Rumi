/**
 * An Urdu lesson title on the Videos shelf shows its letters whole (wq-doors.css `.wq-vct`).
 *
 * Bug (Nov 2026, production): the title is a 2-line clamp with overflow hidden. In Urdu it is 15 px Nastaliq at
 * line-height 1.9, a 28.5 px line, but a Nastaliq line needs 33 px (scrollHeight, measured on the live page at
 * 360 × 740). The clamp cut the top strokes of ک and گ, so «کہ اور کے میں فرق» read «لہ اور کے میں فرق» on the shelf.
 * The title keeps its clamp, and gets room above the first line, like See all and Try again in the same file
 * ("Nastaliq rides high").
 */
const { computed, node, root } = require('./cascade');

const DOORS = [root('wq.css'), root('wq-doors.css')];
const NASTALIQ_LINE_PX = 33;

const title = (lang, adv = false) => [
  node('html', adv ? ['wq-adv'] : [], { lang }),
  node('body'),
  node('div', ['wq-vrow']),
  node('div', ['wq-vcard']),
  node('button', ['wq-vbox']),
  node('b', ['wq-vct']),
];
const px = (v) => (v == null ? 0 : parseFloat(v));
const value = (path, prop) => (computed(path, prop, DOORS) || {}).value;

describe('the Urdu shelf title has room for Nastaliq above its first line', () => {
  test.each([[false], [true]])('Urdu, advanced look %s: line plus top room is at least a Nastaliq line', (adv) => {
    const p = title('ur', adv);
    const line = px(value(p, 'font-size')) * parseFloat(value(p, 'line-height'));
    expect(line + px(value(p, 'padding-top'))).toBeGreaterThanOrEqual(NASTALIQ_LINE_PX);
  });

  test('it is still a 2-line clamp that hides the rest (the card keeps its height)', () => {
    const p = title('ur');
    expect(value(p, '-webkit-line-clamp')).toBe('2');
    expect(value(p, 'overflow')).toBe('hidden');
  });

  test('an English title is drawn exactly as before: no new top room', () => {
    expect(value(title('en'), 'padding-top')).toBeUndefined();
    expect(value(title('en'), 'line-height')).toBe('1.3');
  });
});
