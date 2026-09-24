'use strict';
/**
 * ONE ATTEMPT PER CHILD.
 *
 * A child who re-opens the class link is started again — beginFromCode
 * recognises the handset and startForStudent makes a new quiz_sessions row;
 * nothing blocks it. Read raw, every such row is another child in "finished",
 * in the average, in the hardest-question tallies and on the class card. On
 * production, 6–14 Sep 2026: 1,150 (quiz, child) pairs carried more than one
 * completed attempt — 2,035 extra rows in class reports, one child at 40.
 *
 * The attempt that counts is the LATEST COMPLETED one (the child's current
 * standing), else the latest row (so a child mid-quiz still shows as started).
 * Rows without a student_id cannot be grouped and pass through untouched.
 * Pure, so it can be asserted directly.
 *
 * Every reader that counts children goes through this one function — the class
 * report and card (video-quiz-report), /quiz's list counts and its lesson
 * screen (transcript-quiz-list countsFor, transcript-quiz-flow-endpoint
 * loadStudents) and the "only N have started" nudge — so the teacher reads one
 * number for one class, wherever it is shown. A reader must select student_id,
 * status, completed_at and created_at for the rule to see the attempts: a row
 * without student_id is counted as its own child.
 */
function oneAttemptPerChild(sessions) {
  const rank = (s) => [
    s.status === 'completed' ? 1 : 0,
    String(s.completed_at || ''),
    String(s.created_at || ''),
  ];
  const better = (a, b) => {
    const ra = rank(a); const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i] > rb[i]) return true;
      if (ra[i] < rb[i]) return false;
    }
    return false;
  };
  const byChild = new Map();
  const loose = [];
  (sessions || []).forEach((s) => {
    if (!s) return;
    if (!s.student_id) { loose.push(s); return; }
    const cur = byChild.get(s.student_id);
    if (!cur || better(s, cur)) byChild.set(s.student_id, s);
  });
  return [...byChild.values(), ...loose];
}

module.exports = { oneAttemptPerChild };
