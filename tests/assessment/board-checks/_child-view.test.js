const { childFields } = require('../../../bot/shared/services/assessment/board-checks/_child-view');

const node = (item, extra = {}) => ({ item, stimulusText: null, slotRow: null, ...extra });

describe('_child-view', () => {
  test('collects only what the child sees', () => {
    const f = childFields(node({ main_question: 'M', question: 'Q', options: ['A) x', 'B) y'], passage: 'P', column_a: ['1', '2'], column_b: ['a', 'b'], answer: 'SECRET', scheme: { points: [] }, tag: {}, calc: {}, kind: 'k' }));
    const text = f.map((x) => x.text).join('|');
    expect(text).toBe('M|Q|A) x|B) y|P|1|2|a|b');
    expect(text).not.toMatch(/SECRET/);
  });
  test('words only when the slot or item sets print_words', () => {
    const it = { words: ['alpha', 'beta'] };
    expect(childFields(node(it)).length).toBe(0);
    expect(childFields(node(it, { slotRow: { print_words: true } })).map((x) => x.text)).toEqual(['alpha', 'beta']);
    expect(childFields(node({ ...it, print_words: true })).length).toBe(2);
  });
  test('stimulus: own text always, inherited only when asked', () => {
    const inherited = node({ question: 'q' }, { stimulusText: 'group text' });
    expect(childFields(inherited).map((x) => x.text)).toEqual(['group text', 'q']);
    expect(childFields(inherited, { inherit: false }).map((x) => x.text)).toEqual(['q']);
    expect(childFields(node({ stimulus: 'own', question: 'q' }, { stimulusText: 'own' }), { inherit: false }).map((x) => x.text)).toEqual(['own', 'q']);
  });
  test('fields carry their name; non-strings are tolerated', () => {
    const f = childFields(node({ question: 5, options: [null, { text: 'z' }], column_a: 'x' }));
    expect(f.map((x) => x.field)).toEqual(['question', 'options', 'options', 'column_a']);
    expect(f.map((x) => x.text)).toEqual(['5', '', 'z', 'x']);
  });
});
