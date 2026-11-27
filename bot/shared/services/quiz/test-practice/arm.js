'use strict';
/**
 * The practice door's arm, A/B test ict-quiz-practice-door. Pure: the switch value, who may see the door, the
 * phone-group key and the draw. The DB reads and the ledger live in door.js / ledger.js.
 *
 * Switch (app_settings ab_quiz_practice_door, default absent = off):
 *   true                              → on, drawn by assignArm
 *   {on:true, force_b:[child ids]}    → on, and those children get B without a draw (QA)
 *   {winner:'b', test_id}             → on; assignArm serves the winner once the test is registered
 *   anything else                     → off: nobody sees anything new and nothing new is read
 */
const crypto = require('crypto');

const FLAG_KEY = 'ab_quiz_practice_door';
const TEST_ID = 'ict-quiz-practice-door';
const SALT = `${TEST_ID}:2026-11:v1`;
const SHARES_BP = Object.freeze({ a: 5000, b: 5000 });
const CONTROL = 'a';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFF = Object.freeze({ on: false, forceB: new Set(), switch: null });

function parseFlag(v) {
  if (v === true) return { on: true, forceB: new Set(), switch: v };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return OFF;
  if (typeof v.winner === 'string') return { on: true, forceB: new Set(), switch: v };
  if (v.on !== true) return OFF;
  const ids = Array.isArray(v.force_b) ? v.force_b.filter((x) => typeof x === 'string' && UUID.test(x)) : [];
  return { on: true, forceB: new Set(ids), switch: v };
}

function gradeOf(g) {
  const m = /(\d+)/.exec(String(g == null ? '' : g));
  return m ? Number(m[1]) : null;
}

// A child (not the teacher's own session, not brought in by a friend) finishing a Grade 1-5 English lesson-plan quiz
// that a teacher made. A practice round is never itself a door.
function eligible(s, q) {
  if (!s || !s.student_id || s.user_id) return false;
  if (s.invited_by_student_id && s.invited_by_student_id !== s.student_id) return false;
  if (!q || !q.teacher_id || q.quiz_source !== 'lp_v8') return false;
  const g = gradeOf(q.grade);
  if (!g || g < 1 || g > 5 || !/english/i.test(String(q.subject || ''))) return false;
  const m = q.meta || {};
  if (m.kind === 'practice') return false;
  return Array.isArray(m.lessons) && m.lessons.length > 0 && !!(m.digest && Array.isArray(m.digest.slos) && m.digest.slos.length);
}

// The unit is the phone group: every child bound to one phone draws together. The key is a hash of the binding's
// phone_tomb (already an HMAC), never a phone. A child with no active binding falls back to their own id.
function groupKeyOf(bindings, studentId) {
  const tombs = (bindings || []).map((b) => b && b.phone_tomb).filter(Boolean).sort();
  if (!tombs.length) return { key: `st:${studentId}`, fallback: true };
  return { key: `pg:${crypto.createHash('sha256').update(String(tombs[0])).digest('hex').slice(0, 32)}`, fallback: false };
}

// assign = AB.assignArm (bound to a logger). Returns 'a' or 'b'.
function drawArm({ flag, studentId, groupKey, assign }) {
  if (flag.forceB.has(studentId)) return 'b';
  const arm = assign({ flagKey: FLAG_KEY, unitId: groupKey, salt: SALT, sharesBp: { ...SHARES_BP }, controlArm: CONTROL, switch: flag.switch });
  return arm === 'b' ? 'b' : CONTROL;
}

module.exports = { FLAG_KEY, TEST_ID, SALT, SHARES_BP, CONTROL, parseFlag, eligible, gradeOf, groupKeyOf, drawArm };
