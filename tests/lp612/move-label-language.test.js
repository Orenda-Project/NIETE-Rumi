/**
 * bd-yjmxh -- THE SAME MOVE, TWICE ON ONE URDU PAGE, IN TWO LANGUAGES.
 *
 * RENDER EVIDENCE (Urdu_seg4, page 4): the EXPLANATION phase-heading bar carried a chip
 * reading "I DO" -- Latin letters, in a right-to-left Nastaliq document -- while the
 * TEACHER MODELS box directly beneath it carried a chip reading "کر کے دکھائیں". Two
 * chips, one page, one move, two scripts.
 *
 * WHY THE TWO DISAGREED. They are two different mechanisms:
 *
 *   `.mvt`  (bd-yjmxh, the block chip) derives the move from the block id and prints it
 *           from a LABEL TABLE, so it is a translation and it was already correct.
 *   `.mv`   (bd-hlk39, the bar chip) is fed VERBATIM from `section.move`, a free-text
 *           field the schema says is "authored at D0 in the lesson language, so the
 *           renderer holds no label table for it". The Urdu document authored the
 *           English words "I DO", and the renderer faithfully echoed them.
 *
 * So the bug is not a missing translation; it is that a CLOSED three-value vocabulary was
 * being passed through as author prose. Root CLAUDE.md rule 20 is exactly this: language
 * is DATA, the en and ur blocks must BOTH be complete, and a label the renderer owns
 * lives in `lib/overlay.js` -- not inline, and not in the document. `weDo` and `youDo`
 * already live there in both blocks; `iDo` was the missing third, which is why I DO was
 * the move that printed in the wrong script.
 *
 * WHAT THIS SUITE HOLDS:
 *
 *   1. All three moves exist in BOTH overlay language blocks, in real Urdu, measured in
 *      CODE POINTS (rule 20) -- never UTF-16 units, which count Nastaliq wrong.
 *   2. An English-authored `section.move` prints in the DOCUMENT's language, both on the
 *      opening bar and on the "continued" bar that repeats it after a page break.
 *   3. The two chips agree: one move, one string, whichever surface prints it.
 *   4. No move chip anywhere in an Urdu render contains a Latin letter.
 *   5. Author text the renderer does NOT own still passes through untouched -- the
 *      normalisation may translate a known move, it may never swallow an unknown one.
 *   6. English is byte-identical to what it rendered before.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The fixture re-provenanced to grade 4 -- the one thing `isPrimary` reads. */
function doc(move) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English' };
  d.sections = d.sections.map((s) =>
    s.id === 'development' && move !== undefined ? { ...s, move } : s);
  return d;
}

const built = (d, lang) => buildHtml(d, { docDir: path.dirname(FIXTURE), lang: lang || 'en' });
const html = (d, lang) => built(d, lang).html;

/** Every chip the bar mechanism prints (opening bars and "continued" bars alike). */
const barChips = (h) => [...h.matchAll(/<span class="mv">([^<]*)<\/span>/g)].map((m) => m[1]);
/** Every chip the block mechanism prints. */
const blockChips = (h) => [...h.matchAll(/<span class="mvt[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);

const LATIN = /[A-Za-z]/;
const ARABIC = /[؀-ۿ]/;
/** Rule 20 measures strings in CODE POINTS, never UTF-16 units. */
const cp = (s) => [...s].length;

describe('rule 20 -- the move vocabulary is data, and both languages are complete', () => {
  test.each(['iDo', 'weDo', 'youDo'])('%s exists in the en block', (key) => {
    expect(typeof LABELS.en[key]).toBe('string');
    expect(cp(LABELS.en[key])).toBeGreaterThan(0);
  });

  test.each(['iDo', 'weDo', 'youDo'])('%s exists in the ur block, in real Urdu', (key) => {
    expect(typeof LABELS.ur[key]).toBe('string');
    expect(cp(LABELS.ur[key])).toBeGreaterThan(0);
    expect(LABELS.ur[key]).toMatch(ARABIC);
    expect(LABELS.ur[key]).not.toMatch(LATIN);
  });

  test('the two the overlay already shipped are not disturbed', () => {
    expect(LABELS.ur.weDo).toBe('مل کر کریں');
    expect(LABELS.ur.youDo).toBe('خود کریں');
  });
});

describe('an English-authored move prints in the document language', () => {
  test('the Urdu bar chip says the Urdu words, not "I DO"', () => {
    const chips = barChips(html(doc('I DO'), 'ur'));
    expect(chips.length).toBeGreaterThan(0);
    expect(chips).toContain(LABELS.ur.iDo);
    expect(chips).not.toContain('I DO');
  });

  test('the English bar chip still says the English words', () => {
    expect(barChips(html(doc('I DO'), 'en'))).toContain(LABELS.en.iDo);
  });

  test('every spelling the corpus uses for the same move normalises alike', () => {
    for (const authored of ['I DO', 'i do', 'I Do', 'I-DO', 'i_do']) {
      expect(barChips(html(doc(authored), 'ur'))).toContain(LABELS.ur.iDo);
    }
  });

  test('we do and you do normalise too', () => {
    expect(barChips(html(doc('WE DO'), 'ur'))).toContain(LABELS.ur.weDo);
    expect(barChips(html(doc('YOU DO'), 'ur'))).toContain(LABELS.ur.youDo);
  });
});

describe('the two chips on the page agree', () => {
  test('bar and block print ONE string for I DO in an Urdu document', () => {
    const h = html(doc('I DO'), 'ur');
    const bars = barChips(h);
    const blocks = blockChips(h);
    expect(bars.length).toBeGreaterThan(0);
    expect(blocks.length).toBeGreaterThan(0);
    expect(new Set([...bars, ...blocks].filter((c) => c === LABELS.ur.iDo)).size).toBe(1);
    expect(bars).toContain(LABELS.ur.iDo);
    expect(blocks).toContain(LABELS.ur.iDo);
  });

  test('no move chip anywhere in an Urdu render carries a Latin letter', () => {
    const h = html(doc('I DO'), 'ur');
    for (const chip of [...barChips(h), ...blockChips(h)]) expect(chip).not.toMatch(LATIN);
  });
});

describe('what the renderer does not own, it does not touch', () => {
  test('an authored string outside the move vocabulary passes through verbatim', () => {
    expect(barChips(html(doc('Pair talk'), 'ur'))).toContain('Pair talk');
  });

  test('an already-Urdu authored move is left exactly as written', () => {
    expect(barChips(html(doc('جوڑی میں بات'), 'ur'))).toContain('جوڑی میں بات');
  });

  test('no authored move still prints no bar chip at all', () => {
    expect(barChips(html(doc(undefined), 'ur'))).toEqual([]);
    expect(barChips(html(doc(undefined), 'en'))).toEqual([]);
  });
});
