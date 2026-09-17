/**
 * bd-60118 — STEPS "P" (Presence) for a principal's school (TDD, red-first).
 *
 * P is two different measurements that must not be averaged into one number:
 *   · TEACHER attendance — teacher_attendance_records, one row per (teacher,
 *     date), status present|absent|leave. Prod 2026-09-17: 2,811 rows across
 *     28 schools, Aug 1 – Sep 17.
 *   · STUDENT attendance — attendance_sessions carries the per-session totals
 *     (total_students / present_count), keyed to the teacher who marked it.
 *     Prod: 2,328 sessions / 72,579 records.
 *
 * They stay separate because the weighting between them was never locked.
 * Sabeena, #impact-and-policy 2026-08-10: start at 60:40 teacher:student and
 * "adjust the percentage accordingly based on the findings" after the pilot —
 * still unresolved in that thread. Momina's fairness point is the reason it is
 * unresolved: rural student absence is driven by circumstances at home, so
 * folding it into a teacher's single number can misattribute it. Inventing a
 * blend here would hardcode a decision the org has deliberately not made.
 *
 * `leave` is its own status, NOT an absence. A teacher on approved casual/sick/
 * official leave who is counted absent is being marked down for having taken
 * leave she was granted.
 */

const { summarizePresence } = require('../services/steps-presence.service');

describe('summarizePresence', () => {
  it('returns an explicit empty shape when nothing has been marked', () => {
    const out = summarizePresence([], []);
    expect(out.teacher.records).toBe(0);
    expect(out.teacher.presentPct).toBeNull();   // null, not 0 — unmarked is not absent
    expect(out.student.sessions).toBe(0);
    expect(out.student.presentPct).toBeNull();
  });

  it('computes teacher presence, counting leave separately from absence', () => {
    const out = summarizePresence([
      { status: 'present' }, { status: 'present' }, { status: 'present' },
      { status: 'absent' },
      { status: 'leave' },
    ], []);
    expect(out.teacher.records).toBe(5);
    expect(out.teacher.present).toBe(3);
    expect(out.teacher.absent).toBe(1);
    expect(out.teacher.leave).toBe(1);
    // Leave is excluded from the denominator: it is neither attendance nor
    // absence, and counting it as either misreads an approved day off.
    expect(out.teacher.presentPct).toBe(75);   // 3 present / 4 (present+absent)
  });

  it('computes student presence from the session totals, not a row count', () => {
    const out = summarizePresence([], [
      { total_students: 40, present_count: 32 },
      { total_students: 40, present_count: 36 },
    ]);
    expect(out.student.sessions).toBe(2);
    expect(out.student.presentPct).toBe(85);   // 68 of 80
  });

  it('ignores a session with no roster total rather than dividing by zero', () => {
    const out = summarizePresence([], [
      { total_students: 0, present_count: 0 },
      { total_students: 20, present_count: 15 },
      { total_students: null, present_count: 5 },
    ]);
    expect(out.student.presentPct).toBe(75);   // only the usable session counts
    expect(out.student.sessions).toBe(1);
  });

  it('keeps teacher and student presence as SEPARATE figures', () => {
    const out = summarizePresence([{ status: 'present' }], [{ total_students: 10, present_count: 5 }]);
    expect(out.teacher.presentPct).toBe(100);
    expect(out.student.presentPct).toBe(50);
    // No blended "P score" — the 60:40 weighting is still unresolved (Sabeena,
    // 2026-08-10: adjust after the pilot). Publishing one would invent it.
    expect(out.combinedPct).toBeUndefined();
  });
});
