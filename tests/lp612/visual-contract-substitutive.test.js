/**
 * bd-07bhi — A FIGURE REPLACES THE PROSE IT DRAWS. IT DOES NOT FOLLOW IT.
 *
 * Operator, on four sandbox renders and again on a fifth: *"all of them are 7 pages long"*, and
 * then, on what she actually wanted from the visuals: *"i wasnt asking you to cut words, i want
 * the text to be in readable diagrams, boxes or flow charts so that the LP can be reduced further
 * in page number"*.
 *
 * §4b.1 rule 1 sets a floor of two figures. Rule 3 told the model where to put them, and it read,
 * verbatim:
 *
 *     3. **At point of use** means: the block sits immediately after the `key_points` /
 *        `paragraph` / `worked_example` it illustrates, in the same section.
 *
 * Read literally — and a model reads literally — that is an instruction to state the content in
 * prose and then draw the same content underneath it. The page carries it twice and pays for it
 * twice. Every lever we have pulled to raise the visual count has therefore been a lever that
 * makes the lesson LONGER, which is the exact opposite of what the figures are for.
 *
 * Nothing machine-checked depends on the adjacency. `visual_check.js` V2 asserts only that some
 * in-body figure sits inside `development` or `activity` (the SECTION), never that a prose block
 * precedes it — so the brief is free to say the prose comes out, and the checker still passes.
 *
 * WHAT THIS SUITE PINS.
 *   1. The additive sentence is gone — from all four briefs, not just v3.
 *   2. The replacement instruction is present and unambiguous: the prose the figure carries is
 *      REMOVED, and at most a lead-in line survives beside it.
 *   3. The floor in rule 1 is explicitly not a floor on total content — meeting it by bolting two
 *      blocks onto a finished lesson is named as the failure mode.
 *   4. §4b.1 stays byte-identical across the four briefs. The three flash briefs are GENERATED
 *      upstream by `build_flash_brief.py`, which is not in this repo; a rule added to v3 alone is
 *      invisible to every flash-tier lesson, which is most of them.
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

const read = (f) => fs.readFileSync(path.join(V, f), 'utf8');

/** Just §4b.1, so an assertion cannot be satisfied by prose elsewhere in a 1,100-line brief. */
function floorSection(text) {
  const i = text.indexOf('### 4b.1');
  expect(i).toBeGreaterThan(-1);
  const j = text.indexOf('### 4b.2', i);
  expect(j).toBeGreaterThan(i);
  return text.slice(i, j);
}

/** The additive placement, matched loosely enough to survive re-wrapping. */
const ADDITIVE = /sits\s+immediately\s+after\s+the/i;

/**
 * The rules themselves, without the blockquotes.
 *
 * The brief's house style records WHY a rule changed by quoting the retired one — §4b.1.1 does it
 * for "`textbook_figure` does NOT count toward this two". So the old sentence is expected to
 * survive inside a blockquote, attributed. What must not survive is the old sentence standing as
 * an instruction, which is the only form a model acts on.
 */
const rulesOnly = (section) => section.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');

/** Line wrapping puts `> ` in the middle of a blockquote sentence; match across it. */
const wrapped = (phrase) => new RegExp(phrase.split(' ').join('\\s+(?:>\\s+)?'), 'i');

describe.each(BRIEFS)('%s · §4b.1 is substitutive', (brief) => {
  const s = () => floorSection(read(brief));

  test('the additive placement sentence no longer stands as an instruction', () => {
    // "the block sits immediately after the key_points it illustrates" — print both, pay twice.
    expect(rulesOnly(s())).not.toMatch(ADDITIVE);
  });

  test('the retired sentence is kept, but attributed as retired', () => {
    // Deleting the history invites the next author to reinstate it; leaving it bare instructs.
    const t = s();
    expect(t).toMatch(ADDITIVE);
    expect(t).toMatch(/The rule used to read/);
  });

  test('the prose the figure carries is removed, not kept above it', () => {
    const t = s();
    // The instruction has to name the removal. "put it near the prose" is what we are replacing.
    expect(t).toMatch(/instead of\*{0,2} the prose|in place of the prose/i);
    expect(t).toMatch(/that prose comes out|is removed|cut the prose/i);
  });

  test('printing the figure under prose that already says it is named as a duplicate', () => {
    expect(s()).toMatch(/duplicate/i);
  });

  test('at most a lead-in line survives beside the figure', () => {
    const t = s();
    expect(t).toMatch(/lead-in/i);
    // The two shapes that were actually showing up above the figures.
    expect(t).toMatch(/key_points/);
    expect(t).toMatch(/paragraph/);
  });

  test('the floor is a floor on figures, not a licence to add content', () => {
    const t = s();
    expect(t).toMatch(/floor on \*{0,2}FIGURES\*{0,2}, not/i);
    expect(t).toMatch(wrapped('adding two blocks to a finished lesson'));
  });

  test('the rest of the floor survives — the book figure, the board, the seven rules', () => {
    const t = s();
    expect(t).toMatch(/A BOOK FIGURE COUNTS/);
    expect(t).toMatch(/`page2\.board_final\.diagram` is required/);
    expect(t).toMatch(/Never emit `\{"type":"illustrative"\}`/);
    // Seven numbered rules, still seven. (A blockquote line starts with `>`, so it cannot count.)
    expect(t.match(/^\d\. /gm)).toHaveLength(7);
  });
});

test('§4b.1 is byte-identical in all four briefs — the flash fan-out', () => {
  // build_flash_brief.py lives upstream, so in-repo the patch is applied verbatim to all four.
  // A rule that reaches only v3 reaches only the pro tier.
  const [first, ...rest] = BRIEFS.map((b) => floorSection(read(b)));
  for (const [i, block] of rest.entries()) {
    expect(`${BRIEFS[i + 1]}:\n${block}`).toBe(`${BRIEFS[i + 1]}:\n${first}`);
  }
});
