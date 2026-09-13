/**
 * bd-fa86m — TWO LABELS ON A NUMBER LINE MAY NOT SIT ON TOP OF EACH OTHER.
 *
 * Operator, on `grade_6_mathematics_c06_p99_en.pdf`: *"math one, number line diagram is bleeding
 * into one another on page 3/6"*. Page 3's figure is a `numberline` from 0 to 10 carrying three
 * marked points, and their labels are sentences, not tick numbers:
 *
 *     3  ->  "3 apples = 1 melon"
 *     6  ->  "8 apples, after removing 2 from the right pan"
 *     8  ->  "8 apples, right pan"
 *
 * `numberline.js` drew every point label centred on its own tick at one fixed row, `axisY - 14`,
 * and reserved a flat 26px for all of them together. At 640px wide with 10 steps a tick is ~56px
 * apart, and the middle label alone measures ~250px — so the three overlapped into a smear. The
 * renderer never measured a label, never compared two, and had no second row to move one to.
 *
 * THE CHECK IS ON THE EMITTED SVG, not on the module's own arithmetic. `lib/measure.js` says it
 * plainly: *"a type module can believe whatever it likes about its own arithmetic; what ships is
 * the string, and the string is what gets checked"*. `checkOverlaps` parses that string, resolves
 * transforms, and reports every collision in it — so this suite cannot pass by agreeing with the
 * bug.
 *
 * The three cases below are the three ways this goes wrong: long labels on adjacent ticks (hers),
 * a label wide enough to run off the drawing entirely, and Urdu labels, which are laid out through
 * a foreignObject on a different path and would otherwise keep the old behaviour silently.
 */

const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const numberline = require(path.join(V, 'diagrams', 'types', 'numberline.js'));
const { checkOverlaps } = require(path.join(V, 'diagrams', 'lib', 'measure.js'));

/**
 * EVERY collision in the emitted SVG, as readable pairs — not just `text-text`.
 *
 * Untangling the labels from each other exposed the second half of the same complaint: the jump
 * arc leaves the line AT a marked point and returns AT another, so near its ends it runs straight
 * through those points' labels — reported as `line-text`. Raising the arc cannot fix that, because
 * its endpoints are fixed by what the arc means. `lib/measure.js` names the remedy and this suite
 * holds the renderer to it: *"A line that crosses a label is a collision UNLESS the label sits on
 * an opaque plate that is painted after the line"*. So the assertion is on the whole report.
 */
function collisions(svg) {
  return checkOverlaps(svg).map((o) => `${o.kind}: ${o.a} ✕ ${o.b}  (${o.detail})`);
}

/** Page 3's figure, as the LP actually specified it. */
const HER_FIGURE = {
  type: 'numberline',
  from: 0,
  to: 10,
  step: 1,
  labelFormat: 'integer',
  width: 640,
  points: [
    { at: 3, label: '3 apples = 1 melon', style: 'dot' },
    { at: 6, label: '8 apples, after removing 2 from the right pan', style: 'dot' },
    { at: 8, label: '8 apples, right pan', style: 'dot' },
  ],
  arcs: [{ from: 8, to: 6, label: '− 2', above: true }],
  title: 'Number line',
  caption: '8 apples fall to 6 once 2 are removed from each pan.',
};

describe('a number line with sentence-length point labels', () => {
  test('no two labels overlap — the page-3 figure', () => {
    expect(collisions(numberline.render(HER_FIGURE))).toEqual([]);
  });

  test('every label stays inside the drawing', () => {
    // A label pushed off the left or right edge is not "not overlapping", it is gone.
    const svg = numberline.render(HER_FIGURE);
    const w = Number(svg.match(/viewBox="0 0 ([\d.]+)/)[1]);
    const { elementBoxes } = require(path.join(V, 'diagrams', 'lib', 'measure.js'));
    const escaped = elementBoxes(svg).boxes
      .filter((b) => (b.kind === 'text' || b.kind === 'fo') && (b.x < -0.5 || b.x + b.w > w + 0.5))
      .map((b) => `${b.text || '?'} at x=${Math.round(b.x)}..${Math.round(b.x + b.w)} of ${w}`);
    expect(escaped).toEqual([]);
  });

  test('the figure grows to hold the labels instead of cramming them', () => {
    // The flat 26px label zone is what forced one row. Three stacked rows need more than that,
    // so a renderer that still fits in the old height has not actually stacked anything.
    const one = numberline.render({ ...HER_FIGURE, points: [HER_FIGURE.points[0]] });
    const three = numberline.render(HER_FIGURE);
    const h = (s) => Number(s.match(/viewBox="0 0 [\d.]+ ([\d.]+)/)[1]);
    expect(h(three)).toBeGreaterThan(h(one));
  });
});

describe('the shapes that used to be fine stay fine', () => {
  test('short labels on far-apart ticks still share one row', () => {
    const svg = numberline.render({
      type: 'numberline', from: -5, to: 5, step: 1, labelFormat: 'integer', width: 640,
      points: [{ at: -3, label: 'start' }, { at: 1, label: 'end' }],
    });
    expect(collisions(svg)).toEqual([]);
    // Two short labels 4 units apart do not need stacking; the figure should not have grown.
    const bare = numberline.render({
      type: 'numberline', from: -5, to: 5, step: 1, labelFormat: 'integer', width: 640,
      points: [{ at: -3, label: 'start' }],
    });
    const h = (s) => Number(s.match(/viewBox="0 0 [\d.]+ ([\d.]+)/)[1]);
    expect(h(svg)).toBe(h(bare));
  });

  test('an interval label and a point label do not collide either', () => {
    const svg = numberline.render({
      type: 'numberline', from: -6, to: 6, step: 1, labelFormat: 'integer', width: 640,
      intervals: [{ from: -2, closedLeft: false, label: 'x is greater than minus two' }],
      points: [{ at: 3, label: 'the value we tested' }],
    });
    expect(collisions(svg)).toEqual([]);
  });

  test('Urdu labels are stacked too — the foreignObject path is not exempt', () => {
    const svg = numberline.render({
      type: 'numberline', from: 0, to: 10, step: 1, labelFormat: 'integer', width: 640, lang: 'ur',
      points: [
        { at: 3, label: 'تین سیب ایک خربوزے کے برابر ہیں' },
        { at: 6, label: 'دائیں پلڑے سے دو نکالنے کے بعد آٹھ سیب' },
        { at: 8, label: 'دائیں پلڑے میں آٹھ سیب' },
      ],
    });
    expect(collisions(svg)).toEqual([]);
  });

  test('the three shipped examples still draw clean', () => {
    for (const ex of numberline.examples) {
      expect({ [ex.name]: collisions(numberline.render(ex.spec)) }).toEqual({ [ex.name]: [] });
    }
  });
});
