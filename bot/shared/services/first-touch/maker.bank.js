'use strict';
/**
 * The quiz-maker page's bank: the chip tree it offers, and the make.
 *
 * chipTree() → { '<grade>': { '<subject code>': [{ quizId, topic, qlang }] } }, built from the live video bank:
 * quizzes (quiz_source 'video', status 'ready', grade '1'–'5') whose video is live (student_videos.superseded_by IS
 * NULL). Subjects map to codes by the first-touch table (anything else is dropped); a cell exists only when a quiz
 * does; two quizzes under one topic string in a cell → the one on the newest live video. `qlang` is the quiz's
 * question language (maker.qlang.js qlangFor: quizzes.language when set, else the question texts' language when it
 * agrees with today's read-aloud voice, else null); the questions of the quizzes with no language are read ONCE per
 * build (one paged read of quiz_questions). Held in memory for 10 minutes; a failed read throws. Nothing is written.
 *
 * make({ uid, lang, grade, subject, quizId }) re-checks the quiz id against the bank (a live, ready video quiz in
 * that grade and subject; else { error: 400 }, nothing minted), reuses an unexpired code this teacher already holds
 * for this quiz, else mints ONE quiz_share_codes row through today's mintCode (the class bound only when it is known;
 * the "which class?" chat question is never asked from here). The message is today's vqClassMessage, exactly as the
 * chat share builds it, plus the question-language line when the quiz's qlang is known. No other table is written.
 * → { shareCodeId, message, qlang, preview, total, minted } | { error: 400 } | { error: 503 }.
 *
 * shareMessage({ uid, lang, shareCodeId }) rebuilds that same message for "Send to class group" from the share code
 * row (only when it is this teacher's): → { message, quizId, grade, subject, qlang } | null. Reads only.
 */
const supabase = require('../../config/supabase');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { str } = require('./maker.strings');
const { qlangFor } = require('./maker.qlang');

const TREE_TTL_MS = 10 * 60 * 1000;
const PAGE = 1000;
const QLANGS = Object.freeze(['en', 'ur']);
const GRADES = Object.freeze(['1', '2', '3', '4', '5']);

// Raw bank / profile subject → code (the first-touch table); anything else → null.
const SUBJECT_CODE = Object.freeze({
  maths: 'maths', math: 'maths', mathematics: 'maths',
  english: 'english',
  urdu: 'urdu',
  science: 'science', 'general science': 'science', general_science: 'science',
  'general knowledge': 'general_knowledge', general_knowledge: 'general_knowledge', genk: 'general_knowledge',
  'islamic studies': 'islamic_studies', islamiyat: 'islamic_studies', islamic_studies: 'islamic_studies',
});

function subjectCode(raw) {
  if (typeof raw !== 'string') return null;
  return SUBJECT_CODE[raw.trim().toLowerCase().replace(/\s+/g, ' ')] || null;
}
const gradeOf = (raw) => { const g = raw == null ? '' : String(raw).trim(); return GRADES.includes(g) ? g : null; };
const IN_CHUNK = 300;   // ids per .in() list (under the ~390-id request-header cap)

// ─── the chip tree ───────────────────────────────────────────────────────────────────────────────────────────────

async function pages(build, size = PAGE) {
  const out = [];
  let after = null;
  for (let i = 0; i < 20; i += 1) {
    let q = build();
    if (after) q = q.gt('id', after);
    const { data, error } = await q.order('id', { ascending: true }).limit(size);
    if (error) throw new Error(error.message || 'bank read failed');
    out.push(...(data || []));
    if (!data || data.length < size) break;
    after = data[data.length - 1].id;
  }
  return out;
}

async function loadTree() {
  const quizzes = await pages(() => supabase.from('quizzes').select('id, video_id, grade, subject, topic, language')
    .eq('quiz_source', 'video').eq('status', 'ready').in('grade', GRADES));
  const videos = await pages(() => supabase.from('student_videos').select('id, created_at').is('superseded_by', null));
  const liveAt = new Map(videos.map((v) => [v.id, String(v.created_at || '')]));
  const best = new Map();   // grade|subject|topic → { quiz, at }
  for (const q of quizzes) {
    const grade = gradeOf(q.grade);
    const subject = subjectCode(q.subject);
    const topic = typeof q.topic === 'string' ? q.topic.trim() : '';
    if (!grade || !subject || !topic || !q.video_id || !liveAt.has(q.video_id)) continue;
    const key = `${grade}|${subject}|${topic}`;
    const at = liveAt.get(q.video_id);
    const had = best.get(key);
    if (!had || at > had.at || (at === had.at && q.id > had.quiz.id)) best.set(key, { quiz: q, at, grade, subject, topic });
  }
  // The questions of the listed quizzes with no language: one paged read (in id lists under the header cap).
  const unmarked = [...best.values()].map((b) => b.quiz).filter((q) => !QLANGS.includes(q.language)).map((q) => q.id);
  const questionsOf = new Map(unmarked.map((id) => [id, []]));
  for (let i = 0; i < unmarked.length; i += IN_CHUNK) {
    const ids = unmarked.slice(i, i + IN_CHUNK);
    const rows = await pages(() => supabase.from('quiz_questions').select('id, quiz_id, question_text, option_a').in('quiz_id', ids));
    for (const r of rows) if (questionsOf.has(r.quiz_id)) questionsOf.get(r.quiz_id).push(r);
  }
  const tree = {};
  for (const { quiz, grade, subject, topic } of best.values()) {
    tree[grade] = tree[grade] || {};
    const qlang = qlangFor(quiz.language, questionsOf.get(quiz.id) || []);
    (tree[grade][subject] = tree[grade][subject] || []).push({ quizId: quiz.id, topic, qlang });
  }
  for (const g of Object.values(tree)) for (const list of Object.values(g)) list.sort((a, b) => a.topic.localeCompare(b.topic));
  return tree;
}

let cache = null;   // { at, tree }

async function chipTree(now = Date.now()) {
  if (cache && now - cache.at < TREE_TTL_MS) return cache.tree;
  const tree = await loadTree();
  cache = { at: now, tree };
  return tree;
}

/** The chip for a quiz id in a cell of the cached tree, or null (never throws; for the step event's qlang). */
async function chipOf(grade, subject, quizId) {
  try {
    const cell = ((await chipTree())[grade] || {})[subject] || [];
    return cell.find((c) => c.quizId === quizId) || null;
  } catch (_) {
    return null;
  }
}

// ─── the make ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The bank quiz behind a posted chip when it is a live, ready video quiz of that grade and subject; else null. */
async function liveQuiz({ grade, subject, quizId }) {
  const g = gradeOf(grade);
  if (!g || subjectCode(subject) !== subject || typeof quizId !== 'string') return null;
  const { data: quiz, error } = await supabase.from('quizzes')
    .select('id, video_id, grade, subject, topic, language, quiz_source, status').eq('id', quizId).maybeSingle();
  if (error) throw new Error(error.message || 'quiz read failed');
  if (!quiz || quiz.quiz_source !== 'video' || quiz.status !== 'ready' || !quiz.video_id) return null;
  if (gradeOf(quiz.grade) !== g || subjectCode(quiz.subject) !== subject) return null;
  const { data: video, error: vErr } = await supabase.from('student_videos')
    .select('id, superseded_by').eq('id', quiz.video_id).maybeSingle();
  if (vErr) throw new Error(vErr.message || 'video read failed');
  return video && video.superseded_by == null ? quiz : null;
}

/** An unexpired, active code this teacher already holds for this quiz (the newest), or null. */
async function heldCode(uid, quizId, now) {
  const { data, error } = await supabase.from('quiz_share_codes')
    .select('id, code, teacher_name, topic, language, active, expires_at, created_at, class_id')
    .eq('teacher_user_id', uid).eq('quiz_id', quizId).is('invited_by_student_id', null);
  if (error) throw new Error(error.message || 'share code read failed');
  const live = (data || []).filter((c) => c.active !== false && (!c.expires_at || new Date(c.expires_at).getTime() > now));
  live.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return live[0] || null;
}

/** The quiz's questions in order (text + first option): the preview, the count and the question language. */
async function questionsOfQuiz(quizId) {
  const { data, error } = await supabase.from('quiz_questions').select('question_text, option_a, sort_order')
    .eq('quiz_id', quizId).order('sort_order', { ascending: true }).limit(200);
  if (error) throw new Error(error.message || 'questions read failed');
  return data || [];
}

/**
 * The class message for a held code — ONE builder for the make and for "Send to class group", so the two are the
 * same bytes. The link exactly as the chat share builds it (the web page when it is on for this teacher, else wa.me).
 */
async function classMessage({ uid, language, held, quizId, qlang }) {
  const Share = require('../quiz/video-quiz-share.service');
  const link = await require('../quiz/web-quiz-link').quizLink(held.code, {
    teacherUserId: uid, whatsapp: `https://wa.me/${Share.botNumber()}?text=QUIZ-${held.code}`, quizId,
  });
  const teacher = held.teacher_name || resolveUx('tqYourTeacher', { language });
  const topic = held.topic || resolveUx('vqTodaysVideo', { language });
  const base = resolveUx('vqClassMessage', { language, params: { teacher, topic, link } });
  return qlang ? `${base}\n\n${str(`class.lang.${qlang}`, language)}` : base;
}
const messageLanguage = (lang) => clampLanguage(lang === 'bi' ? 'ur' : lang);

async function make({ uid, lang, grade, subject, quizId, now = Date.now() } = {}) {
  if (typeof uid !== 'string' || !uid) return { error: 400 };
  const quiz = await liveQuiz({ grade, subject, quizId });
  if (!quiz) return { error: 400 };
  const language = messageLanguage(lang);
  const Share = require('../quiz/video-quiz-share.service');

  let held = await heldCode(uid, quiz.id, now);
  let minted = false;
  if (!held) {
    const HandoutClass = require('../quiz/handout-class.service');
    const resolved = await HandoutClass.resolveClass({ teacherUserId: uid, quizId: quiz.id });
    const m = await Share.mintCode({ quizId: quiz.id, userId: uid, videoId: quiz.video_id, language, classId: HandoutClass.classIdToMint(resolved) });
    if (!m) return { error: 503 };
    held = { id: m.id, code: m.code, teacher_name: m.teacherName, topic: m.topic };
    minted = true;
    // today's event, today's fields (as the chat share emits it after its mint)
    logEvent('video_quiz.share_code_minted', { userId: uid, quizId: quiz.id, code: m.code, classBound: Boolean(m.classId) });
  }

  const questions = await questionsOfQuiz(quiz.id);
  const qlang = qlangFor(quiz.language, questions);
  const message = await classMessage({ uid, language, held, quizId: quiz.id, qlang });
  const preview = (questions[0] && questions[0].question_text) || null;
  return { shareCodeId: held.id, message, qlang, preview, total: questions.length, minted };
}

/** The make's message again, for this teacher's own share code; null when the code is not theirs or not live. */
async function shareMessage({ uid, lang, shareCodeId, now = Date.now() } = {}) {
  if (typeof uid !== 'string' || !uid || typeof shareCodeId !== 'string') return null;
  const { data: held, error } = await supabase.from('quiz_share_codes')
    .select('id, code, quiz_id, teacher_user_id, teacher_name, topic, active, expires_at').eq('id', shareCodeId).maybeSingle();
  if (error) throw new Error(error.message || 'share code read failed');
  if (!held || held.teacher_user_id !== uid || !held.quiz_id) return null;
  if (held.active === false || (held.expires_at && new Date(held.expires_at).getTime() <= now)) return null;
  const { data: quiz, error: qErr } = await supabase.from('quizzes')
    .select('id, grade, subject, language').eq('id', held.quiz_id).maybeSingle();
  if (qErr) throw new Error(qErr.message || 'quiz read failed');
  if (!quiz) return null;
  const qlang = qlangFor(quiz.language, await questionsOfQuiz(quiz.id));
  const message = await classMessage({ uid, language: messageLanguage(lang), held, quizId: quiz.id, qlang });
  return { message, quizId: quiz.id, grade: gradeOf(quiz.grade), subject: subjectCode(quiz.subject), qlang };
}

module.exports = { chipTree, chipOf, make, shareMessage, subjectCode, GRADES, TREE_TTL_MS, _resetCache: () => { cache = null; } };
