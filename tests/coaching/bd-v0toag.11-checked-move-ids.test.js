/**
 * v10 coaching test (bd-v0toag.11): the "did she try it" check names the moves it judged.
 *
 * A coach reviews every did/partly/not_done call in week 1, then 10%. To review a call they need the
 * moves the check looked at, so checkThing returns their ids and the checked event carries them.
 * not_adjudicable moves are left out, as they are from the outcome.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/ab-v10-switch', () => ({ v10Enabled: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: jest.fn() }));

const P = require('../../bot/shared/services/coaching/thing-to-try-pick');

const row = (move_id, phase, text, verdict) => ({ move_id, phase, text, verdict, bucket: 'must_happen' });
const graded = (moves) => ({ status: 'ok', lesson_id: 'grade_2_maths_ch4_seg3', moves });
const PRIOR = { move_id: 'm3', lesson_id: 'grade_2_maths_ch4_seg2', text: 'In pairs, solve Q1.', tag: 'C9' };

describe('checkThing names the moves it judged', () => {
  test('the same-practice moves, in plan order, not_adjudicable left out', () => {
    const lp = graded([
      row('m1', 'guided', 'In groups, sort the cards.', 'partial'),
      row('m2', 'exit', 'Exit ticket.', 'executed'),
      row('m3', 'guided', 'Partners read.', 'not_adjudicable'),
      row('m4', 'guided', 'In pairs, solve Q2.', 'not_done'),
    ]);
    expect(P.checkThing(PRIOR, lp)).toEqual({ outcome: 'partly', matched: 2, moveIds: ['m1', 'm4'] });
  });

  test('none when no move has that practice', () => {
    expect(P.checkThing(PRIOR, graded([row('m1', 'exit', 'Exit ticket.', 'executed')])).moveIds).toEqual([]);
  });

  test('none when the recording was not graded', () => {
    expect(P.checkThing(PRIOR, null)).toEqual({ outcome: 'not_graded', matched: 0, moveIds: [] });
  });
});
