/**
 * Code that reads the copy deck at runtime reads it through one door.
 *
 * bot/shared/config/copy.v2.json marks a key `held` or `retired` when no surface may show it (the deck's _meta). A
 * template or quiz service that `require`s the deck and indexes it by key shows the line whatever the deck says of
 * it; the one door, deckLine(key, lang), returns '' for a held or retired key.
 *
 * The rule (the exact rule is rawDeckReaders in test-seam-gates-lib.js): a file under bot/shared/templates or
 * bot/shared/services/quiz (sub-folders too) that calls `require` with a path ending in `copy.v2.json` (or
 * `copy.v2`) in code, never in a comment or a string, is a raw reader. The file that defines `deckLine` is the door
 * itself, not a raw reader; a file that reads through deckLine and does not require the deck is none.
 *
 * copy-deck-readers.allowlist.json: { "<repo path>": "<why>" }, today's raw readers. It only shrinks: a new raw
 * reader fails; a listed file that stops reading the deck raw passes with a console.warn `CLEAN:` line.
 */
const fs = require('fs');
const path = require('path');
const ALLOW = require('./copy-deck-readers.allowlist.json');
const { REPO, rel, walk, rawDeckReaders, listVerdict } = require('./test-seam-gates-lib');

const FILE = 'copy-deck-readers.allowlist.json';
const WHAT = "reads copy.v2.json raw: read the deck through deckLine(key, lang), which returns '' for held or retired keys";
const ROOTS = ['bot/shared/templates', 'bot/shared/services/quiz'];

describe('the detector, on in-memory sources', () => {
  const file = (id, lines) => ({ id, source: lines.join('\n') });
  // built from parts so the unresolved-requires gate never reads these fixture lines as requires of missing files
  const R = 'requ' + 'ire';

  test('a require of the deck in code is a raw reader; in a comment or a string it is not', () => {
    expect(rawDeckReaders([
      file('a.page.js', [`const d = ${R}('../config/copy.v2.json')['jg.round.t_paused'];`]),
      file('b.page.js', [`const DECK = ${R}("../../config/copy.v2");`]),
      file('c.page.js', ['// Copy: copy.v2.json keys only', `/* read ${R}('../config/copy.v2.json') once */`, `const s = "${R}('copy.v2.json')";`]),
      file('d.page.js', [`const ux = ${R}('../config/ux-strings');`]),
    ])).toEqual(['a.page.js', 'b.page.js']);
  });

  test('the file that defines deckLine is the door; a file that reads through it is not a raw reader', () => {
    expect(rawDeckReaders([
      file('deck-line.js', [`const DECK = ${R}('../config/copy.v2.json');`, 'function deckLine(key, lang) { return DECK[key] || ""; }']),
      file('e.page.js', [`const { deckLine } = ${R}('../config/deck-line');`, "const s = deckLine('jg.round.t_paused', 'en');"]),
      file('f.page.js', [`const { deckLine } = ${R}('../config/deck-line');`, `const raw = ${R}('../config/copy.v2.json');`]),
    ])).toEqual(['f.page.js']);
  });

  test('the list check: a new raw reader fails with the deckLine message; a listed file that stopped passes with a CLEAN line', () => {
    expect(listVerdict(['x.js'], [], WHAT, FILE).failures).toEqual([`NEW: x.js ${WHAT}.`]);
    expect(listVerdict([], ['x.js'], WHAT, FILE)).toEqual({ failures: [], cleans: [`CLEAN: x.js is fixed or gone. Remove it from ${FILE}.`] });
  });
});

describe('the tree', () => {
  test('every raw reader of the deck under the templates and the quiz services is listed; nothing new', () => {
    for (const k of Object.keys(ALLOW)) expect([k, String(ALLOW[k]).length >= 10]).toEqual([k, true]);
    const files = ROOTS.flatMap((r) => walk(path.join(REPO, r), (n) => n.endsWith('.js')))
      .map((f) => ({ id: rel(f), source: fs.readFileSync(f, 'utf8') }));
    const { failures, cleans } = listVerdict(rawDeckReaders(files), Object.keys(ALLOW), WHAT, FILE);
    for (const line of cleans) console.warn(line);
    expect(failures).toEqual([]);
  });
});
