/**
 * EVERY FIELD THE ENGINE READS IS A FIELD THE BRIEF PUBLISHES — bd-8lifl.
 *
 * bd-09m6a added a drift guard in ONE direction: every field the brief documents must be a field
 * some module actually reads (it caught `atom.compound` and `chem_equation.above`, both published
 * and read by nothing, both rendering a confident wrong picture). The other direction was never
 * guarded, and it is the more expensive one: a field the engine reads and the brief never names
 * is a capability the model cannot reach. Measured on this branch's base: **57 such fields across
 * 17 types.**
 *
 * Five of the 2026-09-05 batch's defects are that gap, not the model's judgement:
 *
 *   grid.cellText      d01 p8 — a 3×2 `grid` titled "سوال ۸ کا حل" rendered as six EMPTY boxes
 *                      with the answers exiled into the caption. `grid.js:130` reads `cellText`;
 *                      the brief has never contained the string.
 *   atom.Z             d05 p5 — "WHY THE CHROMIUM ION IS Cr3+" drew a HYDROGEN atom. Cr is not in
 *                      the built-in table, so Z fell through to 1. `Z` would have fixed it and the
 *                      brief never mentions `Z`.
 *   graph.segments     d10 p3/p6 — a vectors lesson with no arrow anywhere; `segments` draws the
 *                      straight line between two points and is undocumented.
 *   dna_helix.rungCount d12 p4 — two rungs, both A·T, on a lesson teaching A-T *and* G-C.
 *   punnett.showRatio  d11 p4 — "Phenotype ratio: 1 female (XX)" could not be suppressed.
 *
 * Red-first: fails on this branch's base for all 17 types.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const MANIFEST = require(path.join(V, 'diagrams', 'types_manifest.json'));

const BRIEFS = [
  'brief_author_v3.md',
  'brief_author_v3_flash_maths.md',
  'brief_author_v3_flash_sci.md',
  'brief_author_v3_flash_prose.md',
];

const BEGIN = '<!-- 4b.5:begin';
const END = '<!-- 4b.5:end -->';

/** Just the generated block — `indexOf('4b.5')` runs to end-of-file and swallows §4c onward. */
function appendix(src) {
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b + END.length);
}

/** Every field name any module reads, by type. */
function fieldsOf(t) {
  return [...(t.required || []), ...(t.optional || [])];
}

describe('the brief names every field the engine reads — reverse drift guard', () => {
  it.each(BRIEFS.map((b) => [b]))('%s publishes the complete field list', (file) => {
    const src = fs.readFileSync(path.join(V, file), 'utf8');
    const missing = [];
    for (const t of MANIFEST.types) {
      for (const f of fieldsOf(t)) {
        if (!src.includes(f)) missing.push(`${t.type}.${f}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the generated appendix exists and is marked as generated', () => {
    const src = fs.readFileSync(path.join(V, 'brief_author_v3.md'), 'utf8');
    expect(src).toMatch(/§?4b\.5/);
    expect(src).toMatch(/types_manifest\.json/);
  });

  it('the appendix lists every type in the manifest', () => {
    const src = fs.readFileSync(path.join(V, 'brief_author_v3.md'), 'utf8');
    const app = appendix(src);
    for (const t of MANIFEST.types) {
      expect(app).toContain(`\`${t.type}\``);
    }
  });

  it('the appendix carries each type\'s LIMITS, not just its field names', () => {
    // Round 2 of bd-8lifl. Publishing `grid.cellText` as a bare name was not enough: the model
    // wrote it as a 2-D array of rows, the code reads `[row, col, text]` TRIPLES, and
    // `const [r, c, txt] = t` then destructured a row of strings into a NaN position with
    // undefined text. d01's board grid went from "answers in the caption" to "answers nowhere".
    // A field name without its shape is a trap, and the manifest already holds the shapes.
    const src = fs.readFileSync(path.join(V, 'brief_author_v3.md'), 'utf8');
    const app = appendix(src);
    for (const t of MANIFEST.types) {
      for (const lim of (t.limits || [])) {
        // the first clause of each limit is enough to prove the limit travelled
        const head = lim.split(/[.;]/)[0].trim().slice(0, 40);
        if (head.length >= 15) expect(app).toContain(head);
      }
    }
  });

  it('grid.cellText documents its [row, col, text] shape somewhere the model will see it', () => {
    const g = MANIFEST.types.find((t) => t.type === 'grid');
    expect(g.limits.join(' ')).toMatch(/cellText/);
    expect(g.limits.join(' ')).toMatch(/\[\s*row\s*,\s*col\s*,\s*text\s*\]|row.*col.*text/i);
    const src = fs.readFileSync(path.join(V, 'brief_author_v3.md'), 'utf8');
    expect(appendix(src)).toMatch(/cellText/);
  });

  it('the appendix TABLE does not invent a field no module reads (bd-09m6a direction still holds)', () => {
    const src = fs.readFileSync(path.join(V, 'brief_author_v3.md'), 'utf8');
    // Scoped to the field TABLE. The limits prose below it legitimately names things the
    // top-level field list does not: the manifest's own negative warnings ("There is NO
    // `compound` field", "no top-level `above`/`below`") and nested sub-fields of an array
    // member (`cells[].across`, `steps[].lines`, `panels[].glyph`).
    const full = appendix(src);
    const app = full.slice(0, full.indexOf('**What each type will not do'));
    expect(app.length).toBeGreaterThan(200);
    const legal = new Set(MANIFEST.types.flatMap(fieldsOf).concat(
      MANIFEST.types.map((t) => t.type),
      MANIFEST.types.flatMap((t) => t.aliases || []),
      ['type', 'title', 'caption', 'lang', 'note', 'source', 'id'],
    ));
    // every backticked identifier inside the appendix table must be a real field or type
    const ticked = [...app.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((m) => m[1]);
    const bogus = [...new Set(ticked)].filter((x) => !legal.has(x));
    expect(bogus).toEqual([]);
  });
});
