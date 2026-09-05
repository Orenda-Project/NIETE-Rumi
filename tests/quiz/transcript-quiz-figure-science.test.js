'use strict';
/**
 * Science accuracy checks for transcript-quiz figures.
 *
 * The diagram engine draws whatever spec it is given, cheerfully, even when
 * the science is wrong: an off-table element wears the wrong label, a
 * chemical equation is never balance-checked, and a cell can be asked to
 * label an organelle the chosen kind does not have. This module is the
 * validator's separate science gate for those four cases (PLAN_R4 D7e +
 * brief item 6). Pure: spec in, a defect or null out. No network, no DB.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const {
  chemBalanceDefect,
  atomDefect,
  cellPartsDefect,
  moleculeDefect,
  scienceDefects,
  moleculeFromDictionary,
  MOLECULE_DICTIONARY,
  ATOM_TABLE_SYMBOLS,
  CELL_PARTS,
} = require('../../bot/shared/services/quiz/transcript-quiz-figure-science');

const { renderFigureSvg, svgText } = require('../../bot/shared/services/quiz/transcript-quiz-figure');

describe('chemBalanceDefect', () => {
  const clean = [
    ['2H2 + O2 -> 2H2O', 'simple coefficients'],
    ['CaCO3 ->[Δ] CaO + CO2', 'a condition on the arrow'],
    ['AgNO3(aq) + NaCl(aq) -> AgCl(s) + NaNO3(aq)', 'state symbols'],
    ['Ca(OH)2 + 2HCl -> CaCl2 + 2H2O', 'a parenthesised group'],
    ['N2 + 3H2 <=>[Fe][450 °C] 2NH3', 'equilibrium with two bracket conditions'],
  ];
  test.each(clean)('"%s" (%s) balances — no defect', (equation) => {
    expect(chemBalanceDefect({ type: 'chem_equation', equation })).toBeNull();
  });

  test('an unbalanced equation with no "balanced" flag is a defect (the manifest says the engine never checks this itself)', () => {
    const defect = chemBalanceDefect({ type: 'chem_equation', equation: 'H2 + O2 -> H2O' });
    expect(defect).not.toBeNull();
    expect(defect.message).toMatch(/does not balance/);
    expect(defect.message).toMatch(/O/);
  });

  test('Fe + O2 -> Fe2O3 does not balance', () => {
    const defect = chemBalanceDefect({ type: 'chem_equation', equation: 'Fe + O2 -> Fe2O3' });
    expect(defect).not.toBeNull();
    expect(defect.message).toMatch(/Fe/);
  });

  test('balanced: false is the author declaring a deliberate imbalance — no defect', () => {
    expect(
      chemBalanceDefect({ type: 'chem_equation', equation: 'H2 + O2 -> H2O', balanced: false })
    ).toBeNull();
  });

  test('a word equation has no element symbols to count, so the check abstains rather than guessing', () => {
    expect(
      chemBalanceDefect({ type: 'chem_equation', equation: 'magnesium + oxygen -> magnesium oxide' })
    ).toBeNull();
  });

  test('a non chem_equation type is not judged', () => {
    expect(chemBalanceDefect({ type: 'fraction_bar', equation: 'H2 + O2 -> H2O' })).toBeNull();
  });
});

describe('atomDefect', () => {
  test('Na is on the built-in table — no defect', () => {
    expect(atomDefect({ type: 'atom', element: 'Na' })).toBeNull();
  });

  test('symbol case is normalised the way resolveAtom does it — "na" also means sodium', () => {
    expect(atomDefect({ type: 'atom', element: 'na' })).toBeNull();
  });

  test('Xe is off the built-in table and carries no explicit Z — the drawing would wear the wrong label', () => {
    const defect = atomDefect({ type: 'atom', element: 'Xe' });
    expect(defect).not.toBeNull();
    expect(defect.message).toMatch(/Xe/);
  });

  test('Xe WITH an explicit Z and a real shell configuration is not a defect', () => {
    expect(
      atomDefect({ type: 'atom', element: 'Xe', Z: 54, shells: [2, 8, 18, 18, 8] })
    ).toBeNull();
  });

  test('a shell over its cap is a defect, even though the total still sums to Z', () => {
    const defect = atomDefect({ type: 'atom', element: 'Na', shells: [2, 9] });
    expect(defect).not.toBeNull();
    expect(defect.message).toMatch(/cap/);
  });

  test('O as 2,6 is the standard filling — no defect', () => {
    expect(atomDefect({ type: 'atom', element: 'O', shells: [2, 6] })).toBeNull();
  });

  test('a dot_cross partner atom is checked too', () => {
    const defect = atomDefect({
      type: 'atom', mode: 'dot_cross', bond: 'ionic', element: 'Na', partner: { element: 'Xe' }, transfer: 1,
    });
    expect(defect).not.toBeNull();
    expect(defect.message).toMatch(/Xe/);
  });

  test('a non-atom type is not judged', () => {
    expect(atomDefect({ type: 'grid', element: 'Xe' })).toBeNull();
  });
});

describe('cellPartsDefect', () => {
  test('an animal cell asked to label a chloroplast is a defect — animal cells have no chloroplast', () => {
    const defect = cellPartsDefect({ type: 'cell', kind: 'animal', parts: ['chloroplast'] });
    expect(defect).not.toBeNull();
    expect(defect.unknown).toEqual(['chloroplast']);
    expect(defect.message).toMatch(/chloroplast/);
  });

  test('an animal cell labelling nucleus + mitochondrion is fine', () => {
    expect(
      cellPartsDefect({ type: 'cell', kind: 'animal', parts: ['nucleus', 'mitochondrion'] })
    ).toBeNull();
  });

  test('a plant cell labelling chloroplast + wall is fine', () => {
    expect(
      cellPartsDefect({ type: 'cell', kind: 'plant', parts: ['chloroplast', 'wall'] })
    ).toBeNull();
  });

  test('a misspelt part is a defect', () => {
    const defect = cellPartsDefect({ type: 'cell', kind: 'plant', parts: ['nucleuss'] });
    expect(defect).not.toBeNull();
    expect(defect.unknown).toEqual(['nucleuss']);
  });

  test('the measured case: an animal cell asked for chloroplast + nucleus is a defect', () => {
    const defect = cellPartsDefect({ type: 'cell', kind: 'animal', parts: ['chloroplast', 'nucleus'] });
    expect(defect).not.toBeNull();
    expect(defect.unknown).toEqual(['chloroplast']);
  });

  test('leaf_cross_section takes no "parts" — giving one is a defect', () => {
    const defect = cellPartsDefect({ type: 'leaf_cross_section', parts: ['chloroplast'] });
    expect(defect).not.toBeNull();
  });

  test('a non-cell type is not judged', () => {
    expect(cellPartsDefect({ type: 'grid', kind: 'animal', parts: ['chloroplast'] })).toBeNull();
  });
});

describe('moleculeDefect + moleculeFromDictionary', () => {
  test('H2O is in the fixed dictionary — no defect', () => {
    expect(moleculeDefect({ type: 'molecule', formula: 'H2O' })).toBeNull();
  });

  test('moleculeFromDictionary("H2O") gives the SMILES the dictionary trusts', () => {
    expect(moleculeFromDictionary('H2O')).toEqual({ formula: 'H2O', name: 'water', smiles: 'O' });
  });

  test('a formula outside the dictionary is a defect', () => {
    const defect = moleculeDefect({ type: 'molecule', formula: 'C6H12O6' });
    expect(defect).not.toBeNull();
    expect(defect.message).toMatch(/dictionary/);
  });

  test('a smiles that disagrees with the dictionary is a defect — the dictionary is the source of truth', () => {
    const defect = moleculeDefect({ type: 'molecule', formula: 'H2O', smiles: 'CCO' });
    expect(defect).not.toBeNull();
    expect(defect.message).toMatch(/dictionary/);
  });

  test('no formula at all is a defect', () => {
    expect(moleculeDefect({ type: 'molecule' })).not.toBeNull();
  });

  test('an ionic dictionary entry (NaCl) is unaffected by real chemistry using ionic bonding, not a molecule structure', () => {
    expect(moleculeFromDictionary('NaCl')).toEqual({ formula: 'NaCl', name: 'sodium chloride', ionic: true });
  });
});

describe('scienceDefects', () => {
  test('returns [] for figure types it does not judge', () => {
    expect(scienceDefects({ type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] })).toEqual([]);
    expect(scienceDefects({ type: 'grid', rows: 4, cols: 4 })).toEqual([]);
    expect(scienceDefects({ type: 'numberline', from: 0, to: 10 })).toEqual([]);
  });

  test('flags an unbalanced chem_equation with code FIGURE_CHEM', () => {
    const defects = scienceDefects({ type: 'chem_equation', equation: 'H2 + O2 -> H2O' });
    expect(defects).toHaveLength(1);
    expect(defects[0].code).toBe('FIGURE_CHEM');
  });

  test('flags an off-table atom with code FIGURE_ATOM', () => {
    const defects = scienceDefects({ type: 'atom', element: 'Xe' });
    expect(defects).toHaveLength(1);
    expect(defects[0].code).toBe('FIGURE_ATOM');
  });

  test('flags an impossible cell part with code FIGURE_CELL', () => {
    const defects = scienceDefects({ type: 'cell', kind: 'animal', parts: ['chloroplast'] });
    expect(defects).toHaveLength(1);
    expect(defects[0].code).toBe('FIGURE_CELL');
  });

  test('flags an out-of-dictionary molecule with code FIGURE_MOLECULE', () => {
    const defects = scienceDefects({ type: 'molecule', formula: 'C6H12O6' });
    expect(defects).toHaveLength(1);
    expect(defects[0].code).toBe('FIGURE_MOLECULE');
  });
});

describe('data exports', () => {
  test('ATOM_TABLE_SYMBOLS is the H..Ca + Fe/Cu/Zn/Br/I roster', () => {
    expect(ATOM_TABLE_SYMBOLS).toEqual(expect.arrayContaining(['H', 'Ca', 'Fe', 'Cu', 'Zn', 'Br', 'I']));
    expect(ATOM_TABLE_SYMBOLS).not.toEqual(expect.arrayContaining(['Xe']));
  });

  test('CELL_PARTS has different sets for plant and animal', () => {
    expect(CELL_PARTS.plant).toEqual(expect.arrayContaining(['wall', 'chloroplast', 'vacuole']));
    expect(CELL_PARTS.animal).not.toEqual(expect.arrayContaining(['wall']));
    expect(CELL_PARTS.animal).not.toEqual(expect.arrayContaining(['chloroplast']));
  });

  test('MOLECULE_DICTIONARY has exactly the twelve agreed formulas', () => {
    expect(Object.keys(MOLECULE_DICTIONARY).sort()).toEqual(
      ['CH4', 'CO2', 'CaO', 'Cl2', 'H2', 'H2O', 'HCl', 'MgO', 'N2', 'NH3', 'NaCl', 'O2'].sort()
    );
  });
});

describe('the wrong-science drawings, proven from the live rendered SVG', () => {
  test('an off-table atom really does render the wrong label (measured case 1)', () => {
    const svg = renderFigureSvg({ type: 'atom', element: 'Xe' }, 'en');
    const texts = svgText(svg);
    expect(texts.join(' | ')).toMatch(/Xe \(Xe\) — Z = 1, 1 neutrons, electrons 1/);
  });

  test('an unbalanced equation really does render without complaint (measured case 2)', () => {
    const svg = renderFigureSvg({ type: 'chem_equation', equation: 'H2 + O2 -> H2O' }, 'en');
    const texts = svgText(svg);
    // the engine typesets each glyph run as its own token; joined, it is the
    // unbalanced equation, drawn exactly as given, with no imbalance marker.
    expect(texts.join('')).toBe('H2+O2H2O');
  });

  test('an animal cell asked for chloroplast really does drop the label (measured case 3)', () => {
    const svg = renderFigureSvg({ type: 'cell', kind: 'animal', parts: ['chloroplast', 'nucleus'] }, 'en');
    const texts = svgText(svg);
    expect(texts).toEqual(['nucleus']);
    expect(texts).not.toContain('chloroplast');
  });
});
