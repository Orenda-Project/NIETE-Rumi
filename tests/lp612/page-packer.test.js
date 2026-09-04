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
    it('packs the opening page as full as greedy did', () => {
      const atoms = [A(80), A(15), A(60)];
      const packed = packAtoms(atoms, 100, {});
      expect(pagesOf(atoms, packed).map((p) => p.reduce((s, a) => s + a.h, 0))).toEqual([95, 60]);
      expect(packed.breaks).toEqual(packAtomsGreedy(atoms, 100, {}).breaks);
    });

    it('leaves an already-full page alone rather than levelling', () => {
      // Σ slack² scored [60, 90, 65] best here and emptied the opening page for nothing.
      const atoms = [A(60), A(40), A(50), A(50), A(15)];
      const packed = packAtoms(atoms, 100, {});
      expect(pagesOf(atoms, packed).map((p) => p.reduce((s, a) => s + a.h, 0))).toEqual([100, 100, 15]);
      expect(packed.breaks).toEqual(packAtomsGreedy(atoms, 100, {}).breaks);
    });

    it('reproduces greedy exactly on every shape where greedy was already page-optimal', () => {
      // The whole safety argument for this change, asserted over the randomised corpus below.
      const differing = [];
      for (const c of CORPUS) {
        const greedy = packAtomsGreedy(c.atoms, 200, c.furn);
        const packed = packAtoms(c.atoms, 200, c.furn);
        if (packed.breaks.length !== greedy.breaks.length) continue;   // greedy was not optimal
        if (worstOverflowOf(c.atoms, greedy, 200, c.furn) > 0) continue; // greedy cheated
        if (JSON.stringify(packed.breaks) !== JSON.stringify(greedy.breaks)) differing.push(c.seed);
      }
      expect(differing).toEqual([]);
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
