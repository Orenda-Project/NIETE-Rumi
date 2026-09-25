/**
 * bd-oak77.32 — Defect B: in an Urdu doc, learning-objective chips read O1/O2/O2 instead of
 * O1/O2/O3. The author model fabricates a placeholder code per objective when the subject has no
 * real curriculum SLO code (confirmed in the flash briefs: subjects without one are told to
 * invent "O1"/"O2"-style codes) — and duplicates one when it should not.
 *
 * DECISION (coordinator, phase-2 scoping): option (b) — chip display stays removed, permanently.
 * Commit 7b37d4b7 ("the five renderer fixes from the 2026-09-12 read of a v9.3 plan", closing
 * bd-a8veu.14-.19) deleted the `.objhd`/`.objs`/`.slocode` chip-painting code from
 * `bot/vendor/lp-v9/lib/template.js` entirely, and it is NOT being reintroduced. The render tests
 * that used to live in this file (asserting `buildHtml()` painted O1/O2/O3 chips) are gone —
 * there is nothing left for them to prove, and re-adding chip rendering is out of scope.
 *
 * The fix is DATA-SIDE ONLY. The ids are still cross-referenced even with no chip on the page:
 * `lint_lp.js`'s `taughtSlos(doc)` (~L346) folds every objective's `slo_code` into a Set, and the
 * HW_TAGS check (~L1537) requires every `homework.items[].slo_code` to be a member of it. A
 * duplicate placeholder code silently shrinks that Set, so a homework item correctly tagged to
 * the THIRD objective ("O3") gets rejected as untaught — the first `describe` below proves that
 * with the real `lint()`.
 *
 * The fix belongs in the AUTHOR SANITIZER (a new step alongside `sanitizeUnknownTopLevel`/
 * `sanitizeOverlay`/`sanitizeSequence` in `lp612-author.service.js`, called in the same real
 * production order those three already run in). The second `describe` below proves that gap is
 * RED today: it runs the three real, currently-exported sanitize functions against a duplicate-
 * coded doc — none of them today touch `objectives.items[].slo_code` or
 * `homework.items[].slo_code` at all, so the renumbering + cross-reference rewrite a phase-2 step
 * must add does not happen yet.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.resolve(__dirname, '../../bot/vendor/lp-v9');
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));
const {
  sanitizeUnknownTopLevel,
  sanitizeOverlay,
  sanitizeSequence,
  sanitizeObjectiveCodes,
} = require('../../bot/shared/services/lp612-author.service');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// A subject with no real curriculum code: the author model fabricates O1/O2/O3-style codes
// per objective (confirmed in the flash briefs). Three objectives, but the second and third
// carry the SAME placeholder code — the bug — instead of being numbered by position.
function docWithDuplicateObjectiveCodes() {
  const d = baseDoc();
  d.objectives = {
    ...d.objectives,
    items: [
      { text: 'You can say whether a product is defined from the inner orders.', slo_code: 'O1' },
      { text: 'You can multiply two 2×2 matrices row by column.', slo_code: 'O2' },
      { text: 'You can state the order of the resulting product.', slo_code: 'O2' }, // should be O3
    ],
  };
  return d;
}

describe('a duplicated placeholder objective code breaks the homework SLO cross-reference', () => {
  test('unsanitized, a homework item tagged to the third objective fails HW_TAGS — why the sanitizer must run', () => {
    const d = docWithDuplicateObjectiveCodes();
    // H4 legitimately tests the third objective. With correct numbering that objective's own
    // code would be "O3"; with the duplicate-code bug, "O3" was never recorded as taught.
    // lint() is right to refuse this doc as written — the fix is upstream of it, below.
    d.sections.find((s) => s.id === 'homework').homework.items[3].slo_code = 'O3';

    const { fails } = lint(d);
    const hwTagsOnO3 = fails.filter((f) => f.startsWith('HW_TAGS') && f.includes('O3'));

    expect(hwTagsOnO3.length).toBeGreaterThan(0);
  });
});

describe('the real author sanitize path should normalize objective slo_codes (not built yet)', () => {
  // Same call, same order, as every real production site (rg-confirmed at
  // lp612-author.service.js:2219-2224, 2467-2471, 3173-3176): sanitizeUnknownTopLevel(doc) ->
  // sanitizeOverlay(doc) -> sanitizeSequence(doc, segment) -> sanitizeObjectiveCodes(doc). All
  // four are exported.
  function runRealSanitizePath(doc, segment = {}) {
    sanitizeUnknownTopLevel(doc);
    sanitizeOverlay(doc);
    sanitizeSequence(doc, segment);
    sanitizeObjectiveCodes(doc);
  }

  test('[O1, O2, O2] plus homework tagged O3 comes out as O1, O2, O3 with no HW_TAGS failure — and a real curriculum code that repeats stays unchanged', () => {
    const d = docWithDuplicateObjectiveCodes();
    // Control: a REAL curriculum SLO can legitimately be taught by two objectives in the same
    // lesson. Unlike the placeholder "O#" codes, this must never be touched or deduplicated.
    d.objectives.items.push(
      { text: 'You can identify a square matrix by its dimensions.', slo_code: 'M-09-A-07' },
      { text: 'You can name why a square matrix has a defined product both ways.', slo_code: 'M-09-A-07' },
    );
    d.sections.find((s) => s.id === 'homework').homework.items[3].slo_code = 'O3';

    runRealSanitizePath(d);

    // RED today: the real sanitize pipeline does not touch objectives.items at all, so this is
    // still ['O1', 'O2', 'O2', 'M-09-A-07', 'M-09-A-07'].
    expect(d.objectives.items.map((o) => o.slo_code)).toEqual([
      'O1',
      'O2',
      'O3',
      'M-09-A-07',
      'M-09-A-07',
    ]);

    const hwTagsOnO3 = lint(d).fails.filter((f) => f.startsWith('HW_TAGS') && f.includes('O3'));
    expect(hwTagsOnO3).toEqual([]);
  });

  test('a homework reference to a duplicated placeholder code keeps pointing at its first occurrence', () => {
    // The homework item copies the duplicated code. 'O1' still names the first objective after
    // renumbering, so the reference is left alone: guessing it meant the second would be invention.
    const d = baseDoc();
    d.objectives = {
      ...d.objectives,
      items: [
        { text: 'You can identify the coefficients of a quadratic.', slo_code: 'O1' },
        { text: 'You can complete the square for a quadratic.', slo_code: 'O1' }, // duplicate -> should become O2
      ],
    };
    d.sections.find((s) => s.id === 'homework').homework.items[3].slo_code = 'O1';

    runRealSanitizePath(d);

    // RED today: nothing renumbers the second objective.
    expect(d.objectives.items.map((o) => o.slo_code)).toEqual(['O1', 'O2']);
    const hwCode = d.sections.find((s) => s.id === 'homework').homework.items[3].slo_code;
    expect(hwCode).toBe('O1');
    expect(lint(d).fails.filter((f) => f.startsWith('HW_TAGS'))).toEqual([]);
  });
});
