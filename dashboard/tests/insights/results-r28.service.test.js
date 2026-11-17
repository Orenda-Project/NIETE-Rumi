'use strict';
/**
 * Round 28: the listen-and-tap letter sounds (`<lang>.letter_pick10`) and the tapped story questions
 * (`<lang>.story_mcq_w3`) land in the same result cells as the tasks they replace (W-LS from E4, W-RC from E11): a
 * share of items correct, judged below bar at ≤ 50% as before (chance 20% / 25% sits under it). The old ids keep
 * their codes, so a child's old recorded score and new tapped score are two sessions, never one figure.
 */
const { codeOf, buildResultCells } = require('../../lib/insights/results');

describe('round 28 task ids → EGRA codes (dashboard/lib/insights/results.js)', () => {
  test('letter_pick10 is E4 (letter sounds), story_mcq_w3 is E11 (comprehension), for both languages', () => {
    expect(codeOf('ur.letter_pick10')).toBe('E4');
    expect(codeOf('en.letter_pick10')).toBe('E4');
    expect(codeOf('ur.story_mcq_w3')).toBe('E11');
    expect(codeOf('en.story_mcq_w3')).toBe('E11');
  });
  test('the old ids keep their codes', () => {
    expect(codeOf('ur.letter_sounds5')).toBe('E4');
    expect(codeOf('en.story_comp_w3')).toBe('E11');
    expect(codeOf('en.story_w3')).toBe('E10');
  });
  test('five sessions with en.letter_pick10 3 of 10 make W-LS 5 below bar; 8 of 10 make it 0 below', () => {
    const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const kids = (correct) => [1, 2, 3, 4, 5].map((i) => ({
      s: { id: uuid(100 + i), school_id: uuid(7), coach_user_id: uuid(8), grade: 3, status: 'completed', student_id: uuid(300 + i), started_at: '2026-11-17T05:00:00Z' },
      b: { session_id: uuid(100 + i), block: 'en.letter_pick10', responses: [{ kind: 'result', correct, attempted: 10 }] },
    }));
    const cells = (correct) => buildResultCells({ sessions: kids(correct).map((k) => k.s), blocks: kids(correct).map((k) => k.b),
      testAccountIds: [], term: { start: '2026-10-26' }, jobRunId: uuid(1), computedAt: '2026-11-17T21:00:00.000Z' });
    const ls = (rows) => rows.find((r) => r.w_id === 'W-LS' && r.language === 'en');
    expect(ls(cells(3))).toMatchObject({ tested: 5, numerator: 5, status: 'ok' });
    expect(ls(cells(8))).toMatchObject({ tested: 5, numerator: 0, status: 'ok' });
  });
});
