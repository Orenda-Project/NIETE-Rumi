/**
 * v29 should-fix, early Urdu oral sheets (bd-5jmnfj.4.58): G1 mother item 3 asks two things at once; poem model answers
 * restate the stem; oral read-aloud «تارے» repeats the written «ستارے»; G2 dialogue opens with a reply to nothing.
 */

const { urduOralBad, urduOralFixes, nearRepeat } = require('../../bot/shared/services/assessment/fde-early-urdu-oral');

const it = (ask, answer = '') => ({ ask, answer });
const paper = (content, unseen = {}) => ({ unseen, _layout: { oral: { tasks: [
  { id: 'read_words', kind: 'read_aloud' }, { id: 'mother', kind: 'speaking' }, { id: 'poem', kind: 'listening' }, { id: 'dialogue', kind: 'read_aloud' }], content } } });

describe('early Urdu oral checks', () => {
  test('RED v29 mother 3: one item asking two things is flagged; one question and a yes/no pair are not', () => {
    const bad = urduOralBad('mother', [it('آپ کی امی کیا پکاتی ہیں یا انھیں کیا پسند ہے؟', 'میری امی کھانا پکاتی ہیں۔')]);
    expect(bad).toHaveLength(1);
    expect(bad[0].reason).toBe('two-asks');
    expect(urduOralBad('mother', [it('آپ کی امی کیا پکاتی ہیں؟', 'میری امی دال پکاتی ہیں۔')])).toEqual([]);
    expect(urduOralBad('mother', [it('کیا آپ کی امی چائے یا کافی پیتی ہیں؟', 'چائے۔')])).toEqual([]);
  });
  test('RED v29 poem: an answer that opens «نظم میں» or copies the stem is flagged; a bare answer is not', () => {
    const open = urduOralBad('poem', [it('نظم میں سب کو کس نے بنایا؟', 'نظم میں سب کو میرے خدا نے بنایا۔')]);
    expect(open.map((b) => b.reason)).toContain('restates-stem');
    expect(urduOralBad('poem', [it('ننھی چڑیاں کہاں بیٹھی ہیں؟', 'ننھی چڑیاں پیڑ پر بیٹھی ہیں۔')]).map((b) => b.reason)).toContain('restates-stem');
    expect(urduOralBad('poem', [it('نظم میں شاخوں پر کیا ہے؟', 'پتے۔')])).toEqual([]);
  });
  test('RED v29 dialogue: a first turn that is a reply is flagged', () => {
    const script = 'غصیلا بھنورا: ٹھیک ہے، کرلیتے ہیں آپ سے لڑائی۔\nتگیا: آداب۔ آپ کون؟';
    expect(urduOralBad('dialogue', [], script).map((b) => b.reason)).toEqual(['opens-with-reply']);
    expect(urduOralBad('dialogue', [], 'تگیا: آداب۔ آپ کون؟\nمکڑا: میں مکڑا ہوں۔')).toEqual([]);
    expect(urduOralBad('dialogue', [], '')).toEqual([]);
  });
  test('nearRepeat: a read word inside a written word differs by one letter or less', () => {
    expect(nearRepeat('تارے', 'ستارے')).toBe(true);
    expect(nearRepeat('باغ', 'باغ')).toBe(true);
    expect(nearRepeat('باغ', 'بلی')).toBe(false);
    expect(nearRepeat('قلم', 'قلمدان')).toBe(false);
  });
  test('RED v29 oral 9: a read word that near-repeats a written answer is replaced from the bank', () => {
    const ex = paper([{ id: 'read_words', items: [it('تارے'), it('گھر')] }], { objective: { MCQs: [{ question: 'کون سا لفظ ہے؟', answer: 'ستارے' }] } });
    const { examJson, notes } = urduOralFixes(ex);
    const words = examJson._layout.oral.content[0].items.map((x) => x.ask);
    expect(words).not.toContain('تارے');
    expect(words).toContain('گھر');
    expect(notes.join(' ')).toMatch(/تارے/);
    expect(ex._layout.oral.content[0].items[0].ask).toBe('تارے');
  });
  test('the opening «نظم میں» is stripped from a poem model answer; a mother two-ask keeps its first clause', () => {
    const ex = paper([
      { id: 'poem', items: [it('نظم میں سب کو کس نے بنایا؟', 'نظم میں سب کو میرے خدا نے بنایا۔')] },
      { id: 'mother', items: [it('آپ کی امی کیا پکاتی ہیں یا انھیں کیا پسند ہے؟', 'میری امی دال پکاتی ہیں۔')] }]);
    const c = urduOralFixes(ex).examJson._layout.oral.content;
    expect(c[0].items[0].answer).toBe('سب کو میرے خدا نے بنایا۔');
    expect(c[1].items[0].ask).toBe('آپ کی امی کیا پکاتی ہیں؟');
  });
  test('a paper with no oral part is returned as it was', () => {
    const ex = { unseen: {} };
    expect(urduOralFixes(ex)).toEqual({ examJson: ex, notes: [] });
  });
});
