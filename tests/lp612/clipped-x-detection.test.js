/**
 * `clipped_x` — the horizontal half of bd-km7vu.
 *
 * The renderer's in-page probe already measured VERTICAL overflow (`overflowPx`,
 * `overflowingSections`) and reported it into `<stem>.render.json`. It measured nothing
 * horizontal, which is how 189 TO PREPARE material chips over 40 characters, across 118 of 330
 * rendered lessons, printed truncated: `.mi{ white-space:nowrap; }` inside `.page{
 * overflow:hidden }` let a long chip grow wider than its container and silently lose everything
 * past the page's right edge. pdftotext proved the text was genuinely gone from the PDF, not
 * merely invisible on screen.
 *
 * `scrollWidth > clientWidth` (beyond a 1px rounding tolerance) is the standard DOM signal that
 * an element's own content is wider than the box it was given. The chip's own box does NOT
 * carry this signal — with `white-space:nowrap` its box just grows to fit the unwrapped text,
 * so it never overflows itself — the signal shows up on whichever ANCESTOR (`.mlist`, `.rmat`,
 * `.pad`, sometimes `.page`) actually has a constrained width. That is why the check scans
 * every element inside the page, not just the chip.
 *
 * `clippedXFromElements` is the pure core of the in-page PROBE's horizontal check, exported
 * so the tolerance and the reported shape have a real unit test: this repo's test harness runs
 * `testEnvironment: 'node'` (tests/jest.config.js) with no jsdom installed, so the PROBE's own
 * DOM traversal (`document.querySelectorAll`, `getBoundingClientRect`, real `scrollWidth`) can
 * only be exercised by an actual browser render — see the render verification in bd-km7vu's
 * report for that half. What IS testable without a DOM is the predicate and its output shape,
 * against synthetic `{scrollWidth, clientWidth, className, tagName, textContent}` objects — the
 * same duck-typed surface a real Element exposes. The in-page PROBE embeds this exact function
 * body via `.toString()` (bot/vendor/lp-v9/render_lp.js) rather than a hand-copied duplicate, so
 * there is one algorithm, never two that can drift apart.
 *
 * Red-first: on this branch's base, render_lp.js exports no `clippedXFromElements` and this
 * whole file throws on the `require`.
 */

const { clippedXFromElements } = require('../../bot/vendor/lp-v9/render_lp.js');

/** A synthetic element: only the surface the check actually reads. */
const el = (scrollWidth, clientWidth, extra = {}) =>
  ({ scrollWidth, clientWidth, className: '', tagName: 'DIV', textContent: '', ...extra });

describe('clippedXFromElements', () => {
  it('is empty when nothing overflows its box', () => {
    const elements = [el(200, 200), el(50, 120)];
    expect(clippedXFromElements('t1', elements)).toEqual([]);
  });

  it('flags an element whose content is wider than its own box', () => {
    const chip = el(252, 180, { className: 'mi', textContent: 'a real or homemade balance scale (a ruler resting on a pencil works as a fulcrum)' });
    expect(clippedXFromElements('t1', [chip])).toEqual([{
      page: 't1',
      selector: 'mi',
      scrollWidth: 252,
      clientWidth: 180,
      text: 'a real or homemade balance scale (a ruler resting on a penci',
    }]);
  });

  it('truncates the text sample to 60 characters', () => {
    const long = 'x'.repeat(200);
    const [hit] = clippedXFromElements('t1', [el(300, 100, { textContent: long })]);
    expect(hit.text).toHaveLength(60);
  });

  it('is NOT a false positive at exactly the 1px rounding tolerance', () => {
    expect(clippedXFromElements('t1', [el(101, 100)])).toEqual([]);
  });

  it('flags as soon as the overflow exceeds the 1px tolerance', () => {
    expect(clippedXFromElements('t1', [el(102, 100)])).toHaveLength(1);
  });

  it('never divides by a zero-width box (no layout box, no false positive)', () => {
    expect(clippedXFromElements('t1', [el(40, 0)])).toEqual([]);
  });

  it('prefers className for the selector, falls back to tagName when there is none', () => {
    const [hit] = clippedXFromElements('t1', [el(300, 100, { className: '', tagName: 'SPAN' })]);
    expect(hit.selector).toBe('SPAN');
  });

  it('stamps every hit with the page id it was found on', () => {
    const [hit] = clippedXFromElements('g1_ch8-t1', [el(300, 100)]);
    expect(hit.page).toBe('g1_ch8-t1');
  });
});

/**
 * bd-i8l8c — THE ELLIPSIS EXEMPTION.
 *
 * bd-9la73 promoted `clipped_x` from "reporting only" to a render-failing problem. A full
 * 335-document census then found it firing on 237 documents / 1,653 element instances, of
 * which 1,653 - 0 genuine = 98.7%+ were false positives, all on three selectors that are
 * DELIBERATE one-line clamps carrying `white-space:nowrap; overflow:hidden;
 * text-overflow:ellipsis` with a documented rationale in lib/template.js:
 *   .contstrip .ct  (bd-vvs8z: "the topic is printed in full in the hero on page 1")
 *   .foot .fl       ("footer to take no more than 2 lines pls")
 *   .vres a         (bd-a8veu.4: the video TITLE, clamped to one line)
 * Rasterised and read, each paints a clean ellipsis INSIDE its box; nothing reaches the page
 * edge and no text is lost — the ellipsis is the author's own signal that the run is elided.
 *
 * The mechanism is structural, not a tuning problem: `text-overflow:ellipsis` PAINTS a
 * marker, it does not reduce `scrollWidth`. An intentionally ellipsized run therefore
 * satisfies `scrollWidth - clientWidth > 1` BY CONSTRUCTION, so the raw predicate can never
 * tell "elided on purpose, with a visible ellipsis" from "sliced away with no signal".
 *
 * The exemption is therefore the conjunction the CSS itself uses to clamp: computed
 * `text-overflow: ellipsis` AND computed `overflow-x: hidden`. Either one alone is not a
 * clamp — ellipsis without hidden overflow paints nothing, hidden overflow without ellipsis
 * is exactly the silent slice bd-km7vu exists to catch — so both are required, and an
 * element that clips without an ellipsis still fires.
 *
 * Crucially this does NOT weaken bd-km7vu's genuine case. That signal never appears on the
 * `.mi` chip itself (nowrap grows the chip's own box, so it never overflows itself) — it
 * appears on the constrained ANCESTORS (`.mlist`, `.rmat`, `.pad`, `.page`), none of which
 * carries `text-overflow:ellipsis` anywhere in lib/template.js. Verified on the real corpus:
 * rendering all 335 documents against a tree with `.mi{white-space:nowrap}` restored reports
 * 545 instances on mi/mlist/rmat/pad/rescard, and every one of them still fires after this
 * exemption lands.
 *
 * The computed style is read through an injected reader, defaulting to the page's own
 * `getComputedStyle` — the same idiom the surrounding PROBE already uses for fontSize and
 * for `.pad`'s paddingBottom — so the function stays a pure, DOM-free predicate that this
 * `testEnvironment: 'node'` suite can exercise without jsdom.
 */
describe('clippedXFromElements — the deliberate-ellipsis exemption (bd-i8l8c)', () => {
  /** computed-style reader over a synthetic element's own `css` bag. */
  const cs = (e) => e.css || {};
  const clamped = { textOverflow: 'ellipsis', overflowX: 'hidden' };

  it('does not report a run deliberately clamped with text-overflow:ellipsis + overflow-x:hidden', () => {
    const ct = el(693, 408, { className: 'ct', textContent: 'a long topic', css: clamped });
    expect(clippedXFromElements('t1', [ct], cs)).toEqual([]);
  });

  it('still reports an element clipped with overflow-x:hidden and NO ellipsis — the silent slice', () => {
    const sliced = el(693, 408, { className: 'mlist', css: { textOverflow: 'clip', overflowX: 'hidden' } });
    expect(clippedXFromElements('t1', [sliced], cs)).toHaveLength(1);
  });

  it('still reports text-overflow:ellipsis when overflow-x is NOT hidden — an unclamped ellipsis paints nothing', () => {
    const notClamped = el(693, 408, { className: 'ct', css: { textOverflow: 'ellipsis', overflowX: 'visible' } });
    expect(clippedXFromElements('t1', [notClamped], cs)).toHaveLength(1);
  });

  it('preserves bd-km7vu: an ellipsized descendant does not exempt its non-ellipsized ancestors', () => {
    const elements = [
      el(1200, 408, { className: 'page', css: { textOverflow: 'clip', overflowX: 'hidden' } }),
      el(1200, 408, { className: 'pad', css: { textOverflow: 'clip', overflowX: 'visible' } }),
      el(1200, 408, { className: 'mlist', css: { textOverflow: 'clip', overflowX: 'visible' } }),
      el(60, 40, { className: 'fl', css: clamped }),
    ];
    expect(clippedXFromElements('t1', elements, cs).map((c) => c.selector))
      .toEqual(['page', 'pad', 'mlist']);
  });

  /**
   * Caught by mutation testing (bd-i8l8c): turning the exemption's `continue` into a `break`
   * survived the whole suite, because every existing case put the clamped element LAST. On a
   * real page the order is the opposite — `.contstrip .ct` sits at the top of every continued
   * page and `.mlist`/`.mi` come far below it — so a `break` there would have abandoned the
   * scan at the first clamp and silently destroyed bd-km7vu's entire genuine signal. The
   * exemption skips ONE element; it never ends the scan.
   */
  it('skips only the clamped element — a genuine slice AFTER it is still reported', () => {
    const elements = [
      el(693, 408, { className: 'ct', css: clamped }),
      el(1200, 408, { className: 'mlist', css: { textOverflow: 'clip', overflowX: 'visible' } }),
    ];
    expect(clippedXFromElements('t1', elements, cs).map((c) => c.selector)).toEqual(['mlist']);
  });

  it('exempts only the exact computed value "ellipsis" — "clip" and "fade" are not a clamp', () => {
    const fade = el(693, 408, { className: 'ct', css: { textOverflow: 'fade', overflowX: 'hidden' } });
    expect(clippedXFromElements('t1', [fade], cs)).toHaveLength(1);
  });

  it('an element the reader knows nothing about still fires (no style, no exemption)', () => {
    expect(clippedXFromElements('t1', [el(300, 100)], () => ({}))).toHaveLength(1);
  });
});

/**
 * bd-xn84e — SVG <text>/<tspan>: `clientWidth` DOES NOT track the scale an ancestor
 * `<svg viewBox>` applies, so `scrollWidth - clientWidth` is not a valid clip signal for it.
 *
 * Measured directly, not inferred: a controlled isolate at an exact known scale factor of 2
 * (a `<div style="width:200px">` wrapping `<svg viewBox="0 0 100 20" width="100%">`) showed
 * `clientWidth` landing on neither the pre-scale nor the post-scale advance width, while
 * `scrollWidth`/`getBoundingClientRect()` correctly tracked the real, post-scale pixel size.
 * On the real corpus this fired on all 8 diagram titles flagged by bd-xn84e — e.g. g1_ch10
 * Maths_seg4's title reports scrollWidth 373 / clientWidth 347 — yet a real Chromium
 * screenshot at the exact production viewport (520x2000, deviceScaleFactor 2, print media,
 * the real embedded Inter-Bold.ttf) shows that title fully inside its box with margin to
 * spare on both sides, for every one of the 8, including the largest reported gap (+73px).
 * scrollWidth/clientWidth themselves are unreliable for this element; getBoundingClientRect()
 * is not — it is what the screenshot check above confirms as ground truth, and it is
 * consistent between the text and its owning <svg> at any scale.
 *
 * The real clip boundary for SVG content is the owning <svg>'s own edge: this template's
 * diagram <svg> computes `overflow-x: hidden` (verified on the real render), so content
 * drawn past ITS edge is what a genuine silent slice looks like for a diagram — the same
 * "silent slice past a hidden-overflow box" bd-km7vu already catches for HTML chips, just
 * measured with the DOM API that is actually reliable for this element type.
 */
describe('clippedXFromElements — SVG text is measured by real geometry, not clientWidth (bd-xn84e)', () => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgText = (rect, ownerRect, extra = {}) => ({
    // scrollWidth/clientWidth set to what Chromium ACTUALLY reports for the g1 title (373/347)
    // — real, reproduced values, not a stand-in — so this stays a true red/green test: the old
    // code path (`cw > 0 && sw - cw > 1`) reads exactly these and DOES fire on them today. The
    // fix must stop reading them for this tag and use the geometry below instead.
    scrollWidth: 373, clientWidth: 347,
    className: '', tagName: 'text', textContent: '',
    namespaceURI: SVG_NS,
    getBoundingClientRect: () => rect,
    ownerSVGElement: { getBoundingClientRect: () => ownerRect },
    ...extra,
  });

  it('is NOT a false positive for a title that clientWidth flags but real geometry fits (g1_ch10 Maths_seg4)', () => {
    // Real measured values: svg bbox left=33/right=487 (width 454); text bbox
    // left=73.37/right=446.63 (width 373.27, scrollWidth 373, clientWidth 347 — a naive
    // scrollWidth>clientWidth check fires here; real geometry shows a ~40px margin each side.
    const text = svgText(
      { left: 73.37, right: 446.63, width: 373.27 },
      { left: 33, right: 487, width: 454 },
      { textContent: '3-D SHAPES: name + characteristics' },
    );
    expect(clippedXFromElements('t2', [text])).toEqual([]);
  });

  it('still flags an SVG text run that genuinely extends past its owning <svg>\'s edge', () => {
    const text = svgText(
      { left: 20, right: 500, width: 480 },
      { left: 33, right: 487, width: 454 },
      { textContent: 'a title that really does run off the diagram edge' },
    );
    const [hit] = clippedXFromElements('t2', [text]);
    expect(hit).toMatchObject({ page: 't2', scrollWidth: 480, clientWidth: 454 });
  });

  it('leaves ordinary HTML elements on the same scan using scrollWidth/clientWidth exactly as before', () => {
    const chip = el(252, 180, { className: 'mi', textContent: 'unaffected by the SVG branch' });
    expect(clippedXFromElements('t1', [chip])).toHaveLength(1);
  });
});
