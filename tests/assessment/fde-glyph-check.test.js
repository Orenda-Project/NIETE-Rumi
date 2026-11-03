/**
 * bd-5jmnfj.4.58.7.7: v35 G5 Urdu Q4 item 2 printed option ج as «مگر، کیوں ک�ہ» (one U+FFFD in the exam JSON).
 * Any printed string holding U+FFFD or a control character (other than \n and \t) is a shortfall the writer
 * is re-asked for. The check never authors content: the note says what to rewrite, not with what.
 *
 * Pure: the check reads the exam JSON, never throws.
 */

const { glyphShortfall, glyphNote } = require('../../bot/shared/services/assessment/fde-glyph-check');

const BROKEN = 'مگر، کیوں ک�ہ';
const paper = (obj, sub) => ({ unseen: { objective: obj || {}, subjective: sub || {} } });
const mcq = (options) => ({
  slot: 'urdu.A.Q4b', question: 'خالی جگہ پر کریں: ___ تم محنت کرو گے ___ کامیاب ہو گے۔', options, answer: 'الف', marks: 1,
});
const fill = (answer) => ({ slot: 'urdu.A.Q5', question: 'پاکستان کا ___ اسلام آباد ہے۔', answer, marks: 1 });
const CLEAN_OPTS = ['اگر، تو', 'اور، پھر', 'مگر، کیونکہ', 'جب، اگرچہ'];

describe('bd-5jmnfj.4.58.7.7: a replacement or control character in any printed string is flagged', () => {
  test('a: the v35 option is flagged once, naming the item, the text and U+FFFD', () => {
    const out = glyphShortfall(paper({ MCQs: [mcq(['اگر، تو', 'اور، پھر', BROKEN, 'جب، اگرچہ'])] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slot: 'urdu.A.Q4b', reason: 'glyph' });
    expect(out[0].items).toHaveLength(1);
    expect(out[0].items[0]).toContain('urdu.A.Q4b');
    expect(out[0].items[0]).toContain(BROKEN);
    expect(out[0].items[0]).toContain('U+FFFD');
  });

  test('b: a control character in a fill-in-the-blanks answer is flagged with U+0007', () => {
    const out = glyphShortfall(paper({ 'Fill in the Blanks': [fill('اسلام\u0007آباد')] }));
    expect(out).toHaveLength(1);
    expect(out[0].slot).toBe('urdu.A.Q5');
    expect(out[0].items[0]).toContain('U+0007');
  });

  test('b2: table cells, scheme points and accept lists are read too', () => {
    const q = (over) => ({ slot: 'urdu.B.Q1', question: 'سوال', answer: 'جواب', marks: 2, ...over });
    const run = (over) => glyphShortfall(paper({}, { Group: [q(over)] }));
    expect(run({ table: { rows: [['a', 'b�']] } })).toHaveLength(1);
    expect(run({ words: ['ٹھیک', 'غل�ط'] })).toHaveLength(1);
    expect(run({ scheme: { points: [{ text: 'نقطہ�', marks: 2, kind: 'A' }], accept: [] } })).toHaveLength(1);
    expect(run({ scheme: { points: [{ text: 'نقطہ', marks: 2, kind: 'A' }], accept: ['قبول�'] } })).toHaveLength(1);
  });

  test('c: newline, tab, ordinary Urdu, Arabic-Indic digits, ZWNJ and ZWJ are not flagged', () => {
    const passage = { slot: 'urdu.C.Q7', question: 'پڑھیں:\nپہلی سطر\tدوسری ۱۲۳ ٤٥٦ ہ‌ا ک‍ا', answer: 'جواب ۱۲', marks: 3 };
    expect(glyphShortfall(paper({}, { Group: [passage] }))).toEqual([]);
  });

  test('d: a clean paper, junk input and a removed item give nothing', () => {
    expect(glyphShortfall(paper({ MCQs: [mcq(CLEAN_OPTS)], 'Fill in the Blanks': [fill('دارالحکومت')] }))).toEqual([]);
    expect(glyphShortfall(null)).toEqual([]);
    expect(glyphShortfall({ unseen: 7 })).toEqual([]);
  });

  test('e: the note names the item and the code point, asks for a rewrite, authors no Urdu', () => {
    const note = glyphNote(glyphShortfall(paper({ MCQs: [mcq(['اگر، تو', 'اور، پھر', BROKEN, 'جب، اگرچہ'])] })));
    expect(note).toContain('urdu.A.Q4b');
    expect(note).toContain('U+FFFD');
    expect(note).toMatch(/rewrite/i);
    expect(note).toMatch(/without the broken character/i);
    // it quotes the broken string as found, but offers no corrected text
    expect(note).not.toContain('کیوں کہ');
    expect(note).not.toContain('کیونکہ');
    expect(glyphNote([])).toBeFalsy();
    expect(glyphNote([{ slot: 'x', reason: 'placeholder', items: ['a'] }])).toBeFalsy();
  });

  // f: no end-to-end wiring pattern exists for the other checks (placeholder, punctuate, scheme are tested
  // only as pure modules); the service wiring is asserted at integration, not invented here.
});
