'use strict';
/**
 * bd-v0toag.10 (2a, 2d): the teacher report's attempt count and completion, computed from the
 * quiz_sessions rows the report already loads. Pure — no I/O.
 */
const V21 = require('../../bot/shared/services/quiz/teacher-report-v21');

const T = 'teacher-1';
const row = (id, extra = {}) => ({
  id, student_id: null, device_ref: null, user_id: null, invited_by_student_id: null, status: 'completed', ...extra,
});

describe('childKey', () => {
  it('prefers student_id, then device_ref, then the session id', () => {
    expect(V21.childKey(row('s1', { student_id: 'k1', device_ref: 'd1' }))).toBe('k1');
    expect(V21.childKey(row('s1', { device_ref: 'd1' }))).toBe('d:d1');
    expect(V21.childKey(row('s1'))).toBe('s:s1');
  });
});

describe('attemptCounts', () => {
  it('counts every attempt per child, skipping self-tests, invited friends and invited/cancelled rows', () => {
    const rows = [
      row('a', { student_id: 'k1', status: 'incomplete' }),
      row('b', { student_id: 'k1', status: 'completed' }),
      row('c', { student_id: 'k1', status: 'in_progress' }),
      row('d', { student_id: 'k2' }),
      row('e', { user_id: T, student_id: 'k3' }),
      row('f', { student_id: 'k4', invited_by_student_id: 'k1' }),
      row('g', { student_id: 'k5', status: 'invited' }),
      row('h', { student_id: 'k5', status: 'cancelled' }),
    ];
    const m = V21.attemptCounts(rows, T);
    expect(m.get('k1')).toBe(3);
    expect(m.get('k2')).toBe(1);
    expect(m.has('k3')).toBe(false);
    expect(m.has('k4')).toBe(false);
    expect(m.has('k5')).toBe(false);
  });

  it('is empty for no rows', () => {
    expect(V21.attemptCounts(null, T).size).toBe(0);
  });
});

describe('completion', () => {
  it('is finished over started children, as a whole percent', () => {
    const rows = [
      row('a', { student_id: 'k1', status: 'incomplete' }), row('b', { student_id: 'k1' }),
      row('c', { student_id: 'k2', status: 'in_progress' }),
      row('d', { student_id: 'k3', status: 'expired' }),
    ];
    expect(V21.completion(rows, T, 1)).toEqual({ started: 3, finished: 1, pct: 33 });
  });

  it('never reports fewer started than finished', () => {
    expect(V21.completion([row('a', { student_id: 'k1' })], T, 2)).toEqual({ started: 2, finished: 2, pct: 100 });
  });

  it('is null when nobody started', () => {
    expect(V21.completion([], T, 0)).toBeNull();
  });
});
