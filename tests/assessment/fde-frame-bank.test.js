/**
 * bd-5jmnfj.4.50.4: a label frame prints the item's own instruction and word bank.
 *
 * The prompt asks every frame item for "the instruction and the labels/word bank";
 * the model writes them in `main_question` (or the bank in `words`). The v22 G5
 * Science Q1 (b) printed neither: an empty frame and five numbered lines, with only
 * "Label the given Diagram" above it. A picture frame (its pattern prints `words`)
 * and a map whose item carries no bank print as before.
 *
 * Pure: HTML strings, no browser. Item shaped like the v22 g5-science exam.json.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { frameBank } = require('../../bot/shared/services/assessment/fde-frame-bank');

const NOW = '2026-10-27T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects;

const V22_ITEM = {
  slot: 'science.A.Q1b', lines: 0, marks: 5, blooms: 'Remember', book_page: 142,
  question: 'Circuit symbols',
  answer: '1. Wire, 2. Cell, 3. Switch (closed), 4. Switch (open), 5. Lamp / bulb',
  main_question: 'Label the diagram. Write the name of each numbered part (1 to 5) on the lines in the frame. Word bank: lamp / bulb, switch (open), wire, cell, switch (closed).',
  scheme: { points: ['Wire', 'Cell', 'Switch (closed)', 'Switch (open)', 'Lamp / bulb'].map((t) => ({ kind: 'A', text: `${t} correctly named`, marks: 1 })) },
};

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

function paperWith(subject, subjective) {
  const exam = normaliseScheme(applyLayout({ unseen: { subjective } }, P[subject], { kind: 'fde' }, { now: NOW }).examJson).examJson;
  return R.renderPaper({ examJson: exam, grade: 5, subject, answerLines: true, allowShort: true });
}

// The printed text of the slot from its head up to the end of its frame.
function frameSlot(html, slot) {
  const at = html.indexOf(`id="fde-frame-${slot}"`);
  const start = html.lastIndexOf('<div class="slot-head">', at);
  return visible(html.slice(start, at));
}

describe('frameBank', () => {
  it('reads the word bank off the end of the item instruction', () => {
    expect(frameBank(V22_ITEM, 'Label the given Diagram')).toEqual({
      line: 'Write the name of each numbered part (1 to 5) on the lines in the frame.',
      words: ['lamp / bulb', 'switch (open)', 'wire', 'cell', 'switch (closed)'],
    });
  });

  it('prefers the item words, and splits an Urdu bank on «،»', () => {
    expect(frameBank({ main_question: 'Word bank: a, b', words: ['x', 'y'] }, '').words).toEqual(['x', 'y']);
    expect(frameBank({ main_question: 'نام لکھیں۔ مددگار الفاظ: جڑ، تنا، پتا۔' }, '').words).toEqual(['جڑ', 'تنا', 'پتا']);
  });

  it('gives nothing when the item names no bank', () => {
    expect(frameBank({ main_question: 'Label the diagram.' }, 'Label the given Diagram')).toEqual({ line: '', words: [] });
    expect(frameBank({}, 'x')).toEqual({ line: '', words: [] });
  });
});

describe('a label frame prints its instruction and word bank (bd-5jmnfj.4.50.4)', () => {
  it('G5 Science Q1 (b): the instruction and all five bank words print above the frame', () => {
    const text = frameSlot(paperWith('science', { 'Label the Diagram': [V22_ITEM] }), 'science.A.Q1b');
    expect(text).toContain('Label the given Diagram');
    expect(text).toContain('Write the name of each numbered part (1 to 5) on the lines in the frame.');
    for (const w of ['lamp / bulb', 'switch (open)', 'wire', 'cell', 'switch (closed)']) expect(text).toContain(w);
    expect(text).not.toContain('Word bank:');
    // The slot head is not printed twice.
    expect(text).not.toContain('Label the diagram.');
  });

  it('a frame item with no bank prints its frame alone, as before', () => {
    const plain = { ...V22_ITEM, main_question: 'Label the diagram.' };
    const html = paperWith('science', { 'Label the Diagram': [plain] });
    expect(html).not.toMatch(/class="word-box"/);
    expect(frameSlot(html, 'science.A.Q1b')).not.toContain('Label the diagram.');
  });
});
