/**
 * AN ATOM THE ENGINE CANNOT DRAW MUST FAIL LOUDLY, NOT DRAW HYDROGEN — bd-8lifl.
 *
 * The defect, on the 2026-09-05 representative batch (d05, Grade 10 Chemistry, "Chromium plating
 * & Daniel cell", page 5). The model emitted, in full:
 *
 *     {"type":"atom","element":"Cr","mode":"bohr",
 *      "title":"WHY THE CHROMIUM ION IS Cr3+",
 *      "caption":"Chromium loses 3 electrons to form Cr3+ …"}
 *
 * `atom.js` keeps a built-in table of H–Ca plus Fe/Cu/Zn/Br/I. **Chromium (Z = 24) is not in it.**
 * `TABLE["Cr"]` is undefined, so `row` is null and the resolver falls through:
 *
 *     const Z = Number.isFinite(Number(src.Z)) ? … : row ? row[0] : givenSum || 1;   // → 1
 *
 * With no `shells` and no `Z`, Z becomes **1** and the figure renders one proton, one neutron and
 * a single electron in one shell — **a hydrogen atom labelled Cr**, under a title asking why
 * chromium forms Cr³⁺. An atom with one electron cannot lose three, so the picture refutes its own
 * caption, and every structural gate passed it.
 *
 * This is the silent-fallback class: the engine had no way to draw the thing asked for and drew
 * something else, confidently, rather than saying so. The rule below makes it loud, so the
 * revision ladder can repair it — the model supplies `Z`/`shells` (now published in §4b.5) or
 * picks a different type.
 *
 * Red-first: `lint()` reports nothing at all for the spec above on this branch's base.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));
const { renderDiagram } = require(path.join(V, 'diagrams'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

function docWithBoard(spec) {
  const d = JSON.parse(raw);
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  d.page2.board_final.diagram = spec;
  return d;
}

/** The exact spec that shipped to a teacher. */
const CHROMIUM = {
  type: 'atom',
  element: 'Cr',
  mode: 'bohr',
  title: 'WHY THE CHROMIUM ION IS Cr3+',
  caption: 'Chromium loses 3 electrons to form Cr3+ — matched by the electrolyte formula Cr2(SO4)3.',
};

/** `lint()` returns { fails, warns } — a BLOCKING defect is in `fails`. */
const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

describe('ATOM_UNKNOWN_ELEMENT — the engine says so instead of drawing hydrogen', () => {
  it('fails the exact chromium spec that shipped', () => {
    expect(codes(docWithBoard(CHROMIUM))).toContain('ATOM_UNKNOWN_ELEMENT');
  });

  it('names the element and says what would fix it', () => {
    const msg = fails(docWithBoard(CHROMIUM)).find((e) => e.includes('ATOM_UNKNOWN_ELEMENT'));
    expect(String(msg)).toMatch(/Cr/);
    expect(String(msg)).toMatch(/\bZ\b/);          // tell the author the way out
    expect(String(msg)).toMatch(/shells/);
  });

  it('stays silent for an element that IS in the table', () => {
    expect(codes(docWithBoard({ ...CHROMIUM, element: 'Na' }))).not.toContain('ATOM_UNKNOWN_ELEMENT');
    expect(codes(docWithBoard({ ...CHROMIUM, element: 'Ca' }))).not.toContain('ATOM_UNKNOWN_ELEMENT');
    expect(codes(docWithBoard({ ...CHROMIUM, element: 'Fe' }))).not.toContain('ATOM_UNKNOWN_ELEMENT');
  });

  it('stays silent when the author supplies Z explicitly', () => {
    expect(codes(docWithBoard({ ...CHROMIUM, Z: 24, neutrons: 28, shells: [2, 8, 13, 1] })))
      .not.toContain('ATOM_UNKNOWN_ELEMENT');
  });

  it('stays silent when the author supplies shells alone', () => {
    expect(codes(docWithBoard({ ...CHROMIUM, shells: [2, 8, 13, 1] })))
      .not.toContain('ATOM_UNKNOWN_ELEMENT');
  });

  it('fires on a body diagram too, not only the board', () => {
    const d = JSON.parse(raw);
    for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
    const dev = d.sections.find((s) => s.id === 'development') || d.sections[0];
    dev.blocks.push({ type: 'diagram', id: 'dg-atom', spec: CHROMIUM });
    expect(codes(d)).toContain('ATOM_UNKNOWN_ELEMENT');
  });

  it('also fires through the dot_and_cross alias and on a partner element', () => {
    expect(codes(docWithBoard({ type: 'atom', mode: 'dot_cross', bond: 'ionic',
      element: 'Na', partner: { element: 'Cr' }, transfer: 1, title: 'x' })))
      .toContain('ATOM_UNKNOWN_ELEMENT');
  });

  it('the renderer still draws it — the lint reports, it does not crash the page', () => {
    // A throw here would turn a repairable defect into a lost lesson (d15 lost a whole lesson to
    // a 3px overflow). The ladder repairs; the renderer keeps rendering.
    expect(renderDiagram(JSON.parse(JSON.stringify(CHROMIUM)))).toMatch(/^<svg/);
  });
});
