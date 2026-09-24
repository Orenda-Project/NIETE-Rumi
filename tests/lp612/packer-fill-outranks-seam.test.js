/**
 * THE FILL FLOOR OUTRANKS THE SOFT SEAM — bd-2hmag part B.
 *
 * The operator, a FOURTH time: "fix the wasted white space too".
 *
 * MEASURED over the 330-lesson rendered corpus: 1039 of 2016 non-final pages sit below the
 * renderer's own 85% floor, and 233 of the 610 worst cases are atoms that are ALREADY as small
 * as an atom can be — the `pc-m`/`pc-z` pieces of an already-split worked example or practice
 * block, one turn or one item each, 130-313 characters of HTML. Those single sentences sit
 * against holes of 300-868px on the PRECEDING page. A one-line sentence cannot be taller than a
 * 300px hole, so no amount of finer splitting reaches them. The cause is not atom granularity,
 * it is WHERE THE FILL FLOOR SAT IN THE OBJECTIVE.
 *
 * `better()` in `packAtoms` ranked, lexicographically:
 *     pages < orphans < splits < over < gapSq < used
 * `gapSq` IS the fill floor and it sat second from last, BELOW `splits` — so the DP would
 * knowingly accept a much worse hole on one page rather than take a single extra break after a
 * `soft` atom anywhere in the sequence. `soft` is by construction a seam where a break is always
 * legal (see the `a soft seam` block in page-packer.test.js); it is a preference, and it was
 * outranking the operator's own rule.
 *
 * SHIPPED ORDER:  pages < orphans < over < gapSq < splits < used
 *
 * The three terms that had to stay above the floor, and why each one is pinned below:
 *   - `pages`   filling pages by ADDING pages is not a fix. The operator wants FEWER pages
 *               ("22-24 pages no teacher will read", "we cant go beyond 8").
 *   - `over`    overflow is a broken render — five lessons already fail to produce a PDF on
 *               vertical overflow (bd-p0nzj) and the packer must not add to them. It also moves
 *               ABOVE `splits` here, which is a second, separate defect the old order carried:
 *               the packer would spend the renderer's 12px absorb allowance, for no page saved,
 *               purely to dodge a seam (see `f_slack` below).
 *   - `orphans` an orphaned heading is the failure mode the atom contract exists to eliminate.
 *
 * WHAT DOES NOT CHANGE: nothing is cut. This decides only where a break falls, never what is on
 * the page — every authored word survives either packing.
 */

const { packAtoms, computeBreaks, FILL_TARGET_PCT } = require('../../bot/vendor/lp-v9/render_lp.js');

const A = (h, o = {}) => ({
  h,
  mt: o.mt || 0,
  glue: !!o.glue,
  soft: !!o.soft,
  sec: o.sec || null,
  first: !!o.first,
});

const CAP = 1000;                 // a round page box, so a px reads as a tenth of a percent
const SLACK = 12;                 // OVERFLOW_ABSORB_MAX_PX — what the renderer actually passes

const pageCount = (r) => r.breaks.length + 1;

/** The printed fill of each page, in percent of a uniform (furniture-free) page box. */
function fillsOf(atoms, r, cap = CAP) {
  const starts = [0, ...r.breaks];
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
    const used = atoms.slice(start, end)
      .reduce((s, a, k) => s + a.h + (start + k === 0 ? 0 : a.mt), 0);
    return Math.round((100 * used) / cap);
  });
}

/** px on each page, so overflow can be asserted against the box rather than eyeballed. */
function usedOf(atoms, r) {
  const starts = [0, ...r.breaks];
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
    return atoms.slice(start, end)
      .reduce((s, a, k) => s + a.h + (start + k === 0 ? 0 : a.mt), 0);
  });
}

/**
 * The minimum number of pages this content can possibly occupy — computed independently of
 * `packAtoms`, so "the page count never rises" is checked against arithmetic rather than
 * against the packer's own opinion. Same feasibility rules: a page may hold more than one atom
 * only while it fits the box (+ slack), a single atom always gets its page, and a break after a
 * glued atom is legal only when that atom stood alone.
 */
function minPages(atoms, cap = CAP, slack = 0) {
  const n = atoms.length;
  const best = new Array(n + 1).fill(Infinity);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    let used = 0;
    for (let j = i; j < n; j++) {
      used += atoms[j].h + (j === 0 ? 0 : atoms[j].mt || 0);
      if (used > cap + slack && j > i) break;
      if (j + 1 < n && atoms[j].glue && j !== i) continue;
      best[i] = Math.min(best[i], 1 + best[j + 1]);
    }
  }
  return best[0];
}

/** A deterministic pseudo-random corpus, so a failure is always reproducible from its seed. */
function shapes(count, seed = 4242) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return [...Array(count)].map(() => {
    const n = 3 + Math.floor(rnd() * 12);
    return [...Array(n)].map(() => A(60 + Math.floor(rnd() * 700), {
      glue: rnd() < 0.06,
      soft: rnd() < 0.35,
    }));
  });
}

describe('the fill floor outranks a soft seam', () => {
  /**
   * THE CORPUS CASE, in miniature. A 700px block, then three one-turn `pc-m` pieces of an
   * already-split card, then a 600px block — 1660px over two 1000px pages either way.
   *
   * Front-loading plus seam-avoidance broke it [700] | [120+120+120+600]: a 70% page with a
   * 300px hole in it, sitting in front of a 96% page, chosen because every other two-page
   * packing costs one break after a `soft` atom. That IS the 233-case shape: pieces that cannot
   * be made any smaller, against a hole on the page in front of them.
   *
   * With the floor above the seam the packer takes the seam and the hole closes to 180px, split
   * evenly: 82% / 84%. Same two pages, same content, nothing cut.
   */
  const SEAM_VS_HOLE = [A(700), A(120, { soft: true }), A(120, { soft: true }),
    A(120, { soft: true }), A(600)];

  it('closes a 300px hole rather than keep a soft seam intact', () => {
    const packed = packAtoms(SEAM_VS_HOLE, CAP, {}, { slack: SLACK });
    expect(pageCount(packed)).toBe(2);                 // the page count never moves
    expect(packed.breaks).toEqual([2]);                // seam-avoidance alone gives [1]
    expect(fillsOf(SEAM_VS_HOLE, packed)).toEqual([82, 84]);
  });

  it('leaves no page under the floor here that the content could have covered', () => {
    const packed = packAtoms(SEAM_VS_HOLE, CAP, {}, { slack: SLACK });
    const fills = fillsOf(SEAM_VS_HOLE, packed);
    // 1660px over two pages cannot clear 85% anywhere; what it CAN do is stop being lopsided.
    expect(Math.max(...fills) - Math.min(...fills)).toBeLessThanOrEqual(5);
    expect(Math.min(...fills)).toBeGreaterThan(70);    // the old packing's worst page
  });

  /**
   * SEAM-AVOIDANCE WAS ALSO SPENDING THE RENDERER'S OVERFLOW ALLOWANCE. `over` used to sit
   * BELOW `splits`, so at an equal page count the DP would rather overfill a page by up to
   * OVERFLOW_ABSORB_MAX_PX than break after a `soft` atom. On this shape that produced
   * 101% / 33% / 82% — an overfull page AND a two-thirds-empty one — to save exactly one seam.
   *
   * The allowance exists to REMOVE A PAGE (bd-c3le6) and nothing else. Here it removes none, so
   * it must not be spent.
   */
  const SLACK_FOR_A_SEAM = [A(278), A(545, { soft: true }), A(182), A(328, { soft: true }),
    A(733), A(90)];

  it('does not spend the overflow allowance to dodge a seam', () => {
    const packed = packAtoms(SLACK_FOR_A_SEAM, CAP, {}, { slack: SLACK });
    expect(pageCount(packed)).toBe(3);
    expect(packed.breaks).toEqual([2, 4]);             // was [3, 4], with page 1 at 1005px
    expect(Math.max(...usedOf(SLACK_FOR_A_SEAM, packed))).toBeLessThanOrEqual(CAP);
    expect(fillsOf(SLACK_FOR_A_SEAM, packed)).toEqual([82, 51, 82]);
  });

  /**
   * `over` STAYS ABOVE `gapSq`, pinned in the one direction that can actually conflict.
   * 245 | 94 | 666 | 265 | 404 | 400 over three pages: overflowing page 1 to 1005px scores a
   * LOWER sum of squared deficits (235,261 vs 263,237) than any legal packing does. Overflow is
   * a broken render — five lessons already fail to produce a PDF on vertical overflow
   * (bd-p0nzj) — so the packer must take the worse fill and the intact page.
   */
  it('never overflows a page to even out the fill', () => {
    const atoms = [A(245), A(94, { soft: true }), A(666), A(265, { soft: true }),
      A(404), A(400, { soft: true })];
    const packed = packAtoms(atoms, CAP, {}, { slack: SLACK });
    expect(packed.breaks).toEqual([2, 4]);
    expect(Math.max(...usedOf(atoms, packed))).toBeLessThanOrEqual(CAP);
  });
});

describe('the terms that stay above the fill floor', () => {
  const CORPUS = shapes(400);

  it('never prints more pages than the content strictly requires', () => {
    for (const atoms of CORPUS) {
      const packed = packAtoms(atoms, CAP, {}, { slack: SLACK });
      expect(pageCount(packed)).toBe(minPages(atoms, CAP, SLACK));
    }
  });

  /**
   * The allowance buys a page back, or an ORPHAN back, and nothing else.
   *
   * The second half of that sentence is not a softening of the first, it is what `orphans`
   * sitting above `over` has always meant — in this order and in the one before it. Two shapes
   * out of 400 reach it: a glued 737px atom followed by a 274px one, and a glued 636px atom
   * followed by a 367px one. At slack 0 the glued atom can only stand alone (glue may be broken
   * only to stand alone on a page), which orphans it; twelve pixels of absorb let the next atom
   * join it — 1011px and 1003px on a 1000px box — and the orphan is gone at the same page count.
   * Verified identical under the pre-bd-2hmag.B ranking, so this is the packer's standing
   * contract and not something the fill floor bought.
   */
  it('never spends the overflow allowance unless it removes a page or an orphan', () => {
    // a break after a glued atom is legal only when it stood alone, so a page holding exactly
    // one glued non-final atom IS the orphan the atom contract was built to count
    const orphansOf = (atoms, packed) => {
      const starts = [0, ...packed.breaks];
      return starts.filter((s, i) => {
        const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
        return end - s === 1 && atoms[s].glue && end < atoms.length;
      }).length;
    };
    for (const atoms of CORPUS) {
      const tight = packAtoms(atoms, CAP, {}, { slack: 0 });
      const loose = packAtoms(atoms, CAP, {}, { slack: SLACK });
      if (pageCount(loose) !== pageCount(tight)) continue;    // the allowance did its job
      if (orphansOf(atoms, loose) < orphansOf(atoms, tight)) continue;   // so did it here
      const boxes = usedOf(atoms, loose);
      const starts = [0, ...loose.breaks];
      boxes.forEach((used, i) => {
        const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
        if (end - starts[i] === 1) return;    // a single atom taller than its page keeps it
        expect(used).toBeLessThanOrEqual(CAP);
      });
    }
  });

  it('never overflows a page at all when no allowance is granted', () => {
    for (const atoms of CORPUS) {
      const packed = packAtoms(atoms, CAP, {}, {});
      const starts = [0, ...packed.breaks];
      usedOf(atoms, packed).forEach((used, i) => {
        const end = i + 1 < starts.length ? starts[i + 1] : atoms.length;
        if (end - starts[i] === 1) return;
        expect(used).toBeLessThanOrEqual(CAP);
      });
    }
  });

  it('never orphans a glued atom to close a hole', () => {
    for (const atoms of CORPUS) {
      const packed = packAtoms(atoms, CAP, {}, { slack: SLACK });
      const starts = [0, ...packed.breaks];
      packed.breaks.forEach((b, i) => {
        // a break after a glued atom is legal ONLY when that atom stood alone on its page
        if (atoms[b - 1].glue) expect(b - starts[i]).toBe(1);
      });
    }
  });
});

describe('the v8 signature still speaks for the packer', () => {
  /** `computeBreaks(heights, capacity, contHeight)` builds atoms with no `soft` and no `glue`,
   *  so the demoted term is identically zero and its callers cannot be reached by this change. */
  it('packs a soft-free document exactly as the exact packer always did', () => {
    expect(computeBreaks([500, 450, 500, 450, 500, 450], CAP)).toEqual([2, 4]);
    expect(computeBreaks([400, 290, 560, 580], CAP)).toEqual([2, 3]);
  });

  it('agrees with packAtoms on every shape that declares no soft seam', () => {
    for (const atoms of shapes(120, 777)) {
      const plain = atoms.map((a) => ({ ...a, soft: false, glue: false }));
      const viaV8 = computeBreaks(plain.map((a) => a.h), CAP);
      expect(viaV8).toEqual(packAtoms(plain, CAP, {}).breaks);
    }
  });
});

describe('the floor the packer optimises is the floor the report names', () => {
  it('is the operator 85, in one place', () => {
    expect(FILL_TARGET_PCT).toBe(85);
  });
});
