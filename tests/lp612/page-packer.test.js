/**
 * The lp-v9 page packer — bd-vvcna.
 *
 * The shipped packer was GREEDY FIRST-FIT: fill a page until the next atom does not fit,
 * then break, walking backwards over `glue`. Measured over 62 real lesson documents
 * (page_cap_decision_2026-09-04/card_ceilings/FINDING.md §4) that printed 582 pages where
 * 555 were needed, and left 5 parts over their cap while every one of them carried only
 * 89-96% of the paper its cap allows. Greedy pagination produces exactly that: a locally
 * fine early fit forces an avoidable page later.
 *
 * WHY greedy loses, precisely — because this is the whole design and the only thing the
 * replacement has to get right:
 *
 *   With a UNIFORM page box, greedy first-fit is already optimal for ordered items — taking
 *   the latest feasible break is an exchange argument, and greedy's backwards walk over glue
 *   lands on the latest LEGAL break, which is still optimal. So a uniform-capacity DP would
 *   buy literally nothing.
 *
 *   The box is NOT uniform. A continuation page pays the "…continued" strip, and a page that
 *   opens in the MIDDLE of a section also pays that section's repeated bar. So the box of
 *   page k+1 depends on WHICH atom opens it — and greedy, by stuffing page k as full as it
 *   can, chooses that opener blindly. Stopping one atom earlier so page k+1 opens on a
 *   section's own bar can buy back the whole repeated bar. That is where the pages are.
 *
 * These tests pin that, and pin every constraint the greedy packer honoured, so the exact
 * packer cannot buy a page by breaking something a reader needs kept together.
 */

const { packAtoms, packAtomsGreedy } = require('../../bot/vendor/lp-v9/render_lp.js');

/** Build an atom the way lib/template.js does, with the fields the packer reads. */
const A = (h, o = {}) => ({
  h,
  mt: o.mt || 0,
  glue: !!o.glue,
  soft: !!o.soft,
  sec: o.sec || null,
  first: !!o.first,
});

const pageCount = (r) => r.breaks.length + 1;

/** The atoms carried by each page of a packing, so tests can assert what got separated. */
function pagesOf(atoms, r) {
  const starts = [0, ...r.breaks];
  return starts.map((s, i) => atoms.slice(s, i + 1 < starts.length ? starts[i + 1] : atoms.length));
}

/**
 * The worst overflow in px across the multi-atom pages of a packing — how far past its own
 * box a page paints. Greedy can be positive here; the exact packer never is.
 */
function worstOverflowOf(atoms, r, cap, furn) {
  const starts = [0, ...r.breaks];
  let worst = 0;
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
    const page = atoms.slice(start, end);
    if (page.length < 2) return;
    const bar = r.pages[i].contBarSec;
    const box = start === 0 ? cap : cap - furn.strip - (bar ? furn.contBar[bar] : 0);
    const used = page.reduce((s, a, k) => s + a.h + (start + k === 0 ? 0 : a.mt), 0);
    worst = Math.max(worst, used - box);
  });
  return worst;
}

/** A deterministic pseudo-corpus of atom shapes, so a failure is reproducible by seed. */
const CORPUS = (() => {
  const rng = (seed) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out = [];
  for (let s = 1; s <= 300; s++) {
    const r = rng(s * 7919);
    const n = 3 + Math.floor(r() * 18);
    const atoms = [];
    let sec = 0;
    for (let i = 0; i < n; i++) {
      const startsSection = i === 0 || r() < 0.25;
      if (startsSection) sec++;
      atoms.push(A(10 + Math.floor(r() * 90), {
        mt: Math.floor(r() * 12),
        glue: startsSection || r() < 0.2,
        sec: `S${sec}`,
        first: startsSection,
      }));
    }
    const contBar = {};
    for (let k = 1; k <= sec; k++) contBar[`S${k}`] = 10 + Math.floor(r() * 30);
    out.push({ seed: s, atoms, furn: { strip: 5 + Math.floor(r() * 20), contBar } });
  }
  return out;
})();

describe('packAtoms — the exact page packer', () => {
  /**
   * THE HEADLINE. A section boundary that greedy overshoots.
   *
   * S1 = bar(10) + x1(30) + x2(20);  S2 = bar(10) + y1(30) + y2(30) + y3(25)
   * capacity 100, strip 5, S2's repeated bar 50.
   *
   * Greedy fills page 1 to exactly 100 by swallowing S2's bar and its first body atom, so
   * page 2 has to open MID-S2 and pays the 50px repeated bar — a 45px box that then holds
   * one atom at a time. Three pages.
   *
   * Breaking one atom earlier — at the end of S1, which is a perfectly legal break — lets
   * page 2 open on S2's OWN bar, which repeats nothing: a 95px box that takes all of S2.
   * Two pages, same content, same rules.
   */
  const SECTION_BOUNDARY = [
    A(10, { sec: 'S1', first: true, glue: true }),
    A(30, { sec: 'S1' }),
    A(20, { sec: 'S1' }),
    A(10, { sec: 'S2', first: true, glue: true }),
    A(30, { sec: 'S2' }),
    A(30, { sec: 'S2' }),
    A(25, { sec: 'S2' }),
  ];
  const FURN = { strip: 5, contBar: { S1: 50, S2: 50 } };

  it('does not spend a page to open the next one mid-section (greedy needs 3, two suffice)', () => {
    // The shipped greedy behaviour, asserted so the premise of this test cannot rot silently.
    const greedy = packAtomsGreedy(SECTION_BOUNDARY, 100, FURN);
    expect(pageCount(greedy)).toBe(3);
    expect(greedy.breaks).toEqual([5, 6]);

    const packed = packAtoms(SECTION_BOUNDARY, 100, FURN);
    expect(pageCount(packed)).toBe(2);
    expect(packed.breaks).toEqual([3]);
    // page 2 opens on S2's own bar, so it repeats nothing.
    expect(packed.pages[1].contBarSec).toBeNull();
  });

  it('returns the same shape the renderer already consumes', () => {
    const packed = packAtoms(SECTION_BOUNDARY, 100, FURN);
    expect(packed.pages).toEqual([
      { start: 0, contBarSec: null },
      { start: 3, contBarSec: null },
    ]);
    expect(packAtoms([], 100, FURN)).toEqual({ breaks: [], pages: [] });
  });

  describe('glue is never separated from what it is glued to', () => {
    /**
     * The temptation case. a1 is glued to a2; breaking between them fits the whole part on
     * two pages instead of three. A packer that treats glue as a preference takes that
     * trade and orphans a heading at the foot of a page. This one may not.
     */
    const TEMPTING = [A(10), A(50, { glue: true }), A(50), A(10)];

    it('will not buy a page by breaking a glued pair', () => {
      const packed = packAtoms(TEMPTING, 100, {});
      expect(pageCount(packed)).toBe(3);
      expect(packed.breaks).toEqual([1, 3]);
      // the pair travels together
      const [, second] = pagesOf(TEMPTING, packed);
      expect(second).toEqual([TEMPTING[1], TEMPTING[2]]);
    });

    it('keeps a whole glue CHAIN together, not just one pair', () => {
      const chain = [A(20), A(25, { glue: true }), A(25, { glue: true }), A(25, { glue: true }), A(25), A(60)];
      const packed = packAtoms(chain, 100, {});
      for (const b of packed.breaks) expect(chain[b - 1].glue).toBe(false);
    });

    it('still gives a glued atom taller than its own page that page (content is never dropped)', () => {
      // greedy's own escape hatch: the backwards walk stops rather than empty the page.
      const tall = [A(140, { glue: true }), A(60)];
      const packed = packAtoms(tall, 100, {});
      expect(pageCount(packed)).toBe(2);
      expect(packed.breaks).toEqual([1]);
      expect(packAtomsGreedy(tall, 100, {}).breaks).toEqual([1]);
    });
  });

  describe('per-page overhead is charged for the atom that OPENS the page', () => {
    // a0 is a section bar (glued), then two 40px body atoms of the same section.
    const midSection = [
      A(80, { sec: 'S', first: true, glue: true }),
      A(40, { sec: 'S' }),
      A(40, { sec: 'S' }),
    ];
    // identical, except the second atom opens a NEW section — so it is that section's own bar.
    const newSection = [
      A(80, { sec: 'S', first: true, glue: true }),
      A(40, { sec: 'T', first: true, glue: true }),
      A(40, { sec: 'T' }),
    ];
    const furn = { strip: 10, contBar: { S: 30, T: 30 } };

    it('a page opening MID-section pays the strip AND that section repeated bar', () => {
      const packed = packAtoms(midSection, 100, furn);
      // box = 100 - 10 strip - 30 bar = 60, so the two 40px atoms cannot share it.
      expect(pageCount(packed)).toBe(3);
      expect(packed.pages[1].contBarSec).toBe('S');
      expect(packed.pages[2].contBarSec).toBe('S');
    });

    it('a page opening on a section OWN bar pays the strip only', () => {
      const packed = packAtoms(newSection, 100, furn);
      // box = 100 - 10 strip = 90, so both 40px atoms fit.
      expect(pageCount(packed)).toBe(2);
      expect(packed.pages[1].contBarSec).toBeNull();
    });

    it('charges each section its OWN repeated bar, not a shared one', () => {
      const twoSecs = [
        A(90, { sec: 'S', first: true, glue: true }),
        A(40, { sec: 'S' }),
        A(40, { sec: 'S' }),
      ];
      const cheap = packAtoms(twoSecs, 100, { strip: 10, contBar: { S: 5 } });
      // box = 100 - 10 - 5 = 85 -> both body atoms share page 2
      expect(pageCount(cheap)).toBe(2);
      const dear = packAtoms(twoSecs, 100, { strip: 10, contBar: { S: 30 } });
      // box = 60 -> they cannot
      expect(pageCount(dear)).toBe(3);
    });
  });

  describe('top margins', () => {
    it('suppresses the top margin of the FIRST atom on page 1', () => {
      // 60 + 40 = 100 fits only because a0 top margin is not charged.
      const packed = packAtoms([A(60, { mt: 20 }), A(40)], 100, {});
      expect(pageCount(packed)).toBe(1);
    });

    it('charges the top margin of the first atom on a CONTINUATION page', () => {
      const atoms = [A(90), A(60, { mt: 20 }), A(20)];
      const packed = packAtoms(atoms, 95, {});
      // page 2 opens on a1 and keeps its 20px margin: 80 + 20 = 100 > 95, so a2 is pushed off.
      expect(pageCount(packed)).toBe(3);
      expect(packed.breaks).toEqual([1, 2]);
    });
  });

  /**
   * The tie-break is FRONT-LOADING — the fullest possible page, which is greedy's own rule.
   *
   * The brief asked for "keep pages evenly filled / avoid a near-empty final page", and the
   * measurement argued against it. Both even-fill variants were built and run over all 62
   * documents: Σ slack² levelled everything and dropped teach page 1 of grade_11_physics from
   * 1064px (full) to 741px for zero pages saved; counting pages under 70% full and then
   * front-loading was better but still re-broke 33 of 62 documents and, on c11, moved the
   * stranded page out of the END of the support part and into a 314px hole in the MIDDLE.
   *
   * Neither saved a page. So the shipped rule is the conservative one, and these tests pin
   * the property that makes it safe: wherever greedy was already page-optimal, the exact
   * packer reproduces greedy's breaks EXACTLY, and no break lands anywhere new.
   */
  describe('tie-break: front-loading, so no break lands where greedy would not have put one', () => {
    /**
     * bd-l7vig re-picked both atom shapes below (2026-09-23). The originals — [80,15,60] and
     * [60,40,50,50,15] — each totalled to LESS than the floor could ever reach across every
     * page including the last, so they were, without it being the point, ALSO cases of the
     * exact defect bd-l7vig fixes: the fill floor now legitimately outweighs front-loading for
     * them, and pins that belong to THAT behaviour now live in page-fill-floor.test.js instead.
     * These two keep the shapes but raise the final atom so every page clears the floor under
     * front-loading with no help needed — gapSq is zero either way, so the tie is front-loading's
     * alone to decide, which is what this describe block is actually testing.
     */
    it('packs the opening page as full as greedy did', () => {
      const atoms = [A(80), A(15), A(90)];
      const packed = packAtoms(atoms, 100, {});
      expect(pagesOf(atoms, packed).map((p) => p.reduce((s, a) => s + a.h, 0))).toEqual([95, 90]);
      expect(packed.breaks).toEqual(packAtomsGreedy(atoms, 100, {}).breaks);
    });

    it('leaves an already-full page alone rather than levelling', () => {
      // Σ slack² scored [60, 90, 65] best on the pre-bd-l7vig shape here and emptied the opening
      // page for nothing; that shape moved to page-fill-floor.test.js, where it is the floor's
      // job now. This shape keeps every page at/above the floor either way, so there is nothing
      // for gapSq to prefer and front-loading — not levelling — is what actually wins.
      const atoms = [A(60), A(40), A(50), A(50), A(90)];
      const packed = packAtoms(atoms, 100, {});
      expect(pagesOf(atoms, packed).map((p) => p.reduce((s, a) => s + a.h, 0))).toEqual([100, 100, 90]);
      expect(packed.breaks).toEqual(packAtomsGreedy(atoms, 100, {}).breaks);
    });

    /**
     * THE SAFETY ARGUMENT, narrowed to what is true since bd-5jaag (2026-09-23).
     *
     * Until the fill floor was added this asserted the strong form — wherever greedy was
     * already page-optimal, the exact packer reproduced greedy's breaks EXACTLY. The floor
     * deliberately breaks that on the documents the operator complained about ("too much space
     * left empty, we should be accounting for all the space in the LP"), so the strong form is
     * no longer the property we want; asserting it would only assert that the fix is absent.
     *
     * MEASURED over these 300 shapes, and what is asserted instead:
     *   - 45 of the 235 page-optimal, non-overflowing shapes now pack differently;
     *   - EVERY one of them is a shape where greedy had left a non-final page below the 85%
     *     floor. A document whose pages all clear the floor is NEVER re-broken — that is the
     *     grade_11_physics regression, and it is still zero;
     *   - the worst non-final page improves on 22 of the 45 and is made worse on NONE. That is
     *     the c11 regression (relieve one page by digging another), and it is also zero.
     */
    const fillsOfPages = (atoms, r, cap, furn) => {
      const starts = [0, ...r.breaks];
      return starts.map((start, i) => {
        const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
        const bar = r.pages[i].contBarSec;
        const box = start === 0 ? cap : cap - (furn.strip || 0) - (bar ? furn.contBar[bar] : 0);
        const used = atoms.slice(start, end)
          .reduce((t, a, k) => t + a.h + (start + k === 0 ? 0 : a.mt || 0), 0);
        return Math.round((100 * (cap - box + used)) / cap);
      });
    };
    const worstOfAll = (f) => Math.min(...f);

    /**
     * bd-l7vig narrowed this AGAIN. `worstNonFinal` — the worst page EXCLUDING the last one of
     * the part — was the right measure while the packer itself exempted the last page from the
     * floor; it is now the wrong measure, because that exemption was the defect. A document
     * whose four non-final pages all clear the floor and whose fifth does not (English_seg7,
     * to the pixel) used to read as "clean" by this metric and was never re-broken — which is
     * the whole bug. "Clean" now has to mean every page, final included, so `worstOfAll`
     * replaces `worstNonFinal` in both checks below.
     */
    it('only ever differs from greedy where greedy left a page under the fill floor', () => {
      const rebrokenThoughClean = [];
      const worsened = [];
      let differing = 0;
      for (const c of CORPUS) {
        const greedy = packAtomsGreedy(c.atoms, 200, c.furn);
        const packed = packAtoms(c.atoms, 200, c.furn);
        if (packed.breaks.length !== greedy.breaks.length) continue;   // greedy was not optimal
        if (worstOverflowOf(c.atoms, greedy, 200, c.furn) > 0) continue; // greedy cheated
        if (JSON.stringify(packed.breaks) === JSON.stringify(greedy.breaks)) continue;
        differing++;
        const before = fillsOfPages(c.atoms, greedy, 200, c.furn);
        const after = fillsOfPages(c.atoms, packed, 200, c.furn);
        if (worstOfAll(before) >= 85) rebrokenThoughClean.push(c.seed);
        if (worstOfAll(after) < worstOfAll(before)) worsened.push(c.seed);
      }
      expect(rebrokenThoughClean).toEqual([]);   // a document with every page already clear (final included) is never re-paginated
      expect(worsened).toEqual([]);              // the worst page anywhere in the document never gets worse
      expect(differing).toBeGreaterThan(0);      // ...and the floor is actually doing something
    });
  });

  describe('invariants against the shipped greedy packer', () => {
    /**
     * Greedy can "fit" more than its page holds. After the backwards walk over glue it
     * re-accumulates the page's atoms WITHOUT re-checking the cap, so the page silently
     * overflows — content painted past the page's own bottom edge. Measured here: on 58 of
     * these 300 shapes greedy uses fewer pages than the exact packer, and in all 58 it is
     * because greedy overflowed. So the honest invariant is conditioned on greedy having
     * produced a legal packing in the first place.
     */
    it('never needs more pages than greedy, wherever greedy stayed inside its own pages', () => {
      const worse = CORPUS.filter((c) => {
        const greedy = packAtomsGreedy(c.atoms, 200, c.furn);
        if (worstOverflowOf(c.atoms, greedy, 200, c.furn) > 0) return false;
        return pageCount(packAtoms(c.atoms, 200, c.furn)) > pageCount(greedy);
      });
      expect(worse.map((c) => c.seed)).toEqual([]);
    });

    it('the extra pages it does take are only ever where greedy overflowed a page', () => {
      const unexplained = CORPUS.filter((c) => {
        const greedy = packAtomsGreedy(c.atoms, 200, c.furn);
        return pageCount(packAtoms(c.atoms, 200, c.furn)) > pageCount(greedy)
          && worstOverflowOf(c.atoms, greedy, 200, c.furn) === 0;
      });
      expect(unexplained.map((c) => c.seed)).toEqual([]);
    });

    it('never orphans a glued atom on a page that holds more than that one atom', () => {
      const offenders = [];
      for (const c of CORPUS) {
        const packed = packAtoms(c.atoms, 200, c.furn);
        const starts = [0, ...packed.breaks];
        packed.breaks.forEach((b, i) => {
          if (c.atoms[b - 1].glue && b - 1 !== starts[i]) offenders.push({ seed: c.seed, at: b });
        });
      }
      expect(offenders).toEqual([]);
    });

    it('never drops, duplicates or reorders an atom, and its breaks ascend', () => {
      for (const c of CORPUS) {
        const packed = packAtoms(c.atoms, 200, c.furn);
        expect(packed.breaks).toEqual([...packed.breaks].sort((x, y) => x - y));
        expect(new Set(packed.breaks).size).toBe(packed.breaks.length);
        expect(packed.pages.map((p) => p.start)).toEqual([0, ...packed.breaks]);
        expect(pagesOf(c.atoms, packed).flat()).toEqual(c.atoms);
      }
    });

    it('never paints a multi-atom page past its own box (greedy could, after a walk-back)', () => {
      for (const c of CORPUS) {
        const packed = packAtoms(c.atoms, 200, c.furn);
        const starts = [0, ...packed.breaks];
        pagesOf(c.atoms, packed).forEach((page, i) => {
          if (page.length < 2) return;
          const start = starts[i];
          const box = start === 0
            ? 200
            : 200 - c.furn.strip - (packed.pages[i].contBarSec ? c.furn.contBar[packed.pages[i].contBarSec] : 0);
          const used = page.reduce((s, a, k) => s + a.h + (start + k === 0 ? 0 : a.mt), 0);
          expect(used).toBeLessThanOrEqual(box);
        });
      }
    });
  });
});

/**
 * bd-usirc — A SOFT SEAM: PREFER NOT TO BREAK HERE, NEVER AT THE COST OF A PAGE.
 *
 * `glue` is nearly hard: a break after a glued atom is legal only when that atom stands alone
 * on its page, so gluing two atoms that a reader wants together BUYS A PAGE whenever the pair
 * does not fit where it lands. Measured on the 38-lesson G1-5 corpus, gluing the one opening
 * box's two bands cost +7 pages -- while on A4 the packer was splitting that box and leaving
 * 500px of blank underneath it, because at an equal page count the comparator front-loads.
 *
 * `soft` is the missing middle: a break after it is always legal, and is counted. Ranked below
 * `pages` it can never buy paper; ranked above `used` it wins every tie that front-loading used
 * to win. An atom that does not declare it is packed exactly as before.
 */
describe('a soft seam', () => {
  test('the break moves off the seam when that costs no page', () => {
    // 130px over a 100px box needs two pages either way. Front-loading would fill page 1 to 80
    // and break on the seam; the seam is worth more than the 30px.
    const r = packAtoms([A(50), A(30, { soft: true }), A(30), A(20)], 100);
    expect(pageCount(r)).toBe(2);
    expect(r.breaks).toEqual([1]);
  });

  test('but the seam breaks rather than spend a page', () => {
    // 155px over a 100px box: the only two-page packing puts the break on the seam, because
    // 45 + 60 does not fit. A soft seam yields; it is a preference, not a constraint.
    const r = packAtoms([A(50), A(45, { soft: true }), A(60)], 100);
    expect(pageCount(r)).toBe(2);
    expect(r.breaks).toEqual([2]);
  });

  test('an atom that declares neither flag packs exactly as it always did', () => {
    const plain = [A(50), A(30), A(30), A(20)];
    expect(packAtoms(plain, 100).breaks).toEqual([2]);
  });
});
