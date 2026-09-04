/**
 * THE LADDER MUST STOP TRADING FIGURES FOR PAGES.
 *
 * The gate is only half the fix. The other half is that the revision ladder, as it stood, applied
 * one sustained instruction across five rounds and that instruction was DELETE.
 *
 * Measured over the n=24 study's 118 rounds (`measurement_2026-09-03/cells/*.json`,
 * `gate_rounds[].problems`): `PAGE COUNT` **158 occurrences**, `OVERFLOW` 7, `FIGURE TOO SMALL` 4.
 * `VISUALS` appears in a final defect list **once in 24 runs**. 23 of 24 cells burned all five
 * rounds. The prompt's page-count block says, verbatim, *"REMOVE WHOLE ITEMS instead… Shortening
 * sentences will NOT remove a page."* A diagram is the biggest single object on the page.
 *
 * And acceptance pointed the same way. `lint_lp.js` has FOUR rules that can only fire BECAUSE a
 * diagram is present — FIGURE (label under the 13.5px floor), DIAGRAM_OVERLAP,
 * DIAGRAM_DEGENERATE, DUPLICATE_DIAGRAM — and the dense subject-specific types are the ones that
 * trip them. `notWorse` compared defect COUNT, so a candidate that dropped its `circuit` shed
 * every defect that circuit could have caused and won on the numbers.
 *
 * Two assertions, therefore: the visual defects are stated FIRST and stated as things to ADD, and
 * a document that meets its subject minimum can never lose to one that dodged it.
 */

const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The network boundary, and only the network boundary — never the service under test.
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: jest.fn() } } }),
}));

const svc = require('../../bot/shared/services/lp612-author.service.js');
const fs = require('fs');

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

function chemDoc(specs) {
  const d = JSON.parse(raw);
  d.provenance = { ...d.provenance, subject: 'Chemistry', grade: 9 };
  // strip the fixture's own (Maths) visuals — these tests set the diagram set themselves
  for (const s of d.sections) s.blocks = (s.blocks || []).filter((b) => b.type !== 'diagram');
  delete d.page2.board_final.diagram;
  const dev = d.sections.find((s) => s.id === 'development');
  for (const spec of specs) dev.blocks.push({ type: 'diagram', id: `d${dev.blocks.length}`, spec });
  return d;
}

const gate = ({ lint = [], render = [], warns = [], schema = [] }) => ({ schema, lint, render, warns });

describe('the revision prompt states the visual contract first, as a thing to add', () => {
  const gates = gate({
    lint: [
      'BUDGET: whole document is 1,620 words; the MEASURED page capacity is 900-1200.',
      'VISUAL: V6 [Chemistry] none of [\'chem_equation\'] is present; §4b.2 requires one of them.',
      'HOOKCLOSE: the hook names no closed_by.',
    ],
    render: ['PAGE COUNT: support needs 6 pages; the cap is 4'],
  });
  const prompt = svc.buildRevisionPrompt({
    doc: chemDoc([]), gates, originalUser: '# LESSON TO AUTHOR', notes: null,
  });

  test('the visual block appears BEFORE the page-count instruction', () => {
    const v = prompt.indexOf('THE VISUAL CONTRACT');
    const p = prompt.indexOf('HOW TO FIX A PAGE-COUNT ERROR');
    expect(v).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(-1);
    expect(v).toBeLessThan(p);
  });

  test('it appears before the document itself, so it is not buried under 40KB of JSON', () => {
    expect(prompt.indexOf('THE VISUAL CONTRACT')).toBeLessThan(prompt.indexOf('=== PREVIOUS lp_doc'));
  });

  test('the V-line is hoisted out of the generic lint list, not merely reordered inside it', () => {
    const lintBlock = prompt.slice(prompt.indexOf('=== LINT ERRORS ==='),
      prompt.indexOf('=== PAGE / LAYOUT ERRORS'));
    expect(lintBlock).toContain('HOOKCLOSE');
    expect(lintBlock).not.toContain('V6 [Chemistry]');
  });

  test('the instruction is to ADD a figure, never to make room by cutting one', () => {
    const block = prompt.slice(prompt.indexOf('THE VISUAL CONTRACT'), prompt.indexOf('=== PREVIOUS lp_doc'));
    expect(block).toContain('FIX THESE FIRST, BY ADDING A FIGURE');
    expect(block).toMatch(/never to delete/i);
    expect(block).toMatch(/Page length is soft here; this floor is not/);
  });

  test('the page-count block now says in as many words not to drop a diagram', () => {
    expect(prompt).toContain('DO NOT REMOVE A DIAGRAM');
    expect(prompt).toMatch(/make it smaller .*rather than deleting it/s);
  });

  test('an advisory BUDGET line is still withheld, and no visual block appears when there is none', () => {
    expect(prompt).not.toContain('BUDGET:');
    const clean = svc.buildRevisionPrompt({
      doc: chemDoc([]), gates: gate({ lint: ['HOOKCLOSE: x'] }), originalUser: 'x', notes: null,
    });
    expect(clean).not.toContain('THE VISUAL CONTRACT');
  });
});

describe('acceptance · meeting the subject minimum is a tier, not a tie-break', () => {
  const met = chemDoc([
    { type: 'chem_equation', equation: '2H2 + O2 -> 2H2O' },
    { type: 'molecule', smiles: 'O', formula: 'H2O', name: 'water' },
  ]);
  const dodged = chemDoc([{ type: 'flow', steps: [{ title: 'a' }] }]);
  const nw = svc.__notWorseVisualForTests;

  test('a candidate that dropped the subject figure LOSES even with fewer defects', () => {
    // exactly the shape the old rule got wrong: the dense figure is gone, and with it the two
    // defects only that figure could have caused.
    const cheap = gate({ lint: [] });
    const rich = gate({ lint: ['FIGURE: molecule label is 12.1px, under the 13.5px floor', 'DIAGRAM_OVERLAP: two labels collide'] });
    expect(nw(cheap, rich, dodged, met)).toBe(false);
  });

  test('a candidate that GAINS the subject figure wins even carrying more defects', () => {
    const rich = gate({ lint: ['FIGURE: molecule label is 12.1px, under the 13.5px floor'] });
    const cheap = gate({ lint: [] });
    expect(nw(rich, cheap, met, dodged)).toBe(true);
  });

  test('when neither side meets the minimum the ordinary count decides, unchanged', () => {
    const fewer = gate({ lint: ['A: x'] });
    const more = gate({ lint: ['A: x', 'B: y'] });
    expect(nw(fewer, more, dodged, dodged)).toBe(true);
    expect(nw(more, fewer, dodged, dodged)).toBe(false);
  });

  test('when both sides meet it the ordinary count decides, unchanged', () => {
    const fewer = gate({ lint: [] });
    const more = gate({ lint: ['A: x'] });
    expect(nw(fewer, more, met, met)).toBe(true);
    expect(nw(more, fewer, met, met)).toBe(false);
  });

  test('schema validity still outranks it — a broken document with a molecule in it renders nothing', () => {
    const broken = gate({ schema: ['SCHEMA: /sections/0 missing minutes'] });
    const valid = gate({ lint: ['A: x', 'B: y', 'C: z'] });
    expect(nw(broken, valid, met, dodged)).toBe(false);
    expect(nw(valid, broken, dodged, met)).toBe(true);
  });
});
