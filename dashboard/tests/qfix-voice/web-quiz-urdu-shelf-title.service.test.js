/**
 * An Urdu lesson title on the Videos shelf shows its letters whole (wq-doors.css `.wq-vct`).
 *
 * Bug (Nov 2026, production): «کہ اور کے میں فرق» read «لہ اور کے میں فرق» on the shelf. A line-initial ک or گ draws its
 * top bar past the start of its advance, in every Urdu face. In RTL that start is the box's right edge, and the
 * title's clamp (overflow hidden) trimmed the bar, leaving a ل-like stem. Measured at a true 3× scale on the live page:
 * nothing is cut at the top, so the first fix (5 px of top room) changed nothing and is taken out again.
 * The title keeps its clamp and gets 6 px at its inline start (the right edge in Urdu).
 */
const { computed, node, root } = require('./cascade');

const DOORS = [root('wq.css'), root('wq-doors.css')];
const BAR_PX = 6;

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

describe('the Urdu shelf title has room at its start for a ک or گ bar', () => {
  test.each([[false], [true]])('Urdu, advanced look %s: inline-start room is at least 6 px, and no top room', (adv) => {
    const p = title('ur', adv);
    expect(px(value(p, 'padding-inline-start'))).toBeGreaterThanOrEqual(BAR_PX);
    expect(px(value(p, 'padding-top'))).toBe(0);
  });

  test('it is still a 2-line clamp that hides the rest (the card keeps its height)', () => {
    const p = title('ur');
    expect(value(p, '-webkit-line-clamp')).toBe('2');
    expect(value(p, 'overflow')).toBe('hidden');
  });

  test('an English title is drawn exactly as before: no new room on any side', () => {
    for (const prop of ['padding-top', 'padding-inline-start', 'padding-right', 'padding-left']) {
      expect(value(title('en'), prop)).toBeUndefined();
    }
    expect(value(title('en'), 'line-height')).toBe('1.3');
  });
});
