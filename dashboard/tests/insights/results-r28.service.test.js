'use strict';
/**
 * Round 28: the listen-and-tap letter sounds (`<lang>.letter_pick10`) and the tapped story questions
 * (`<lang>.story_mcq_w3`) are NEW measures and never pool with the old spoken ones: they get their own codes (E4T, E11T)
 * and their own result rows (W-LS-T, W-RC-T), so a cell that spans the switch shows both rows, never one figure.
 */
const { codeOf, buildResultCells } = require('../../lib/insights/results');

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function cells(blocksFor) {
  const kids = [1, 2, 3, 4, 5].map((i) => ({
    s: { id: uuid(100 + i), school_id: uuid(7), coach_user_id: uuid(8), grade: 3, status: 'completed', student_id: uuid(300 + i), started_at: '2026-11-17T05:00:00Z' },
    b: blocksFor(uuid(100 + i), i),
  }));
  return buildResultCells({ sessions: kids.map((k) => k.s), blocks: kids.flatMap((k) => k.b),
    testAccountIds: [], term: { start: '2026-10-26' }, jobRunId: uuid(1), computedAt: '2026-11-17T21:00:00.000Z' });
}
const pick = (sid, correct) => ({ session_id: sid, block: 'en.letter_pick10', responses: [{ kind: 'result', correct, attempted: 10 }] });
const sounds = (sid, correct) => ({ session_id: sid, block: 'en.letter_sounds5', responses: [{ kind: 'result', correct, attempted: 5 }] });
const row = (rows, w, lang) => rows.find((r) => r.w_id === w && r.language === lang);

describe('round 28 task ids → their own EGRA codes (dashboard/lib/insights/results.js)', () => {
  test('letter_pick10 is E4T, story_mcq_w3 is E11T, for both languages', () => {
    expect(codeOf('ur.letter_pick10')).toBe('E4T');
    expect(codeOf('en.letter_pick10')).toBe('E4T');
    expect(codeOf('ur.story_mcq_w3')).toBe('E11T');
    expect(codeOf('en.story_mcq_w3')).toBe('E11T');
  });
  test('the old ids keep their codes', () => {
    expect(codeOf('ur.letter_sounds5')).toBe('E4');
    expect(codeOf('en.story_comp_w3')).toBe('E11');
    expect(codeOf('en.story_w3')).toBe('E10');
  });
  test('five sessions with en.letter_pick10 3 of 10 make W-LS-T 5 below bar; 8 of 10 make it 0 below', () => {
    expect(row(cells((sid) => [pick(sid, 3)]), 'W-LS-T', 'en')).toMatchObject({ tested: 5, numerator: 5, status: 'ok' });
    expect(row(cells((sid) => [pick(sid, 8)]), 'W-LS-T', 'en')).toMatchObject({ tested: 5, numerator: 0, status: 'ok' });
  });
  test('the old W-LS row is untouched by letter_pick sessions', () => {
    expect(row(cells((sid) => [pick(sid, 3)]), 'W-LS', 'en')).toBeUndefined();
    const both = cells((sid, i) => (i <= 2 ? [sounds(sid, 5)] : [pick(sid, 2)]));
    expect(row(both, 'W-LS', 'en')).toMatchObject({ tested: 2, status: 'insufficient' });
    expect(row(both, 'W-LS-T', 'en')).toMatchObject({ tested: 3, status: 'insufficient' });
  });
  test('W-LS-T is a gap in Urdu; W-RC-T is not graded in both languages and never merges with W-RC', () => {
    expect(row(cells((sid) => [{ ...pick(sid, 8), block: 'ur.letter_pick10' }]), 'W-LS-T', 'ur')).toMatchObject({ status: 'not_measured', tested: 5 });
    const mcq = cells((sid, i) => [{ session_id: sid, block: i <= 2 ? 'ur.story_comp_w3' : 'ur.story_mcq_w3', responses: [{ kind: 'result', correct: 3, attempted: 6 }] }]);
    expect(row(mcq, 'W-RC', 'ur')).toMatchObject({ tested: 2, status: 'not_graded' });
    expect(row(mcq, 'W-RC-T', 'ur')).toMatchObject({ tested: 3, status: 'not_graded' });
  });
});
