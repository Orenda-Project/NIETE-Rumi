const m = require('../../../bot/shared/services/assessment/board-checks/readability');

const long = (n) => `${Array.from({ length: n }, () => 'word').join(' ')}.`;
const urLong = (n) => `${Array.from({ length: n }, () => 'لفظ').join(' ')}۔`;
const paper = (...items) => ({ unseen: { objective: { M: items } } });
const en6 = { mode: 'free', subjectConfig: { grade: 6, band: '6_8', medium: 'en' } };
const ur6 = { mode: 'free', subjectConfig: { grade: 6, band: '6_8', medium: 'ur' } };
const codes = (r) => r.issues.map((i) => i.code);

describe('D15 readability', () => {
  test('member interface and pinned limits', () => {
    expect(m.id).toBe('D15');
    expect(m.hard).toBe(false);
    expect(m.modes).toEqual(['free', 'board']);
    expect(m.LIMITS).toEqual({
      fkSlack: 2,
      sentence: { '6_8': 14, '9_10': 17, '11_12': 20 },
      stem: { '6_8': 25, '9_10': 35, '11_12': 45 },
      urSentence: { '6_8': 14, '9_10': 18, '11_12': 22 },
    });
  });
  test('(1) a G6 section of 20-word sentences gets notes', () => {
    const r = m.run(paper({ type: 'srq', question: long(20) }, { type: 'srq', question: long(20) }), en6);
    expect(codes(r)).toEqual(expect.arrayContaining(['SENTENCE_LONG', 'FK_HIGH']));
    expect(r.issues.every((i) => i.hard === false && i.check === 'D15')).toBe(true);
    expect(r.readability.sections['type:srq'].avg_sentence).toBe(20);
    expect(typeof r.readability.sections['type:srq'].fk).toBe('number');
  });
  test('(2) a G6 section at FK 3 gets none', () => {
    const r = m.run(paper({ type: 'srq', question: 'The cat sat on the mat. The dog ran.' }), en6);
    expect(r.issues).toEqual([]);
  });
  test('MCQ stem above the band limit is a note on that item', () => {
    const r = m.run(paper({ type: 'mcq', question: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix', options: ['A) a', 'B) b', 'C) c', 'D) d'] }), en6);
    const n = r.issues.find((i) => i.code === 'STEM_LONG');
    expect(n).toMatchObject({ item_ref: 'mcq#1', hard: false });
  });
  test('(3) Urdu section of 30-word sentences gets a note; short ones do not', () => {
    expect(codes(m.run(paper({ type: 'srq', question: urLong(30) }), ur6))).toEqual(['SENTENCE_LONG']);
    expect(m.run(paper({ type: 'srq', question: urLong(8) }), ur6).issues).toEqual([]);
  });
  test('Urdu band limits differ by band', () => {
    const ur9 = { mode: 'free', subjectConfig: { grade: 9, band: '9_10', medium: 'ur' } };
    expect(m.run(paper({ type: 'srq', question: urLong(16) }), ur9).issues).toEqual([]);
    expect(codes(m.run(paper({ type: 'srq', question: urLong(19) }), ur9))).toEqual(['SENTENCE_LONG']);
  });
  test('(4) ok is true whatever it finds', () => {
    expect(m.run(paper({ type: 'srq', question: long(60) }), en6).ok).toBe(true);
  });
  test('(5) a section with no sentences does not divide by zero', () => {
    const r = m.run(paper({ type: 'srq', question: '' }), en6);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.readability.sections['type:srq'].avg_sentence).toBe(0);
    expect(r.readability.sections['type:srq'].fk).toBeUndefined();
  });
  test('board mode groups by layout section', () => {
    const p = { _layout: { sections: [{ id: 'A', slots: [{ slot: 's.A' }] }, { id: 'B', slots: [{ slot: 's.B' }] }] }, unseen: { objective: { M: [{ type: 'srq', slot: 's.A', question: 'Short one.' }, { type: 'srq', slot: 's.B', question: long(20) }] } } };
    const r = m.run(p, { mode: 'board', subjectConfig: { grade: 6, band: '6_8', medium: 'en' } });
    expect(Object.keys(r.readability.sections)).toEqual(['A', 'B']);
    expect(r.issues.every((i) => i.item_ref === 'section:B')).toBe(true);
  });
  test('missing medium or band is reported as skipped, never thrown', () => {
    const r = m.run(paper({ type: 'srq', question: long(40) }), { mode: 'free', subjectConfig: { grade: 6 } });
    expect(r.ok).toBe(true);
    expect(r.skipped.map((s) => s.id)).toContain('D15:medium');
  });
  test('the Urdu out-of-book vocabulary rate is listed as skipped', () => {
    const r = m.run(paper({ type: 'srq', question: urLong(5) }), ur6);
    expect(r.skipped.map((s) => s.id)).toContain('D15:urdu-vocab');
  });
});
