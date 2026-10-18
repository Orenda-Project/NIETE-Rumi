/**
 * The shared switch-off matrix: the values are the agreed set, and `throwOn` fails only the one switch's read.
 */
const { OFF_VALUES, throwOn } = require('./switch-off-matrix');

const builder = (table, calls) => {
  const b = {
    eq: (col, v) => { calls.push([table, 'eq', col, v]); return b; },
    in: (col, vs) => { calls.push([table, 'in', col, vs]); return b; },
  };
  return b;
};

describe('switch-off matrix', () => {
  test('the off values: false, absent, a non-true string, a number, an object — frozen', () => {
    expect(OFF_VALUES).toEqual([['false', false], ['absent', null], ['"yes"', 'yes'], ['1', 1], ['{}', {}]]);
    expect(Object.isFrozen(OFF_VALUES)).toBe(true);
    expect(OFF_VALUES.every(Object.isFrozen)).toBe(true);
  });

  test('throwOn: the switch\'s read throws by .eq and by .in; other keys and tables read as before', () => {
    const calls = [];
    const from = throwOn((t) => builder(t, calls), 'my_switch');
    expect(() => from('app_settings').eq('key', 'my_switch')).toThrow('settings down');
    expect(() => from('app_settings').in('key', ['other', 'my_switch'])).toThrow('settings down');
    from('app_settings').eq('key', 'other');
    from('app_settings').in('key', ['other']);
    from('quizzes').eq('key', 'my_switch');
    expect(calls).toEqual([
      ['app_settings', 'eq', 'key', 'other'],
      ['app_settings', 'in', 'key', ['other']],
      ['quizzes', 'eq', 'key', 'my_switch'],
    ]);
  });
});
