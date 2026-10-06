'use strict';
/**
 * The web quiz counts a child's FIRST finished attempt (a child cannot replay
 * on a sibling's phone to raise their class score). WhatsApp keeps the latest.
 */
const { oneAttemptPerChild } = require('../../../shared/services/quiz/one-attempt-per-child');

const s = (id, student, status, completed, created) => ({
  id, student_id: student, status, completed_at: completed, created_at: created,
});

describe("oneAttemptPerChild rule 'first_completed'", () => {
  const rows = [
    s('a1', 'kid', 'completed', '2026-10-05T10:00:00Z', '2026-10-05T09:55:00Z'),
    s('a2', 'kid', 'completed', '2026-10-05T11:00:00Z', '2026-10-05T10:55:00Z'),
    s('a3', 'kid', 'in_progress', null, '2026-10-05T12:00:00Z'),
  ];

  test('default stays latest completed (existing callers unchanged)', () => {
    expect(oneAttemptPerChild(rows).map((r) => r.id)).toEqual(['a2']);
    expect(oneAttemptPerChild(rows, { rule: 'latest_completed' }).map((r) => r.id)).toEqual(['a2']);
  });

  test('first_completed keeps the earliest completed attempt', () => {
    expect(oneAttemptPerChild(rows, { rule: 'first_completed' }).map((r) => r.id)).toEqual(['a1']);
  });

  test('first_completed with nothing completed falls back to the latest row', () => {
    const open = [s('b1', 'k2', 'in_progress', null, '2026-10-05T09:00:00Z'),
      s('b2', 'k2', 'in_progress', null, '2026-10-05T10:00:00Z')];
    expect(oneAttemptPerChild(open, { rule: 'first_completed' }).map((r) => r.id)).toEqual(['b2']);
  });

  test('first_completed: a completed row beats a later in-progress one; loose rows pass through', () => {
    const mix = [s('c1', 'k3', 'completed', '2026-10-05T09:00:00Z', '2026-10-05T08:00:00Z'),
      s('c2', 'k3', 'in_progress', null, '2026-10-05T10:00:00Z'), s('c3', null, 'completed', 'x', 'y')];
    expect(oneAttemptPerChild(mix, { rule: 'first_completed' }).map((r) => r.id)).toEqual(['c1', 'c3']);
  });
});
