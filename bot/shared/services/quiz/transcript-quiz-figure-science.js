'use strict';
/**
 * Transcript quiz — the science-accuracy gate for figures.
 *
 * The diagram engine (bot/vendor/lp-v9/diagrams) draws whatever spec it is
 * given, with no complaint, even when the science is wrong:
 *   - an atom symbol off the engine's built-in table falls back to a
 *     hydrogen-shaped drawing wearing the requested label (atom.js resolveAtom);
 *   - a chemical equation is typeset but never checked for balance
 *     (chem_equation.js's own manifest entry says so);
 *   - a cell figure silently drops any requested part the chosen kind
 *     (plant/animal) does not have (bio_schematic.js's `on()` gate);
 *   - `molecule` takes a flash model's SMILES on trust.
 *
 * This module is the validator's separate check for those four cases
 * (PLAN_R4 D7e). Pure: a figure spec in, a defect (or null) out. No network,
 * no DB, and no dependency on the validator or the renderer — the manager
 * wires `scienceDefects()` into transcript-quiz-validator.js.
 */

// ─── atom ────────────────────────────────────────────────────────────────────

const ATOM_TYPES = new Set(['atom', 'bohr', 'electron_shells', 'dot_and_cross']);
const DOT_CROSS_MODES = new Set(['dot_cross', 'dot_and_cross', 'dotcross']);

// Z, copied from atom.js's TABLE (H..Ca, plus Fe, Cu, Zn, Br, I — the engine's
// own built-in roster). An element outside this set renders with the WRONG
// electron count unless the spec also gives an explicit Z.
const ATOM_Z = {
  H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
  Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18, K: 19, Ca: 20,
  Fe: 26, Cu: 29, Zn: 30, Br: 35, I: 53,
};
const ATOM_TABLE_SYMBOLS = Object.keys(ATOM_Z);

function isAtomSpec(spec) {
  return ATOM_TYPES.has(String(spec && spec.type).trim().toLowerCase());
}

/** Mirrors atom.js's resolveMode(): an explicit spec.mode wins, else the type alias, else bohr. */
function atomMode(sp) {
  const m = String(sp.mode == null ? '' : sp.mode).trim().toLowerCase();
  if (DOT_CROSS_MODES.has(m)) return 'dot_cross';
  const t = String(sp.type == null ? '' : sp.type).trim().toLowerCase();
  if (DOT_CROSS_MODES.has(t)) return 'dot_cross';
  return 'bohr';
}

/** Case-normalised the way resolveAtom() does it: first letter upper, rest lower. */
function normalizeSymbol(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * The standard school-level 2/8/8/2 filling for Z <= 20 (the same shells the
 * engine's own TABLE uses for H..Ca).
 */
function standardFilling(z) {
  const order = [2, 8, 8, 2];
  let left = Math.max(0, Math.round(z));
  const out = [];
  for (let i = 0; i < order.length && left > 0; i++) {
    const k = Math.min(order[i], left);
    out.push(k);
    left -= k;
  }
  return out;
}

/**
 * A shell's true maximum occupancy is 2*n^2 (n = shell number, 1-indexed).
 * atom.js's own CAPS = [2,8,8,18,18,32,32] is a PERIOD-LENGTH heuristic used
 * only to synthesise a filling for an out-of-table Z (fillShells()) — it is
 * not a physical bound, and the engine's own TABLE already breaks it for any
 * transition metal (Fe's shells are [2,8,14,2]; 14 > CAPS[2]'s 8). A real,
 * textbook-correct configuration like xenon's 2,8,18,18,8 must not be flagged
 * as a defect, so this check uses the true 2n^2 ceiling instead.
 */
function shellCap(index) {
  return 2 * (index + 1) * (index + 1);
}

function checkOneAtom(raw, explicitZRaw, shellsRaw, label) {
  const trimmed = raw == null ? '' : String(raw).trim();
  if (!trimmed) return null; // nothing named — not this rule's concern

  const key = normalizeSymbol(trimmed);
  const inTable = Object.prototype.hasOwnProperty.call(ATOM_Z, key);
  const explicitZ = Number.isFinite(Number(explicitZRaw)) ? Math.round(Number(explicitZRaw)) : null;

  if (!inTable && explicitZ === null) {
    return {
      message: `"${trimmed}" is not on the built-in element table (H-Ca, Fe, Cu, Zn, Br, I) — ` +
        `without an explicit "Z" the drawing renders as a DIFFERENT element wearing the "${trimmed}" label; ` +
        `give "Z" (and "shells" for a specific configuration)`,
    };
  }

  if (!Array.isArray(shellsRaw) || !shellsRaw.length) return null;
  const shells = shellsRaw.map((v) => Math.max(0, Math.round(Number(v) || 0)));
  const Z = explicitZ !== null ? explicitZ : ATOM_Z[key];

  const sum = shells.reduce((a, b) => a + b, 0);
  if (sum !== Z) {
    return { message: `${label} "${trimmed}" has shells ${shells.join(', ')} summing to ${sum}, not Z = ${Z}` };
  }

  const overIndex = shells.findIndex((v, i) => v > shellCap(i));
  if (overIndex !== -1) {
    return {
      message: `${label} "${trimmed}" has ${shells[overIndex]} electrons in shell ${overIndex + 1}, ` +
        `over its cap of ${shellCap(overIndex)}`,
    };
  }

  if (Z <= 20) {
    const std = standardFilling(Z);
    const matches = std.length === shells.length && std.every((v, i) => v === shells[i]);
    if (!matches) {
      return {
        message: `${label} "${trimmed}" (Z = ${Z}) should fill as ${std.join(', ')}, not ${shells.join(', ')}`,
      };
    }
  }

  return null;
}

/**
 * @param {object} spec a figure spec
 * @returns {null|{message:string}}
 */
function atomDefect(spec) {
  if (!spec || typeof spec !== 'object' || !isAtomSpec(spec)) return null;

  const primary = checkOneAtom(spec.element != null ? spec.element : spec.symbol, spec.Z, spec.shells, 'the atom');
  if (primary) return primary;

  if (atomMode(spec) === 'dot_cross' && spec.partner && typeof spec.partner === 'object') {
    const p = spec.partner;
    return checkOneAtom(p.element != null ? p.element : p.symbol, p.Z, p.shells, 'the partner atom');
  }
  return null;
}

// ─── chem_equation ───────────────────────────────────────────────────────────

const CHEM_TYPES = new Set(['chem_equation', 'equation', 'reaction']);
const STATE_SYMBOLS = /\((?:s|l|g|aq)\)/gi;
const TRAILING_CHARGE = /\^\d*[+-]+$/;
const ARROW = /(<=>|<->|->|<-|=)/;

function isChemSpec(spec) {
  return CHEM_TYPES.has(String(spec && spec.type).trim().toLowerCase());
}

/** Parse one bracket-free formula (after coefficient/state/charge are stripped) into element counts. */
function parseFormulaElements(s) {
  let i = 0;
  function parseElement() {
    const start = i;
    i += 1; // the leading uppercase letter
    if (i < s.length && /[a-z]/.test(s[i])) i += 1;
    const el = s.slice(start, i);
    const numStart = i;
    while (i < s.length && /[0-9]/.test(s[i])) i += 1;
    const n = i > numStart ? parseInt(s.slice(numStart, i), 10) : 1;
    return { el, n };
  }
  function parseGroup() {
    const counts = {};
    while (i < s.length && s[i] !== ')') {
      const ch = s[i];
      if (ch === '(') {
        i += 1;
        const inner = parseGroup();
        if (s[i] !== ')') throw new Error('unmatched parenthesis');
        i += 1;
        const numStart = i;
        while (i < s.length && /[0-9]/.test(s[i])) i += 1;
        const mult = i > numStart ? parseInt(s.slice(numStart, i), 10) : 1;
        Object.entries(inner).forEach(([el, n]) => { counts[el] = (counts[el] || 0) + n * mult; });
      } else if (/[A-Z]/.test(ch)) {
        const { el, n } = parseElement();
        counts[el] = (counts[el] || 0) + n;
      } else {
        throw new Error(`unparseable character "${ch}"`);
      }
    }
    return counts;
  }
  const counts = parseGroup();
  if (i !== s.length) throw new Error('trailing unparsed input');
  return counts;
}

/** One species (e.g. "2Ca(OH)2(aq)") -> element counts, or null if it cannot be parsed as chemistry. */
function parseSpeciesElements(species) {
  let str = String(species || '').trim();
  str = str.replace(STATE_SYMBOLS, '').replace(TRAILING_CHARGE, '').trim();
  if (!str) return null;

  const coefMatch = /^\d+/.exec(str);
  let coef = 1;
  if (coefMatch) {
    coef = parseInt(coefMatch[0], 10);
    str = str.slice(coefMatch[0].length).trim();
  }
  if (!str) return null;

  let counts;
  try {
    counts = parseFormulaElements(str);
  } catch (e) {
    return null; // a word equation, or anything else that is not chemistry — abstain, never guess
  }
  if (!Object.keys(counts).length) return null;

  const scaled = {};
  Object.entries(counts).forEach(([el, n]) => { scaled[el] = n * coef; });
  return scaled;
}

/**
 * @param {object} spec a chem_equation figure spec
 * @returns {null|{message:string,left:object,right:object}}
 */
function chemBalanceDefect(spec) {
  if (!spec || typeof spec !== 'object' || !isChemSpec(spec)) return null;
  if (spec.balanced === false) return null; // the author is asking the child to balance it themselves

  const raw = String(spec.equation == null ? '' : spec.equation).trim();
  if (!raw) return null;

  // strip [above]/[below] condition brackets riding on the arrow BEFORE splitting
  const stripped = raw.replace(/\[[^\]]*\]/g, '');
  const arrowMatch = ARROW.exec(stripped);
  if (!arrowMatch) return null;

  const leftSide = stripped.slice(0, arrowMatch.index);
  const rightSide = stripped.slice(arrowMatch.index + arrowMatch[0].length);
  const leftSpecies = leftSide.split(/\s\+\s/).map((s) => s.trim()).filter(Boolean);
  const rightSpecies = rightSide.split(/\s\+\s/).map((s) => s.trim()).filter(Boolean);
  if (!leftSpecies.length || !rightSpecies.length) return null;

  const leftCounts = {};
  const rightCounts = {};
  for (const s of leftSpecies) {
    const c = parseSpeciesElements(s);
    if (!c) return null; // cannot be parsed as chemistry (e.g. a word equation) — abstain
    Object.entries(c).forEach(([el, n]) => { leftCounts[el] = (leftCounts[el] || 0) + n; });
  }
  for (const s of rightSpecies) {
    const c = parseSpeciesElements(s);
    if (!c) return null;
    Object.entries(c).forEach(([el, n]) => { rightCounts[el] = (rightCounts[el] || 0) + n; });
  }

  const elements = [...new Set([...Object.keys(leftCounts), ...Object.keys(rightCounts)])];
  const mismatch = elements.find((el) => (leftCounts[el] || 0) !== (rightCounts[el] || 0));
  if (!mismatch) return null;

  const l = leftCounts[mismatch] || 0;
  const r = rightCounts[mismatch] || 0;
  return {
    message: `the equation "${raw}" does not balance — ${mismatch} is ${l} on the left and ${r} on the right; ` +
      `add coefficients, or set "balanced": false if the child is being asked to balance it`,
    left: leftCounts,
    right: rightCounts,
  };
}

// ─── cell ────────────────────────────────────────────────────────────────────

// Copied from bio_schematic.js's renderCell() — the plant and animal branches
// each read a DIFFERENT set of `on(...)` keys.
const CELL_PARTS = {
  plant: ['wall', 'membrane', 'vacuole', 'chloroplast', 'cytoplasm', 'mitochondrion', 'nucleus', 'nucleolus'],
  animal: ['membrane', 'cytoplasm', 'ribosome', 'mitochondrion', 'nucleus', 'nucleolus'],
};

/** Which bio_schematic figure a spec selects, mirroring its own alias resolution. */
function cellFigureKind(spec) {
  const type = String(spec.type == null ? '' : spec.type).trim().toLowerCase();
  const figure = String(spec.figure == null ? '' : spec.figure).trim().toLowerCase();
  if (figure === 'leaf_cross_section' || figure === 'leaf' || type === 'leaf_cross_section' || type === 'leaf') {
    return 'leaf_cross_section';
  }
  if (figure === 'heart_loop' || figure === 'heart' || type === 'heart_loop' || type === 'heart') {
    return 'heart_loop';
  }
  if (type === 'cell' || type === 'bio_schematic' || figure === 'cell') return 'cell';
  return null;
}

/**
 * @param {object} spec a cell/leaf_cross_section/heart_loop figure spec
 * @returns {null|{message:string,unknown:string[]}}
 */
function cellPartsDefect(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const figureKind = cellFigureKind(spec);
  if (!figureKind) return null;

  if (figureKind !== 'cell') {
    const parts = Array.isArray(spec.parts) ? spec.parts.filter(Boolean) : [];
    if (parts.length) {
      return {
        message: `"${figureKind}" takes no "parts" — it has no plant/animal part list to select from; remove "parts"`,
        unknown: parts.slice(),
      };
    }
    return null;
  }

  const kind = spec.kind === 'animal' ? 'animal' : 'plant';
  const allowed = CELL_PARTS[kind];
  const parts = Array.isArray(spec.parts) ? spec.parts.filter(Boolean) : [];
  if (!parts.length) return null;

  const unknown = parts.filter((p) => !allowed.includes(p));
  if (!unknown.length) return null;

  const plantOnly = unknown.filter((p) => CELL_PARTS.plant.includes(p) && !CELL_PARTS.animal.includes(p));
  const why = kind === 'animal' && plantOnly.length
    ? ` — an animal cell has no ${plantOnly.join(', ')}; that difference is usually the point of the lesson`
    : '';

  return {
    message: `the "${kind}" cell has no ${unknown.join(', ')} to label — it only has ${allowed.join(', ')}${why}`,
    unknown,
  };
}

// ─── molecule ────────────────────────────────────────────────────────────────

const MOLECULE_TYPES = new Set(['molecule', 'smiles', 'structure']);

// PLAN_R4 D7f: molecule is re-admitted to the allowlist ONLY behind this fixed
// dictionary — a flash model's SMILES is not trusted.
const MOLECULE_DICTIONARY = {
  H2O: { smiles: 'O', name: 'water' },
  CO2: { smiles: 'O=C=O', name: 'carbon dioxide' },
  CH4: { smiles: 'C', name: 'methane' },
  NH3: { smiles: 'N', name: 'ammonia' },
  O2: { smiles: 'O=O', name: 'oxygen' },
  N2: { smiles: 'N#N', name: 'nitrogen' },
  HCl: { smiles: 'Cl', name: 'hydrogen chloride' },
  H2: { smiles: '[HH]', name: 'hydrogen' },
  Cl2: { smiles: 'ClCl', name: 'chlorine' },
  NaCl: { ionic: true, name: 'sodium chloride' },
  CaO: { ionic: true, name: 'calcium oxide' },
  MgO: { ionic: true, name: 'magnesium oxide' },
};

function isMoleculeSpec(spec) {
  return MOLECULE_TYPES.has(String(spec && spec.type).trim().toLowerCase());
}

function dictionaryKey(formula) {
  // whitespace only — never case-fold: CO (carbon monoxide) and Co (cobalt) differ.
  return String(formula == null ? '' : formula).replace(/\s+/g, '');
}

/**
 * @param {string} formula
 * @returns {null|{formula:string,name:string,smiles?:string,ionic?:true}}
 */
function moleculeFromDictionary(formula) {
  const key = dictionaryKey(formula);
  const entry = key ? MOLECULE_DICTIONARY[key] : null;
  if (!entry) return null;
  const out = { formula: key, name: entry.name };
  if (entry.smiles) out.smiles = entry.smiles;
  if (entry.ionic) out.ionic = true;
  return out;
}

/**
 * @param {object} spec a molecule figure spec
 * @returns {null|{message:string}}
 */
function moleculeDefect(spec) {
  if (!spec || typeof spec !== 'object' || !isMoleculeSpec(spec)) return null;

  const key = dictionaryKey(spec.formula);
  const entry = key ? MOLECULE_DICTIONARY[key] : null;
  if (!entry) {
    const drawable = Object.keys(MOLECULE_DICTIONARY).join(', ');
    return {
      message: `"${spec.formula == null ? '' : spec.formula}" is not in the fixed molecule dictionary — ` +
        `only these formulas are drawable: ${drawable}`,
    };
  }

  const givenSmiles = spec.smiles == null ? '' : String(spec.smiles).trim();
  if (givenSmiles) {
    if (entry.ionic) {
      return {
        message: `"${key}" (${entry.name}) is ionic — the dictionary draws a lattice, not a SMILES structure; remove "smiles"`,
      };
    }
    if (givenSmiles !== entry.smiles) {
      return {
        message: `"${key}"'s SMILES is "${givenSmiles}" but the fixed dictionary says "${entry.smiles}" for ${entry.name} — ` +
          `the dictionary wins, because a flash model's SMILES is not trusted`,
      };
    }
  }
  return null;
}

// ─── dispatcher ──────────────────────────────────────────────────────────────

/**
 * @param {object} spec a figure spec, as authored
 * @returns {Array<{code:string,message:string}>} [] when the type is not judged
 */
function scienceDefects(spec) {
  if (!spec || typeof spec !== 'object') return [];
  const out = [];
  const chem = chemBalanceDefect(spec);
  if (chem) out.push({ code: 'FIGURE_CHEM', message: chem.message });
  const atom = atomDefect(spec);
  if (atom) out.push({ code: 'FIGURE_ATOM', message: atom.message });
  const cell = cellPartsDefect(spec);
  if (cell) out.push({ code: 'FIGURE_CELL', message: cell.message });
  const molecule = moleculeDefect(spec);
  if (molecule) out.push({ code: 'FIGURE_MOLECULE', message: molecule.message });
  return out;
}

module.exports = {
  chemBalanceDefect,
  atomDefect,
  cellPartsDefect,
  moleculeDefect,
  scienceDefects,
  moleculeFromDictionary,
  MOLECULE_DICTIONARY,
  ATOM_TABLE_SYMBOLS,
  CELL_PARTS,
};
