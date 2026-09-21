/**
 * bd-xsuwz — THE SCHEMA MUST ACCEPT WHAT THE RENDERER READS.
 *
 * Three vendor divergences added a field to `lib/template.js` and said, in SYNC, that they had
 * also added it to `schema/lp_doc.schema.json`. None of the three had:
 *
 *   §3.16  `board.panels`   — the board LAID OUT, the fix for 38 boards printing as 38 paragraphs
 *   §3.17  `turns`          — the script as call-and-response rows, on worked_example + faded_example
 *   bd-vbs5w `sequence.day` / `.of` — the integers the primary progress rail draws its pips from
 *
 * The gap was invisible for a reason worth writing down: EVERY suite in this tree calls
 * `buildHtml(doc)` directly, and `buildHtml` does not validate. `validateDoc` runs one layer up,
 * inside `renderDoc`, so a document could be renderable by every test here and still be refused by
 * the CLI and by `lint_lp.js` — which is exactly what happened. Measured on the G4 English Ch.9
 * corpus: `node render_lp.js <primary doc>` exits 1 with SCHEMA INVALID on all 38 lessons, and has
 * done since §3.16 landed. Every primary render produced in the meantime went around the validator.
 *
 * So this suite asserts against `validateDoc`, not against markup. It is the only suite here that
 * does, and that is its whole point: it fails when the schema falls behind the renderer again.
 *
 * WHAT MUST NOT CHANGE: all five additions are OPTIONAL properties on existing variants. A G6-12
 * document carries none of them, and the first test is the control that says so — the base fixture
 * must stay valid, with no errors, exactly as it was.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { validateDoc } = require(path.join(VENDOR, 'lib', 'validate'));
const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** Put `blk` in `development` and judge the whole document, which is what the CLI judges. */
function withBlock(blk) {
  const d = baseDoc();
  d.sections.find((s) => s.id === 'development').blocks.push(blk);
  return d;
}
const ok = (doc) => validateDoc(doc);

// The shapes below are not invented: they are every key the renderer reads, cross-checked
// against every key the 38-lesson G4 Ch.9 corpus actually emits.
const PANELS = [
  { label: 'APOSTROPHE ALLEY', rows: [{ term: "Jojo's ball", gloss: 'the ball belongs to Jojo' }] },
  { connector: '-> APPLY THE CLUE ->', label: 'PRESENT SIMPLE', rows: [{ text: 'Birds fly in the sky.' }] },
];
const TURNS = [
  { kind: 'do', text: 'Model both apostrophe purposes on the board.' },
  { kind: 'say', text: "I read the book's example." },
  { kind: 'ask', text: 'Who owns the ball?', expect: ['Jojo'] },
  { kind: 'frame', text: 'The ___ belongs to ___.' },
  { kind: 'calc', text: 'is not -> isn’t' },
  { kind: 'routine', name: 'THINK-PAIR-SHARE', parts: ['Think alone.', 'Tell your partner.'] },
  { kind: 'say', text: 'Turn to p.107.', ref: 'p.107' },
];

describe('a G6-12 plan is the control', () => {
  test('the base fixture is valid and carries none of the five additions', () => {
    const r = ok(baseDoc());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const json = JSON.stringify(baseDoc());
    for (const key of ['"panels"', '"turns"', '"day"', '"of"']) expect(json).not.toContain(key);
  });
});

describe('board.panels — the board LAID OUT (SYNC 3.16)', () => {
  test('a panelled board validates', () => {
    expect(ok(withBlock({ type: 'board', id: 'b1', text: 'flat fallback', panels: PANELS })).errors)
      .toEqual([]);
  });

  test('`text` stays REQUIRED — it is the fallback every reader outside the renderer addresses', () => {
    expect(ok(withBlock({ type: 'board', id: 'b1', panels: PANELS })).ok).toBe(false);
  });

  test('a panel row is term+gloss OR text, and a row that is neither is refused', () => {
    const bad = [{ label: 'X', rows: [{ nope: 'y' }] }];
    expect(ok(withBlock({ type: 'board', id: 'b1', text: 't', panels: bad })).ok).toBe(false);
  });

  test('a panel needs rows — an empty panel is a numbered chip with nothing under it', () => {
    expect(ok(withBlock({ type: 'board', id: 'b1', text: 't', panels: [{ label: 'X' }] })).ok)
      .toBe(false);
  });
});

describe('turns — the script as rows (SYNC 3.17)', () => {
  for (const type of ['worked_example', 'faded_example']) {
    test(`a ${type} carrying turns validates`, () => {
      const blk = { type, id: 'x', title: 'I DO', minutes: 6, steps: ['Model it.'], turns: TURNS };
      expect(ok(withBlock(blk)).errors).toEqual([]);
    });
  }

  test('`steps` stays REQUIRED — it is what a G6-12 plan and the flat branch still print', () => {
    expect(ok(withBlock({ type: 'worked_example', id: 'x', turns: TURNS })).ok).toBe(false);
  });

  test('the six kinds are the closed set the renderer styles, and a seventh is refused', () => {
    const blk = (kind) => ({ type: 'worked_example', id: 'x', steps: ['s'], turns: [{ kind, text: 't' }] });
    for (const kind of ['do', 'say', 'ask', 'frame', 'calc', 'routine']) {
      expect(ok(withBlock(blk(kind))).errors).toEqual([]);
    }
    // `.k-shout` has no rule, so the row would print unstyled rather than loudly wrong.
    expect(ok(withBlock(blk('shout'))).ok).toBe(false);
  });
});

describe('sequence.day / .of — the pips, not the sentence (bd-vbs5w)', () => {
  const seq = (extra) => {
    const d = baseDoc();
    d.sequence = { this: 'Day 6 of 10', ...extra };
    return d;
  };

  test('the two integers validate beside the sentence they were parsed out of', () => {
    expect(ok(seq({ day: 6, of: 10 })).errors).toEqual([]);
  });

  test('`this` stays REQUIRED — it is the fallback when the rail cannot be drawn', () => {
    const d = baseDoc();
    d.sequence = { day: 6, of: 10 };
    expect(ok(d).ok).toBe(false);
  });

  test('a day is a counting number, so 0 and a string are both refused', () => {
    expect(ok(seq({ day: 0, of: 10 })).ok).toBe(false);
    expect(ok(seq({ day: '6', of: 10 })).ok).toBe(false);
  });
});

describe('section.move — the gradual-release tag on the bar (bd-hlk39)', () => {
  /* `sections.items` is `additionalProperties: false`, so a field the renderer reads and the
     schema has never heard of is not a lax pass -- it is SCHEMA INVALID and exit 1 on every
     primary document. That is the bd-xsuwz failure, and this is the test that stops it
     happening a second time in the same quarter. */
  const withMove = (move) => {
    const d = baseDoc();
    const dev = d.sections.find((s) => s.id === 'development');
    dev.title = 'Explanation';
    if (move !== undefined) dev.move = move;
    return d;
  };

  test('the base fixture is still valid, with no move anywhere — the control', () => {
    expect(ok(withMove(undefined)).errors).toEqual([]);
  });

  test('a section carrying its move validates', () => {
    expect(ok(withMove('I DO')).errors).toEqual([]);
  });

  test('the move is free text, because D0 authors it in the lesson language', () => {
    expect(ok(withMove('میں کرتا ہوں')).errors).toEqual([]);
  });

  test('a move that is not a string is refused rather than printed as [object Object]', () => {
    expect(ok(withMove({ en: 'I DO' })).ok).toBe(false);
    expect(ok(withMove(1)).ok).toBe(false);
  });
});
