'use strict';
const { firstActionShortfall, firstActionNote } = require('../../bot/shared/services/assessment/fde-urdu-first-action');

const paper = (question, answer) => ({ unseen: { subjective: { 'Comprehension Passage': [{ slot: 'urdu.B.Q2', parts: [{ key: 'questions', questions: [{ question, answer }] }] }] } } });

describe('firstActionShortfall: a "first" stem has a one-action key', () => {
  test('two actions joined by اور are flagged', () => {
    const s = firstActionShortfall(paper('زینب صبح اٹھ کر سب سے پہلے کیا کرتی ہے؟', 'زینب اپنا بستہ تیار کرتی ہے اور امی کے ساتھ ناشتہ کرتی ہے۔'));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ slot: 'urdu.B.Q2', reason: 'first' });
    expect(s[0].items[0]).toContain('سب سے پہلے');
  });
  test('two sentences are flagged', () => {
    expect(firstActionShortfall(paper('سب سے پہلے کیا ہوا؟', 'وہ اٹھتی ہے۔ وہ نہاتی ہے۔'))).toHaveLength(1);
  });
  test('one action is fine', () => {
    expect(firstActionShortfall(paper('زینب صبح اٹھ کر سب سے پہلے کیا کرتی ہے؟', 'زینب اپنا بستہ تیار کرتی ہے۔'))).toEqual([]);
  });
  test('a noun pair is not two actions', () => {
    expect(firstActionShortfall(paper('سب سے پہلے کون آیا؟', 'امی اور ابو آئے۔'))).toEqual([]);
  });
  test('a stem without سب سے پہلے is not checked', () => {
    expect(firstActionShortfall(paper('زینب کیا کرتی ہے؟', 'وہ پڑھتی ہے اور لکھتی ہے۔'))).toEqual([]);
  });
  test('the note names the flagged item and is empty with no first row', () => {
    const s = firstActionShortfall(paper('سب سے پہلے کیا کرتی ہے؟', 'وہ اٹھتی ہے اور نہاتی ہے۔'));
    expect(firstActionNote(s)).toContain('سب سے پہلے');
    expect(firstActionNote([{ slot: 'x', reason: 'glyph', items: ['a'] }])).toBe('');
  });
});
