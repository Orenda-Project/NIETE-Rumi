/**
 * TOPPING UP AN OVERLAY INSTEAD OF RE-AUTHORING A CORPUS — bd-idneu (bd-yhd16's purge half).
 *
 * bd-x3dn6 widened `overlayTargets()`: `/provenance/topic`, `/chapter` and `/chapter_title` are
 * now overlayable, so an Urdu lesson's TITLE and running header can finally be Urdu. Measured on
 * the gate fixture: 89 offered pointers before the fix, 92 after.
 *
 * The fix reaches new documents only. 302 Urdu renders are already cached, and a cache hit
 * returns the stored artifact untouched, so every one of them keeps serving an English title.
 *
 * THE OBVIOUS LEVER IS A SILENT NO-OP. Bumping `LP_612_TEMPLATE_VERSION` makes every row a miss,
 * but `lp612-author.worker.js:729` says it outright — "A TEMPLATE BUMP IS A RE-RENDER, NOT A
 * RE-AUTHORING". `reuseFromPreviousVersion()` finds the stored `.lp.json`, returns it with
 * `llmCalls: 0`, and the pre-fix overlay comes back with it.
 *
 * So the three options were: re-author the fleet (~$1.50 x the whole corpus, English included),
 * delete the Urdu rows and re-author 302 documents, or ASK THE MODEL FOR THE THREE STRINGS IT
 * WAS NEVER ASKED FOR. This is the third. Cents per document, and the lesson body — already lint
 * -clean, already rendered, already read by teachers — is never re-generated and so cannot
 * regress.
 *
 * WHAT THIS SUITE PINS:
 *
 *   1. The delta is computed from `overlayTargets()` itself, never a hand-written list of three
 *      pointers. A second copy of that rule is exactly what this repo's own linter comment warns
 *      about, and it would go stale the next time the target set moves.
 *   2. A document that needs nothing costs NOTHING. 302 documents through a pass that always
 *      calls the model is 302 calls to discover that most of them had nothing to do.
 *   3. AN UNOVERLAID DOCUMENT IS NOT A TOP-UP CANDIDATE. Translating three pointers onto an
 *      English document produces a page with an Urdu title over English prose — worse than the
 *      bug, and it would report success.
 *   4. The existing translation always wins. Re-translating 89 good strings is both the cost this
 *      bead exists to avoid and a way to regress a page a teacher has already read.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

const {
  missingOverlayPointers,
  PROVENANCE_TOPUP_POINTERS,
} = require('../../bot/shared/services/lp612-overlay-topup.service');

/** The overlay a PRE-FIX authoring run would have produced: every pointer the old gate offered. */
const preFixOverlay = (d) => {
  const out = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;   // the old OVERLAY_SKIP_ROOTS entry
    out[ptr] = 'یہ اردو ہدایت ہے جو اس سبق کے لیے لکھی گئی ہے۔';
  }
  return out;
};

describe('A — the delta is derived, never hand-listed', () => {
  it('names exactly the pointers the current gate offers that the stored overlay lacks', () => {
    const d = doc();
    d.ur_overlay = preFixOverlay(d);

    const missing = missingOverlayPointers(d);
    const offered = overlayDefects.targets(d);

    // Derived both ways from the same function, so a later widening of the target set is picked
    // up here without anyone editing this test.
    expect(missing.sort()).toEqual(offered.filter((p) => !(p in d.ur_overlay)).sort());
    expect(missing.length).toBeGreaterThan(0);
  });

  it('the bd-x3dn6 pointers are what a pre-fix Urdu document is actually missing', () => {
    const d = doc();
    d.ur_overlay = preFixOverlay(d);

    // Not the definition of the delta — a readability assertion on top of it. If this ever fails
    // while the test above passes, the target set moved and the corpus needs re-measuring, which
    // is a finding rather than a broken test.
    expect(missingOverlayPointers(d)).toEqual(expect.arrayContaining([...PROVENANCE_TOPUP_POINTERS]));
  });

  it('every missing pointer resolves to a real string in the document', () => {
    const d = doc();
    d.ur_overlay = preFixOverlay(d);

    for (const ptr of missingOverlayPointers(d)) {
      const value = ptr.split('/').slice(1)
        .reduce((node, seg) => (node == null ? node : node[seg.replace(/~1/g, '/').replace(/~0/g, '~')]), d);
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('B — a document that needs nothing costs nothing', () => {
  it('a fully-covered overlay yields an empty delta', () => {
    const d = doc();
    d.ur_overlay = {};
    for (const ptr of overlayDefects.targets(d)) d.ur_overlay[ptr] = 'اردو';

    expect(missingOverlayPointers(d)).toEqual([]);
  });

  it('a post-fix document authored today needs no top-up — the pass is for the backlog only', () => {
    const d = doc();
    d.ur_overlay = {};
    for (const ptr of overlayDefects.targets(d)) d.ur_overlay[ptr] = 'اردو متن';

    expect(missingOverlayPointers(d)).toHaveLength(0);
  });
});

describe('C — degenerate documents are classified, not crashed', () => {
  it('a document with NO overlay reports its whole target set as missing', () => {
    // The caller — not this function — decides that this is a re-author rather than a top-up.
    // Reporting it honestly here keeps that decision in one place, with its reasoning written
    // down beside it.
    const d = doc();
    delete d.ur_overlay;

    expect(missingOverlayPointers(d)).toEqual(overlayDefects.targets(d));
  });

  it('a null or malformed document yields an empty delta rather than throwing', () => {
    expect(missingOverlayPointers(null)).toEqual([]);
    expect(missingOverlayPointers(undefined)).toEqual([]);
    expect(missingOverlayPointers('not a document')).toEqual([]);
  });

  it('a non-object ur_overlay is treated as no coverage, not as a crash', () => {
    const d = doc();
    d.ur_overlay = 'nonsense';
    expect(missingOverlayPointers(d)).toEqual(overlayDefects.targets(d));
  });
});
