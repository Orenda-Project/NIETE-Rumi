'use strict';
const { mendAntonymParts, ANTONYMS } = require('../../bot/shared/services/assessment/fde-urdu-antonyms');

const paper = (pairs) => ({ unseen: { subjective: { 'Comprehension Passage': [{ slot: 'urdu.B.Q2', parts: [{ key: 'questions', questions: [] }, { key: 'antonyms', antonyms: pairs }] }] } } });
const pairsOf = (r) => r.examJson.unseen.subjective['Comprehension Passage'][0].parts[1].antonyms;

describe('mendAntonymParts: a reviewed table adds the standard alternatives to the printed key', () => {
  test('صبح: رات also accepts شام, printed in the key pair', () => {
    const r = mendAntonymParts(paper([['صبح', 'رات'], ['خوش', 'اداس']]));
    expect(pairsOf(r)[0]).toEqual(['صبح', 'رات، یا شام']);
    expect(pairsOf(r)[1][1]).toMatch(/^اداس، یا /);
    expect(pairsOf(r)[1][1]).toContain('غمگین');
  });
  test('the first printed word is unchanged', () => {
    expect(pairsOf(mendAntonymParts(paper([['صبح', 'شام']])))[0][0]).toBe('صبح');
  });
  test('an alternative already present is not added twice', () => {
    expect(pairsOf(mendAntonymParts(paper([['صبح', 'رات، یا شام']])))[0][1]).toBe('رات، یا شام');
  });
  test('a pair not in the table is untouched', () => {
    const p = paper([['کتاب', 'قلم']]);
    expect(mendAntonymParts(p).examJson).toEqual(p);
  });
  test('the table never lists a word as its own antonym', () => {
    Object.entries(ANTONYMS).forEach(([k, v]) => expect(v).not.toContain(k));
  });
  test('the input is not mutated', () => {
    const p = paper([['صبح', 'رات']]);
    const copy = JSON.parse(JSON.stringify(p));
    mendAntonymParts(p);
    expect(p).toEqual(copy);
  });
});
