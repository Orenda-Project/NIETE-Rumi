/**
 * `underfilled_pages` — the honest half of bd-5jaag.
 *
 * The operator, three times: "too much space left empty, we should be accounting for all the
 * space in the LP" / "English too has wasted white space" / "Urdu has similar feedback to
 * english and Math with ... space wasted".
 *
 * The packer now pays down whitespace as far as the content allows, but it CANNOT reach a deep
 * trough: a page at 25% is sixty points short of the floor, and the page in front of it may
 * only give up fifteen before it becomes a hole itself. Those are structural — a tall atom
 * that shares with nothing — and they come out of the AUTHORING, not out of the packer.
 *
 * So the render report has to name them rather than let a clean-looking render imply the
 * document is clean. Two rules, both of them the operator's own words ("no page under ~85%
 * except the last page of each part"):
 *   - the threshold is the SAME constant the packer optimises against, so the report and the
 *     packer can never disagree about what counts as a hole;
 *   - the LAST page of each part is exempt, because it is the one page nothing can be pulled
 *     back onto without opening a hole further up.
 * `[]` on a clean document, never absent — an absent field reads as "not measured" (rule 24b).
 */

const { underfilledPages, FILL_TARGET_PCT } = require('../../bot/vendor/lp-v9/render_lp.js');

/** A probe page, as `probe.pages` carries it: fill is contentBottomPx / footTopPx. */
const P = (id, part, fillPct, box = 1000) =>
  ({ id, part, contentBottomPx: Math.round((fillPct / 100) * box), footTopPx: box });

describe('underfilled_pages', () => {
  it('uses the packer\'s own floor as the threshold', () => {
    expect(FILL_TARGET_PCT).toBe(85);
  });

  it('is an empty list for a document whose every page clears the floor', () => {
    const pages = [P('t1', 'teach', 99), P('t2', 'teach', 85), P('s1', 'support', 90)];
    expect(underfilledPages(pages)).toEqual([]);
  });

  it('names each page still under the floor, with its measured fill', () => {
    // English_seg2 in miniature: a mid-document trough the packer could not feed.
    const pages = [P('t1', 'teach', 96), P('t2', 'teach', 39), P('t3', 'teach', 92)];
    expect(underfilledPages(pages)).toEqual([{ id: 't2', part: 'teach', fill: 39 }]);
  });

  it('exempts the LAST page of each part, not just the last page of the document', () => {
    // English_seg7: four full teach pages and an 8% fifth. The 8% page ends its part, so it is
    // reported by `page_fill_pct` and NOT as a defect here; the 60% support page is a defect.
    const pages = [
      P('t1', 'teach', 92), P('t2', 'teach', 93), P('t3', 'teach', 99), P('t4', 'teach', 8),
      P('s1', 'support', 60), P('s2', 'support', 30),
    ];
    expect(underfilledPages(pages)).toEqual([{ id: 's1', part: 'support', fill: 60 }]);
  });

  it('treats a part of one page as all last page — a single-page part is never a defect', () => {
    expect(underfilledPages([P('t1', 'teach', 12)])).toEqual([]);
  });

  it('returns [] rather than throwing when the probe did not run', () => {
    expect(underfilledPages(null)).toEqual([]);
  });
});
