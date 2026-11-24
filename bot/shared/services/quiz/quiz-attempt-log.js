'use strict';
/**
 * KEEP EVERY QUIZ ATTEMPT (table quiz_attempts, migration quiz_attempts.sql).
 *
 * quiz_sessions + quiz_answers hold each attempt today, but not durably and not with what marked it:
 *  - quiz_answers cascades from quiz_questions, and a remake / cache hit replaces a quiz's questions
 *    (transcript-quiz-generate: delete + insert), so the answers of children who already played go with them;
 *  - quiz_sessions cascades from quizzes and students;
 *  - an answer key fixed in place (quiz_item_reviews 'fixed') leaves no trace of the key an earlier try was marked by.
 * So a change in a child's score cannot be told apart from a change in marking (task #276, L1).
 *
 * One append-only row per finished attempt, written BESIDE the finish (never awaited by it, never changing its reply):
 *   answers        [{qid, picked, ok, key, item}]: the child's pick, the verdict given, the key that gave it, and a short
 *                  hash of the question as shown (stem + options)
 *   key_version    hash of every served item's key at marking time: changes when any key is fixed
 *   items_version  hash of the served items' content: changes when the quiz maker rewrites the questions
 *   quiz_source / quiz_made_at  which quiz maker made the quiz, and when (git history at that date = the maker's code)
 *   marker_commit  the bot commit that marked the attempt (RAILWAY_GIT_COMMIT_SHA)
 * No names, no phones. Switch: app_settings web_quiz_keep_attempts, on only for JSON true (the hub switches' read); a failed write is a
 * warn log line and nothing else.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_keep_attempts';
const pending = new Set();

const hash = (s, n) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);

/** The switch rides the web quiz's one settings read (web-quiz-hub-flags, cached), so a finish makes no read for it. */
async function on() {
  try {
    return (await require('./web-quiz-hub-flags').flags()).keepAttempts === true;
  } catch (e) {
    logToFile('⚠️ quiz attempt log: setting unreadable — not recording', { error: e && e.message }, 'warn');
    return false;
  }
}

/** The question as the child saw it: stem and options (not the key). */
function itemText(q) {
  const web = q && q.media && q.media.web;
  return JSON.stringify([q.question_text || '', q.option_a || '', q.option_b || '', q.option_c || '', q.option_d || '',
    web ? { ...web, key: undefined } : null]);
}

/**
 * Pure: the row for one attempt. `served` = the questions the child answered, in sitting order; `byQ` = their answers
 * by question id; `keyFor(q)` = the grader's key for q.
 */
function buildAttempt({ session, quiz, served, byQ, keyFor, channel, status = 'completed', commit = null }) {
  const answers = served.map((q) => {
    const a = byQ.get(q.id);
    return { qid: q.id, picked: a.selected_option, ok: Boolean(a.is_correct), key: keyFor(q), item: hash(itemText(q), 12) };
  });
  const ids = answers.map((a) => a.qid).sort();
  const byId = new Map(answers.map((a) => [a.qid, a]));
  return {
    session_id: session.id,
    quiz_id: session.quiz_id || null,
    student_id: session.student_id || null,
    share_code_id: session.share_code_id || null,
    channel,
    status,
    correct: answers.filter((a) => a.ok).length,
    total: answers.length,
    answers,
    key_version: hash(ids.map((id) => `${id}:${byId.get(id).key}`).join('|'), 16),
    items_version: hash(ids.map((id) => `${id}:${byId.get(id).item}`).join('|'), 16),
    quiz_source: (quiz && quiz.quiz_source) || null,
    quiz_made_at: (quiz && quiz.created_at) || null,
    marker_commit: commit,
  };
}

async function write(args) {
  if (!(await on())) return;
  // A teacher's own preview is not a child's attempt.
  if (args.session && args.session.user_id) return;
  let quiz = null;
  try {
    const { data } = await supabase.from('quizzes').select('quiz_source, created_at').eq('id', args.session.quiz_id).maybeSingle();
    quiz = data || null;
  } catch (_) { /* the quiz row is context, not the record */ }
  const row = buildAttempt({ ...args, quiz, commit: process.env.RAILWAY_GIT_COMMIT_SHA || null });
  const { error } = await supabase.from('quiz_attempts').insert(row);
  if (error && error.code !== '23505') {
    logToFile('⚠️ quiz attempt log: write failed — the finish is unaffected', { sessionId: row.session_id, code: error.code, error: error.message }, 'warn');
  }
}

/** Record one attempt in the background. Never throws, never awaited by the finish. */
function keep(args) {
  const p = write(args).catch((e) => {
    logToFile('⚠️ quiz attempt log: write failed — the finish is unaffected', { error: e && e.message }, 'warn');
  }).finally(() => pending.delete(p));
  pending.add(p);
}

/** Tests only. */
async function _settled() { while (pending.size) await Promise.all([...pending]); }
function _reset() { require('./web-quiz-hub-flags')._resetCache(); }

module.exports = { keep, buildAttempt, on, KEY, _settled, _reset };
