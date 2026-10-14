/**
 * v10 coaching test (bd-v0toag.22): each plan move's high-leverage practice, as a FICO section C code.
 *
 * Moves are per lesson (move_id m1..mN) and their texts never repeat, so "the same move" on the next
 * recording (a different lesson) is "a move with the same practice". The tag is computed from the
 * move's own phase, type and text: no table, no content edit. First rule that matches wins.
 */

const { practiceTag, PRACTICES } = require('../../bot/shared/services/coaching/practice-tag');

const m = (phase, type, text) => ({ phase, type, text });

describe('practiceTag', () => {
  test.each([
    ['peer review phase', m('peer_review', 'activity', 'Students swap notebooks.'), 'C11'],
    ['partners check each other', m('guided', 'check', 'Partners check each other’s answers with a tick.'), 'C11'],
    ['self-check', m('independent', 'activity', 'Students self-check against the board.'), 'C11'],
    ['pair work', m('guided', 'activity', 'In pairs, students read the dialogue aloud.'), 'C9'],
    ['group work', m('guided', 'activity', 'Each group sorts the cards into two piles.'), 'C9'],
    ['grouping phase', m('grouping', 'instruction', 'Seat students in fours.'), 'C9'],
    ['choral response', m('warm_up', 'question', 'Class answers chorally: 15, 30, 45.'), 'C4'],
    ['cold call', m('guided', 'question', 'Cold call three children by name.'), 'C4'],
    ['modelling type', m('explain', 'modelling', 'Model the sum on the board.'), 'C8'],
    ['think aloud in explain', m('explain', 'instruction', 'Think aloud while choosing the topic.'), 'C8'],
    ['exit ticket', m('exit', 'check', 'Exit ticket: one sentence.'), 'C3'],
    ['a check mid-lesson', m('guided', 'check', 'Thumbs up if you agree.'), 'C3'],
    ['independent practice', m('independent', 'activity', 'Students complete the worksheet alone.'), 'C3'],
    ['a question', m('hook', 'question', 'Ask: what did Pinky see?'), 'C1'],
    ['recall phase', m('recall', 'instruction', 'Recall yesterday’s three words.'), 'C1'],
    ['warm up', m('warm_up', 'activity', 'Read three words fast.'), 'C1'],
    ['guided practice', m('guided', 'activity', 'Guide the class through Q1 step by step.'), 'C8'],
    ['plain explain', m('explain', 'instruction', 'Write the four words on the board.'), 'C8'],
    ['announce', m('announce', 'instruction', 'Tell students today’s goal.'), 'C6'],
    ['compound type', m('explain', 'modelling + check', 'Model, then ask two children.'), 'C8'],
    ['Urdu text falls back to phase', m('explain', 'modelling', 'اُستاد بورڈ پر سوچ بلند طریقہ استعمال کرتے ہیں'), 'C8'],
  ])('%s', (_label, move, tag) => {
    expect(practiceTag(move)).toBe(tag);
  });

  test.each([
    ['homework', m('homework', 'instruction', 'Copy the words at home.')],
    ['unknown phase', m('mystery', 'activity', 'Something.')],
    ['null', null],
    ['not an object', 'm1'],
    ['empty', {}],
  ])('%s: null', (_label, move) => {
    expect(practiceTag(move)).toBeNull();
  });

  test('pair work beats a question type (rule order)', () => {
    expect(practiceTag(m('warm_up', 'question', 'Partners take turns asking recall questions.'))).toBe('C9');
  });

  test('peer check beats pair work (rule order)', () => {
    expect(practiceTag(m('guided', 'activity', 'In pairs, students check each other’s sums.'))).toBe('C11');
  });

  test('case does not matter', () => {
    expect(practiceTag(m('GUIDED', 'Activity', 'IN PAIRS, read.'))).toBe('C9');
  });

  test('the same move always gets the same tag', () => {
    const move = m('guided', 'activity', 'Each group sorts the cards.');
    expect(practiceTag(move)).toBe(practiceTag({ ...move }));
  });

  test('every tag it can return is a named FICO section C practice', () => {
    expect(Object.keys(PRACTICES).sort()).toEqual(['C1', 'C11', 'C3', 'C4', 'C6', 'C8', 'C9']);
    for (const name of Object.values(PRACTICES)) expect(typeof name).toBe('string');
  });
});
