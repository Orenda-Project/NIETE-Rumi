/**
 * bd-2hmag part A — ATOM GRANULARITY: the atoms that were taller than the hole they had to fill.
 *
 * OPERATOR, four times, most recently *"fix the wasted white space too"*. Measured across the
 * rendered corpus of 330 lessons, 1,039 of 2,016 non-final pages sit below the renderer's own 85%
 * fill floor. `packAtoms` is an exact DP and is page-optimal FOR THE ATOMS IT IS GIVEN — it cannot
 * put half a block in a hole because there was no half block. The atom that would not fit, counted
 * over the corpus and highest first:
 *
 *   114  `blk board sp-2` — one atom for 1..7 panels          → SPLIT, one atom per panel
 *    51  `blk exq sp-2`   — flat `steps`, never split at any length → SPLIT, one atom per step
 *    50  `blk sp-3`       — groupAtoms' label + card 1        → LEFT WHOLE on purpose (see below)
 *    22  `blk sp-2`       — key_points, never split           → SPLIT, one atom per item
 *    13  `blk pr sp-2`    — practice under the `>= 3` gate    → SPLIT at two items
 *
 * EVERY NEW SEAM IS `soft`, NEVER `glue`. `glue` forbids the break outright (render_lp.js:820-821)
 * and measured at +7 pages over the 38-lesson corpus when it was tried on the opening box;
 * `soft` (render_lp.js:827) charges the break as a `splits` cost, so a block stays whole wherever
 * staying whole is free and yields where it is not.
 *
 * WHAT MAY NOT BE CUT, and is pinned here:
 *   • a panel's own `.bb` rows are the drawing — the cut is BETWEEN panels, never inside one;
 *   • a connector describes the transition INTO the next panel (bd-i44jn), so it travels with the
 *     panel it PRECEDES, never printed after the one it follows;
 *   • a heading never orphans: the board label, the example tag, the key-points label and the
 *     practice tag each ride in the same atom as their first item;
 *   • a block WITH `turns` keeps the byte-for-byte piece shape `exqAtoms` has always emitted;
 *     its OPENER's seam was later reclassified `glue` → `soft` by bd-5jaag (see below);
 *   • groupAtoms' label and card 1 are one HTML string and stay one atom (they are the
 *     orphaned-heading failure this whole idiom exists to prevent).
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
/** The same fixture re-provenanced to grade 4 — the one thing `isPrimary` reads. */
const primaryDoc = () => {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  return d;
};

const built = (d) => buildHtml(d, { lang: 'en', docDir: path.dirname(FIXTURE) });

/**
 * The teach part's atoms, each with the class the packer sees AND the markup it owns.
 * `buildHtml` returns the flags; the body carries the classes, in the same order.
 */
function atoms(d) {
  const r = built(d);
  const body = r.html.split('</style>').pop();
  const hits = [...body.matchAll(/<[a-z]+ data-atom[^>]*class="([^"]*)"/g)];
  return r.atoms.teach.map((a, i) => {
    const next = hits[i + 1];
    return {
      ...a,
      cls: hits[i][1],
      html: body.slice(hits[i].index, next ? next.index : body.length),
    };
  });
}
const like = (d, rx) => atoms(d).filter((a) => rx.test(a.cls));
const count = (h, rx) => (h.match(rx) || []).length;

/** Make `block` the document's ONLY block of its type — the fixture authors two of several. */
function only(d, block) {
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== block.type);
  d.sections[0].blocks.unshift(block);
  return d;
}

const panels = (n) => Array.from({ length: n }, (_, i) => ({
  label: `Panel ${i + 1}`,
  connector: i ? `→ STEP ${i + 1} →` : undefined,
  rows: [{ term: `t${i + 1}`, gloss: `g${i + 1}` }, { text: `line ${i + 1}` }],
}));
const board = (n) => ({ type: 'board', id: 'board-plan', title: 'Chapter 9 review',
  text: 'fallback text', panels: panels(n) });

// ── 1. THE BOARD: ONE ATOM PER PANEL ────────────────────────────────────────
describe('a board is one atom per panel', () => {
  test('a seven-panel board is seven atoms, in authored order', () => {
    const a = like(only(baseDoc(), board(7)), /\bboard\b/);
    expect(a).toHaveLength(7);
    expect(a.map((x) => x.cls.replace(/\s*\bsp-\d\b/, ''))).toEqual([
      'blk board pc pc-a', ...Array(5).fill('blk board pc pc-m'), 'blk board pc pc-z',
    ]);
    expect(a.map((x) => (x.html.match(/<span class="bn">(\d+)<\/span>/) || [])[1]))
      .toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  test('a panel drawing is never torn: exactly one `.bb` per atom, all rows inside it', () => {
    for (const x of like(only(baseDoc(), board(7)), /\bboard\b/)) {
      expect(count(x.html, /<div class="bb">/g)).toBe(1);
      expect(count(x.html, /<div class="bp">|<div class="bp"/g)).toBe(1);
    }
  });

  test('a connector travels with the panel it PRECEDES, never the one it follows (bd-i44jn)', () => {
    const a = like(only(baseDoc(), board(7)), /\bboard\b/);
    expect(a[0].html).not.toContain('bcon');            // panel 1 has no connector
    for (let i = 1; i < 7; i++) {
      expect(a[i].html).toContain(`STEP ${i + 1}`);      // the connector INTO panel i+1
      expect(a[i].html.indexOf('bcon')).toBeLessThan(a[i].html.indexOf('class="bn"'));
    }
  });

  test('the board label and title ride panel 1, so a page never opens on a bare drawing', () => {
    const a = like(only(baseDoc(), board(7)), /\bboard\b/);
    expect(a[0].html).toContain('class="lbl"');
    expect(a[0].html).toContain('<div class="btitle">Chapter 9 review</div>');
    for (const x of a.slice(1)) expect(x.html).not.toContain('class="lbl"');
  });

  test('every authored word survives the split', () => {
    const h = built(only(baseDoc(), board(7))).html;
    for (let i = 1; i <= 7; i++) {
      for (const w of [`Panel ${i}`, `t${i}`, `g${i}`, `line ${i}`]) expect(h).toContain(w);
    }
  });

  test('a one-panel board is still ONE atom, with no seam classes', () => {
    const a = like(only(baseDoc(), board(1)), /\bboard\b/);
    expect(a).toHaveLength(1);
    expect(a[0].cls).toBe('blk board sp-2');
  });

  test('a text-only board (no panels) is untouched — one atom, no seam classes', () => {
    const d = only(baseDoc(), { type: 'board', id: 'board-plan', text: 'WRITE THIS UP' });
    const a = like(d, /\bboard\b/);
    expect(a).toHaveLength(1);
    expect(a[0].cls).toBe('blk board sp-2');
    expect(a[0].html).toContain('WRITE THIS UP');
  });

  test('the hoisted set-up board on a primary plan splits too — it is the same block', () => {
    // On a primary plan the introduction's board is hoisted into the set-up furniture and
    // re-emitted from the assembly, a second call site that must split identically.
    expect(like(only(primaryDoc(), board(5)), /\bboard\b/)).toHaveLength(5);
  });
});

// ── 2. THE FLAT-STEPS EXAMPLE ───────────────────────────────────────────────
const stepped = (d, n, id = 'ido') => {
  for (const s of d.sections) {
    for (const b of s.blocks || []) {
      if (b.id === id) { delete b.turns; b.steps = Array.from({ length: n }, (_, i) => `step ${i + 1}`); }
    }
  }
  return d;
};
const exq = (d) => like(d, /\bexq\b/).filter((a) => !/\bwe\b/.test(a.cls));

describe('a worked example with a flat `steps` list splits by step', () => {
  test('a 34-step example is 34 atoms, numbered 1..34 with nothing dropped', () => {
    const a = exq(stepped(baseDoc(), 34));
    expect(a).toHaveLength(34);
    const h = a.map((x) => x.html).join('');
    for (let i = 1; i <= 34; i++) expect(h).toContain(`step ${i}`);
    // The list keeps counting across the seam: piece n opens its <ol> at n.
    expect(a[1].html).toContain('start="2"');
    expect(a[33].html).toContain('start="34"');
  });

  test('the tag and the setup ride step 1; the result rides the last step', () => {
    const a = exq(stepped(baseDoc(), 34));
    expect(a[0].html).toContain('<span class="tag">');
    expect(a[0].cls.replace(/\s*\bsp-\d\b/, '')).toBe('blk exq pc pc-a');
    expect(a[33].cls.replace(/\s*\bsp-\d\b/, '')).toBe('blk exq pc pc-z');
    for (const x of a.slice(1)) expect(x.html).not.toContain('<span class="tag">');
  });

  test('a two-step example is one atom — there is no seam worth having', () => {
    const a = exq(stepped(baseDoc(), 2));
    expect(a).toHaveLength(1);
    expect(a[0].cls).toBe('blk exq sp-2');
  });

  test('the G6-12 control fixture is untouched: its examples are still one atom each', () => {
    // The fixture authors 5 and 4 steps, both under the seam gate.
    expect(like(baseDoc(), /\bexq\b/).map((a) => a.cls)).toEqual(['blk exq sp-2', 'blk exq we sp-2']);
  });
});

describe('a block WITH turns keeps the piece shape it has always had', () => {
  const TURNS = [
    { kind: 'do', text: 'Set out the four labelled boxes.' },
    { kind: 'say', text: 'Let us build the plan together.' },
    { kind: 'ask', text: 'What is 2023 plus 5?', expect: ['2028'] },
    { kind: 'frame', text: 'It opens in ___.' },
    { kind: 'say', text: 'Write the date under the title.' },
  ];
  const withTurns = (steps) => {
    const d = baseDoc();
    for (const s of d.sections) {
      for (const b of s.blocks || []) if (b.id === 'ido') { b.turns = TURNS; b.steps = steps; }
    }
    return d;
  };

  test('`steps` alongside `turns` changes nothing — turns still win, byte for byte', () => {
    const withoutSteps = exq(withTurns(undefined)).map((a) => ({ cls: a.cls, html: a.html }));
    const withSteps = exq(withTurns(Array.from({ length: 34 }, (_, i) => `step ${i + 1}`)))
      .map((a) => ({ cls: a.cls, html: a.html }));
    expect(withSteps).toEqual(withoutSteps);
  });

  test('and the turn-split shape is the one `exqAtoms` has always emitted', () => {
    expect(exq(withTurns(undefined)).map((a) => a.cls.replace(/\s*\bsp-\d\b/, '')))
      // five turns → turn 1 with the tag, three middles, the last turn with the result
      .toEqual(['blk exq pc pc-a', ...Array(3).fill('blk exq pc pc-m'), 'blk exq pc pc-z']);
  });

  // bd-5jaag. This assertion read `.glue === true` until 2026-09-24. bd-2hmag held this one
  // opener out of its own `soft`-everywhere rule, which forbade the break between TURN 1 and
  // TURN 2 that the shape above declares legal — and `glue` is not a tie-break the packer can
  // lose on fill pressure, it deletes the seam from the DP's search space. Measured over 112
  // re-rendered lessons, unforbidding it cost no lesson a page and saved four.
  test('but its opening seam is a soft cost, not a forbidden break (bd-5jaag)', () => {
    const a = exq(withTurns(undefined))[0];
    expect([a.glue, a.soft]).toEqual([false, true]);
  });
});

// ── 3. KEY POINTS ───────────────────────────────────────────────────────────
const kp = (n) => ({ type: 'key_points', id: 'remember', title: 'Remember',
  items: Array.from({ length: n }, (_, i) => `point ${i + 1}`) });
const kpAtoms = (d) => atoms(d).filter((a) => /class="kp"/.test(a.html));

describe('key_points is one atom per item', () => {
  test('a four-item list is four atoms, with every item printed once', () => {
    const a = kpAtoms(only(baseDoc(), kp(4)));
    expect(a).toHaveLength(4);
    const h = a.map((x) => x.html).join('');
    for (let i = 1; i <= 4; i++) expect(count(h, new RegExp(`point ${i}<`, 'g'))).toBe(1);
  });

  test('the label rides item 1 — a page never opens on a bare bullet', () => {
    const a = kpAtoms(only(baseDoc(), kp(4)));
    expect(a[0].html).toContain('Remember');
    expect(a[0].html).toContain('point 1');
    for (const x of a.slice(1)) expect(x.html).not.toContain('class="lbl g"');
  });

  test('a one-item list is one atom — there is nothing to split', () => {
    expect(kpAtoms(only(baseDoc(), kp(1)))).toHaveLength(1);
  });
});

// ── 4. PRACTICE AT TWO ITEMS ────────────────────────────────────────────────
const pr = (n) => ({ type: 'practice', id: 'youdo', mode: 'independent',
  items: Array.from({ length: n }, (_, i) => ({ q: `q${i + 1}`, a: `a${i + 1}` })) });

describe('a two-item practice list may break between its items', () => {
  test('two items are two atoms; the tag rides item 1', () => {
    const a = like(only(primaryDoc(), pr(2)), /\bpr\b/);
    expect(a).toHaveLength(2);
    expect(a[0].html).toContain('<span class="tag">');
    expect(a[0].html).toContain('q1');
    expect(a[1].html).toContain('q2');
  });

  test('one item is still one atom', () => {
    expect(like(only(primaryDoc(), pr(1)), /\bpr\b/)).toHaveLength(1);
  });

  // bd-5jaag. This asserted `.glue === true` at 3+ items until 2026-09-24. bd-2hmag kept `glue`
  // there on the theory that *"there are then later seams for the packer to use"*; replayed on
  // the real atom heights of 112 rendered lessons there are not — six lessons each spend a whole
  // page on that one forbidden seam, and unforbidding it costs no lesson a page.
  test('three or more items take a soft seam too, not a forbidden one (bd-5jaag)', () => {
    const a = like(only(primaryDoc(), pr(4)), /\bpr\b/);
    expect(a).toHaveLength(4);
    expect([a[0].glue, a[0].soft]).toEqual([false, true]);
    // and the tag still rides with item 1, so nothing orphans
    expect(a[0].html).toContain('<span class="tag">');
  });
});

// ── 5. EVERY NEW SEAM IS SOFT, AND NONE IS GLUE ─────────────────────────────
describe('the new seams are soft costs, never forbidden breaks', () => {
  const seamed = (d, rx) => like(d, rx);
  const cases = () => [
    ['board', seamed(only(baseDoc(), board(7)), /\bboard\b.*\bpc\b|\bpc\b.*\bboard\b/)],
    ['exq steps', exq(stepped(baseDoc(), 34))],
    ['key_points', kpAtoms(only(baseDoc(), kp(4)))],
    ['practice(2)', like(only(primaryDoc(), pr(2)), /\bpr\b/)],
  ];

  test('no atom of a newly split block forbids the break after it', () => {
    for (const [name, a] of cases()) {
      expect([name, a.map((x) => x.glue)]).toEqual([name, a.map(() => false)]);
    }
  });

  test('every piece but the last charges the packer a `splits` cost', () => {
    for (const [name, a] of cases()) {
      expect([name, a.map((x) => x.soft)])
        .toEqual([name, a.map((_, i) => i < a.length - 1)]);
    }
  });
});

// ── 6. WHAT IS DELIBERATELY LEFT WHOLE ──────────────────────────────────────
describe('groupAtoms keeps its label with card 1', () => {
  test('the label and the first card are one atom, as they have always been', () => {
    const a = atoms(primaryDoc()).filter((x) => /class="lbl g"/.test(x.html) && /class="card"/.test(x.html));
    expect(a.length).toBeGreaterThan(0);
    for (const x of a) expect(x.html.indexOf('lbl g')).toBeLessThan(x.html.indexOf('class="card"'));
  });
});
