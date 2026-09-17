/**
 * bd-60118 — STEPS "P" (Presence), aggregated for a principal's school.
 *
 * Two measurements, deliberately kept apart:
 *   · TEACHER attendance — teacher_attendance_records, one row per (teacher,
 *     date), status present|absent|leave (prod 2026-09-17: 2,811 rows, 28
 *     schools, Aug 1 – Sep 17).
 *   · STUDENT attendance — attendance_sessions carries per-session totals
 *     (total_students / present_count), keyed to whoever marked it (prod:
 *     2,328 sessions, 72,579 records).
 *
 * WHY THERE IS NO SINGLE "P SCORE". The teacher:student weighting was never
 * locked. Sabeena, #impact-and-policy 2026-08-10: start at 60:40 and "adjust
 * the percentage accordingly based on the findings" after the pilot — the
 * thread ends unresolved. Momina's objection is the reason: rural student
 * absence is driven by circumstances at home (domestic, financial, family), so
 * folding it into one teacher-facing number can misattribute it. Publishing a
 * blend would hardcode a decision the org has explicitly deferred, and it would
 * be indistinguishable from an agreed one once it is on screen.
 *
 * LEAVE IS NOT ABSENCE. It is its own status with its own types (casual, sick,
 * official). It is excluded from the presence denominator rather than counted
 * either way — a teacher marked down for leave she was granted is being
 * penalised for the school's own approval.
 */

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {Array<{status: string}>} teacherRecords  teacher_attendance_records rows
 * @param {Array<{total_students: number, present_count: number}>} studentSessions  attendance_sessions rows
 */
function summarizePresence(teacherRecords, studentSessions) {
  const tr = Array.isArray(teacherRecords) ? teacherRecords : [];
  const ss = Array.isArray(studentSessions) ? studentSessions : [];

  const present = tr.filter((r) => r && r.status === 'present').length;
  const absent = tr.filter((r) => r && r.status === 'absent').length;
  const leave = tr.filter((r) => r && r.status === 'leave').length;
  // Denominator is the days actually accounted for as present-or-absent.
  const marked = present + absent;

  let studentTotal = 0;
  let studentPresent = 0;
  let usableSessions = 0;
  for (const s of ss) {
    const total = Number(s && s.total_students);
    const p = Number(s && s.present_count);
    // No roster total means the session tells us nothing about a rate.
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!Number.isFinite(p)) continue;
    studentTotal += total;
    studentPresent += p;
    usableSessions += 1;
  }

  return {
    teacher: {
      records: tr.length,
      present,
      absent,
      leave,
      // null, not 0: nothing marked is not "nobody came in".
      presentPct: marked > 0 ? round1((present / marked) * 100) : null,
    },
    student: {
      sessions: usableSessions,
      totalMarked: studentTotal,
      present: studentPresent,
      presentPct: studentTotal > 0 ? round1((studentPresent / studentTotal) * 100) : null,
    },
  };
}

module.exports = { summarizePresence };
