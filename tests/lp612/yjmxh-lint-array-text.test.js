/**
 * bd-yjmxh — lint_lp.js on the bd-oyqb2 string-or-array slots, part 2 of 2.
 *
 * Part 1 is yjmxh-lint-array-fields.test.js: it carries the full defect write-up, the reason
 * this fixture is a REAL primary document rather than `v9_gate_base.lp.json`, and the rules
 * that read a whole field's SHAPE. This file carries the rules that read a field's TEXT, where
 * the defect is `Array#toString`'s bare comma rather than a crash:
 *
 *   A4a :1280 `unworded(b.prompt)`                  — the "?"/":" end-anchor lost to the comma
 *   A4b :1428 `String(coaching_reflection || "")`   — same, on the teacher's own page
 *   E1  :1570 `wordCount(O.outcome)`                — the comma eats a word boundary per row,
 *                                                     silently raising the OUTCOME_BOX ceiling
 *   E2  :1203 `allQuestions(doc)`                   — every exit-ticket question, same anchor
 *   E3  :311  `extraWords` exit ticket              — N rows counted as ONE word, so an array
 *                                                     exit ticket costs its section nothing
 *   E4  :1518 `rayLesson` join                    — a row boundary inside "plane mirror" beats
 *                                                     the phrase regex, and the rule bd-jir5b
 *                                                     was cut for stops firing entirely
 *
 * Every assertion here is a DELTA on one code against the unmodified fixture (49 fails across
 * 20 codes), never an absolute count, and every pair is string-form vs the array form of the
 * SAME content: the array must never be the weaker reading.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint, OUTCOME_BOX_V9 } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'primary_g1_english.lp.json');
const RAW = fs.readFileSync(FIXTURE, 'utf8');
const base = () => JSON.parse(RAW);

const run = (doc) => lint(doc, FIXTURE);
const failsOf = (doc, code) => run(doc).fails.filter((f) => f.startsWith(`${code}:`));
const nFails = (doc, code) => failsOf(doc, code).length;

const fadedOf = (d) => {
  for (const s of d.sections) for (const b of s.blocks || []) if (b.type === 'faded_example') return b;
  throw new Error('fixture has no faded_example');
};
const exitOf = (d) => {
  for (const s of d.sections) if ((s.exit_ticket || []).length) return s.exit_ticket[0];
  throw new Error('fixture has no exit ticket');
};

describe('bd-yjmxh A4a — UNWORDED_Q reads a prompt as printed (:1280)', () => {
  // faded_example.prompt is live on 335 of 335 corpus documents (worked_example.prompt on 0).
  // A colon-terminated stem is a frame (`/[:\uFF1A]\s*$/`) and carries no COMMANDS word, so the
  // end-anchor is the ONLY thing holding it — which is what the trailing comma destroys.
  const STEM = 'The best title for this story is:';
  const UNFRAMED = '|B|, B inverse: B = 3';

  test('a colon-stemmed prompt is framed; a blank trailing row must not unframe it', () => {
    const str = base();
    fadedOf(str).prompt = STEM;
    const arr = base();
    fadedOf(arr).prompt = [STEM, '   '];
    expect(nFails(str, 'UNWORDED_Q')).toBe(nFails(base(), 'UNWORDED_Q'));
    expect(nFails(arr, 'UNWORDED_Q')).toBe(nFails(str, 'UNWORDED_Q'));
  });

  test('NO WEAKER: a prompt with no frame fails as a string and as the array form', () => {
    const str = base();
    fadedOf(str).prompt = UNFRAMED;
    const arr = base();
    fadedOf(arr).prompt = ['|B|,', 'B inverse: B = 3'];
    const both = nFails(base(), 'UNWORDED_Q') + 1;
    expect(nFails(str, 'UNWORDED_Q')).toBe(both);
    expect(nFails(arr, 'UNWORDED_Q')).toBe(both);
  });

  test('an array prompt is worth exactly its space-joined equivalent string', () => {
    // The invariant the fix asserts, on content whose verdict is NOT obvious either way:
    // "look"/"blend" are outside COMMANDS, so this prompt is unframed in BOTH shapes. What
    // must hold is that the two shapes agree — the array is never the weaker reading.
    const rows = ['Look at the two words on the board.', 'Blend each one sound by sound.'];
    const str = base();
    fadedOf(str).prompt = rows.join(' ');
    const arr = base();
    fadedOf(arr).prompt = rows;
    expect(nFails(arr, 'UNWORDED_Q')).toBe(nFails(str, 'UNWORDED_Q'));
    expect(nFails(arr, 'UNWORDED_Q')).toBeGreaterThan(nFails(base(), 'UNWORDED_Q'));
  });
});

describe('bd-yjmxh A4b — COACHING_CORNER reads the reflection as printed (:1428)', () => {
  const REFLECTION = 'Which of my pupils could not blend today, and who do I re-teach tomorrow?';

  test('a reflective question with a blank trailing row passes, as its string form does', () => {
    const str = base();
    str.page2.coaching_reflection = REFLECTION;
    const arr = base();
    arr.page2.coaching_reflection = [REFLECTION, '   '];
    expect(nFails(str, 'COACHING_CORNER')).toBe(0);
    expect(nFails(arr, 'COACHING_CORNER')).toBe(0);
  });

  test('NO WEAKER: a content-question reflection fails as a string and as the array form', () => {
    const str = base();
    str.page2.coaching_reflection = 'What is the main idea of the story on page 124?';
    const arr = base();
    arr.page2.coaching_reflection = ['What is the main idea', 'of the story on page 124?'];
    expect(failsOf(str, 'COACHING_CORNER').join(' ')).toMatch(/asks about the lesson.s CONTENT/);
    expect(failsOf(arr, 'COACHING_CORNER').join(' ')).toMatch(/asks about the lesson.s CONTENT/);
  });

  test('NO WEAKER: a statement reflection fails in both shapes', () => {
    const str = base();
    str.page2.coaching_reflection = 'My pupils found the blending hard today.';
    const arr = base();
    arr.page2.coaching_reflection = ['My pupils found', 'the blending hard today.'];
    expect(failsOf(str, 'COACHING_CORNER').join(' ')).toMatch(/is a statement, not a question/);
    expect(failsOf(arr, 'COACHING_CORNER').join(' ')).toMatch(/is a statement, not a question/);
  });

  test('an empty reflection still fails, through the normaliser (fieldText("   ") is "")', () => {
    const d = base();
    d.page2.coaching_reflection = '   ';
    expect(failsOf(d, 'COACHING_CORNER').join(' ')).toMatch(/sets no reflective question/);
  });
});

describe('bd-yjmxh E1 — OUTCOME_BOX counts every word of an array outcome (:1570)', () => {
  // OUTCOME_BOX_V9.outcome is 20. 21 words, addressed to the pupil so OUTCOME_VOICE stays quiet.
  const WORDS = ['You', 'can', 'look', 'at', 'the', 'title', 'and', 'the', 'picture', 'before',
    'reading', 'and', 'predict', 'what', 'the', 'whole', 'story', 'will', 'be', 'mainly', 'about.'];

  test('the case is one word over the ceiling', () => {
    expect(WORDS.length).toBe(OUTCOME_BOX_V9.outcome + 1);
  });

  test('NO WEAKER: 21 words fail as a string and as the two-row array of the same words', () => {
    const str = base();
    str.objectives.outcome = WORDS.join(' ');
    const arr = base();
    arr.objectives.outcome = [WORDS.slice(0, 11).join(' '), WORDS.slice(11).join(' ')];
    expect(failsOf(str, 'OUTCOME_BOX').join(' ')).toMatch(/the outcome sentence is 21 words/);
    expect(failsOf(arr, 'OUTCOME_BOX').join(' ')).toMatch(/the outcome sentence is 21 words/);
  });
});

describe('bd-yjmxh E3 — an array exit-ticket question is budgeted word for word (:311)', () => {
  // `extraWords` is the section budget's other half. The weld collapses N rows to ONE word
  // (`String(["a","b","c"]).split(/\s+/)` is `["a,b,c"]`), so an array exit ticket costs the
  // section almost nothing and a section that overflows the page reports as within budget.
  const ROWS = Array.from({ length: 30 }, (_, i) => `padding row number ${i} here`);

  test('the array costs the conclusion exactly what the same words cost as a string', () => {
    const str = base();
    exitOf(str).q = ROWS.join(' ');
    const arr = base();
    exitOf(arr).q = ROWS;
    const of = (d) => failsOf(d, 'BUDGET').filter((f) => /conclusion/.test(f));
    expect(of(base())).toEqual([]);          // the section starts inside its budget
    expect(of(str)).toHaveLength(1);         // +150 words puts it over
    expect(of(arr)).toEqual(of(str));        // and the array must cost the same
  });
});

describe('bd-yjmxh E2 — exit_ticket[].q reaches the question rules as text (:1203)', () => {
  test('NO WEAKER: an unframed exit-ticket question fails UNWORDED_Q in both shapes', () => {
    const str = base();
    exitOf(str).q = '|B|, B inverse: B = 3';
    const arr = base();
    exitOf(arr).q = ['|B|,', 'B inverse: B = 3'];
    expect(nFails(str, 'UNWORDED_Q')).toBe(nFails(arr, 'UNWORDED_Q'));
    expect(nFails(arr, 'UNWORDED_Q')).toBeGreaterThan(0);
  });

  test('NOT STRICTER: a colon-stemmed exit-ticket question keeps its frame across rows', () => {
    // Held ONLY by the end-anchor `/[:\uFF1A]\s*$/`, so the weld's trailing comma is the whole
    // difference between framed and a spurious UNWORDED_Q.
    const STEM = 'The best title for this story is:';
    const str = base();
    exitOf(str).q = STEM;
    const arr = base();
    exitOf(arr).q = [STEM, '   '];
    expect(nFails(str, 'UNWORDED_Q')).toBe(nFails(base(), 'UNWORDED_Q'));
    expect(nFails(arr, 'UNWORDED_Q')).toBe(nFails(str, 'UNWORDED_Q'));
  });

  test('an array exit-ticket question does not crash the linter', () => {
    const d = base();
    exitOf(d).q = ['Predict what this story is about.', 'Then blend sh-are.'];
    expect(() => run(d)).not.toThrow();
  });
});

describe('bd-yjmxh E4 — RAY_ELEMENT_MISMATCH reads the lesson prose as printed (:1518)', () => {
  // The falsification pass did not name this one, and it is the same silent-disable class as A3.
  // `rayLesson` welds `objectives.outcome` into the prose the mirror/lens rules search, and both
  // consumers are PHRASE regexes -- `/\bplane\s+mirror/i`, `/\b(concave|convex|...)\s+mirror/i`.
  // A row boundary falling between "plane" and "mirror" prints "plane mirror" to the teacher but
  // welds to "plane,mirror", `\s+` fails, and the rule whose comment says it "catches the shipped
  // defect: a plane-mirror lesson drawn with a concave mirror" (bd-jir5b) stops firing.
  //
  // FIXTURE: this is the ONE rule here that needs `v9_gate_base.lp.json`. The ray gate is STEM-only
  // and reachable only through a `ray_diagram` spec, which no primary document carries; the reason
  // the rest of this suite avoids that fixture (isPrimary false) is exactly why it is right here.
  const GATE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
  const GATE_RAW = fs.readFileSync(GATE, 'utf8');

  /** The gate fixture with a concave-mirror ray diagram and the given outcome. */
  const withRay = (outcome) => {
    const d = JSON.parse(GATE_RAW);
    d.objectives.outcome = outcome;
    d.sections.find((s) => s.id === 'development').blocks.push({
      type: 'diagram', id: 'ray-e4', spec: { type: 'ray_diagram', element: 'concave_mirror', f: 20 },
    });
    return d;
  };
  const rayFails = (doc) => lint(doc, GATE).fails.filter((f) => f.startsWith('RAY_ELEMENT_MISMATCH:'));

  test('the probe is schema-valid, so a miss is the rule and not a rejected document', () => {
    for (const o of ['You can draw the image formed by a plane mirror.', ['a', 'b']]) {
      expect(lint(withRay(o), GATE).fails.filter((f) => f.startsWith('SCHEMA:'))).toEqual([]);
    }
  });

  test('a plane-mirror outcome drawn with a concave mirror fails as a string', () => {
    expect(rayFails(withRay('You can draw the image formed by a plane mirror.')).length).toBe(1);
  });

  test('NO WEAKER: the same words split so the row boundary lands inside "plane mirror"', () => {
    const arr = ['You can draw the image formed by a plane', 'mirror and mark the normal.'];
    expect(rayFails(withRay(arr)).length).toBe(1);
  });

  test('NOT STRICTER: a concave-mirror outcome drawn with a concave mirror stays silent', () => {
    const arr = ['You can draw the image formed by a concave', 'mirror and mark the focus.'];
    expect(rayFails(withRay(arr))).toEqual([]);
  });
});
