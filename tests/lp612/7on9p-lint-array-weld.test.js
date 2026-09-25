/**
 * bd-7on9p — ARRAY_WELD: an array element that cannot survive the fill gate's re-join.
 *
 * bd-oyqb2 widened nine authored slots to `string | string[]`; the array prints one bulleted row
 * per element. bd-8sfwj then added the two-pass FILL GATE (`render_lp.js:~1373` joinArrayForm /
 * `:~1403` keepArrayForm), which REJECTS the array when the rows cost the lesson a page and
 * re-joins the elements with a SINGLE SPACE so the dense paragraph prints at its old page count.
 *
 *     ["Look at the diagram", "What do you notice?"]
 *  -> "Look at the diagram What do you notice?"          <- a run-on in the teacher's hand.
 *
 * The renderer must not repair this: "dont cut anything" means it never edits, trims or
 * re-punctuates an authored word, so it cannot append the missing full stop. The defect is
 * therefore caught HERE, at the validation boundary, before the document reaches a teacher.
 *
 * WHY A LINT AND NOT A SCHEMA `pattern`. The rule is "every element EXCEPT THE LAST ends in a
 * terminal mark". JSON Schema's `items` applies one constraint to every element and knows
 * nothing about an array's length, so it cannot exempt the last one; an `items.pattern` would
 * also demand a terminal mark on the final element, which MEASURED over the 335-lesson ch9-10
 * corpus would make a faithful split of 6 of the 2,345 gated-slot strings (0.26%) illegal —
 * strings that ship today, unterminated, and render exactly as they do now.
 *
 * WHY THE LAST ELEMENT IS EXEMPT. Nothing is welded AFTER it. Its final character is the field's
 * final character in BOTH forms, so the join cannot introduce a defect there. A rule that fired
 * on it would not be a weld rule at all; it would be a new "every field ends in a full stop"
 * rule with a different, measured blast radius (the 6 above, plus 37 of 335 faded_example
 * prompts) and is the operator's to ask for.
 *
 * URDU (language rule 20). Terminal punctuation includes ۔ U+06D4 and ؟ U+061F, and Urdu
 * REVERSES the curly quotes — ’’…‘‘ — so U+2018 is a CLOSING quote here, as are the guillemets
 * « ». Measured: reading U+2018/U+00BB as openers misreads 7 live Urdu strings as unterminated.
 * Lengths are measured in CODE POINTS: 14 corpus strings carry astral emoji, and a UTF-16 scan
 * can land on a lone surrogate.
 */

const fs = require('fs');
const path = require('path');

// A LITERAL relative require: `require(path.join(VENDOR, …))` is invisible to the static
// require-graph behind tests/setup/unresolved-requires.test.js.
const { lint, weldDefects } = require('../../bot/vendor/lp-v9/lint_lp.js');

const FIXTURE = path.join(__dirname, '__fixtures__', 'primary_g1_english.lp.json');
const RAW = fs.readFileSync(FIXTURE, 'utf8');
const base = () => JSON.parse(RAW);

const run = (doc) => lint(doc, FIXTURE);
const welds = (doc) => run(doc).fails.filter((f) => f.startsWith('ARRAY_WELD:'));
const nWelds = (doc) => welds(doc).length;

/** The `ask` block the introduction keeps as its hook. */
const hookOf = (d) => {
  for (const s of d.sections) for (const b of s.blocks || []) if (b.type === 'ask' && b.hook) return b;
  throw new Error('fixture has no hook');
};
const firstExit = (d) => {
  for (const s of d.sections) if ((s.exit_ticket || []).length) return s.exit_ticket[0];
  throw new Error('fixture has no exit ticket');
};

describe('bd-7on9p — weldDefects, the rule itself', () => {
  test('a terminated element before another element is clean', () => {
    expect(weldDefects({ objectives: { outcome: ['You can name a clue.', 'You can use it.'] } })).toEqual([]);
  });

  test('an UNTERMINATED element before another element is a defect, and names the slot', () => {
    const d = weldDefects({ objectives: { outcome: ['You can name a clue', 'You can use it.'] } });
    expect(d).toHaveLength(1);
    expect(d[0].at).toBe('/objectives/outcome/0');
    expect(d[0].row).toBe('You can name a clue');
    expect(d[0].next).toBe('You can use it.');
  });

  test('the LAST element is exempt — nothing is welded after it', () => {
    expect(weldDefects({ objectives: { outcome: ['You can name a clue.', 'You can use it'] } })).toEqual([]);
  });

  test('a one-element array has no weld at all', () => {
    expect(weldDefects({ objectives: { outcome: ['You can name a clue'] } })).toEqual([]);
  });

  test('a STRING is never a weld, however it ends', () => {
    expect(weldDefects({ objectives: { outcome: 'You can name a clue' } })).toEqual([]);
  });

  test('every defective element is reported, not just the first', () => {
    const d = weldDefects({ objectives: { outcome: ['a', 'b', 'c', 'd.'] } });
    expect(d.map((x) => x.at)).toEqual(['/objectives/outcome/0', '/objectives/outcome/1', '/objectives/outcome/2']);
  });

  test('. ! ? and … all terminate', () => {
    for (const m of ['.', '!', '?', '…']) {
      expect(weldDefects({ objectives: { outcome: [`Look` + m, 'Now.'] } })).toEqual([]);
    }
  });

  test('a colon or semicolon stem terminates — the join stays grammatical', () => {
    for (const m of [':', ';', '؛']) {
      expect(weldDefects({ objectives: { outcome: [`Look` + m, 'Now.'] } })).toEqual([]);
    }
  });

  test('a COMMA does not terminate — that is the bd-oyqb2 comma-splice, by another route', () => {
    expect(weldDefects({ objectives: { outcome: ['Look at it,', 'now try.'] } })).toHaveLength(1);
  });

  test('trailing whitespace is not a terminal mark, and does not hide one', () => {
    expect(weldDefects({ objectives: { outcome: ['Look at it.   ', 'Now.'] } })).toEqual([]);
    expect(weldDefects({ objectives: { outcome: ['Look at it   ', 'Now.'] } })).toHaveLength(1);
  });

  test('a blank row is dropped, as fieldRows drops it — the weld is between PRINTED rows', () => {
    expect(weldDefects({ objectives: { outcome: ['Look at it.', '   ', 'Now.'] } })).toEqual([]);
    const d = weldDefects({ objectives: { outcome: ['Look at it', '   ', 'Now.'] } });
    expect(d).toHaveLength(1);
    expect(d[0].next).toBe('Now.');
  });
});

describe('bd-7on9p — Urdu is not degraded (language rule 20)', () => {
  test('۔ U+06D4 and ؟ U+061F terminate — each in a NON-last row, which is the only place it matters', () => {
    // Both marks are asserted off the end of the array: the last row is exempt by
    // construction, so a ؟ parked there would prove nothing (it did not, before bd-7on9p).
    expect(weldDefects({ objectives: { outcome: ['لکھیں۔', 'کیا؟', 'x.'] } })).toEqual([]);
    expect(weldDefects({ objectives: { outcome: ['کیا؟', 'لکھیں۔', 'x.'] } })).toEqual([]);
  });

  test('a row that is NOTHING BUT a terminal mark is still weld-safe', () => {
    // The scan walks back over closers and must accept index 0 as the mark's home.
    expect(weldDefects({ objectives: { outcome: ['.', 'Now try.'] } })).toEqual([]);
    expect(weldDefects({ objectives: { outcome: ['۔', 'Now try.'] } })).toEqual([]);
  });

  test('an Urdu row with no terminal mark still fires', () => {
    expect(weldDefects({ objectives: { outcome: ['لکھیں', 'کیا؟'] } })).toHaveLength(1);
  });

  test('Urdu REVERSES the curly quotes: ‘ U+2018 closes, and « » are closers too', () => {
    // Both shapes are live in the corpus: `…لکھیں گے۔‘` and `…بتائیں۔»`.
    expect(weldDefects({ objectives: { outcome: ['لکھیں گے۔‘', 'x.'] } })).toEqual([]);
    expect(weldDefects({ objectives: { outcome: ['بتائیں۔»', 'x.'] } })).toEqual([]);
    expect(weldDefects({ objectives: { outcome: ['کیوں‘‘۔‘', 'x.'] } })).toEqual([]);
  });
});

describe('bd-7on9p — closers after the terminal mark', () => {
  test('a closing quote or bracket AFTER the mark still terminates', () => {
    for (const c of ['"', "'", '”', '’', ')', ']', '}']) {
      expect(weldDefects({ objectives: { outcome: ['He said "Go."' + c, 'Now try.'] } })).toEqual([]);
    }
  });

  test('the reported path is the AUTHORED index, not the printed-row index', () => {
    // A blank element is dropped before printing, so the two indices diverge. The
    // teacher fixes the row by its position in the JSON, so the JSON index is the one.
    const d = weldDefects({ objectives: { outcome: ['', 'Look at the diagram', 'What do you notice?'] } });
    expect(d).toHaveLength(1);
    expect(d[0].at).toBe('/objectives/outcome/1');
  });

  test('a closer with NO terminal mark before it does NOT terminate', () => {
    expect(weldDefects({ objectives: { outcome: ['Turn to the map (see page 12)', 'Now try.'] } })).toHaveLength(1);
  });

  test('an all-closers element has nothing to terminate it', () => {
    expect(weldDefects({ objectives: { outcome: ['")]', 'Now try.'] } })).toHaveLength(1);
  });

  test('an astral code point is scanned as ONE character, not two surrogates', () => {
    // 14 corpus strings carry emoji. Both readings agree on the verdict; the scan must not
    // land mid-pair, and a terminal mark behind an emoji-and-closer must still be found.
    expect(weldDefects({ objectives: { outcome: ['Find the beaker 🧪', 'Now try.'] } })).toHaveLength(1);
    expect(weldDefects({ objectives: { outcome: ['Find it.🧪', 'Now try.'] } })).toHaveLength(1);
  });
});

describe('bd-7on9p — every gated slot the fill gate joins is visited', () => {
  const BAD = ['first row', 'second row.'];
  const OK = ['first row.', 'second row.'];

  /** Build a minimal doc that puts BAD in one slot, and return the slot's reported paths. */
  const at = (build) => weldDefects(build(BAD)).map((d) => d.at);

  test('objectives.outcome', () => {
    expect(at((v) => ({ objectives: { outcome: v } }))).toEqual(['/objectives/outcome/0']);
    expect(weldDefects({ objectives: { outcome: OK } })).toEqual([]);
  });

  test('page2.differentiation.stuck and .early', () => {
    expect(at((v) => ({ page2: { differentiation: { stuck: v } } }))).toEqual(['/page2/differentiation/stuck/0']);
    expect(at((v) => ({ page2: { differentiation: { early: v } } }))).toEqual(['/page2/differentiation/early/0']);
  });

  test('page2.coaching_reflection', () => {
    expect(at((v) => ({ page2: { coaching_reflection: v } }))).toEqual(['/page2/coaching_reflection/0']);
  });

  test('sections[].exit_ticket[].q', () => {
    expect(at((v) => ({ sections: [{ exit_ticket: [{ q: 'fine.' }, { q: v }] }] })))
      .toEqual(['/sections/0/exit_ticket/1/q/0']);
  });

  test('ask.question', () => {
    expect(at((v) => ({ sections: [{ blocks: [{ type: 'ask', question: v }] }] })))
      .toEqual(['/sections/0/blocks/0/question/0']);
  });

  test('worked_example.prompt and .cfu', () => {
    expect(at((v) => ({ sections: [{ blocks: [{ type: 'worked_example', prompt: v }] }] })))
      .toEqual(['/sections/0/blocks/0/prompt/0']);
    expect(at((v) => ({ sections: [{ blocks: [{ type: 'worked_example', cfu: v }] }] })))
      .toEqual(['/sections/0/blocks/0/cfu/0']);
  });

  test('a block nested inside a `split` is visited too', () => {
    // render_lp.js:eachArrayFormSlot walks `sec.blocks` WITHOUT descending into a split, so a
    // nested block is invisible to the fill gate today. lint_lp.js has always walked splits
    // (`allBlocks`), and an author cannot know whether their block was nested.
    expect(at((v) => ({ sections: [{ blocks: [{ type: 'split', left: [{ type: 'ask', question: v }], right: [] }] }] })))
      .toEqual(['/sections/0/blocks/0/left/0/question/0']);
  });

  test('faded_example.prompt is NOT gated — its array is never joined, so it cannot weld', () => {
    // render_lp.js ARRAY_FORM_BLOCK_SLOTS deliberately omits faded_example: its string branch
    // already splits on " · " into the same <ul>, so the gate never joins it. lib/template.js
    // carries no `.join(" ")` at all, so `joinArrayForm` is the only weld route in the vendor.
    expect(weldDefects({ sections: [{ blocks: [{ type: 'faded_example', prompt: BAD }] }] })).toEqual([]);
  });

  test('a slot on an unknown block type is not invented', () => {
    expect(weldDefects({ sections: [{ blocks: [{ type: 'key_points', question: BAD }] }] })).toEqual([]);
  });
});

describe('bd-7on9p — ARRAY_WELD through lint(), on a real primary document', () => {
  test('the pristine fixture, all-strings, raises no ARRAY_WELD', () => {
    expect(welds(base())).toEqual([]);
  });

  test('a welding hook question is a FAIL, and the message names the slot and quotes the row', () => {
    const d = base();
    hookOf(d).question = ['Look at the picture on page 124', 'What do you think happens next?'];
    const w = welds(d);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('/question/0');
    expect(w[0]).toContain('Look at the picture on page 124');
    expect(w[0]).toContain('What do you think happens next?');
  });

  test('the SAME split, properly terminated, is clean — the rule is not a ban on arrays', () => {
    const d = base();
    hookOf(d).question = ['Look at the picture on page 124.', 'What do you think happens next?'];
    expect(welds(d)).toEqual([]);
  });

  test('an ARRAY_WELD is a fail, never a warn', () => {
    const d = base();
    firstExit(d).q = ['Name one clue', 'Then say why.'];
    const r = run(d);
    expect(r.fails.filter((f) => f.startsWith('ARRAY_WELD:'))).toHaveLength(1);
    expect(r.warns.filter((f) => f.startsWith('ARRAY_WELD:'))).toEqual([]);
  });

  test('it fires on a `smoke` profile too — a weld is not a full-profile nicety', () => {
    // `full` and `smoke` are the only profiles the schema admits. Most pedagogy gates are
    // skipped on `smoke`; ARRAY_WELD is not one of them, because the fill gate joins regardless.
    const d = base();
    d.lint_profile = 'smoke';
    hookOf(d).question = ['Look at the picture', 'What next?'];
    expect(run(d).profile).toBe('smoke');
    expect(welds(d)).toHaveLength(1);
  });

  test('the array form is NO STRICTER than the joined string it would become', () => {
    // The file's own invariant (see the fieldRows/fieldText note): a rule reading a whole field
    // must reach the same verdict on both shapes. So a PROPERLY TERMINATED split must raise
    // exactly the fails its joined string raises — ARRAY_WELD included, which must be none.
    const parts = ['Look at the picture on page 124.', 'What do you think happens next?'];
    const arr = base();
    hookOf(arr).question = parts;
    const str = base();
    hookOf(str).question = parts.join(' ');
    expect(run(arr).fails.sort()).toEqual(run(str).fails.sort());
  });

  test('a WELDING split differs from its joined string by ARRAY_WELD and nothing else', () => {
    // The joined string is exactly what the gate would print, so every other rule must agree.
    const parts = ['Look at the picture on page 124', 'What do you think happens next?'];
    const arr = base();
    hookOf(arr).question = parts;
    const str = base();
    hookOf(str).question = parts.join(' ');
    const a = run(arr).fails.sort();
    expect(a.filter((f) => f.startsWith('ARRAY_WELD:'))).toHaveLength(1);
    expect(a.filter((f) => !f.startsWith('ARRAY_WELD:'))).toEqual(run(str).fails.sort());
  });
});
