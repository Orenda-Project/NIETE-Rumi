/**
 * THE URDU OVERLAY MAY NOT WRITE INTO A FIELD THE RENDERER PARSES — bd-oak77.23.
 *
 * Found by reading a delivered page, not by reading code. Staging run
 * `grade_12_chemistry.c14.p227-230` ur (row b3e93b2f, 19pp, `status=ready`) shipped a molecule
 * whose label block was Urdu and Latin painted ON TOP OF ITSELF, unreadable. Its overlay contained:
 *
 *     /sections/1/blocks/2/spec/formula => "فاسفولپڈ (phospholipid) (بیکٹیریا کی جھلی کا جزو)"
 *
 * `spec.formula` is the molecule renderer's FORMULA CARD — a large, centred, LTR slot sized for
 * about ten Latin characters like `C7H6N4OS`. A 49-code-point mixed string lands in it and collides
 * with everything around it.
 *
 * AND IT WAS TWO POINTERS, NOT ONE. `/sections/1/blocks/4/tex` — 184 characters of KaTeX — was also
 * selected for overlay and survived only because the model happened to echo it byte-identically.
 * A model that had "translated" it would have shipped a broken equation. So the class is reachable
 * and we were lucky once out of two, which is a different claim from "one field was mangled".
 *
 * THE DISTINCTION THE CODE HAS TO MAKE is not English-vs-Urdu, it is PRINTED vs PARSED:
 *   printed — captions, labels, prose. A human reads them. Translate them; the Urdu caption under
 *             the NaCl lattice on run (b) page 8 is exactly right.
 *   parsed  — `tex` (KaTeX), `smiles` (openchemlib `Molecule.fromSmiles`), `equation`, and
 *             `formula` (a fixed-width LTR card). The renderer feeds these to a parser or a
 *             geometry, not to a reader.
 *
 * WHY ONE LIST AND NOT THREE. Three layers ask this question — `overlayTargets` builds what the
 * model is offered, the pass rejects anything outside it, and `sanitizeOverlay` drops what survives
 * — and they consulted two different lists (`OVERLAY_SKIP_KEYS` in lint_lp.js, `FROZEN_POINTERS` in
 * lib/overlay.js). Neither had these keys. That is the same shape as the 727/729 `FULL_COL` drift
 * (PR #731): a rule restated instead of imported. The fix puts it in `overlay.js` once and has the
 * others read it.
 *
 * Red-first on the base branch: every assertion below fails there.
 */

const path = require('path');
const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { applyOverlay, frozenReason, MACHINE_KEYS } = require(path.join(VENDOR, 'lib', 'overlay.js'));
const { overlayDefects } = require(path.join(VENDOR, 'lint_lp.js'));

/** The shape of the block that broke, plus a latex block and honest prose beside it. */
const doc = () => ({
  lesson_id: 'x',
  schema_version: '3.0',
  provenance: { medium: 'en', topic: 't', grade: 12, subject: 'Chemistry' },
  sections: [{
    id: 'development',
    blocks: [
      { type: 'paragraph', text: 'Halicin was found by screening a very large compound database.' },
      {
        type: 'diagram',
        spec: {
          type: 'molecule',
          smiles: 'c1ccc(cc1)C(=NNC(=O)N)c1cscn1',
          formula: 'phospholipid (bacterial membrane component)',
          caption: 'a membrane phospholipid — the kind of molecule the mechanism disrupts',
        },
      },
      { type: 'latex', tex: '\\dfrac{n(\\text{compound screened})}{n(\\text{database})} = \\dfrac{1}{100{,}000{,}000}',
        caption: 'the hit rate, written as a ratio' },
    ],
  }],
});

const PARSED = ['/sections/0/blocks/1/spec/smiles',
  '/sections/0/blocks/1/spec/formula',
  '/sections/0/blocks/2/tex'];
const PRINTED = ['/sections/0/blocks/0/text',
  '/sections/0/blocks/1/spec/caption',
  '/sections/0/blocks/2/caption'];

describe('the overlay is never OFFERED a parsed field', () => {
  test('overlayTargets excludes every parsed field', () => {
    const targets = overlayDefects.targets(doc());
    for (const p of PARSED) {
      expect({ pointer: p, offered: targets.includes(p) }).toEqual({ pointer: p, offered: false });
    }
  });

  test('…and still offers the prose beside them — this must not become a blunt instrument', () => {
    const targets = overlayDefects.targets(doc());
    for (const p of PRINTED) {
      expect({ pointer: p, offered: targets.includes(p) }).toEqual({ pointer: p, offered: true });
    }
  });
});

describe('and if one reaches the renderer anyway, it is refused', () => {
  test('frozenReason names each parsed field, with a reason a human can read', () => {
    const d = doc();
    for (const p of PARSED) {
      const why = frozenReason(d, p);
      expect({ pointer: p, frozen: !!why }).toEqual({ pointer: p, frozen: true });
      expect(typeof why).toBe('string');
      expect(why.length).toBeGreaterThan(10);
    }
  });

  test('applyOverlay leaves a parsed field BYTE-IDENTICAL', () => {
    const base = doc();
    const d = doc();
    d.ur_overlay = {
      '/sections/0/blocks/1/spec/formula': 'فاسفولپڈ (phospholipid) (بیکٹیریا کی جھلی کا جزو)',
      '/sections/0/blocks/1/spec/smiles': 'سی ون سی سی',
      '/sections/0/blocks/2/tex': '\\dfrac{اردو}{ترجمہ}',
      '/sections/0/blocks/1/spec/caption': 'جھلی کا ایک فاسفولپڈ',
      '/sections/0/blocks/0/text': 'ہیلیسن ایک بہت بڑے ڈیٹابیس کی اسکریننگ سے ملی۔',
    };
    const out = applyOverlay(d, 'ur');

    // the parsed fields survive untouched — byte for byte
    expect(out.doc.sections[0].blocks[1].spec.formula).toBe(base.sections[0].blocks[1].spec.formula);
    expect(out.doc.sections[0].blocks[1].spec.smiles).toBe(base.sections[0].blocks[1].spec.smiles);
    expect(out.doc.sections[0].blocks[2].tex).toBe(base.sections[0].blocks[2].tex);
    // …and the prose beside them IS translated
    expect(out.doc.sections[0].blocks[1].spec.caption).toBe('جھلی کا ایک فاسفولپڈ');
    expect(out.doc.sections[0].blocks[0].text).toMatch(/ہیلیسن/);
    expect(out.applied).toEqual(expect.arrayContaining(PRINTED.slice(0, 2)));
  });
});

describe('one list, not three', () => {
  test('the parsed-key set is exported from lib/overlay.js', () => {
    // So lint_lp.js can READ it. A second copy is what let these keys through in the first place.
    expect(MACHINE_KEYS).toBeInstanceOf(Set);
    for (const k of ['smiles', 'formula', 'tex', 'equation']) {
      expect({ key: k, frozen: MACHINE_KEYS.has(k) }).toEqual({ key: k, frozen: true });
    }
  });

  test('lint_lp.js does not keep its own copy of these keys', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(VENDOR, 'lint_lp.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const skipBlock = (src.match(/OVERLAY_SKIP_KEYS\s*=\s*new Set\(\[[\s\S]*?\]\)/) || [''])[0];
    for (const k of ['smiles', 'formula', 'tex', 'equation']) {
      expect({ key: k, hardcoded: skipBlock.includes(`"${k}"`) }).toEqual({ key: k, hardcoded: false });
    }
    expect(src).toMatch(/MACHINE_KEYS/);
  });
});
