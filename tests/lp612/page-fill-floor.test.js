/**
 * THE PAGE-FILL FLOOR — bd-5jaag.
 *
 * The operator, three times over one week:
 *   "too much space left empty, we should be accounting for all the space in the LP"
 *   "English too has wasted white space"
 *   "Urdu has similar feedback to english and Math with ... space wasted"
 *
 * MEASURED, from the `page_fill_pct` every render writes into its `.render.json` for the
 * g3-ch2-trio corpus: English_seg7 prints 5 pages and its last one carries 8% of the paper.
 * Maths_seg5 t4 25%, Maths_seg9 t8 34%, Maths_seg6 t7 34%, Urdu_seg5 t8 36%, English_seg2
 * t8 39%, English_seg3 t3 43%. The final page is usually the offender, plus scattered
 * mid-document troughs.
 *
 * The target is the operator's own, already written into render_lp.js's report comment:
 * "no page under ~85% except the last page of each part".
 *
 * WHY THIS IS A THIRD OBJECTIVE AND NOT A RERUN OF THE TWO THAT WERE REJECTED. packAtoms's
 * own header records both even-fill variants that were built, measured over 62 documents and
 * thrown away (2026-09-04):
 *
 *   - "Σ slack² over every page. It levels the whole document. It pulled teach page 1 of
 *      grade_11_physics from 1064px (full) down to 741px ... for ZERO pages saved."
 *      It scores EVERY page, so a full page always has something to give.
 *   - "The COUNT of pages under 70% full, then front-loading ... on c11 it removed the
 *      stranded page at the END of the support part by opening a 314px hole in the MIDDLE of
 *      it, which reads worse". It scored the LAST page like any other, so the only way it
 *      could improve the count was to move the hole somewhere worse.
 *
 * The third objective takes the operator's rule literally, including its exemption:
 *   1. `gapSq`  — Σ (px a NON-FINAL page falls short of the 85% floor)². Clamped at the floor,
 *                 so a page at or above it scores zero and there is no gradient pulling a full
 *                 page down (the Σ slack² defect). The final page is excluded, so a hole can
 *                 never be moved INTO the middle to relieve the end (the c11 defect) — that
 *                 trade always raises this term. Squared, so depth is paid down before
 *                 breadth and the fix reaches the WORST page rather than the average.
 *   2. `lastGap`— how far the FINAL page is below the floor. Ranked last, so the end page is
 *                 only ever filled with paper no middle page needed: the floor above it is
 *                 what stops this from becoming Σ slack².
 *
 * Both sit BELOW page count, orphans, soft seams and the slack allowance, and above
 * front-loading — so they can only ever decide ties front-loading used to decide, and the
 * page count can never rise.
 *
 * A COUNT of below-floor pages was tried above the depth term and rejected on measurement —
 * see 'shallows the worst hole rather than clearing one by digging another twice as deep'.
 */

const { packAtoms } = require('../../bot/vendor/lp-v9/render_lp.js');

const A = (h, o = {}) => ({
  h,
  mt: o.mt || 0,
  glue: !!o.glue,
  soft: !!o.soft,
  sec: o.sec || null,
  first: !!o.first,
});

const CAP = 1000;                 // a round page box, so a px reads as a tenth of a percent

/** The printed fill of each page, in percent of the page box, furniture included. */
function fillsOf(atoms, r, cap = CAP, furn = {}) {
  const starts = [0, ...r.breaks];
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
    const bar = r.pages[i].contBarSec;
    const box = start === 0 ? cap : cap - (furn.strip || 0) - (bar ? furn.contBar[bar] : 0);
    const used = atoms.slice(start, end)
      .reduce((s, a, k) => s + a.h + (start + k === 0 ? 0 : a.mt), 0);
    return Math.round((100 * (cap - box + used)) / cap);
  });
}

describe('the 85% fill floor', () => {
  /**
   * THE 8% PAGE, in miniature — RE-PINNED for bd-l7vig. Ten 100px atoms plus one 50px atom is
   * 1050px over two 1000px pages: 52.5% on average, well short of the 85% floor, so no even
   * split of this content can clear it on EITHER page. That used to matter to this term (the
   * final page was exempt, so front-loading won by default and the last page kept whatever was
   * left over, 900/150); now every page is charged on the same clamped square, so the DP
   * prefers 500/550 — not over the floor, which is structurally impossible here, but far closer
   * to even than one full page and one near-empty one. This IS English_seg7's shape, just
   * without English_seg7's slightly-richer 79%-average content (see the bd-l7vig test below,
   * which uses a total that DOES clear the floor on average, to pin the case where the fix
   * actually reaches 85%).
   */
  const STRANDED_TAIL = [...Array(10)].map(() => A(100)).concat(A(50));

  it('spreads a structural deficit close to evenly instead of stranding it on the final page', () => {
    const packed = packAtoms(STRANDED_TAIL, CAP, {});
    expect(packed.breaks.length + 1).toBe(2);              // the page count never moves
    expect(packed.breaks).toEqual([5]);                    // front-loading alone gives [10]
    expect(fillsOf(STRANDED_TAIL, packed)).toEqual([50, 55]);
  });

  it('does not overshoot the even split once it stops being cheaper', () => {
    // 50/55 is the minimum of the sum of squared deficits for this content; anything that moved
    // a further atom (e.g. 40/65) would widen the gap again for no reason the objective values.
    const packed = packAtoms(STRANDED_TAIL, CAP, {});
    const fills = fillsOf(STRANDED_TAIL, packed);
    expect(Math.max(...fills) - Math.min(...fills)).toBeLessThanOrEqual(5);
  });

  /**
   * THE c11 DEFECT, RE-PINNED for bd-l7vig. 500+400 | 400+500 | 160 sums to 1960 over three
   * 1000px pages: 65% on average, again short of the floor everywhere, so — like STRANDED_TAIL
   * above — no page here is exempt from the trade any more. The squared term still refuses the
   * ORIGINAL c11 defect (trading one hole for a WORSE one elsewhere, which is what the rejected
   * "count of pages under 70%" variant did — see the header comment); it simply no longer has a
   * standing reason to protect the LAST page in particular. For these atom sizes that means
   * 500 | 400+400 | 500+160 (50/80/66) scores lower than the old 500+400 | 400+500 | 160
   * (90/90/16): a 350px deficit plus a 190px one costs less, squared, than a lone 690px one.
   */
  it('spreads a structural deficit toward the front rather than stranding it on one page', () => {
    const atoms = [A(500), A(400), A(400), A(500), A(160)];
    const packed = packAtoms(atoms, CAP, {});
    expect(packed.breaks.length + 1).toBe(3);
    expect(packed.breaks).toEqual([1, 3]);
    expect(fillsOf(atoms, packed)).toEqual([50, 80, 66]);
  });

  /**
   * THE grade_11_physics DEFECT, pinned. A document whose pages are all at or above the floor
   * is not re-broken at all: there is nothing for the new terms to score, and front-loading —
   * the rule the shipped packer has always used — still decides.
   */
  it('leaves a document that already clears the floor exactly where it was', () => {
    const atoms = [A(500), A(450), A(500), A(450), A(500), A(450)];
    const packed = packAtoms(atoms, CAP, {});
    expect(packed.breaks).toEqual([2, 4]);
    expect(fillsOf(atoms, packed)).toEqual([95, 95, 95]);
  });

  /**
   * A MID-DOCUMENT TROUGH is fed from the page in front of it, and only with paper that page
   * can spare. This is Maths_seg5 t2/t7 (74%/73%) and English_seg1 t1 (78%): a page a little
   * under the floor sitting behind a page front-loading stuffed to 95%.
   *
   * A DEEP trough is a different animal and this term cannot reach it — a page at 25% is 60
   * points short, and the page in front of it may only give up 15 before it becomes a hole
   * itself. Those are structural (a tall atom that shares with nothing) and the render report
   * says so rather than pretending otherwise.
   */
  it('lifts a shallow mid-document trough over the floor from the page in front of it', () => {
    // front-loading: [450+400+100] [300+450] [800] -> 95%, 75%, 80%
    // floor-aware:   [450+400] [100+300+450] [800] -> 85%, 85%, 80%, same three pages
    const atoms = [A(450), A(400), A(100), A(300), A(450), A(800)];
    const packed = packAtoms(atoms, CAP, {});
    expect(packed.breaks.length + 1).toBe(3);
    expect(packed.breaks).toEqual([2, 5]);
    expect(fillsOf(atoms, packed)).toEqual([85, 85, 80]);
  });

  /** The floor is charged on the PRINTED page, so a continuation page's furniture counts as
   *  filled space — which means shrinking that furniture (bd-yjmxh, concurrent) changes the
   *  arithmetic without this packer knowing anything about its height. */
  it('counts the continuation furniture as paper the page has already spent', () => {
    const furn = { strip: 200, contBar: {} };
    // page 2's box is 800; 700px of content on it prints as (200 furniture + 700) / 1000 = 90%.
    const atoms = [A(900), A(350), A(350), A(60)];
    const packed = packAtoms(atoms, CAP, furn);
    expect(packed.breaks).toEqual([1]);
    expect(fillsOf(atoms, packed, CAP, furn)).toEqual([90, 96]);
  });

  /** Page count is still the top term: the floor may never buy a page. */
  it('never spends a page to raise a fill', () => {
    const atoms = [A(400), A(400), A(120), A(120), A(60)];
    const packed = packAtoms(atoms, CAP, {});
    expect(packed.breaks.length + 1).toBe(2);
  });

  /**
   * THE COUNT REGRESSION, pinned — the reason the floor is scored by DEPTH and not by how many
   * pages are under it. Measured over the 300-shape packer corpus: ranking a COUNT of
   * below-floor pages above their depth made the WORST page of 12 shapes worse, e.g. seed 28
   * went from pages at 69/56/58% to 40/86/58% and seed 208 from 95/93/68/57/78/34% to
   * 95/93/33/93/78/34%. Both are the same trade: lift ONE hole over the floor by digging the
   * page in front of it twice as deep. The count calls that an improvement. The operator's
   * complaint is about the emptiest page on the desk, so it is a regression.
   *
   * 400 | 290 | 560 | 580 in a 1000px box packs three ways-round into three pages and only
   * two of them are legal:
   *   depth:  [400+290] [560] [580]  ->  69% 56% 58%   two shallow holes
   *   count:  [400]  [290+560]  [580] ->  40% 85% 58%   one hole, twice as deep
   * The packer must take the first.
   */
  it('shallows the worst hole rather than clearing one by digging another twice as deep', () => {
    const atoms = [A(400), A(290), A(560), A(580)];
    const packed = packAtoms(atoms, CAP, {});
    expect(packed.breaks.length + 1).toBe(3);
    expect(packed.breaks).toEqual([2, 3]);
    expect(fillsOf(atoms, packed)).toEqual([69, 56, 58]);
  });

  /** Orphan rules stay absolute: a glued atom is not separated to feed the last page. */
  it('never breaks glue to feed the final page', () => {
    const atoms = [A(300), A(300), A(300), A(80, { glue: true }), A(200)];
    const packed = packAtoms(atoms, CAP, {});
    for (const b of packed.breaks) expect(atoms[b - 1].glue).toBe(false);
  });

  /**
   * bd-l7vig, pinned. English_seg7 after the warm-up-method change: four pages front-loaded to
   * 89-99% and a FIFTH the first four could not have made room for by giving up a single atom
   * each — the part's total, spread evenly, clears the floor (86% here; 79% on the real
   * document, which is why the real fifth page still reads a little under 85 rather than over
   * it — see the file-level rationale comment on `gapSq` in render_lp.js).
   *
   * `lastGap`'s old exemption made the final page's own deficit invisible to the objective, so
   * once every non-final page cleared 85% the DP stopped looking — no matter how empty the last
   * page was, because nothing was left to optimise. Twenty 190px atoms front-load to 95% * 4
   * with a trailing 500px atom stranded alone at 50%. The fix prices the final page's shortfall
   * on the SAME clamped square as every other page, so the DP will now trade a shallow new
   * deficit on an earlier page (each atom pulled back costs at most 1 page 95% -> 76%, still a
   * printable page) for closing a deep one on the last (50% -> as high as the last page's own
   * capacity allows, 88% here, since it can absorb at most 2 more 190px atoms before it
   * overflows).
   */
  it('pulls content across MULTIPLE non-final pages to relieve a stranded final page (bd-l7vig)', () => {
    const atoms = [...Array(20)].map(() => A(190)).concat(A(500));
    const packed = packAtoms(atoms, CAP, {});
    expect(packed.breaks.length + 1).toBe(5);           // the page count never moves
    const fills = fillsOf(atoms, packed);
    expect(fills[4]).toBeGreaterThanOrEqual(85);         // was 50 — now at the operator's own floor
    // reaching it costs exactly two atoms, pulled off two DIFFERENT earlier pages (a single
    // page giving up both would pay a quadratically worse gapSq for the same relief)
    const nonFinal = fills.slice(0, 4);
    expect(nonFinal.filter((f) => f < 95).length).toBe(2);
    expect(Math.min(...nonFinal)).toBeGreaterThanOrEqual(70);
  });
});
