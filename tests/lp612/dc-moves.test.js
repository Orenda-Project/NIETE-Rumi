/**
 * bd-3jemp -- THE PAGE NAMED THREE MOVES AND THE DIGITAL COACH GRADES TEN.
 *
 * OPERATOR: *"are the LPs coloured as per moves detected by DC? It should be, and the crux of
 * what should be done should be highlighted in the move since there is alot of script to go
 * through"*, and then *"i dont mind colours, I want teachers to know which moves are there,
 * what is the main move to do in order to score well on DC"*.
 *
 * THE PREMISE WAS WRONG AND IT MATTERED. The sheet's move vocabulary is I DO / WE DO / YOU DO.
 * That is not what the Digital Coach detects. Its move enum is ten `phase` values, hard-coded at
 * `bot/shared/services/coaching/fidelity/lp-upload-extractor.js:15-17`:
 *
 *     warm_up · hook · recall · announce · explain · guided · independent · peer_review ·
 *     exit · homework
 *
 * and the score follows THOSE. `fico-framework.js:700-745` (`applyLpFidelity`) overwrites the
 * whole of FICO Section B with `round(fidelity_pct/100 * 40)` whenever a lesson plan is linked
 * and its fidelity is usable -- 40 of 148 points, 27% of the teacher's entire score, on one
 * continuous dial of executed-over-prescribed moves. Gradual release survives in FICO only as
 * the level-3 descriptor of indicator B2 ("Clear I Do -> We Do -> You Do sequence"), worth
 * 4/148 = 2.7%, and B2 is among the ten indicators discarded the moment that overwrite fires.
 *
 * So the three pills named the 2.7% and said nothing about the 27%. This suite makes the page
 * name the phases the DC actually looks for.
 *
 * WHAT IS NOT MARKED, AND WHY. `fidelity-scorer.js:93-121` builds the core denominator from
 * `must_happen` moves plus the `adaptive_set` members that applied; `optional_extension` is
 * excluded and can only ever add credit. Every phase this sheet prints is core -- the plan has
 * no extension blocks -- so a per-block "this one is scored" marker would be printed on all of
 * them and would carry no information. The lever is completeness, not one starred block, and a
 * star that says otherwise would be a lie about the rubric.
 *
 * TWO PHASES HAVE NO SURFACE HERE: `recall` and `peer_review`. Nothing in the primary block
 * inventory is either, and inventing a block to fill the enum would be a proxy for a stage that
 * is genuinely dark. The map stays honest and short.
 *
 * THE CRUX IS AUTHORED, NEVER DERIVED. *"there is alot of script to go through"* -- so each move
 * may carry one line saying what the teacher must actually do in it, printed above the script at
 * the weight of a heading. A block with no authored crux prints exactly as it did.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const tpl = require('../../bot/vendor/lp-v9/lib/template.js');
const { buildHtml, dcPhaseOf } = tpl;
const { LABELS } = require('../../bot/vendor/lp-v9/lib/overlay.js');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** The ten phases the DC's own extractor enumerates. */
const DC_PHASES = ['warm_up', 'hook', 'recall', 'announce', 'explain', 'guided',
  'independent', 'peer_review', 'exit', 'homework'];

/** Phases this sheet has a surface for. `recall` and `peer_review` deliberately have none. */
const SURFACED = ['warm_up', 'hook', 'announce', 'explain', 'guided', 'independent',
  'exit', 'homework'];

/**
 * Primary is derived from the document, not passed in: `isPrimary(doc)` is true for
 * `provenance.grade` 1-5 (the gate fixture is a Grade 9 matrices lesson). So the switch is the
 * grade, and `opts.primary` would be quietly ignored -- a test that set it would assert nothing.
 */
function render(mut, opts = {}) {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  doc.provenance.grade = opts.primary === false ? 9 : 3;
  if (mut) mut(doc);
  return buildHtml(doc, { docDir: path.dirname(FIXTURE) }).html;
}

/** Put one block into the development section and render, returning the whole page. */
function withBlock(block, build) {
  return render((doc) => {
    const dev = (doc.sections || []).find((s) => s.id === 'development') || doc.sections[0];
    dev.blocks = [block];
  }, build);
}

describe('bd-3jemp: the sheet names the moves the Digital Coach grades', () => {
  describe('the map from a block id to a DC phase', () => {
    test.each([
      ['hook', 'hook'],
      ['big-idea', 'announce'],
      ['i-do', 'explain'],
      ['we-do', 'guided'],
      ['you-do', 'independent'],
      ['you-do-task', 'independent'],
      ['remember', 'exit'],
      ['hw', 'homework'],
    ])('%s is the DC phase %s', (id, phase) => {
      expect(dcPhaseOf(id)).toBe(phase);
    });

    test('ids are normalised the way every other move surface normalises them', () => {
      expect(dcPhaseOf('I_Do')).toBe('explain');
      expect(dcPhaseOf('weDo')).toBe('guided');
    });

    test('a block outside the vocabulary carries no phase', () => {
      for (const id of ['keywords', 'halfway', 'dia-hook', 'hook-characters', '', null]) {
        expect(dcPhaseOf(id)).toBeNull();
      }
    });

    test('every phase it can return is one the DC actually enumerates', () => {
      const returned = new Set(
        ['hook', 'big-idea', 'i-do', 'we-do', 'you-do', 'you-do-task', 'remember', 'hw']
          .map(dcPhaseOf)
      );
      for (const p of returned) expect(DC_PHASES).toContain(p);
    });
  });

  describe('the chip on the page', () => {
    test('a mapped block prints its DC phase chip', () => {
      const html = withBlock({ type: 'key_points', id: 'remember', items: ['Carry the ten.'] });
      expect(html).toMatch(/class="dct"/);
      expect(html).toContain(LABELS.en.dcPhase.exit);
    });

    /**
     * Scoped to the block. The rest of the fixture keeps its own mapped ids (`worked_example:ido`
     * in the development section), so a page-wide assertion would fail on a chip that is correct.
     */
    test('an unmapped block prints no chip', () => {
      const html = withBlock({ type: 'key_points', id: 'keywords', items: ['sum'] });
      const i = html.indexOf('sum');
      expect(i).toBeGreaterThan(-1);
      expect(html.slice(i - 400, i)).not.toMatch(/class="dct"/);
    });

    test('the chip is primary-only -- the 6-12 sheet has no rule to paint it', () => {
      const html = withBlock({ type: 'key_points', id: 'remember', items: ['Carry the ten.'] },
        { primary: false });
      expect(html).not.toMatch(/class="dct"/);
    });

    test('it does not displace the gradual-release pill on a block that has both', () => {
      const html = withBlock({ type: 'key_points', id: 'i-do', items: ['Model it.'] });
      expect(html).toMatch(/class="mvt/);
      expect(html).toMatch(/class="dct"/);
    });
  });

  describe('the labels are data, in both languages (root rule 20)', () => {
    test.each(['en', 'ur'])('%s labels every surfaced phase', (lang) => {
      for (const p of SURFACED) expect(typeof LABELS[lang].dcPhase[p]).toBe('string');
    });

    test('the two language blocks label exactly the same set', () => {
      expect(Object.keys(LABELS.en.dcPhase).sort()).toEqual(Object.keys(LABELS.ur.dcPhase).sort());
    });

    test('the Urdu labels are Urdu, not English echoed onto an Urdu page', () => {
      for (const p of SURFACED) {
        expect(LABELS.ur.dcPhase[p]).not.toBe(LABELS.en.dcPhase[p]);
        expect(LABELS.ur.dcPhase[p]).toMatch(/[؀-ۿ]/);
      }
    });

    test('nothing is labelled for a phase this sheet has no surface for', () => {
      expect(Object.keys(LABELS.en.dcPhase).sort()).toEqual([...SURFACED].sort());
    });
  });

  describe('the crux -- one authored line of what to actually do', () => {
    const CRUX = 'Say the renaming out loud before you write it.';

    test('an authored crux prints inside its block', () => {
      const html = withBlock({ type: 'key_points', id: 'i-do', items: ['Model it.'], crux: CRUX });
      expect(html).toMatch(/class="crux"/);
      expect(html).toContain(CRUX);
    });

    test('it prints above the script, not after it', () => {
      const html = withBlock({ type: 'key_points', id: 'i-do', items: ['Model it.'], crux: CRUX });
      expect(html.indexOf(CRUX)).toBeLessThan(html.indexOf('Model it.'));
    });

    test('a block with no crux prints exactly as it did', () => {
      const html = withBlock({ type: 'key_points', id: 'i-do', items: ['Model it.'] });
      expect(html).not.toMatch(/class="crux"/);
    });

    test('a blank crux is the same as none', () => {
      const html = withBlock({ type: 'key_points', id: 'i-do', items: ['Model it.'], crux: '  ' });
      expect(html).not.toMatch(/class="crux"/);
    });

    test('it is escaped, not injected', () => {
      const html = withBlock({ type: 'key_points', id: 'i-do', items: ['x'], crux: '<b>no</b>&' });
      expect(html).not.toContain('<b>no</b>');
    });

    /**
     * THE SCHEMA THIS ASSERTS AGAINST IS THE ONE THE DOCUMENT CHOOSES.
     *
     * `validate.js` maps `schema_version` to a file: "3.0" -> `lp_doc.schema.json`, "2.0" ->
     * `lp_doc.v2.schema.json` (v8, frozen). Every document the primary builder writes is 3.0, so
     * the live file is the only one that can admit a new property -- and the first version of
     * this test asserted against the FROZEN one, passed, and shipped a document that could not
     * render (`should NOT have additional properties ('crux')`). A property assertion on a
     * schema nothing validates against is a green test over a broken feature.
     */
    test('the schema admits it on every block type', () => {
      const schema = require('../../bot/vendor/lp-v9/schema/lp_doc.schema.json');
      for (const branch of schema.definitions.block.oneOf) {
        expect(branch.properties).toHaveProperty('crux');
      }
    });

    /** The gate the property assertion above cannot be: a real doc through the real validator. */
    test('a document carrying one validates', () => {
      const { validateDoc, SCHEMA_PATH } = require('../../bot/vendor/lp-v9/lib/validate.js');
      const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
      const blk = doc.sections.flatMap((s) => s.blocks || [])[0];
      blk.crux = 'Work it on the board while they watch. Nobody copies yet.';
      const v = validateDoc(doc);
      expect(path.basename(SCHEMA_PATH)).toBe('lp_doc.schema.json');
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
    });
  });
});
