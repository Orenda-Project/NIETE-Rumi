'use strict';
const { mendG5Urdu, g5UrduShortfall, g5UrduNote } = require('../../bot/shared/services/assessment/fde-g5-urdu-mends');

const paper = () => ({
  unseen: {
    subjective: {
      'Comprehension Passage': [{ slot: 'urdu.B.Q2', parts: [
        { key: 'questions', questions: [{ question: 'زینب صبح اٹھ کر سب سے پہلے کیا کرتی ہے؟', answer: 'وہ اٹھتی ہے اور نہاتی ہے۔' }] },
        { key: 'antonyms', antonyms: [['صبح', 'رات']] }] }],
      'Poem Explanation': [{ slot: 'urdu.C.Q6', passage: 'ندی کی فریاد\nیہ گندگی ہے', scheme: { points: [{ text: 'بولنے والا ندی ہے', marks: 1.5 }, { text: 'اپنے لفظوں میں', marks: 3.5 }] } }],
      'Letter Writing': [{ slot: 'urdu.C.Q10', question: 'خط لکھیں۔', answer: 'پیاری امی!\nعلی' }],
    },
  },
});

describe('fde-g5-urdu-mends', () => {
  test('mendG5Urdu applies the antonym, title and form mends together', () => {
    const r = mendG5Urdu(paper());
    const u = r.examJson.unseen.subjective;
    expect(u['Comprehension Passage'][0].parts[1].antonyms[0][1]).toBe('رات، یا شام');
    expect(u['Poem Explanation'][0].scheme.points).toHaveLength(1);
    expect(u['Letter Writing'][0].answer.split('\n')[0]).toMatch(/^تاریخ:/);
    expect(r.notes.length).toBeGreaterThanOrEqual(3);
  });
  test('the first-action flag and its note come through', () => {
    const s = g5UrduShortfall(paper());
    expect(s[0].reason).toBe('first');
    expect(g5UrduNote(s)).toContain('سب سے پہلے');
  });
  test('a paper with none of these is returned equal', () => {
    const p = { unseen: { s: { T: [{ slot: 'urdu.A.Q1', question: 'q', answer: 'a' }] } } };
    expect(mendG5Urdu(p).examJson).toEqual(p);
    expect(g5UrduShortfall(p)).toEqual([]);
  });
});
