'use strict';
/**
 * The quiz-maker page's bank: the chip tree it offers, and the make.
 *
 * chipTree() → { '<grade>': { '<subject code>': [{ quizId, topic, qlang }] } }, built from the live video bank:
 * quizzes (quiz_source 'video', status 'ready', grade '1'–'5') whose video is live (student_videos.superseded_by IS
 * NULL). Subjects map to codes by the first-touch table (anything else is dropped); a cell exists only when a quiz
 * does; two quizzes under one topic string in a cell → the one on the newest live video. `qlang` is
 * quizzes.language ('en' | 'ur', else null). Held in memory for 10 minutes; a failed read throws.
 *
 * make({ uid, lang, grade, subject, quizId }) re-checks the quiz id against the bank (a live, ready video quiz in
 * that grade and subject; else { error: 400 }, nothing minted), reuses an unexpired code this teacher already holds
 * for this quiz, else mints ONE quiz_share_codes row through today's mintCode (the class bound only when it is known;
 * the "which class?" chat question is never asked from here). The message is today's vqClassMessage, exactly as the
 * chat share builds it, plus the question-language line when quizzes.language is known. No other table is written.
 * → { shareCodeId, message, qlang, preview, minted } | { error: 400 } | { error: 503 }.
 */
const supabase = require('../../config/supabase');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { str } = require('./maker.strings');

const TREE_TTL_MS = 10 * 60 * 1000;
const PAGE = 1000;
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
const QLANGS = Object.freeze(['en', 'ur']);
const qlangOf = (v) => (QLANGS.includes(v) ? v : null);

// ─── the chip tree ───────────────────────────────────────────────────────────────────────────────────────────────

async function pages(build) {
  const out = [];
  let after = null;
  for (let i = 0; i < 20; i += 1) {
    let q = build();
    if (after) q = q.gt('id', after);
    const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
    if (error) throw new Error(error.message || 'bank read failed');
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
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
  const tree = {};
  for (const { quiz, grade, subject, topic } of best.values()) {
    tree[grade] = tree[grade] || {};
    (tree[grade][subject] = tree[grade][subject] || []).push({ quizId: quiz.id, topic, qlang: qlangOf(quiz.language) });
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

async function firstQuestion(quizId) {
  const { data } = await supabase.from('quiz_questions').select('question_text, sort_order')
    .eq('quiz_id', quizId).order('sort_order', { ascending: true }).limit(1);
  return (data && data[0] && data[0].question_text) || null;
}

async function make({ uid, lang, grade, subject, quizId, now = Date.now() } = {}) {
  if (typeof uid !== 'string' || !uid) return { error: 400 };
  const quiz = await liveQuiz({ grade, subject, quizId });
  if (!quiz) return { error: 400 };
  const language = clampLanguage(lang === 'bi' ? 'ur' : lang);
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

  // The link exactly as the chat share builds it: the web page when it is on for this teacher, else wa.me.
  const link = await require('../quiz/web-quiz-link').quizLink(held.code, {
    teacherUserId: uid, whatsapp: `https://wa.me/${Share.botNumber()}?text=QUIZ-${held.code}`, quizId: quiz.id,
  });
  const teacher = held.teacher_name || resolveUx('tqYourTeacher', { language });
  const topic = held.topic || resolveUx('vqTodaysVideo', { language });
  const qlang = qlangOf(quiz.language);
  const base = resolveUx('vqClassMessage', { language, params: { teacher, topic, link } });
  const message = qlang ? `${base}\n\n${str(`class.lang.${qlang}`, language)}` : base;
  return { shareCodeId: held.id, message, qlang, preview: await firstQuestion(quiz.id), minted };
}

module.exports = { chipTree, chipOf, make, subjectCode, GRADES, TREE_TTL_MS, _resetCache: () => { cache = null; } };
