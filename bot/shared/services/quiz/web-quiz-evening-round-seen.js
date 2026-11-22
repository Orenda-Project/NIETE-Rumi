'use strict';
/**
 * THE SAME-DAY SWAP's read: which of an evening round's lesson items THIS child already answered RIGHT earlier the same
 * PKT day on another quiz of the same lesson. The round is written through lp_v8, whose cache copies a lesson's items
 * from one authored quiz (meta.cache_donor), so the quiz a teacher forwarded that afternoon can hold the very questions
 * the round serves at 18:00. selectRoundItems leaves those items out (skip) and fills from the round's next lesson
 * items; a same-day miss stays.
 *
 * "The same question" is the same LINEAGE: the root quiz (meta.cache_donor.quiz_id for a copy, else the quiz's own id)
 * plus the external_id's '<slo>:<n>' tail. lp-quiz-cache rowsFor re-keys a copy's external_id to its own quiz id and keeps
 * the tail, so an external_id is never equal across two quizzes, while every copied item carries its donor item's tail
 * with the same text, options and key.
 *
 * Stable by construction, so start, answers, finish and a resume (in any process) get the same set: only answers
 * recorded BEFORE the sitting began (quiz_answers.created_at < the session's created_at), on this child's sessions that
 * began earlier the same PKT day, on any quiz but the round's own. Every such row is already in the past when the
 * sitting starts. Kept per session id (bounded), so a sitting reads it once per process. A failed read is "nothing
 * seen" for that sitting in that process (logged).
 *
 * Reads, for a named child's round sitting only: quiz_sessions; then, when there is an earlier sitting today,
 * quiz_answers; when one of its answers was right, quiz_questions and quizzes (the lineage).
 */
const { logToFile } = require('../../utils/logger');
const { read: dbRead } = require('./web-quiz-db-deadline');

const EMPTY = Object.freeze(new Set());
const KEPT = new Map(); // session id -> Set of the round's lesson row ids answered right earlier today
const KEPT_MAX = 5000;
const SESSIONS_MAX = 50;

const tailOf = (externalId) => {
  const p = String(externalId || '').split(':');
  return p.length >= 4 ? `${p[p.length - 2]}:${p[p.length - 1]}` : null;
};
const rootOf = (quiz) => (quiz && quiz.meta && quiz.meta.cache_donor && quiz.meta.cache_donor.quiz_id) || (quiz && quiz.id) || null;

function keep(sessionId, set) {
  if (KEPT.size >= KEPT_MAX) KEPT.delete(KEPT.keys().next().value);
  KEPT.set(sessionId, set);
  return set;
}

async function readRows(label, build) {
  const { data, error } = await dbRead(label, build);
  if (error) throw new Error(error.message || String(error));
  return data || [];
}

/**
 * The round's lesson row ids this child answered right earlier today (a Set; empty when none, or when the sitting has
 * no named child). `rows` = the round's questions as served (loadQuestions).
 */
async function rightEarlierToday({ sessionId, studentId, createdAt, roundQuizId, rows } = {}) {
  const lesson = (rows || []).filter((q) => q && q.media && q.media.round === 'lesson' && tailOf(q.external_id));
  if (!sessionId || !studentId || !createdAt || !roundQuizId || !lesson.length) return EMPTY;
  if (KEPT.has(sessionId)) return KEPT.get(sessionId);
  try {
    const P = require('../nudges/pkt-time');
    const at = new Date(createdAt);
    if (Number.isNaN(at.getTime())) return EMPTY;
    const bound = at.toISOString();
    const dayStart = P.atPkt(P.pktDate(at), 0, 0).toISOString();
    const sessions = await readRows('roundSeen:quiz_sessions', (db) => db.from('quiz_sessions').select('id, quiz_id')
      .eq('student_id', studentId).gte('created_at', dayStart).lt('created_at', bound).neq('quiz_id', roundQuizId)
      .limit(SESSIONS_MAX));
    if (!sessions.length) return keep(sessionId, EMPTY);
    const right = await readRows('roundSeen:quiz_answers', (db) => db.from('quiz_answers').select('question_id')
      .in('session_id', sessions.map((s) => s.id)).eq('is_correct', true).lt('created_at', bound));
    const qids = [...new Set(right.map((a) => a.question_id).filter(Boolean))];
    if (!qids.length) return keep(sessionId, EMPTY);
    const items = await readRows('roundSeen:quiz_questions', (db) => db.from('quiz_questions').select('id, quiz_id, external_id').in('id', qids));
    const quizIds = [...new Set([roundQuizId, ...items.map((q) => q.quiz_id).filter(Boolean)])];
    const quizzes = await readRows('roundSeen:quizzes', (db) => db.from('quizzes').select('id, meta').in('id', quizIds));
    const byId = new Map(quizzes.map((q) => [q.id, q]));
    const roundRoot = rootOf(byId.get(roundQuizId));
    if (!roundRoot) return keep(sessionId, EMPTY);
    const seen = new Set(items.map((q) => {
      const root = rootOf(byId.get(q.quiz_id));
      const tail = tailOf(q.external_id);
      return root && tail ? `${root}|${tail}` : null;
    }).filter(Boolean));
    const out = new Set(lesson.filter((q) => seen.has(`${roundRoot}|${tailOf(q.external_id)}`)).map((q) => q.id));
    return keep(sessionId, out.size ? out : EMPTY);
  } catch (err) {
    logToFile('⚠️ evening round: earlier answers unreadable — no swap for this sitting', { error: err.message });
    return keep(sessionId, EMPTY);
  }
}

module.exports = { rightEarlierToday, tailOf, rootOf, _reset: () => { KEPT.clear(); } };
