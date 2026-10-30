/** Unit tests for fde-slot-fit (bd-5jmnfj.4.58.4): page fit numbers and row grouping. */
const Fit = require('../../bot/shared/services/assessment/fde-slot-fit');

const pic = (kind) => ({ picture: { kind } });

describe('fitHeightMm', () => {
  test('null when the default already fits', () => {
    expect(Fit.fitHeightMm({ n: 1, pic: 45 })).toBeNull();
  });
  test('four scenes shrink to a height that keeps the slot under the page budget', () => {
    const mm = Fit.fitHeightMm({ n: 4, pic: 45 });
    expect(mm).toBe(29); // was 33 with ITEM_MM 25; re-pinned with the measured 29.5 (bd-5jmnfj.4.58.9.1)
    expect(Fit.slotHeightMm({ n: 4, pic: mm })).toBeLessThanOrEqual(245);
  });
  test('null when the fit would go under 60% of the default', () => {
    expect(Fit.fitHeightMm({ n: 6, pic: 62 })).toBeNull();
  });
});

describe('fitAttr', () => {
  test('empty for items without a picture or inside a speech bubble', () => {
    expect(Fit.fitAttr([{}, {}])).toBe('');
    expect(Fit.fitAttr([pic('scene'), pic('scene'), pic('scene'), pic('scene')], { bubble: true })).toBe('');
  });
  test('a style attribute only, never a class', () => {
    expect(Fit.fitAttr(Array(4).fill(pic('scene')))).toBe(' style="--pic-fit:29mm"') // was 33mm, see ITEM_MM;
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

/*
 * bd-5jmnfj.4.58.9.1 (v37r4 G1 Urdu Q3/Q6/Q7): ITEM_MM was 25, but Chromium measures a picture item
 * (stem line, picture, one-line answer box, margins) at 29.1 mm without its picture, and the slot head at
 * 10.8 mm. Five objects fitted to "22 mm" therefore measured 272.5 mm, over the 263 mm a page holds, the
 * slot split 3 + 2, and `break-before: avoid` on the last item dragged item iv after it, leaving about
 * 95 mm blank on page 3 (and again on pages 6, 8 and 11). The fit now uses the measured overhead.
 */
describe('the fit uses the overhead Chromium measures (G1 Urdu, v37r4)', () => {
  const MEASURED_OVERHEAD = 29.1;
  const MEASURED_HEAD = 10.8;
  const PAGE_BODY_MM = 263 - 8; // A4 less margins and footer, less the slot's own margins
  const measured = (n, pic) => MEASURED_HEAD + n * (MEASURED_OVERHEAD + pic);

  test('five object pictures are fitted so the measured slot is one page', () => {
    const mm = Fit.fitHeightMm({ n: 5, pic: 28 });
    expect(mm).not.toBeNull();
    expect(measured(5, mm)).toBeLessThanOrEqual(PAGE_BODY_MM);
  });

  test('fitAttr gives the same for five picture items with a box', () => {
    const attr = Fit.fitAttr(Array(5).fill(pic('object')));
    const mm = Number((attr.match(/--pic-fit:(\d+)mm/) || [])[1]);
    expect(mm).toBeGreaterThan(0);
    expect(measured(5, mm)).toBeLessThanOrEqual(PAGE_BODY_MM);
  });
});

describe('wide sentence-box cells (G1 Urdu Q10, v37r4)', () => {
  // Measured: cell = 13.5 mm number line + picture, plus a 4 mm margin; the slot head is 10.8 mm.
  const measured = (n, pic) => 10.8 + n * (13.5 + 4 + pic);
  test('five wide cells are fitted so the measured slot is one page', () => {
    const mm = Fit.fitHeightMm({ n: 5, pic: 44, wide: true });
    expect(mm).not.toBeNull();
    expect(measured(5, mm)).toBeLessThanOrEqual(255);
  });
});
