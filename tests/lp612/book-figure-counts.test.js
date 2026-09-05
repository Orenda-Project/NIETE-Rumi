/**
 * THE BRIEF MUST NOT CONTRADICT ITSELF ABOUT WHETHER A BOOK FIGURE COUNTS — bd-8lifl.
 *
 * PR #622 changed `visual_check.js` so a `textbook_figure` counts toward V1's two in-body
 * figures and satisfies V2 at the point of use, "exactly as a drawn `diagram` does", and §4b.1
 * of the author brief was rewritten at length to match — including the worked example of the
 * Grade 11 Biology cell-membrane lesson that drew two text boxes while the book's Fig 1.10 sat
 * staged in R2.
 *
 * §4b.4 item 4 was not touched. It still says, verbatim, in every brief:
 *
 *     4. **`textbook_figure` does not count toward §4b.1's two `diagram` blocks**
 *
 * So the model is handed both sentences in one prompt, and the stale one sits in the section
 * headed "COPY THESE, do not invent fields" — closer to the point of decision than the
 * corrected one.
 *
 * What the 2026-09-05 representative batch measured (bd-8lifl, 16 lessons, 56 diagrams): the
 * planner named a crop, the crop was verified present in R2, and the model drew something else
 * instead on at least seven lessons — d07 (the p.42 ocean-currents map, while the lesson's own
 * WE DO tells the teacher "find the Gulf Stream on the figure"), d11 (Fig 6.9, while the
 * Activity heading is literally "LABELLING FIG. 6.9" and the exam bank awards four marks for
 * it), d14 (the Sparta crop, so a compare-and-contrast lesson shows Athens twice and Sparta
 * never), d17 (the SDG-6 infographic, while the hook quotes a number that exists only inside
 * it), d04, d08 and d09.
 *
 * Red-first: every assertion below fails on this branch's base — the stale sentence is present
 * in all four vendored briefs and all five canon briefs.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');

const BRIEFS = [
  'brief_author_v3.md',
  'brief_author_v3_flash_maths.md',
  'brief_author_v3_flash_sci.md',
  'brief_author_v3_flash_prose.md',
];

/** The stale claim, matched loosely enough to survive re-wrapping. */
const STALE = /textbook_figure`?\*{0,2}\s*\*{0,2}does\s+not\s+count\s+toward/i;

/**
 * §4b.1 legitimately QUOTES the superseded rule while explaining why it changed
 * ("The rule used to read *\"`textbook_figure` does NOT count toward this two\"*"), so a
 * whole-file search reports that history note as a live instruction. The assertion is about
 * what §4b.4 tells the model to do, so it is scoped to §4b.4 onward.
 */
function section4b4(src) {
  const i = src.indexOf('4b.4');
  if (i < 0) throw new Error('§4b.4 not found — the brief has been restructured');
  return src.slice(i);
}

describe('§4b.4 no longer contradicts §4b.1 about the ≥2 figure floor', () => {
  it.each(BRIEFS.map((b) => [b]))(
    '%s does not tell the model a book figure fails to count',
    (file) => {
      expect(section4b4(fs.readFileSync(path.join(V, file), 'utf8'))).not.toMatch(STALE);
    },
  );

  it.each(BRIEFS.map((b) => [b]))(
    '%s states positively that a book figure DOES count',
    (file) => {
      const src = fs.readFileSync(path.join(V, file), 'utf8');
      // §4b.1's box already says it; §4b.4 must agree rather than stay silent, because §4b.4
      // is the section the model works from when it emits a spec.
      expect(section4b4(src)).toMatch(/textbook_figure`?\*{0,2}\s*\*{0,2}counts?\s+toward/i);
    },
  );

  it.each(BRIEFS.map((b) => [b]))(
    '%s keeps the half of the old rule that was right — it satisfies a §4b.2 labelled_figure row',
    (file) => {
      const src = fs.readFileSync(path.join(V, file), 'utf8');
      expect(section4b4(src)).toMatch(/labelled_figure/);
    },
  );

  it('§4b.1 and §4b.4 agree — the same claim, not two', () => {
    const src = fs.readFileSync(path.join(V, 'brief_author_v3.md'), 'utf8');
    expect(src).toMatch(/A BOOK FIGURE COUNTS/);          // §4b.1 says it
    expect(section4b4(src)).not.toMatch(STALE);           // §4b.4 no longer denies it
    expect(section4b4(src)).toMatch(/COUNTS toward/);     // and says so itself
  });
});
