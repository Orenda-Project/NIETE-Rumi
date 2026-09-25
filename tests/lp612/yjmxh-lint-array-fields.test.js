/**
 * bd-yjmxh — lint_lp.js on the bd-oyqb2 string-or-array slots.
 *
 * bd-oyqb2 widened nine authored slots to accept an ARRAY that prints one row per element.
 * `lint_lp.js` was never audited against that change. Measured on real documents out of the
 * 335-lesson ch9-10 corpus (2026-09-24), it fails four ways:
 *
 *   A1  :470  `b.question.trim()`      — TypeError. 4 of 4 sampled documents crash when only
 *                                        `ask#hook.question` is turned into an array; the same
 *                                        document lints to 49 fails as a string.
 *   A2  :432  `text_verbatim.trim()`   — TypeError on a shape `schema/lp_doc.schema.json:106`
 *                                        was accepting. Fixed at the SCHEMA, not here: the SLO
 *                                        is copied VERBATIM, and no renderer prints it, so the
 *                                        field is reverted to string-only and :432 is right as
 *                                        written. See the SCOPE tests below.
 *   A3  :1602 `typeof s === "string"`  — OUTCOME_VOICE stops applying ENTIRELY. Measured on
 *                                        the fixture below: a curriculum-voice outcome yields
 *                                        2 OUTCOME_VOICE fails as a string and 1 as an array.
 *                                        No error, no warn — the rule turns itself off.
 *   A4  :1280/:1428                    — the verdict is computed against `Array#toString`, a
 *                                        BARE COMMA with no space. That is not the text the
 *                                        teacher reads, and it changes the verdict: a
 *                                        colon-stemmed prompt or a question-form reflection
 *                                        with a blank trailing row loses its "?"/":" anchor to
 *                                        the trailing comma and fails SPURIOUSLY.
 *
 * And one the falsification pass did not name, the same class as A3 and a true WEAKENING:
 *   E1  :1570 `wordCount(O.outcome)`   — `wordCount` is `String(s).split(/\s+/)`, so the
 *                                        comma-weld eats one word boundary per row. A 21-word
 *                                        outcome in two rows counts 20, and the OUTCOME_BOX
 *                                        ceiling is silently raised by (rows - 1).
 *
 * WHY THE FIXTURE IS THIS ONE. `__fixtures__/v9_gate_base.lp.json` is grade 9, STEM-2, with
 * `worked_example turns=0/steps=5` — `isPrimary` false, below `exqAtoms`/`exqStepAtoms`. The
 * whole v9 gate suite runs on a code path no affected G1-5 document takes. This fixture is a
 * REAL built primary document (`ch9-10-build/renders/g1_ch10/docs/English_seg1.lp.json`,
 * grade 1, LL-2, schema 3.0, lint_profile full), copied unmodified. It is not clean — 49 fails
 * across 20 codes — so every assertion below is a DELTA on one code, never an absolute count.
 *
 * NO WEAKER THAN THE STRING. Each rule touched gets a pair: content that fails as a string, and
 * the SAME content as the array form, which must fail too. Where the array is the legitimate
 * multi-row shape, a control proves the fix did not make the gate spuriously stricter either.
 *
 * SPLIT: this file covers the normaliser itself and the three rules that read a WHOLE FIELD's
 * SHAPE — A1 HOOK, A2/Part B slo.text_verbatim, A3 OUTCOME_VOICE. The rules that read a field's
 * TEXT (A4a UNWORDED_Q, A4b COACHING_CORNER, E1 OUTCOME_BOX, E2 exit tickets, E3 the word
 * budget) are in yjmxh-lint-array-text.test.js, to keep both files under the 300-line cap.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint, fieldRows, fieldText } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'primary_g1_english.lp.json');
const RAW = fs.readFileSync(FIXTURE, 'utf8');
const base = () => JSON.parse(RAW);

const run = (doc) => lint(doc, FIXTURE);
const failsOf = (doc, code) => run(doc).fails.filter((f) => f.startsWith(`${code}:`));
const nFails = (doc, code) => failsOf(doc, code).length;

/** The hook `ask` block, wherever the introduction keeps it. */
const hookOf = (d) => {
  for (const s of d.sections) for (const b of s.blocks || []) if (b.type === 'ask' && b.hook) return b;
  throw new Error('fixture has no hook');
};

describe('bd-yjmxh — the normaliser', () => {
  test('a string is one row; an array is its rows', () => {
    expect(fieldRows('one line')).toEqual(['one line']);
    expect(fieldRows(['a', 'b'])).toEqual(['a', 'b']);
  });

  test('absent fields carry no rows and no text', () => {
    expect(fieldRows(undefined)).toEqual([]);
    expect(fieldRows(null)).toEqual([]);
    expect(fieldText(undefined)).toBe('');
  });

  test('rows are trimmed and blank rows dropped — schema minLength:3 admits "   "', () => {
    expect(fieldRows([' a ', '   ', 'b'])).toEqual(['a', 'b']);
    expect(fieldRows('  padded  ')).toEqual(['padded']);
  });

  test('fieldText joins with a SPACE — never Array#toString’s bare comma', () => {
    expect(fieldText(['Find AB.', 'Show every entry.'])).toBe('Find AB. Show every entry.');
    expect(fieldText(['Find AB.', 'Show every entry.'])).not.toContain(',Show');
    expect(String(['Find AB.', 'Show every entry.'])).toContain(',Show'); // what the bug used
  });

  test('fieldText of a string is that string, so every string call site is unchanged', () => {
    expect(fieldText('Which pupils could blend today?')).toBe('Which pupils could blend today?');
  });
});

describe('bd-yjmxh A1 — HOOK reads ask.question through the normaliser (:470)', () => {
  const STATEMENT = 'The boy runs to school every morning with his sister.';

  test('an array hook question does not crash the linter', () => {
    const d = base();
    hookOf(d).question = [hookOf(base()).question];
    expect(() => run(d)).not.toThrow();
  });

  test('a hook that is a flat statement fails HOOK as a string', () => {
    const d = base();
    hookOf(d).question = STATEMENT;
    expect(failsOf(d, 'HOOK').join(' ')).toMatch(/neither a question nor a case/);
  });

  test('NO WEAKER: the same statement split across rows fails HOOK too', () => {
    const d = base();
    hookOf(d).question = ['The boy runs to school every morning', 'with his sister.'];
    expect(failsOf(d, 'HOOK').join(' ')).toMatch(/neither a question nor a case/);
  });

  test('NOT STRICTER: a setup row plus a question row is still a hook', () => {
    const str = base();
    hookOf(str).question = 'Look at the picture on page 124. What do you think happens next?';
    const arr = base();
    hookOf(arr).question = ['Look at the picture on page 124.', 'What do you think happens next?'];
    expect(nFails(arr, 'HOOK')).toBe(nFails(str, 'HOOK'));
    expect(failsOf(arr, 'HOOK').join(' ')).not.toMatch(/neither a question nor a case/);
  });

  test('the HOOK message quotes the rows as they print, not [object Array]', () => {
    const d = base();
    hookOf(d).question = ['The boy runs to school every morning', 'with his sister.'];
    const msg = failsOf(d, 'HOOK').join(' ');
    expect(msg).toContain('The boy runs to school every morning with his sister.');
    expect(msg).not.toContain(',with');
  });
});

describe('bd-yjmxh A2 + Part B — slo.text_verbatim is string-only (:432, schema:106)', () => {
  test('an array text_verbatim is refused by the schema, not crashed on', () => {
    const d = base();
    d.slo.text_verbatim = ['Predict what a story is about.', 'Blend sounds to read new words.'];
    let r;
    expect(() => { r = run(d); }).not.toThrow();
    expect(r.fails.some((f) => f.startsWith('SCHEMA:'))).toBe(true);
  });

  test('the string form is untouched — the fixture still lints past the SLO gate', () => {
    expect(nFails(base(), 'SCHEMA')).toBe(0);
    expect(nFails(base(), 'SLO')).toBe(0);
  });

  test('an empty text_verbatim still fails SLO — the string rule is untouched', () => {
    const d = base();
    d.slo.text_verbatim = '          ';
    expect(failsOf(d, 'SLO').join(' ')).toMatch(/text_verbatim is empty/);
  });
});

describe('bd-yjmxh A3 — OUTCOME_VOICE applies PER ROW (:1602)', () => {
  const CURRICULUM = 'Predict the story from its title and picture, then blend sounds to read.';
  const PUPIL = 'You can predict a story from its title and picture.';

  test('a curriculum-voice outcome fails as a string', () => {
    const d = base();
    d.objectives.outcome = CURRICULUM;
    expect(failsOf(d, 'OUTCOME_VOICE').join(' ')).toMatch(/the outcome sentence does not address the pupil/);
  });

  test('THE DEFECT: the same sentence as a one-row array still fails', () => {
    const d = base();
    d.objectives.outcome = [CURRICULUM];
    expect(failsOf(d, 'OUTCOME_VOICE').join(' ')).toMatch(/the outcome sentence does not address the pupil/);
  });

  test('PER ROW, NOT JOINED: one pupil-voice row does not launder a curriculum-voice row', () => {
    // On the joined text `addresses.test` is true because row 1 says "You", so `impersonal` is
    // false and the box passes — a box printing two registers, which is the exact defect the
    // operator reported twice. Per row it fails, and names the row.
    const d = base();
    d.objectives.outcome = [PUPIL, 'Blend the sound-parts smoothly to read the new word.'];
    const msg = failsOf(d, 'OUTCOME_VOICE').join(' ');
    expect(msg).toMatch(/the outcome sentence does not address the pupil/);
    expect(msg).toContain('Blend the sound-parts smoothly to read the new word.');
    expect(msg).not.toContain(PUPIL);
  });

  test('NOT STRICTER: an outcome whose every row addresses the pupil raises nothing', () => {
    const d = base();
    d.objectives.outcome = [PUPIL, 'You can blend sound-parts to read a new word.'];
    expect(failsOf(d, 'OUTCOME_VOICE').join(' ')).not.toMatch(/the outcome sentence/);
  });

  test('SCOPE: objectives.by_the_end is NOT one of the nine — it stays string-only', () => {
    // schema:152 types it `string`, so an array never reaches the rule and routing it through
    // the normaliser would only tell the next reader it is an array slot. The string rule is
    // untouched, and this is the guard that says so.
    const arr = base();
    arr.objectives.by_the_end = ['You can answer a "what happens next?" question.', 'You can give a reason.'];
    expect(failsOf(arr, 'SCHEMA').join(' ')).toMatch(/by_the_end/);
    const str = base();
    str.objectives.by_the_end = 'State what happens next in the story.';
    expect(failsOf(str, 'OUTCOME_VOICE').join(' ')).toMatch(/"by_the_end" . line does not address the pupil/);
  });

  test('the objectives.items loop is unchanged — it was already per item', () => {
    const d = base();
    d.objectives.items = [{ text: 'Name the four sound-parts.', slo_code: 'E-01-R-01' }];
    expect(failsOf(d, 'OUTCOME_VOICE').join(' ')).toMatch(/objective 1 does not address the pupil/);
  });
});
