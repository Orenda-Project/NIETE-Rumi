/**
 * A SPEC THE TYPE CANNOT USE MUST FAIL LOUDLY — bd-8lifl, round 2.
 *
 * Three defects in the 2026-09-05 batch are one root cause: a diagram module handed a spec it
 * cannot use paints a confident DEFAULT instead of saying so, and every structural gate passes.
 *
 *   atom  → HYDROGEN   `element:"Cr"` is outside the built-in table, Z falls through to 1, and a
 *                      figure headed "WHY THE CHROMIUM ION IS Cr3+" drew one proton and one
 *                      electron. Closed by ATOM_UNKNOWN_ELEMENT.
 *   cell  → PLANT CELL `cell.js:255` reads `const plant = (spec.kind || "plant") === "plant"`.
 *                      d09 emitted a `bio_schematic` with `steps` and no `kind`, titled
 *                      "COMPLEMENT SYSTEM ATTACKS A BACTERIUM", and got a labelled generic plant
 *                      cell — nucleus, nucleolus, chloroplasts, central vacuole.
 *   grid  → EMPTY      `grid.js:130` reads `cellText` as `[row, col, text]` TRIPLES. Told only the
 *                      field's NAME by this lane's own first-round fix, the model wrote a 2-D
 *                      array of rows; `const [r, c, txt] = t` then destructured a row of strings
 *                      into a NaN position with undefined text. FOUR grids across d01 and d05
 *                      printed as completely empty boxes under titles promising their contents.
 *
 * The last of those is a regression this lane caused, and it is the clearest statement of the
 * class: publishing a field's name without its SHAPE is worse than not publishing it, because the
 * failure is silent. The shape is now published (§4b.5 carries the manifest's `limits`), and this
 * rule is the belt to that braces — the brief tells the model, and the gate refuses to ship a
 * document where it did not land.
 *
 * Deliberately NOT in the renderer: a throw turns a repairable defect into a lost lesson, and this
 * batch already lost three lessons to overflow.
 *
 * Red-first: `lint()` reports nothing for any of the three specs below on this branch's base.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));
const MANIFEST = require(path.join(V, 'diagrams', 'types_manifest.json'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

function docWithBoard(spec) {
  const d = JSON.parse(raw);
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  d.page2.board_final.diagram = spec;
  return d;
}
const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

/** The exact spec that drew a plant cell (d09 p5). */
const BIO = {
  type: 'bio_schematic', direction: 'lr',
  title: 'COMPLEMENT SYSTEM ATTACKS A BACTERIUM (Fig. 9.8, p.173)',
  steps: [{ title: '1. MAC FORMS', lines: ['activated complement proteins'] }],
};

/** The exact shape that drew four empty grids (d01 p8, d05 p4/p5/p6). */
const GRID_2D = {
  type: 'grid', rows: 4, cols: 2, lang: 'ur', title: 'اصنافِ سخن کا درست جوڑ',
  cellText: [['کالم الف', 'کالم ب'], ['کہانی', 'ایک دفعہ کا ذکر ہے']],
};

const GRID_OK = {
  type: 'grid', rows: 4, cols: 2, title: 'ok',
  cellText: [[0, 0, 'a'], [0, 1, 'b'], [1, 0, 'c']],
};

describe('SPEC_CONTRACT — a required field that is absent is named, not defaulted', () => {
  it('fails a `bio_schematic` with no `kind` — the spec that drew a plant cell', () => {
    expect(codes(docWithBoard(BIO))).toContain('SPEC_CONTRACT');
  });

  it('names the type and the missing field', () => {
    const m = fails(docWithBoard(BIO)).find((e) => e.includes('SPEC_CONTRACT'));
    expect(String(m)).toMatch(/bio_schematic|cell/);
    expect(String(m)).toMatch(/kind/);
  });

  it('stays silent when the required field is present', () => {
    expect(codes(docWithBoard({ type: 'bio_schematic', kind: 'animal', title: 'ok' })))
      .not.toContain('SPEC_CONTRACT');
    expect(codes(docWithBoard({ type: 'cell', kind: 'plant', title: 'ok' })))
      .not.toContain('SPEC_CONTRACT');
  });

  it('resolves required fields through an ALIAS, not just the canonical name', () => {
    // `bio_schematic` is an alias of `cell`; its requirements are cell's.
    const cell = MANIFEST.types.find((t) => t.type === 'cell');
    expect(cell.aliases).toContain('bio_schematic');
    expect(cell.required).toContain('kind');
  });

  it('does not fire on a type whose required list is empty', () => {
    expect(codes(docWithBoard({ type: 'dna_helix', title: 'ok' }))).not.toContain('SPEC_CONTRACT');
  });
});

describe('GRID_CELLTEXT_SHAPE — the field that printed nothing', () => {
  it('fails the 2-D-array shape the model actually wrote', () => {
    expect(codes(docWithBoard(GRID_2D))).toContain('GRID_CELLTEXT_SHAPE');
  });

  it('says what the shape should be', () => {
    const m = fails(docWithBoard(GRID_2D)).find((e) => e.includes('GRID_CELLTEXT_SHAPE'));
    expect(String(m)).toMatch(/row/i);
    expect(String(m)).toMatch(/col/i);
    expect(String(m)).toMatch(/text/i);
  });

  it('stays silent on the [row, col, text] triples the renderer reads', () => {
    expect(codes(docWithBoard(GRID_OK))).not.toContain('GRID_CELLTEXT_SHAPE');
  });

  it('stays silent on a grid with no cellText at all', () => {
    expect(codes(docWithBoard({ type: 'grid', rows: 10, cols: 10, shaded: 37 })))
      .not.toContain('GRID_CELLTEXT_SHAPE');
  });

  it('fires in the body as well as on the board', () => {
    const d = JSON.parse(raw);
    for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
    (d.sections.find((s) => s.id === 'development') || d.sections[0])
      .blocks.push({ type: 'diagram', id: 'dg-g', spec: GRID_2D });
    expect(codes(d)).toContain('GRID_CELLTEXT_SHAPE');
  });
});
