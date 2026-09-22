/**
 * A PLACE-VALUE GRID MUST READ AS COLUMN SUBTRACTION, NOT AS A FIVE-DIGIT NUMBER.
 *
 * Operator, on the G3 Ch.2 Maths render (`Maths_seg5.lp.json`, /sections[1]/blocks[2]):
 *
 *   "In the Grid Image Th H T O should be right above each square, not tightened together
 *    in the middle, the grid makes no sense since 3600 - 47 is the equation written below
 *    but the grid diagram also has 35910 under it, when it should have been carried over"
 *
 * TWO DEFECTS, one spec.
 *
 * (1) THE COLUMN HEADERS BUNCH IN THE MIDDLE. `colLabel` is a SINGLE string, padded with
 *     literal spaces — "Th   H   T   O" — and drawn once, centred on the whole grid. Space
 *     padding cannot align to a 56-unit cell track at any font: the four headers print as
 *     one clump over the middle two columns and none of them sits over the place it names.
 *     A header that names the wrong column is worse than no header.
 *
 * (2) THE REGROUPED ROW READS AS 35910. Renaming was authored as A SECOND ROW OF DIGITS —
 *     3, 5, 9, 10 — which is not how column subtraction is written, and the "10" is two
 *     glyphs in a one-digit place-value cell, so the row scans as one five-digit number.
 *     A Grade 3 teacher writes renaming as MARKS OVER THE MINUEND, in the minuend's OWN row:
 *
 *              Th    H    T    O
 *                         5    9        <- the renamed values, small, set above and left
 *               3    6/   0/  10/       <- the minuend, renamed digits struck through
 *          -               4    7
 *              ─────────────────
 *               3    5    5    3
 *
 * THE CHECK IS ON THE EMITTED SVG, per `lib/measure.js`: *"a type module can believe
 * whatever it likes about its own arithmetic; what ships is the string"* — so this suite
 * cannot pass by agreeing with the module.
 *
 * Both keys are ADDITIVE. The byte-identity block at the bottom pins every grid spec in the
 * corpus to the exact canvas it rendered before this change.
 */

const crypto = require('crypto');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const grid = require(path.join(V, 'diagrams', 'types', 'grid.js'));
// The two helper halves live in diagrams/lib/, NOT in diagrams/types/: index.js loads
// EVERY .js in types/ as a diagram type, so a helper there registers as type `undefined`
// and the registry throws on the second one.
const notation = require(path.join(V, 'diagrams', 'lib', 'grid_notation.js'));
const { checkOverlaps, elementBoxes } = require(path.join(V, 'diagrams', 'lib', 'measure.js'));

// ── tiny SVG readers: what SHIPPED, not what the module believes ──────────────
const at = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
const texts = (svg) =>
  [...svg.matchAll(/<text\s([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const a = at(m[1]);
    return { x: +a.x, y: +a.y, size: +a['font-size'], anchor: a['text-anchor'] || 'start', text: m[2] };
  });
const rules = (svg) =>
  [...svg.matchAll(/<line\s([^>]*)\/>/g)].map((m) => at(m[1])).map((a) => ({
    x1: +a.x1, y1: +a.y1, x2: +a.x2, y2: +a.y2, skip: a['data-ov'] === 'skip',
  }));
const box = (svg) => {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return { w: +m[1], h: +m[2] };
};
const escaped = (svg) => {
  const { w } = box(svg);
  return elementBoxes(svg).boxes
    .filter((b) => (b.kind === 'text' || b.kind === 'fo') && (b.x < -0.5 || b.x + b.w > w + 0.5))
    .map((b) => `${b.text || '?'} at x=${Math.round(b.x)}..${Math.round(b.x + b.w)} of ${w}`);
};
/** The column-track centres, read off the grid's OWN vertical rules. */
const columnCentres = (svg) => {
  const xs = [...new Set(rules(svg).filter((l) => !l.skip && l.x1 === l.x2).map((l) => l.x1))].sort((a, b) => a - b);
  return xs.slice(1).map((x, i) => (x + xs[i]) / 2);
};
const rowBands = (svg) => {
  const ys = [...new Set(rules(svg).filter((l) => !l.skip && l.y1 === l.y2).map((l) => l.y1))].sort((a, b) => a - b);
  return ys.slice(1).map((y, i) => [ys[i], y]);
};

// ── the operator's figure, authored the way the fix allows ───────────────────
const HEADERS = ['Th', 'H', 'T', 'O'];
/** Her spec's colLabel, verbatim: one string, space-padded, four headers inside it. */
const PADDED = 'Th   H   T   O';

const MINUEND = [[0, 0, '3'], [0, 1, '6'], [0, 2, '0'], [0, 3, '0']];
const REST = [[1, 2, '4'], [1, 3, '7'], [2, 0, '3'], [2, 1, '5'], [2, 2, '5'], [2, 3, '3']];
const SUM = {
  type: 'grid', rows: 3, cols: 4, shaded: 0, cellSize: 56,
  legend: '3,600 - 47 = 3,553',
  cellText: [...MINUEND, ...REST],
  regroup: [[0, 1, '5'], [0, 2, '9'], [0, 3, '10']],
};

// ── DEFECT 1 — one header per column track ──────────────────────────────────

describe('column headers sit over the columns they name', () => {
  const each = (spec) => {
    const svg = grid.render(spec);
    const drawn = texts(svg).filter((t) => HEADERS.includes(t.text));
    return { svg, drawn, centres: columnCentres(svg) };
  };

  test('colLabels: an array draws one label centred on each column track', () => {
    const { drawn, centres } = each({ ...SUM, colLabels: HEADERS });
    expect(drawn.map((t) => t.text)).toEqual(HEADERS);
    expect(centres).toHaveLength(4);
    drawn.forEach((t, i) => {
      expect(t.anchor).toBe('middle');
      expect(t.x).toBeCloseTo(centres[i], 1);
    });
  });

  test('colLabel: the space-padded string she actually shipped is treated as that array', () => {
    // The whole point of keeping the string form: her document must render correctly
    // WITHOUT being re-authored.
    const { drawn, centres } = each({ ...SUM, colLabel: PADDED });
    expect(drawn.map((t) => t.text)).toEqual(HEADERS);
    drawn.forEach((t, i) => expect(t.x).toBeCloseTo(centres[i], 1));
    // and the bunched single string is GONE
    expect(texts(grid.render({ ...SUM, colLabel: PADDED })).some((t) => /Th\s+H/.test(t.text))).toBe(false);
  });

  test('the headers sit ABOVE the grid, clear of the first row of cells', () => {
    const svg = grid.render({ ...SUM, colLabels: HEADERS });
    const top = rowBands(svg)[0][0];
    const heads = texts(svg).filter((t) => HEADERS.includes(t.text));
    expect(heads).toHaveLength(4);
    expect(heads.every((t) => t.y < top)).toBe(true);
    expect(checkOverlaps(svg)).toEqual([]);
    expect(escaped(svg)).toEqual([]);
  });

  test('a count that does not match `cols` refuses loudly — one centred label, as before', () => {
    // A four-word PHRASE over two columns is a phrase, not a header row. Splitting it would
    // mis-align it silently; the old centred behaviour is the correct refusal.
    const svg = grid.render({
      type: 'grid', rows: 2, cols: 2,
      colLabel: 'Responsibilities (benefit the community)',
      cellText: [[0, 0, 'Voting'], [1, 1, 'Paying taxes']],
    });
    const drawn = texts(svg).filter((t) => /Responsibilities/.test(t.text));
    expect(drawn).toHaveLength(1);
    expect(drawn[0].x).toBeCloseTo((columnCentres(svg)[0] + columnCentres(svg)[1]) / 2, 1);
  });

  test('the resolver is the single place that decides, and it is pure', () => {
    expect(notation.resolveColLabels({ colLabels: HEADERS }, 4).perColumn).toEqual(HEADERS);
    expect(notation.resolveColLabels({ colLabel: PADDED }, 4).perColumn).toEqual(HEADERS);
    expect(notation.resolveColLabels({ colLabel: PADDED }, 3).perColumn).toBeNull();
    expect(notation.resolveColLabels({ colLabel: PADDED }, 3).single).toBe(PADDED);
    expect(notation.resolveColLabels({ colLabel: '6' }, 6).perColumn).toBeNull();
    expect(notation.resolveColLabels({}, 4)).toEqual({ perColumn: null, single: undefined });
  });
});

// ── DEFECT 2 — renaming is a mark on the minuend, not a second row ───────────

describe('regrouping is written over the minuend, in the minuend row', () => {
  const svg = () => grid.render({ ...SUM, colLabels: HEADERS });

  test('the grid stays three rows — renaming did not become a fourth', () => {
    expect(rowBands(svg())).toHaveLength(3);
  });

  test('each renamed digit is struck through, with a skip-marked rule over its own glyph', () => {
    const strikes = rules(svg()).filter((l) => l.skip);
    expect(strikes).toHaveLength(3);
    const [band] = rowBands(svg());
    for (const s of strikes) {
      expect(s.y1).toBe(s.y2);                       // horizontal
      expect(s.y1).toBeGreaterThan(band[0]);         // inside the MINUEND row
      expect(s.y1).toBeLessThan(band[1]);
      expect(s.x2 - s.x1).toBeLessThan(20);          // over one glyph, not the cell
    }
  });

  test('the renamed values are small, above and left of the digit, in the same row', () => {
    const s = svg();
    const marks = texts(s).filter((t) => ['5', '9', '10'].includes(t.text) && t.size < 13);
    expect(marks.map((t) => t.text)).toEqual(['5', '9', '10']);
    const [band] = rowBands(s);
    const centres = columnCentres(s);
    marks.forEach((m, i) => {
      expect(m.size).toBeLessThan(13);               // SMALL — the struck original is full size
      expect(m.size).toBeGreaterThanOrEqual(12);     // ...but never under the engine's floor
      expect(m.y).toBeGreaterThan(band[0]);          // INSIDE the minuend row
      expect(m.y).toBeLessThan((band[0] + band[1]) / 2); // above the digit's centre line
      expect(m.x).toBeLessThan(centres[i + 1]);      // and left of it
    });
  });

  test('nothing the mark touches collides — column header above, digit below', () => {
    expect(checkOverlaps(svg())).toEqual([]);
    expect(escaped(svg())).toEqual([]);
  });

  test('a regroup entry with no new value strikes the digit and draws no mark', () => {
    const s = grid.render({ ...SUM, regroup: [[0, 1]] });
    expect(rules(s).filter((l) => l.skip)).toHaveLength(1);
    expect(texts(s).filter((t) => t.size < 13)).toEqual([]);
  });

  test('the five-digit row is not needed at all — no cell carries two glyphs', () => {
    const s = svg();
    const centres = columnCentres(s);
    const [band] = rowBands(s);
    const inMinuend = texts(s).filter(
      (t) => t.size >= 13 && t.y > band[0] && t.y < band[1] && centres.some((c) => Math.abs(c - t.x) < 1)
    );
    expect(inMinuend.map((t) => t.text)).toEqual(['3', '6', '0', '0']);
  });

  test('the normaliser drops junk entries instead of drawing at NaN', () => {
    expect(notation.resolveRegroup({ regroup: [[0, 1, '5'], null, ['x', 2, '9'], [1, 1]] })).toEqual([
      { r: 0, c: 1, value: '5' },
      { r: 1, c: 1, value: '' },
    ]);
    expect(notation.resolveRegroup({})).toEqual([]);
  });
});

describe('an Urdu place-value grid regroups too', () => {
  const UR = {
    type: 'grid', rows: 3, cols: 4, cellSize: 56, lang: 'ur',
    colLabels: ['ہزار', 'سو', 'دس', 'اکائی'],
    cellText: [[0, 0, '۳'], [0, 1, '۶'], [0, 2, '۰'], [0, 3, '۰'], [2, 0, '۳'], [2, 1, '۵']],
    regroup: [[0, 1, '۵'], [0, 2, '۹'], [0, 3, '۱۰']],
  };

  test('it renders clean, stays on the canvas and uses eastern-Arabic digits', () => {
    const s = grid.render(UR);
    expect(checkOverlaps(s)).toEqual([]);
    expect(escaped(s)).toEqual([]);
    expect(s).toMatch(/[۰-۹]/);
    expect(s).not.toMatch(/[٠-٩]/); // never the Arabic-Indic set
  });

  test('no Urdu box pins a px line-height — that clips Nastaliq descenders', () => {
    expect(grid.render(UR)).not.toMatch(/line-height:\s*[\d.]+px/);
  });
});

// ── every grid in the corpus renders byte-identically ────────────────────────

describe('the change is additive: the corpus is untouched', () => {
  const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

  // Hashes captured from the module BEFORE this change. A grid spec that uses neither new
  // key must come out of the renderer as the same string, to the byte.
  const CORPUS = [
    ['hundred square', { type: 'grid', rows: 10, cols: 10, shaded: 37, majorEvery: 5 }, '6a4101e640b7797f'],
    ['v9 gate fixture', { type: 'grid', rows: 10, cols: 10, shaded: 25, majorEvery: 5 }, '76df4b878e1f7e1a'],
    ['G6 integer signs', {
      type: 'grid', rows: 2, cols: 2, shaded: 2, majorEvery: 2,
      legend: 'Same signs (+ , +) or (− , −) → product is POSITIVE. Different signs (+ , −) or (− , +) → product is NEGATIVE.',
      caption: 'The four sign combinations for multiplying two integers — two of the four squares give a positive product.',
    }, 'b1a39fe8d6ce3581'],
    ['area model with digits', {
      type: 'grid', rows: 4, cols: 6, cellSize: 34, shaded: 24,
      rowLabel: '4', colLabel: '6', cellText: [[0, 0, '1'], [1, 1, '2']],
    }, '3bc8ab3e49728374'],
    ['p.62 comparison table', {
      type: 'grid', rows: 5, cols: 2,
      rowLabel: 'Duties (required by law)',
      colLabel: 'Responsibilities (benefit the community)',
      title: 'Duties of Citizens vs. Rights and Responsibilities of Citizens (p.62)',
      cellText: [
        [0, 0, 'Obeying laws'], [0, 1, 'Voting'],
        [1, 0, 'Paying taxes'], [1, 1, 'Attending civic meetings'],
        [2, 0, 'Defending the nation'], [2, 1, 'Petitioning the government'],
        [3, 0, 'Registering for selective service'], [3, 1, 'Running for offices'],
        [4, 0, 'Performing duty on juries'], [4, 1, 'Serving community services'],
      ],
    }, 'e6de07f9d294ca6b'],
    ['shipped example: grid_percent_37', null, '2e40fc3a4d217b89'],
    ['shipped example: grid_area_model_ur', null, 'f53b2bfac24872cc'],
  ];

  it.each(CORPUS)('%s is byte-identical', (name, spec, want) => {
    const s = spec || grid.examples[name.endsWith('_ur') ? 1 : 0].spec;
    expect({ [name]: sha(grid.render(s)) }).toEqual({ [name]: want });
  });

  test('the shipped examples still draw clean', () => {
    for (const ex of grid.examples) {
      expect({ [ex.name]: checkOverlaps(grid.render(ex.spec)) }).toEqual({ [ex.name]: [] });
    }
  });

  test('a grid with neither new key never emits a skip-marked rule', () => {
    expect(rules(grid.render({ type: 'grid', rows: 4, cols: 4, shaded: 6 })).some((l) => l.skip)).toBe(false);
  });
});
