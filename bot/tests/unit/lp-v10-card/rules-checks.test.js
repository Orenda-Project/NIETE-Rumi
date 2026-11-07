const K = require('../../../shared/services/lp-v10-card/rules-checks');

describe('rules-checks: the gate helpers', () => {
  test('texts walks nested strings only', () => {
    expect(K.texts({ a: 'x', b: [1, 'y', { c: 'z' }], d: 3 })).toEqual(['x', 'y', 'z']);
  });
  test('plain counts code points after stripping tags', () => {
    expect(K.plain('<b>ab</b>😀')).toBe(3);
  });
  test('timeBar: total, then the 60/30/30/25 shares', () => {
    expect(K.timeBar({ open: 5, explain: 7, we: 12, you: 12, check: 4 })).toEqual([]);
    expect(K.timeBar({ open: 5, explain: 7, we: 12, you: 12, check: 5 })).toEqual(['section minutes add to 41, not 40']);
    expect(K.timeBar({ open: 10, explain: 11, we: 8, you: 7, check: 4 })).toEqual([
      'practice (We Do + You Do) is 15 of 40, under 60%', 'We Do is 8 of 40, under 30%',
      'You Do is 7 of 40, under 30%', 'I Do (explain) is 11 of 40, over 25%']);
  });
  test('unvocab removes the card words and content pairs', () => {
    expect(K.unvocab('say neighbour now', { words: ['neighbour'] }).trim()).toBe('say  now');
    expect(K.unvocab('rhyming pairs', {})).toBe('');
  });
  test('turnLines asks for a repair line only for English and Urdu', () => {
    const m = { turn: { first: 'A', a: 'x', b: 'y', stop: 's' } };
    expect(K.turnLines(m, 'Maths')).toEqual([]);
    expect(K.turnLines(m, 'English')).toHaveLength(1);
    expect(K.turnLines({}, 'Maths')[0]).toMatch(/no turn/);
  });
  test('pictures: a clean svg passes, a tiny font is named', () => {
    const p = [{ id: 'a', after: 'open', kind: 'svg', svg: '<svg><text font-size="9.5">x</text></svg>' }];
    expect(K.pictures({ pictures: p }, ['open'])).toEqual(['picture a: svg text font-size 9.5 (min 12, labels 14)']);
  });
  test('exitTicket: board writing by the teacher is fine', () => {
    expect(K.exitTicket({ moves: [{ do: 'Write cat on the board', how: '', say: '' }] })).toEqual([]);
    expect(K.exitTicket({ moves: [{ do: 'Write a line', how: '', say: '' }] })).toHaveLength(1);
  });
});
