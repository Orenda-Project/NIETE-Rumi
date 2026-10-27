/**
 * A Grade 1-2 paper, as a child who cannot yet read well meets it.
 *
 * Amena, 23 Oct 2026 on the sandbox G1 English paper: no line or box to write in;
 * "Q1 stem is right, the sub-bullets should just have a picture and a box to
 * write in"; Q1 says "from the box" and there was no box of words. Every written
 * item gets a box (bd-5jmnfj.4.8), the word bank prints where the instruction
 * points at it (bd-5jmnfj.4.9), and a picture-naming question is a grid of
 * picture + box with no stem repeated under each one (bd-5jmnfj.4.19).
 *
 * The fixtures are the sandbox papers of that day with every image cut to a
 * stub: they were generated before these flags existed, so the paper must fall
 * back to the pattern for them.
 */

const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const english = require('./fixtures/early/g1-english-exam.json');
const gk = require('./fixtures/early/g1-general_knowledge-exam.json');

const html = R.renderPaper({ examJson: english, grade: 1, subject: 'english' });

/** The printed items of one slot, each as its own HTML string. */
function itemsOf(page, slot) {
  const marker = `data-slot="${slot}"`;
  return page.split('<div class="q').slice(1).filter((s) => s.includes(marker));
}

/** The whole printed block of one slot: head, word bank and items. */
function slotHtml(page, slot) {
  const at = page.indexOf(`data-slot="${slot}"`);
  const end = page.indexOf('<div class="slot', at);
  return page.slice(page.lastIndexOf('<div class="slot', at), end < 0 ? undefined : end);
}

describe('every written item has somewhere to write', () => {
  test.each([
    ['g1.english.A.Q1'], ['g1.english.A.Q2'], ['g1.english.A.Q3'], ['g1.english.A.Q4'],
    ['g1.english.A.Q5'], ['g1.english.B.Q7'], ['g1.english.B.Q9'], ['g1.english.C.Q14'],
  ])('%s prints a write box under every item', (slot) => {
    const items = itemsOf(html, slot);
    expect(items.length).toBeGreaterThan(0);
    items.forEach((it) => expect(it).toContain('class="write-box"'));
  });

  test('a multiple-choice item gets no box: the child circles', () => {
    itemsOf(html, 'g1.english.C.Q15').forEach((it) => expect(it).not.toContain('write-box'));
  });

  test('answerLines:false still prints a clean paper with no boxes', () => {
    const bare = R.renderPaper({ examJson: english, grade: 1, subject: 'english', answerLines: false });
    expect(bare).not.toContain('class="write-box"');
  });
});

describe('a picture-naming question is picture + box, nothing else', () => {
  const q1 = itemsOf(html, 'g1.english.A.Q1');

  test('Q1 prints six cells in a picture grid, the word bank once above it', () => {
    const block = slotHtml(html, 'g1.english.A.Q1');
    expect(block.indexOf('word-')).toBeLessThan(block.indexOf('class="pic-grid"'));
    expect(block).toContain('class="pic-grid"');
    expect(q1).toHaveLength(6);
    q1.forEach((it) => expect(it.startsWith(' pic-cell"')).toBe(true));
  });

  test('no Q1 cell repeats a stem under its number', () => {
    q1.forEach((it) => expect(it).not.toMatch(/Write the correct word/i));
  });

  test('the picture comes before the box', () => {
    q1.forEach((it) => expect(it.indexOf('class="pic ')).toBeLessThan(it.indexOf('write-box')));
  });

  test('Q7 Name the Picture drops "What is this?" too', () => {
    itemsOf(html, 'g1.english.B.Q7').forEach((it) => expect(it).not.toMatch(/what is this/i));
  });

  test('a picture item that needs its stem keeps it (Q5 shows the word with a gap)', () => {
    const q5 = itemsOf(html, 'g1.english.A.Q5');
    q5.forEach((it) => expect(it).toMatch(/_/));
  });
});

describe('"from the box" prints the box', () => {
  test('G1 English Q1 prints its six words', () => {
    const block = slotHtml(html, 'g1.english.A.Q1');
    ['cat', 'dog', 'sun', 'pen', 'kite', 'cake'].forEach((w) => expect(block).toContain(`>${w}<`));
    expect(block).toMatch(/word-(box|line)/);
  });

  test('G1 English Q9 prints its five words', () => {
    expect(slotHtml(html, 'g1.english.B.Q9')).toMatch(/word-(box|line)/);
  });

  test('G1 GK Q1 prints its word bank', () => {
    const page = R.renderPaper({ examJson: gk, grade: 1, subject: 'general_knowledge' });
    const words = gk.unseen.subjective['Fill in the Blanks'][0].words;
    expect(words.length).toBeGreaterThan(0);
    const block = slotHtml(page, gk.unseen.subjective['Fill in the Blanks'][0].slot);
    expect(block).toMatch(/word-(box|line)/);
    words.forEach((w) => expect(block).toContain(w));
  });
});

/*
 * What the v12 sandbox papers showed (bd-5jmnfj.4.20): a full-width box lost its
 * right border at the page edge, "34 ☐ 43" printed its square as a missing glyph
 * with a box under it, and G1 GK Q1's words sat as a line under item i.
 */
describe('v12 sandbox papers', () => {
  const maths = require('./fixtures/early/g1-maths-exam.json');
  const mathsHtml = R.renderPaper({ examJson: maths, grade: 1, subject: 'maths' });
  const gkHtml = R.renderPaper({ examJson: gk, grade: 1, subject: 'general_knowledge' });

  test('a write box stops short of the page edge on its end side', () => {
    expect(html).toMatch(/\.write-box \{[^}]*margin-right: 0\.5mm/);
    expect(gkHtml).toMatch(/\.write-box \{[^}]*margin-left: 0\.5mm/);
  });

  test('a compare item draws its square and needs no box under it', () => {
    const q4 = itemsOf(mathsHtml, 'g1.maths.A.Q4');
    expect(q4.length).toBeGreaterThan(0);
    q4.forEach((it) => {
      expect(it).not.toContain('☐');
      expect(it).toContain('class="sq"');
      expect(it).not.toContain('write-box');
    });
  });

  test.each([
    ['G1 GK Q1', () => gkHtml, 'g1.general_knowledge.A.Q1'],
    ['G1 English Q9', () => html, 'g1.english.B.Q9'],
  ])('%s prints one boxed bank above its items, none under them', (_, page, slot) => {
    const block = slotHtml(page(), slot);
    expect(block.match(/word-box bank/g)).toHaveLength(1);
    expect(block.indexOf('word-box bank')).toBeLessThan(block.indexOf('<div class="q'));
    expect(block).not.toContain('word-line');
    itemsOf(page(), slot).forEach((it) => expect(it).not.toMatch(/word-(box|line)/));
  });
});
