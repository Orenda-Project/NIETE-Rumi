const m = require('../../../bot/shared/services/assessment/board-checks/key-leak');

const paper = (...items) => ({ unseen: { objective: { M: items } } });
const FREE = { mode: 'free' };
const srq = (question, answer, extra = {}) => ({ type: 'srq', question, answer, ...extra });
const hard = (r) => r.issues.filter((i) => i.hard);

describe('N18/N19 key-leak', () => {
  test('member interface and pinned limits', () => {
    expect(m.id).toBe('N18/N19');
    expect(m.hard).toBe(true);
    expect(m.modes).toEqual(['free', 'board']);
    expect(m.LIMITS).toEqual({ minTokens: 2, minLetters: 5, minDigits: 3 });
  });
  test('(1) Q7 repeating Q3 key (3 tokens) is a hard leak on Q7', () => {
    const r = m.run(paper(
      srq('What does a leaf do with light?', 'Light energy to chemical energy'),
      srq('A leaf turns light energy to chemical energy. Why does it need water?', 'Because water is split'),
    ), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0]).toMatchObject({ check: 'N18', code: 'KEY_IN_STEM', item_ref: 'srq#2', hard: true });
    expect(r.ok).toBe(false);
  });
  test('(2) a key inside its own options is not a leak', () => {
    const r = m.run(paper({ type: 'mcq', question: 'Photosynthesis changes', options: ['A) light energy to chemical energy', 'B) heat to sound', 'C) x y', 'D) z w'], answer: 'A) light energy to chemical energy' }), FREE);
    expect(r.issues).toEqual([]);
  });
  test('a key repeated in its own stem is a leak', () => {
    const r = m.run(paper(srq('Light energy to chemical energy: name the change.', 'light energy to chemical energy')), FREE);
    expect(hard(r)[0].item_ref).toBe('srq#1');
  });
  test('(3) a one-token short key is not searched', () => {
    const r = m.run(paper({ type: 'fill_blank', question: 'تعداد؟', answer: 'پانچ' }, srq('پانچ ارکان کون سے ہیں؟', 'x y z')), FREE);
    expect(r.issues).toEqual([]);
  });
  test('one long token and a 3-digit number are searched', () => {
    expect(hard(m.run(paper(srq('q', 'Mitochondria'), srq('Where is mitochondria found?', 'a b')), FREE))).toHaveLength(1);
    expect(hard(m.run(paper(srq('q', '180'), srq('He paid 180 rupees.', 'a b')), FREE))).toHaveLength(1);
    expect(hard(m.run(paper(srq('q', '18'), srq('He paid 18 rupees.', 'a b')), FREE))).toHaveLength(0);
  });
  test('true/false style keys are not searched', () => {
    const r = m.run(paper({ type: 'true_false_correct', question: 'Water boils at 90 C. True or false?', answer: 'False' }, srq('Is it false that ice floats?', 'a b')), FREE);
    expect(r.issues).toEqual([]);
  });
  test('(4) words box counts only with print_words', () => {
    const key = srq('q', 'gravitational potential energy');
    const fill = (extra) => ({ type: 'fill_blank', question: 'Fill in the blank', answer: 'zeta', words: ['gravitational potential energy', 'omega'], ...extra });
    expect(m.run(paper(key, fill({})), FREE).issues).toEqual([]);
    const r = m.run(paper(key, fill({ print_words: true })), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0].item_ref).toBe('fill_blank#1');
    const slotted = { _layout: { sections: [{ id: 'A', slots: [{ slot: 's.A', print_words: true }] }] }, unseen: { objective: { M: [{ ...key }, fill({ slot: 's.A' })] } } };
    expect(hard(m.run(slotted, { mode: 'board' }))).toHaveLength(1);
  });
  const match = (colB, answer) => ({ type: 'match', question: 'Match', column_a: ['Apple', 'Boy', 'Cat'], column_b: colB, answer });
  test('(5) N19: column_b in key order is hard, shuffled is ok', () => {
    const lines = 'A → x1\nB → y1\nC → z1';
    const r = m.run(paper(match(['x1', 'y1', 'z1', 'w1'], lines)), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0]).toMatchObject({ check: 'N19', code: 'COLUMN_B_ORDER' });
    expect(hard(m.run(paper(match(['y1', 'z1', 'x1', 'w1'], lines)), FREE))).toHaveLength(0);
  });
  test('(6) arrow, dash, colon and label key forms all parse', () => {
    const ordered = ['x1', 'y1', 'z1'];
    ['A → x1; B → y1; C → z1', 'A - x1\nB - y1\nC - z1', 'A: x1\nB: y1\nC: z1', 'A -> x1, B -> y1, C -> z1'].forEach((a) => {
      expect(hard(m.run(paper(match(ordered, a)), FREE))).toHaveLength(1);
    });
    const labelled = ['a) w', 'b) x', 'c) y'];
    expect(hard(m.run(paper(match(labelled, '1-a, 2-b, 3-c')), FREE))).toHaveLength(1);
    expect(hard(m.run(paper(match(labelled, '1-c, 2-a, 3-b')), FREE))).toHaveLength(0);
    expect(hard(m.run(paper(match(['x1', 'y1', 'z1'], 'gibberish')), FREE))).toHaveLength(0);
  });
  test('fewer than 3 rows is never an order leak; column_b without a spare is a soft note', () => {
    const two = { type: 'match', question: 'm', column_a: ['A', 'B'], column_b: ['x1', 'y1'], answer: 'A → x1\nB → y1' };
    expect(hard(m.run(paper(two), FREE))).toHaveLength(0);
    const r = m.run(paper(match(['y1', 'z1', 'x1'], 'A → x1\nB → y1\nC → z1')), FREE);
    expect(r.issues.find((i) => i.code === 'COLUMN_B_EXTRA')).toMatchObject({ hard: false, check: 'N19' });
    expect(r.ok).toBe(true);
  });
  test('(7) a stimulus text that contains the key of its own MCQ is hard', () => {
    const grp = { type: 'scenario', stimulus: { text: 'The mitochondria generates ATP energy here.', items: [{ type: 'mcq', question: 'Which organelle?', options: ['A) nucleus', 'B) mitochondria generates ATP energy', 'C) vacuole', 'D) wall'], answer: 'B' }] } };
    const r = m.run(paper(grp), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0].item_ref).toBe('scenario#1@s1');
  });
  test('(8) free mode runs; items without answers or ids are skipped quietly', () => {
    expect(m.run(paper({ type: 'srq', question: 'q' }), FREE).ok).toBe(true);
    expect(m.run({}, FREE)).toEqual({ ok: true, issues: [] });
  });
  test('answer, scheme and tag never count as child-visible', () => {
    const r = m.run(paper(srq('q', 'light energy to chemical energy'), srq('r', 'a b', { scheme: { points: [{ text: 'light energy to chemical energy' }] }, tag: { x: 'light energy to chemical energy' } })), FREE);
    expect(r.issues).toEqual([]);
  });
});
