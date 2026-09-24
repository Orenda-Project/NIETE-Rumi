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
