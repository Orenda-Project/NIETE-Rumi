/**
 * An Urdu lesson title on the Videos shelf shows its letters whole (wq-doors.css `.wq-vct`).
 *
 * Bug (Nov 2026, production): «کہ اور کے میں فرق» read «لہ اور کے میں فرق» on the shelf. A line-initial ک or گ draws its
 * top bar past the start of its advance, in every Urdu face. In RTL that start is the box's right edge, and the
 * title's clamp (overflow hidden) trimmed the bar, leaving a ل-like stem. The title keeps its clamp and gets 6 px at its
 * inline start (the right edge in Urdu).
 *
 * Bug 2 (Nov 2026, production): «گنجائش» read «کنجائش». The upper of گ's two bars draws about 5 px above the first line
 * box (15 px Nastaliq at line-height 1.9), and the same clamp trimmed it at the box top, so گ showed one bar, like ک.
 * Measured at a true 3× scale with the crop starting 22 px above the box: live vs overflow:visible differ by 103 px
 * above the box for گ and by 0 for ک. (An earlier crop started 8 px above the box and could not see it.) Any گ on the
 * first line is hit, not only a line-initial one. An Urdu-script title also gets 6 px of room at its top; a Latin title on
 * the Urdu grid draws no گ and keeps its box.
 */
const { computed, node, root } = require('./cascade');

const DOORS = [root('wq.css'), root('wq-doors.css')];
const BAR_PX = 6;
// گ's upper bar reaches 15 device px (5.00 CSS px) above the first line box at 3×, its faintest antialias row included
// (live vs overflow:visible, topmost differing row); 6 = that + 1 px for fractional device scales.
const TOP_PX = 6;

// wq-doors.js draws `<b class="wq-vct"><bdi …>title</bdi></b>`; a Latin title's bdi carries `wq-lat` (lat()).
const title = (lang, adv = false, latin = false) => [
  node('html', adv ? ['wq-adv'] : [], { lang }),
  node('body'),
  node('div', ['wq-vrow']),
  node('div', ['wq-vcard']),
  node('button', ['wq-vbox']),
  node('b', ['wq-vct'], {}, undefined, [node('bdi', latin ? ['wq-lat'] : [])]),
];
const px = (v) => (v == null ? 0 : parseFloat(v));
const value = (path, prop) => (computed(path, prop, DOORS) || {}).value;

describe('the Urdu shelf title has room at its start for a ک or گ bar, and at its top for the upper bar of گ', () => {
  test.each([[false], [true]])('Urdu, advanced look %s: inline-start room is at least 6 px', (adv) => {
    expect(px(value(title('ur', adv), 'padding-inline-start'))).toBeGreaterThanOrEqual(BAR_PX);
  });

  test.each([[false], [true]])('Urdu, advanced look %s: top room is at least 6 px, so گ keeps both bars', (adv) => {
    expect(px(value(title('ur', adv), 'padding-top'))).toBeGreaterThanOrEqual(TOP_PX);
  });

  // A Latin title on the Urdu grid has no گ: its box stays as it was (no top room), in both looks.
  test.each([[false, '1.9'], [true, '1.3']])('a Latin title on the Urdu grid, advanced look %s: no top room, its box unchanged', (adv, lh) => {
    const p = title('ur', adv, true);
    expect(px(value(p, 'padding-top'))).toBe(0);
    expect(value(p, 'line-height')).toBe(lh);
    expect(px(value(p, 'padding-inline-start'))).toBeGreaterThanOrEqual(BAR_PX);
  });

  test('it is still a 2-line clamp that hides the rest (a long title stops at 2 lines)', () => {
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
