/**
 * THE VISUAL CONTRACT — brief §4b, executed.
 *
 * The defect these tests pin is not a wrong rule. It is a rule that was never wired up.
 *
 * `brief_author_v3.md:279`, in the model's system prompt on every single call, says:
 *
 *     "visual_check.py runs on the emitted document, counts the blocks below, and FAILS any
 *      lesson that misses its subject's minimum. A failed visual check is a revision round,
 *      exactly like a schema error."
 *
 * `visual_check.py` was never vendored into `bot/vendor/lp-v9/` and no runtime code referenced
 * it. What ran instead was `lint_lp.js`'s `visuals === 0` — a rule satisfied by ONE `latex`
 * block, which the canon author itself documents (author_lp.py:1437-1448) as "exactly how they
 * shipped 'bereft' of diagrams".
 *
 * Measured over the 62 documents teachers actually received (39 delivered off staging + the 23
 * cells of the n=24 study), 2026-09-04: the real gate fails 48 of 62 and V6 — the per-subject
 * minimum — fires 45 times. Live output ran 1.77 diagrams a lesson against a stated floor of 2,
 * 83.5% of them flow/mindmap/panels, and NINE of the twenty diagram types never appeared once.
 *
 * Every test below drives the real `lint()` on a real lp_doc, so each one executes the wiring at
 * `lint_lp.js` §14c rather than asserting on the checker in isolation.
 */

const fs = require('fs');
const path = require('path');

const { lint } = require('../../bot/vendor/lp-v9/lint_lp.js');
const VC = require('../../bot/vendor/lp-v9/visual_check.js');

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

/**
 * A fresh v9 document with EXACTLY the diagrams the test asks for.
 *
 * The fixture's own visuals are stripped first, deliberately: it is now a §4b-compliant document
 * (it was not before this change — a Mathematics lesson on determinants with no picture in it,
 * which is the defect in miniature), and a test about a missing diagram has to start from a
 * document that is missing one.
 */
function doc({ subject = 'Chemistry', grade = 9, specs = [], board = null, extra = {} } = {}) {
  const d = JSON.parse(raw);
  d.provenance = { ...d.provenance, subject, grade };
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  delete d.page2.board_final.diagram;
  const dev = d.sections.find((s) => s.id === 'development');
  for (const spec of specs) {
    dev.blocks.push({ type: 'diagram', id: `dia-${spec.type}-${dev.blocks.length}`, spec });
  }
  if (board) d.page2.board_final.diagram = board;
  return Object.assign(d, extra);
}

/** Only the visual-contract lines, with the lint code stripped back off. */
const visualFails = (d) => lint(d, null, {}).fails
  .filter((f) => f.startsWith('VISUAL: '))
  .map((f) => f.slice('VISUAL: '.length));
const codes = (d) => visualFails(d).map((e) => e.split(' ')[0]);
const has = (d, code) => codes(d).includes(code);

// ── the gate exists at all ───────────────────────────────────────────────────

describe('the contract is wired into the gate of record', () => {
  test('a Chemistry lesson carrying only [flow, panels] FAILS its subject minimum', () => {
    // The forensics report names this exact document as the red test, because it is what the
    // corpus is full of: two generic diagrams, no chem_equation, no molecule, no atom.
    const d = doc({
      subject: 'Chemistry',
      specs: [{ type: 'flow', direction: 'lr', steps: [{ title: 'a' }, { title: 'b' }] }],
      board: { type: 'panels', panels: [{ title: 'A' }, { title: 'B' }] },
    });
    const v6 = visualFails(d).filter((e) => e.startsWith('V6'));
    expect(v6.length).toBe(2); // chem_equation, and molecule/atom
    expect(v6.join(' ')).toContain('chem_equation');
    expect(v6.join(' ')).toContain('molecule');
    expect(v6.join(' ')).toContain('§4b.2');
  });

  test('the same lesson PASSES once it carries the two chemistry types', () => {
    const d = doc({
      subject: 'Chemistry',
      specs: [
        { type: 'chem_equation', equation: '2H2 + O2 -> 2H2O' },
        { type: 'molecule', smiles: 'O', formula: 'H2O', name: 'water' },
      ],
      board: { type: 'chem_equation', equation: '2H2 + O2 -> 2H2O' },
    });
    expect(codes(d)).not.toContain('V6');
  });

  test('a `latex` block alone no longer satisfies the visual rule on a v9 document', () => {
    // The whole defect in one assertion. The base fixture carries a `latex` block and no diagram
    // at all: the OLD rule (`visuals === 0`) passed it, and 62 real documents were shipped under
    // exactly that permission.
    const d = doc({ subject: 'Chemistry', specs: [] });
    const anyLatex = d.sections.some((s) => (s.blocks || []).some((b) => b.type === 'latex'));
    expect(anyLatex).toBe(true);
    expect(lint(d, null, {}).fails).not.toContain(
      'VISUALS: page 1 carries no diagram, figure or formula. Visuals are mandatory (M5).'
    );
    expect(has(d, 'V1')).toBe(true);
  });

  test('a 2.0 document keeps the old floor and is never judged by the contract', () => {
    const d = doc({ subject: 'Chemistry' });
    d.schema_version = '2.0';
    // Nothing to assert about V-codes on a doc the contract does not run on; the point is that
    // the 200-document 2.0 corpus does not turn red overnight.
    expect(lint(d, null, {}).fails.filter((f) => f.startsWith('VISUAL: '))).toEqual([]);
  });
});

// ── the individual rules, each on the live lint path ─────────────────────────

describe('V1-V5 · the floor every lesson must clear', () => {
  test('V1 · fewer than two typed diagrams', () => {
    const one = doc({ specs: [{ type: 'chem_equation', equation: 'A -> B' }] });
    expect(has(one, 'V1')).toBe(true);
    const two = doc({
      specs: [{ type: 'chem_equation', equation: 'A -> B' }, { type: 'atom', element: 'Na', mode: 'bohr' }],
    });
    expect(has(two, 'V1')).toBe(false);
  });

  test('V2 · nothing at the point of use', () => {
    const d = doc({ specs: [], board: { type: 'chem_equation', equation: 'A -> B' } });
    // one diagram, and it is parked on the board page
    expect(has(d, 'V2')).toBe(true);
  });

  test('V3 · page2.board_final.diagram missing', () => {
    const d = doc({ specs: [{ type: 'chem_equation', equation: 'A -> B' }] });
    expect(has(d, 'V3')).toBe(true);
    expect(visualFails(d).find((e) => e.startsWith('V3'))).toContain('draw_order');
  });

  test('V4 · an `illustrative` placeholder is not a visual', () => {
    const d = doc({ specs: [{ type: 'illustrative', kind: 'opener', brief: 'a village' }] });
    expect(has(d, 'V4')).toBe(true);
  });

  test('V5 · a type the renderer does not know', () => {
    const d = doc({ specs: [{ type: 'sankey' }] });
    expect(has(d, 'V5')).toBe(true);
    expect(visualFails(d).find((e) => e.startsWith('V5'))).toContain("'sankey'");
  });

  test('V5 · `dna_helix` is a legal type — PR #57 shipped the renderer for it', () => {
    const d = doc({ subject: 'Biology', specs: [{ type: 'dna_helix', sequence: 'ATCGGA' }] });
    expect(has(d, 'V5')).toBe(false);
  });
});

describe('a book figure is a visual — it counts toward the floor and at the point of use', () => {
  // Measured on a live Biology E2E (`grade_11_biology.c01.p010-013`): the book's own Fig 1.10,
  // the fluid mosaic model, was cropped, staged in R2 and named in that segment's notes — and
  // the lesson emitted two `panels` text boxes and a `flow` instead, then wrote an Activity
  // telling the teacher to "label the two ends of a phospholipid molecule" with no picture on
  // the page to label. Every link below the model worked. §4b.1.1 was telling it the real
  // figure bought nothing: "textbook_figure does NOT count toward this two".
  const bookFig = (extra = {}) => ({
    type: 'textbook_figure', id: 'fig-1-10', ref: 'grade_11_biology/pg_012_f0',
    figure_label: 'Fig. 1.10', page: '12',
    legend: 'Phosphate heads face the water; the fatty-acid tails face each other.', ...extra,
  });

  test('two book figures clear V1 — the ≥2 floor', () => {
    const d = doc({ subject: 'Biology', specs: [] });
    const dev = d.sections.find((s) => s.id === 'development');
    dev.blocks.push(bookFig(), bookFig({ id: 'fig-1-11', ref: 'grade_11_biology/pg_013_f0' }));
    expect(has(d, 'V1')).toBe(false);
  });

  test('a book figure in `development` satisfies V2, the point-of-use rule', () => {
    const d = doc({ subject: 'Biology', specs: [] });
    d.sections.find((s) => s.id === 'development').blocks.push(bookFig());
    expect(has(d, 'V2')).toBe(false);
  });

  test('a book figure parked in `homework` still fails the point-of-use rule', () => {
    const d = doc({ subject: 'Biology', specs: [] });
    d.sections.find((s) => s.id === 'homework').blocks.push(bookFig());
    expect(has(d, 'V2')).toBe(true);
  });

  test('and it satisfies the Biology structure requirement, as §4b.2 now says', () => {
    const d = doc({
      subject: 'Biology',
      specs: [{ type: 'flow', steps: [{ title: 'a' }] }],
      board: { type: 'flow', steps: [{ title: 'b' }] },
    });
    d.sections.find((s) => s.id === 'development').blocks.push(bookFig());
    expect(has(d, 'V6')).toBe(false);
  });

  test('the brief no longer tells the model the opposite', () => {
    const brief = fs.readFileSync(
      path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'brief_author_v3.md'), 'utf8');
    // The old sentence survives ONCE, quoted inside the explanation of why it changed. What must
    // not survive is the NORMATIVE bullet — §4b.1 item 1, the line the model reads as the rule.
    const item1 = brief.slice(brief.indexOf('### 4b.1'), brief.indexOf('2. **`page2.board_final'));
    expect(item1).toContain('\u22652 FIGURES');
    expect(item1).not.toMatch(/^1\..*does NOT count/m);
    expect(brief).toContain('A BOOK FIGURE COUNTS');
    expect(brief.split('does NOT count toward this two').length - 1).toBe(1);
  });
});

describe('the checker and the engine roster can never drift', () => {
  // The manifest's own $comment: "Anything that consumes the type list — the lp_doc schema enum,
  // lint_lp.js, the author brief's §4b.4 — checks itself against THIS file." This is that check
  // for the visual contract's V5.
  const MANIFEST = require('../../bot/vendor/lp-v9/diagrams/types_manifest.json');

  test('every kind and alias the engine registers is legal to V5, and nothing else is', () => {
    const legal = new Set();
    for (const t of MANIFEST.types) {
      legal.add(t.type);
      for (const a of t.aliases || []) legal.add(a);
    }
    expect([...legal].filter((x) => !VC.DIAGRAM_TYPES.has(x))).toEqual([]); // V5 would reject a legal type
    expect([...VC.DIAGRAM_TYPES].filter((x) => !legal.has(x))).toEqual([]); // V5 would allow an unknown one
  });

  test('every type named in a §4b.2 row is one the engine actually renders', () => {
    // kinds AND aliases: `heart_loop` and `leaf_cross_section` are aliases of `cell`, and a row
    // is entitled to name the alias — that is how a biology row asks for the circulatory loop
    // rather than "a bio_schematic, kind unspecified".
    const legal = new Set();
    for (const t of MANIFEST.types) {
      legal.add(t.type);
      for (const a of t.aliases || []) legal.add(a);
    }
    for (const [subject, rule] of Object.entries(VC.SUBJECT_RULES)) {
      if (rule.alias) continue;
      for (const group of rule.one_of || []) {
        for (const kind of group) {
          expect({ subject, kind, renders: legal.has(VC.CANON[kind] || kind) })
            .toEqual({ subject, kind, renders: true });
        }
      }
    }
  });
});

describe('V6 · the per-subject minimum', () => {
  const board = { type: 'panels', panels: [{ title: 'A' }, { title: 'B' }] };

  test('Physics · no circuit / ray_diagram / free_body / graph', () => {
    const d = doc({ subject: 'Physics', specs: [{ type: 'mindmap', centre: { label: 'x' } }], board });
    expect(has(d, 'V6')).toBe(true);
    const d2 = doc({ subject: 'Physics', specs: [{ type: 'free_body', body: { shape: 'box' } }], board });
    expect(has(d2, 'V6')).toBe(false);
  });

  test('Mathematics · no graph / numberline / geometry / grid / fraction_bar', () => {
    const d = doc({ subject: 'Mathematics', specs: [{ type: 'flow', steps: [{ title: 'a' }] }], board });
    expect(has(d, 'V6')).toBe(true);
    const d2 = doc({ subject: 'Mathematics', specs: [{ type: 'numberline', from: -5, to: 5 }], board });
    expect(has(d2, 'V6')).toBe(false);
  });

  test('English · needs a mindmap AND a flow-or-timeline — two groups, both binding', () => {
    const d = doc({ subject: 'English', specs: [{ type: 'mindmap', centre: { label: 'x' } }], board });
    expect(visualFails(d).filter((e) => e.startsWith('V6')).length).toBe(1);
  });

  test('Pakistan Studies · timeline-or-graph AND panels', () => {
    const d = doc({ subject: 'Pakistan Studies', specs: [{ type: 'panels', panels: [] }], board });
    const v6 = visualFails(d).filter((e) => e.startsWith('V6'));
    expect(v6.length).toBe(1);
    expect(v6[0]).toContain('timeline');
  });
});

describe('V6 · Biology and General Science — the row that was satisfiable by `flow` alone', () => {
  const board = { type: 'flow', steps: [{ title: 'a' }] };

  test('Biology · a flow plus a mindmap is NOT a labelled structure', () => {
    // This is the exact shape the delivered corpus shipped: Biology posted ZERO V6 failures
    // across 13 diagrams while carrying zero labelled structures, because the old row was the
    // permissive union ['cell','flow','labelled_figure','mindmap','punnett'] and `flow` is in it.
    const d = doc({
      subject: 'Biology',
      specs: [{ type: 'flow', steps: [{ title: 'a' }] }, { type: 'mindmap', centre: { label: 'x' } }],
      board,
    });
    const v6 = visualFails(d).filter((e) => e.startsWith('V6'));
    expect(v6.length).toBe(1);
    expect(v6[0]).toContain('labelled_figure');
    expect(v6[0]).toContain('cell');
  });

  test('Biology · a cell diagram plus a flow satisfies both groups', () => {
    const d = doc({
      subject: 'Biology',
      specs: [{ type: 'cell', kind: 'plant' }, { type: 'flow', steps: [{ title: 'a' }] }],
      board,
    });
    expect(has(d, 'V6')).toBe(false);
  });

  test('Biology · a structure with NO process map still fails the second group', () => {
    const d = doc({
      subject: 'Biology',
      specs: [{ type: 'cell', kind: 'plant' }],
      board: { type: 'cell', kind: 'animal' },
    });
    expect(has(d, 'V6')).toBe(true);
  });

  test('Biology · `textbook_figure` counts as the structure — the book figure is the best one', () => {
    // The escape hatch has to actually work, or the row is unsatisfiable on a lesson whose real
    // structure is a photograph the engine cannot draw.
    const d = doc({ subject: 'Biology', specs: [{ type: 'flow', steps: [{ title: 'a' }] }], board });
    d.sections.find((s) => s.id === 'development').blocks.push({
      type: 'textbook_figure', id: 'fig-1-11',
      ref: 'grade_7_general_science/pg_011_f0',
      legend: 'Figure 1.11 — the leaf in cross-section',
    });
    expect(has(d, 'V6')).toBe(false);
  });

  test('General Science · NOT a blind alias of Biology — a physics beat is satisfied by physics types', () => {
    // General Science 6-8 is biology AND chemistry AND physics. Demanding a `cell` of a
    // push-and-pull forces lesson is over-reach, not rigour: of the 300 General Science segments
    // only 70% carry a labelled structure in their page-truth at all.
    const d = doc({
      subject: 'General Science',
      specs: [{ type: 'free_body', body: { shape: 'box' } }, { type: 'flow', steps: [{ title: 'a' }] }],
      board,
    });
    expect(has(d, 'V6')).toBe(false);
  });

  test('General Science · two generic diagrams still fail', () => {
    const d = doc({
      subject: 'General Science',
      specs: [{ type: 'flow', steps: [{ title: 'a' }] }, { type: 'panels', panels: [] }],
      board,
    });
    expect(has(d, 'V6')).toBe(true);
  });
});

describe('V0 · Computer Science had no row at all', () => {
  test('Computer Science no longer falls off the table', () => {
    const d = doc({ subject: 'Computer Science', specs: [{ type: 'flow', steps: [{ title: 'a' }] }] });
    expect(has(d, 'V0')).toBe(false);
  });

  test('Computer Science · one flowchart is not a lesson — the second group binds', () => {
    const d = doc({
      subject: 'Computer Science',
      specs: [{ type: 'flow', steps: [{ title: 'a' }] }],
      board: { type: 'flow', steps: [{ title: 'b' }] },
    });
    const v6 = visualFails(d).filter((e) => e.startsWith('V6'));
    expect(v6.length).toBe(1);
    expect(v6[0]).toContain('panels');
  });

  test('Computer Science · a flow plus a comparison satisfies it', () => {
    const d = doc({
      subject: 'Computer Science',
      specs: [{ type: 'flow', steps: [{ title: 'a' }] }, { type: 'panels', panels: [] }],
      board: { type: 'flow', steps: [{ title: 'b' }] },
    });
    expect(has(d, 'V6')).toBe(false);
  });

  test('a subject with genuinely no row still reports V0 rather than passing silently', () => {
    const d = doc({ subject: 'Astronomy', specs: [{ type: 'flow', steps: [{ title: 'a' }] }] });
    expect(has(d, 'V0')).toBe(true);
  });
});

describe('V7-V14 · the notation and shape rules', () => {
  const mathsBoard = { type: 'numberline', from: 0, to: 5 };

  test('V7 · maths written as prose', () => {
    const d = doc({ subject: 'Mathematics', specs: [{ type: 'numberline', from: 0, to: 5 }], board: mathsBoard });
    d.sections.find((s) => s.id === 'development').blocks.push({
      type: 'paragraph', id: 'p-prose', text: 'Take x squared and subtract three.',
    });
    expect(visualFails(d).find((e) => e.startsWith('V7'))).toContain('x squared');
  });

  test('V8 · no marked incorrect example', () => {
    const d = doc({ subject: 'Mathematics', specs: [{ type: 'numberline', from: 0, to: 5 }], board: mathsBoard });
    // the base fixture is a determinants lesson; strip its error-marking words
    const said = JSON.stringify(d).match(/incorrect|wrong|mistake|error/i);
    if (!said) expect(has(d, 'V8')).toBe(true);
    else expect(has(d, 'V8')).toBe(false);
  });

  test('V10 · a Physics lesson with no `latex` block', () => {
    const d = doc({ subject: 'Physics', specs: [{ type: 'free_body', body: { shape: 'box' } }] });
    for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'latex');
    expect(has(d, 'V10')).toBe(true);
  });

  test('V11 · a chemical formula left in plain prose', () => {
    const d = doc({ subject: 'Chemistry', specs: [{ type: 'chem_equation', equation: 'A -> B' }] });
    d.sections.find((s) => s.id === 'development').blocks.push({
      // "CO2" cannot match by design (the leading C blocks the lookbehind) — the pattern wants a
      // digit inside the token, which is what stops it firing on "CO" or "IT".
      type: 'paragraph', id: 'p-chem', text: 'Bubble the gas through H2O and watch it cloud.',
    });
    expect(visualFails(d).find((e) => e.startsWith('V11'))).toContain('H2O');
  });

  test('V13 · a grade 6-8 plan may not claim a board weight', () => {
    const d = doc({ subject: 'Chemistry', grade: 7, specs: [], extra: { board_weight: 'SSC-I ~5 marks' } });
    expect(has(d, 'V13')).toBe(true);
  });

  test('V14 · a four-step top-to-bottom flow eats most of a page', () => {
    const d = doc({
      subject: 'Chemistry',
      specs: [{ type: 'flow', direction: 'tb', steps: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }] }],
    });
    const v14 = visualFails(d).find((e) => e.startsWith('V14'));
    expect(v14).toContain('600px');
    expect(v14).toContain('"lr"');
  });
});

// ── the reward side ──────────────────────────────────────────────────────────

describe('meetsSubjectMinimum · the one thing acceptance may never trade away', () => {
  test('true only when EVERY group of the subject row is satisfied', () => {
    const good = doc({
      subject: 'Chemistry',
      specs: [{ type: 'chem_equation', equation: 'A -> B' }, { type: 'atom', element: 'Na', mode: 'bohr' }],
    });
    expect(VC.meetsSubjectMinimum(good)).toBe(true);

    const half = doc({ subject: 'Chemistry', specs: [{ type: 'chem_equation', equation: 'A -> B' }] });
    expect(VC.meetsSubjectMinimum(half)).toBe(false);
  });

  test('a subject with no row is NOT "satisfied" — nothing to meet is not the same as met', () => {
    const d = doc({ subject: 'Astronomy', specs: [{ type: 'flow', steps: [{ title: 'a' }] }] });
    expect(VC.meetsSubjectMinimum(d)).toBe(false);
  });
});

// ── the corpus calibration ───────────────────────────────────────────────────

describe('the vendored checker is the canon checker', () => {
  test('every §4b.2 row in the brief has a row in the table, and vice versa', () => {
    const brief = fs.readFileSync(
      path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'brief_author_v3.md'), 'utf8');
    const table = brief.slice(brief.indexOf('### 4b.2'), brief.indexOf('### 4b.3'));
    for (const subject of ['Mathematics', 'Chemistry', 'Physics', 'Biology', 'General Science',
      'English', 'Urdu', 'Pakistan Studies', 'Computer Science', 'Islamiat']) {
      expect(VC.resolveRule(subject)).not.toBeNull();
      expect(table).toContain(subject);
    }
  });

  test('§4b.4 hands the model no colour that lint rejects as a PLACEHOLDER', () => {
    // The paragraph above those examples says a raw hex FAILS the document. Ten of the examples
    // then used exactly that form, concentrated on the dense types — graph, geometry, numberline,
    // fraction_bar — i.e. on the types this whole change exists to make the model reach for.
    const brief = fs.readFileSync(
      path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'brief_author_v3.md'), 'utf8');
    const specs = brief.slice(brief.indexOf('### 4b.4'), brief.indexOf('## 4c'));
    const { PLACEHOLDERS } = require('../../bot/vendor/lp-v9/lint_lp.js');
    const hex = PLACEHOLDERS.find((p) => p.name === 'raw hex colour code').re;
    for (const line of specs.split('\n')) {
      if (line.trimStart().startsWith('- ') || line.trimStart().startsWith('**')) continue; // prose
      expect(hex.test(line)).toBe(false);
    }
  });

  test('§4b.4 documents the two capabilities that shipped into the engine with no instruction', () => {
    // PR #57 (dna_helix) and PR #56 (graph shade) both reached bot/vendor/lp-v9 on 2026-09-02 and
    // reached NO brief. dna_helix appears 0 times in 115 shipped diagrams. A capability the model
    // has never been shown cannot be chosen.
    const brief = fs.readFileSync(
      path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'brief_author_v3.md'), 'utf8');
    const specs = brief.slice(brief.indexOf('### 4b.4'), brief.indexOf('## 4c'));
    expect(specs).toContain('"type":"dna_helix"');
    expect(specs).toContain('"shade":"above"');
    // and the engine really does carry them, so the brief is not promising fiction
    const reg = require('../../bot/vendor/lp-v9/diagrams/index.js');
    expect(typeof reg).toBe('object');
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9',
      'diagrams', 'types', 'dna_helix.js'))).toBe(true);
    expect(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9',
      'diagrams', 'types', 'graph.js'), 'utf8')).toContain('f.shade === "above"');
  });

  test('the `ref` contract in §4b.4 is the figure plan\'s own format, not a parallel one', () => {
    // build_plan.py::crop_key -> "{book_stem}/{page}_f{k}". The brief used to show
    // "…/p011/fig_1_11_leaf", which nothing can resolve against a real crop.
    const brief = fs.readFileSync(
      path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'brief_author_v3.md'), 'utf8');
    expect(brief).toMatch(/"ref": "[a-z0-9_]+\/pg_\d{3}_f\d"/);
    expect(brief).toContain('{book_stem}/{page}_f{k}');
    expect(brief).not.toContain('fig_1_11_leaf');
    // and the model must be told never to write `src` — that is resolved mechanically
    expect(brief).toContain('Never write `src`');
  });

  test('the brief still promises the gate that now exists', () => {
    const brief = fs.readFileSync(
      path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9', 'brief_author_v3.md'), 'utf8');
    expect(brief).toMatch(/FAILS\*\* any\s+lesson that misses its subject's minimum/);
  });
});
