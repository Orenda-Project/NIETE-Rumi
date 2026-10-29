/** Unit tests for fde-slot-fit (bd-5jmnfj.4.58.4): page fit numbers and row grouping. */
const Fit = require('../../bot/shared/services/assessment/fde-slot-fit');

const pic = (kind) => ({ picture: { kind } });

describe('fitHeightMm', () => {
  test('null when the default already fits', () => {
    expect(Fit.fitHeightMm({ n: 1, pic: 45 })).toBeNull();
  });
  test('four scenes shrink to a height that keeps the slot under the page budget', () => {
    const mm = Fit.fitHeightMm({ n: 4, pic: 45 });
    expect(mm).toBe(33);
    expect(Fit.slotHeightMm({ n: 4, pic: mm })).toBeLessThanOrEqual(245);
  });
  test('null when the fit would go under 70% of the default', () => {
    expect(Fit.fitHeightMm({ n: 6, pic: 62 })).toBeNull();
  });
});

describe('fitAttr', () => {
  test('empty for items without a picture or inside a speech bubble', () => {
    expect(Fit.fitAttr([{}, {}])).toBe('');
    expect(Fit.fitAttr([pic('scene'), pic('scene'), pic('scene'), pic('scene')], { bubble: true })).toBe('');
  });
  test('a style attribute only, never a class', () => {
    expect(Fit.fitAttr(Array(4).fill(pic('scene')))).toBe(' style="--pic-fit:33mm"');
  });
});

describe('soloScene', () => {
  test('one scene outside a frame and a bubble', () => {
    expect(Fit.soloScene([pic('scene')])).toBe(true);
    expect(Fit.soloScene([pic('scene')], { frame: true })).toBe(false);
    expect(Fit.soloScene([pic('scene')], { bubble: true })).toBe(false);
    expect(Fit.soloScene([pic('scene'), pic('scene')])).toBe(false);
    expect(Fit.soloScene([pic('object')])).toBe(false);
  });
});

describe('groupRows', () => {
  const cells = (n) => Array.from({ length: n }, (_, i) => `<c${i}>`);
  const tail = (html) => html.slice(html.indexOf('<div class="pic-tail">'));
  test('nine cells make three lines, the last two inside the tail', () => {
    const html = Fit.groupRows(cells(9));
    expect((html.match(/pic-row/g) || []).length).toBe(3);
    expect((tail(html).match(/pic-row/g) || []).length).toBe(2);
  });
  test('seven cells never leave a lone cell: the tail holds the last two lines', () => {
    expect((tail(Fit.groupRows(cells(7))).match(/<c\d>/g) || []).length).toBe(4);
  });
  test('two lines or fewer are all one tail', () => {
    expect((Fit.groupRows(cells(4)).match(/pic-tail/g) || []).length).toBe(1);
    expect(Fit.groupRows(cells(2))).toBe('<div class="pic-tail"><div class="pic-row"><c0><c1></div></div>');
  });
});
