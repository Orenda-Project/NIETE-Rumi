/**
 * PROSE IN A MOLECULE'S FORMULA SLOT IS A DEFECT, NOT A FORMULA — bd-oak77.24.
 *
 * A `molecule` spec with no `smiles` draws its `formula` through the chem_equation typesetter,
 * which splits the string into element/count/charge runs and DROPS EVERY SPACE, because a space
 * is never part of a chemical formula. When the author puts words there, e.g.
 * "phospholipid (bacterial membrane component)", the card prints
 * "phospholipid(bacterialmembranecomponent)": one run-together word, and no gate complains.
 *
 * Acceptance: lint rejects prose in the formula slot with a clear, blocking defect that says
 * what to put there instead. Real formulas (H2O, C6H12O6, CH3COOH, the ion SO4^2-) raise no
 * such defect and still typeset as separate runs.
 *
 * Red-first: on this branch's base lint() reports nothing for the prose spec.
 */
const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));
const { renderDiagram } = require(path.join(V, 'diagrams'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

const PROSE = 'phospholipid (bacterial membrane component)';
const REAL = ['H2O', 'C6H12O6', 'CH3COOH', 'SO4^2-'];

/** The fixture with its one development diagram swapped for `spec`. */
function docWithDiagram(spec) {
  const d = JSON.parse(raw);
  const dev = d.sections.find((s) => s.id === 'development');
  const swap = (blocks) => {
    for (const b of blocks || []) {
      if (b.type === 'diagram') b.spec = spec;
      for (const k of ['left', 'right', 'blocks']) if (Array.isArray(b[k])) swap(b[k]);
    }
  };
  swap(dev.blocks);
  return d;
}

const fails = (doc) => (lint(doc).fails || []).map(String);
const proseFails = (doc) => fails(doc).filter((f) => /formula/i.test(f) && /prose/i.test(f));
/** An SVG's text runs, in order. */
const runs = (svg) =>
  [...svg.replace(/<style[\s\S]*?<\/style>/g, '').matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe('bd-oak77.24 — prose in a molecule formula slot', () => {
  it('fails lint with a blocking defect for the prose spec', () => {
    expect(proseFails(docWithDiagram({ type: 'molecule', formula: PROSE }))).toHaveLength(1);
  });

  it('the defect quotes the prose and says what belongs there', () => {
    const [msg] = proseFails(docWithDiagram({ type: 'molecule', formula: PROSE }));
    expect(String(msg)).toContain('phospholipid');
    expect(String(msg)).toMatch(/smiles/i);
    expect(String(msg)).toMatch(/\bname\b/);
  });

  it('also fails when a name is given alongside the prose formula', () => {
    expect(proseFails(docWithDiagram({ type: 'molecule', name: 'Cell membrane', formula: PROSE }))).toHaveLength(1);
  });

  it.each(REAL)('raises no prose defect for the real formula %s', (f) => {
    expect(proseFails(docWithDiagram({ type: 'molecule', formula: f }))).toEqual([]);
  });

  it.each(REAL)('still typesets %s as separate element/count runs', (f) => {
    const r = runs(renderDiagram({ type: 'molecule', formula: f }));
    expect(r.length).toBeGreaterThan(2);
    expect(r.join('')).not.toContain(' ');
  });
});
