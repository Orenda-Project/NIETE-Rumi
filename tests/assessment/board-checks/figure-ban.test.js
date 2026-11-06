const m = require('../../../bot/shared/services/assessment/board-checks/figure-ban');

const paper = (...items) => ({ unseen: { objective: { M: items.map((q, i) => ({ id: `q${i}`, type: 'srq', ...q })) } } });
const run = (q, ctx = { mode: 'board' }) => m.run(paper(q), ctx);
const codes = (r) => r.issues.map((i) => i.code);
const hard = (r) => r.issues.filter((i) => i.hard).map((i) => i.code);

describe('N20 figure-ban', () => {
  test('member interface', () => {
    expect(m.id).toBe('N20');
    expect(m.hard).toBe(true);
    expect(m.modes).toEqual(['free', 'board']);
  });
  test('(0) curve with no inline data is hard; inline table passes', () => {
    expect(hard(run({ question: 'Use the curve to explain the rate.' }))).toEqual(['FIGURE_REF']);
    expect(run({ question: 'Use the table below:\n| T | v |\n| 1 | 2 |\nFind the mean v.' }).ok).toBe(true);
    expect(run({ question: 'Use the data 3, 5, 8, 9 to find the mean.' }).ok).toBe(true);
  });
  test('(1) diagram shown below is hard', () => {
    const r = run({ question: 'Study the diagram shown below and name the part.' });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ check: 'N20', code: 'FIGURE_REF', hard: true, item_ref: 'srq#1' });
  });
  test('(2) In Figure 2 is hard', () => {
    expect(hard(run({ question: 'In Figure 2, which wire is live?' }))).toEqual(['FIGURE_REF']);
  });
  test('(3) Urdu deictic + noun is hard', () => {
    expect(hard(run({ question: 'نیچے دی گئی شکل دیکھیے اور بتائیے۔' }))).toEqual(['FIGURE_REF']);
    expect(hard(run({ question: 'شکل نمبر 3 میں کیا ہے؟' }))).toEqual(['FIGURE_REF']);
    expect(hard(run({ question: 'نقشہ دیکھ کر بتائیں' }))).toEqual(['FIGURE_REF']);
  });
  test('(4)-(6) ordinary Urdu words are not a figure reference', () => {
    expect(hard(run({ question: 'اس شکل میں خرابی ہے' }))).toEqual([]);
    expect(hard(run({ question: 'اس کی تصویر دل میں رہتی ہے' }))).toEqual([]);
    expect(hard(run({ question: 'خاکہ نگاری کی تعریف کریں' }))).toEqual([]);
    expect(codes(run({ question: 'اس شکل میں خرابی ہے' }))).toContain('FIGURE_WORD');
  });
  test('(7) explain how a free-body diagram helps passes', () => {
    expect(run({ question: 'Explain how a free-body diagram helps.' }).ok).toBe(true);
  });
  test('(8) draw the free-body diagram is soft FIGURE_TASK', () => {
    const r = run({ question: 'Draw the free-body diagram of a block on a slope.' });
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual(['FIGURE_TASK']);
    expect(r.issues[0].hard).toBe(false);
    expect(hard(run({ question: 'Use the free-body diagram shown below to find the force.' }))).toEqual(['FIGURE_REF']);
  });
  test('(9) a leftover image key is hard FIGURE_KEY', () => {
    expect(hard(run({ question: 'Name it.', image_description: 'a cell' }))).toEqual(['FIGURE_KEY']);
    expect(run({ question: 'Name it.', image: '' }).ok).toBe(true);
  });
  test('(10) the word only in the answer, scheme or tag passes', () => {
    const r = run({ question: 'Name the organ.', answer: 'See Figure 2 diagram shown below', scheme: { points: [{ text: 'the given graph' }] }, tag: { x: 'figure 1' } });
    expect(r.issues).toEqual([]);
  });
  test('(11) CS: bare graph passes, the given graph is hard', () => {
    expect(hard(run({ question: 'In a graph, an edge joins two vertices.' }))).toEqual([]);
    expect(hard(run({ question: 'Use the given graph to find a path.' }))).toEqual(['FIGURE_REF']);
  });
  test('reads options, passage, stimulus, columns, OR branches, parts', () => {
    expect(hard(run({ question: 'q', options: ['A) as in the figure', 'B) b'] }))).toEqual(['FIGURE_REF']);
    expect(hard(run({ passage: 'See the figure above.' }))).toEqual(['FIGURE_REF']);
    expect(hard(run({ stimulus: { text: 'Look at the picture below.' }, question: 'q' }))).toEqual(['FIGURE_REF']);
    expect(hard(run({ type: 'match', column_a: ['label the parts'], column_b: ['x'] }))).toEqual(['FIGURE_REF']);
    expect(hard(run({ or: [{ id: 'a', type: 'srq', question: 'ok' }, { id: 'b', type: 'srq', question: 'Refer to Fig. 3' }] })).length).toBe(1);
    expect(hard(run({ parts: [{ id: 'p', type: 'srq', question: 'In Figure 1, name X' }] })).length).toBe(1);
  });
  test('words box is read only with print_words', () => {
    expect(run({ question: 'Fill in.', words: ['see figure 2'] }).ok).toBe(true);
  });
  test('never mutates, never throws on odd input', () => {
    expect(m.run({}, { mode: 'free' })).toEqual({ ok: true, issues: [] });
    expect(m.run(null, {}).ok).toBe(true);
  });
});
