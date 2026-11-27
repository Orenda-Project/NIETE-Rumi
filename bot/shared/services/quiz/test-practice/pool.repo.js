'use strict';
/**
 * Practice door reads and writes (A/B test ict-quiz-practice-door, arm B only). Every read answers a safe default on
 * error and logs: an empty pool, no questions, null blocked texts (the caller then serves no round: fail closed).
 *
 * A round is a quizzes row: quiz_source 'practice', status 'skipped' (never in a teacher's list or report), the source
 * quiz's teacher and topic, meta {kind:'practice', student_id, source_quiz_id, round:{items}, result}. It has no
 * quiz_sessions rows; the page sends every answer at the end and the server grades them.
 */
const supabase = require('../../../config/supabase');
const Keys = require('../quiz-key-review.service');
const { logToFile } = require('../../../utils/logger');
const F = require('./freshness');

const QUIZ_COLS = 'id, teacher_id, grade, subject, topic, quiz_source, status, meta, created_at';
const Q_COLS = 'id, quiz_id, question_text, option_a, option_b, option_c, correct_option, external_id';
const LIVE = ['ready', 'sent', 'report_sent'];
const POOL_LIMIT = 120;
const PAGE = 1000;      // PostgREST max-rows on the NIETE database
const MAX_PAGES = 40;   // 40,000 rows: more than the whole exam bank
const CHUNK = 200;      // ids per .in(), under the 16 KB header cap
const BLOCK_TTL_MS = 10 * 60 * 1000;

const warn = (m) => logToFile(`⚠️ practice_door ${m}`);
let blockCache = new Map();

async function one(label, build) {
  try {
    const { data, error } = await build();
    if (error) { warn(`${label} ${error.code || ''} ${error.message || ''}`); return null; }
    return data;
  } catch (e) { warn(`${label} ${e.message}`); return null; }
}

const sessionOf = (id) => one('session', () => supabase.from('quiz_sessions')
  .select('id, student_id, user_id, invited_by_student_id, share_code_id, quiz_id').eq('id', id).maybeSingle());

const quizOf = (id) => one('quiz', () => supabase.from('quizzes').select(QUIZ_COLS).eq('id', id).maybeSingle());

async function answersOf(sessionId) {
  return (await one('answers', () => supabase.from('quiz_answers').select('question_id, is_correct').eq('session_id', sessionId))) || [];
}

async function poolQuizzes(grade, excludeId) {
  const rows = await one('pool', () => supabase.from('quizzes').select(QUIZ_COLS)
    .eq('quiz_source', 'lp_v8').in('status', LIVE).eq('grade', grade).ilike('subject', '%english%')
    .order('created_at', { ascending: false }).limit(POOL_LIMIT + 1));
  return (rows || []).filter((z) => z.id !== excludeId).slice(0, POOL_LIMIT);
}

// Questions of these quizzes, less any a reviewer held. If the review embed fails, nothing is served from that chunk.
async function questionsOf(quizIds) {
  const ids = [...new Set(quizIds || [])];
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await one('questions', () => supabase.from('quiz_questions')
      .select(`${Q_COLS}, ${Keys.REVIEW_EMBED}`).in('quiz_id', ids.slice(i, i + CHUNK)));
    if (!rows) continue;
    const { rows: kept, held } = Keys.servedAfterReview(rows);
    if (held.length) warn(`held_skipped n=${held.length}`);
    out.push(...kept);
  }
  return out;
}

async function seenQuizIds(studentId) {
  const rows = await one('seen', () => supabase.from('quiz_sessions').select('quiz_id').eq('student_id', studentId).limit(500));
  return new Set((rows || []).map((r) => r.quiz_id));
}

async function practiceRows(studentId) {
  return (await one('rounds', () => supabase.from('quizzes').select('id, created_at, meta')
    .eq('quiz_source', 'practice').eq('meta->>student_id', studentId)
    .order('created_at', { ascending: false }).limit(200))) || [];
}

const roundsSince = (rows, iso) => (rows || []).filter((r) => r.created_at && String(r.created_at) >= iso).length;

function seenOfRounds(rows) {
  const s = new Set();
  (rows || []).forEach((r) => ((r.meta && r.meta.round && r.meta.round.items) || []).forEach((i) => i && i.qid && s.add(i.qid)));
  return s;
}

async function paged(label, build) {
  const out = [];
  for (let p = 0; p < MAX_PAGES; p += 1) {
    const rows = await one(label, () => build().range(p * PAGE, p * PAGE + PAGE - 1));
    if (!rows) return null;
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  return out;
}

// Every English exam-bank question (its grade label has no fixed format, so no grade filter: wider, never narrower)
// and every exercise on the pages of this grade's English textbooks. Null when any read fails.
async function readBlocked(grade) {
  const bank = await paged('exam_bank', () => supabase.from('exam_question_bank').select('id, question_statement')
    .ilike('subject', '%english%').order('id'));
  if (!bank) return null;
  const books = await one('textbooks', () => supabase.from('textbooks').select('id').eq('grade', grade).ilike('subject', '%english%'));
  if (!books) return null;
  const texts = bank.map((r) => r.question_statement).filter(Boolean);
  const ids = books.map((b) => b.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const pages = await paged('textbook_pages', () => supabase.from('textbook_pages').select('id, exercises')
      .in('textbook_id', ids.slice(i, i + CHUNK)).order('id'));
    if (!pages) return null;
    pages.forEach((pg) => texts.push(...F.textsOf(pg.exercises)));
  }
  return texts;
}

async function blockedTexts(grade, now = Date.now()) {
  const hit = blockCache.get(grade);
  if (hit && now - hit.at < BLOCK_TTL_MS) return hit.texts;
  let texts;
  try { texts = await readBlocked(grade); } catch (e) { warn(`blocked ${e.message}`); texts = null; }
  if (texts) blockCache.set(grade, { at: now, texts });
  return texts;
}

async function insertRound(row) {
  const data = await one('insert', () => supabase.from('quizzes').insert(row).select('id').single());
  return data ? data.id : null;
}

async function updateRound(id, patch) {
  return (await one('update', () => supabase.from('quizzes').update(patch).eq('id', id).eq('quiz_source', 'practice'))) != null;
}

const _resetCache = () => { blockCache = new Map(); };

module.exports = {
  POOL_LIMIT, sessionOf, quizOf, answersOf, poolQuizzes, questionsOf, seenQuizIds, practiceRows, roundsSince,
  seenOfRounds, blockedTexts, insertRound, updateRound, _resetCache,
};
