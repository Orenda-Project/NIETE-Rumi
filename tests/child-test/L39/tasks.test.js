/**
 * Battery v3 (CONTRACT §21.2): the 18 task ids, one voice note and one child_test_blocks row each,
 * in visit order. Every lane imports this list; nobody re-types it.
 */
const T = require('../../../bot/shared/services/child-test/tasks');

describe('child-test v3 task list (§21.2)', () => {
  it('lists the 18 tasks in visit order: Urdu 5, English 5, maths 8', () => {
    expect(T.TASKS_V3).toEqual([
      'ur.listening', 'ur.letters', 'ur.nonwords', 'ur.words', 'ur.story',
      'en.listening', 'en.letters', 'en.nonwords', 'en.words', 'en.story',
      'ma.number_id', 'ma.discrimination', 'ma.missing', 'ma.add1', 'ma.sub1', 'ma.add2', 'ma.sub2', 'ma.word_problems',
    ]);
    expect(Object.isFrozen(T.TASKS_V3)).toBe(true);
  });

  it('knows each task\'s block and kind', () => {
    expect(T.blockOf('ur.story')).toBe('urdu');
    expect(T.blockOf('en.nonwords')).toBe('english');
    expect(T.blockOf('ma.add2')).toBe('maths');
    expect(T.kindOf('en.letters')).toBe('letters');
    expect(T.kindOf('ma.word_problems')).toBe('word_problems');
    expect(T.tasksOfBlock('maths')).toHaveLength(8);
    expect(T.isTask('ur.letters')).toBe(true);
    expect(T.isTask('urdu')).toBe(false);
  });

  it('block names for storage keep the v1/v2 three and add the 18 ids', () => {
    expect(T.BLOCK_NAMES).toEqual(['urdu', 'english', 'maths', ...T.TASKS_V3]);
  });
});
