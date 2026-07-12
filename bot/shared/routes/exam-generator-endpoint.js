'use strict';
/**
 * Exam Generator Flow endpoint handler.
 *
 * Three screens (see docs/flows/exam-generator-flow.json):
 *   TYPE_SELECT     → user picks WEEKLY | TERM
 *   GRADE_SUBJECT   → user picks grade / subject / language
 *   CHAPTERS        → user picks 1+ chapters and taps "Generate exam"
 *   SUCCESS         → terminal, hands control back to the bot
 *
 * State between screens is stored in Redis keyed by flow_token
 * (WhatsApp opaque session id). Each screen looks up its predecessors'
 * choices from that key before deciding what to show next.
 *
 * On the final submit we queue an EXAM_GENERATE job so the actual
 * compose+render+deliver runs off the webhook thread.
 */

const { logToFile } = require('../utils/logger');
const supabase = require('../config/supabase');
const redis = require('../services/cache/railway-redis.service');
const SQSQueueService = require('../services/queue');

const SESSION_TTL_SECONDS = 15 * 60; // 15 min — teacher won't spend longer

function sessionKey(flowToken) {
  return `exam_flow:${flowToken || 'no-token'}`;
}

async function readSession(flowToken) {
  try {
    const raw = await redis.get(sessionKey(flowToken));
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    logToFile('[exam-flow] session read failed', { err: e.message });
    return {};
  }
}

async function writeSession(flowToken, state) {
  try {
    await redis.set(sessionKey(flowToken), JSON.stringify(state), SESSION_TTL_SECONDS);
  } catch (e) {
    logToFile('[exam-flow] session write failed', { err: e.message });
  }
}

async function clearSession(flowToken) {
  try {
    await redis.delete(sessionKey(flowToken));
  } catch (_e) { /* not fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// data loaders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grade / subject options — distinct values from the imported bank.
 *
 * PostgREST caps `.limit(N)` at max-rows (1000 by default on Supabase),
 * so a naive `.select('grade').limit(5000)` client-side-dedup returns
 * only whatever grade dominates the first 1000 rows. `.range(0, 49999)`
 * bypasses that cap for the read; we then dedup in JS. Fine at NIETE's
 * ~35k bank size; if the bank grows past 100k, replace with a SQL view.
 *
 * Also: grade values in the bank already look like "Grade Five" — don't
 * double-prefix "Grade " onto them.
 */
async function loadGradeOptions() {
  const { data, error } = await supabase
    .from('exam_question_bank')
    .select('grade')
    .range(0, 49999);
  if (error || !data || data.length === 0) {
    return [
      { id: 'Grade One',   title: 'Grade One' },
      { id: 'Grade Two',   title: 'Grade Two' },
      { id: 'Grade Three', title: 'Grade Three' },
      { id: 'Grade Four',  title: 'Grade Four' },
      { id: 'Grade Five',  title: 'Grade Five' },
    ];
  }
  const uniq = [...new Set(data.map(r => String(r.grade)))].sort();
  return uniq.map(g => ({ id: g, title: g }));
}

async function loadSubjectOptions() {
  const { data, error } = await supabase
    .from('exam_question_bank')
    .select('subject')
    .range(0, 49999);
  if (error || !data || data.length === 0) {
    return [
      { id: 'Math',        title: 'Math' },
      { id: 'English',     title: 'English' },
      { id: 'Urdu',        title: 'Urdu' },
    ];
  }
  const uniq = [...new Set(data.map(r => r.subject))].sort();
  return uniq.map(s => ({ id: s, title: s }));
}

async function loadChapterOptions(grade, subject, language) {
  const { data, error } = await supabase
    .from('exam_question_bank')
    .select('chapter_index, chapter_title')
    .eq('grade', grade)
    .eq('subject', subject)
    .eq('language', language)
    .order('chapter_index', { ascending: true })
    .range(0, 49999);
  if (error) {
    logToFile('[exam-flow] chapter load failed', { err: error.message });
    return [];
  }
  const byIdx = new Map();
  for (const r of data || []) {
    if (!byIdx.has(r.chapter_index)) {
      byIdx.set(r.chapter_index, r.chapter_title);
    }
  }
  return [...byIdx.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, title]) => ({
      id: String(idx),
      title: `Ch ${idx}: ${title}`,
    }));
}

async function loadTeacherPreferredLanguage(userId) {
  try {
  
    const { data } = await supabase
      .from('users')
      .select('preferred_language')
      .eq('id', userId)
      .single();
    const pref = String(data?.preferred_language || '').toLowerCase();
    return pref === 'ur' ? 'ur' : 'en';
  } catch (_e) {
    return 'en';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// screen builders
// ─────────────────────────────────────────────────────────────────────────────

function typeSelectScreen() {
  return { screen: 'TYPE_SELECT', data: {} };
}

async function gradeSubjectScreen(userId) {
  const [grades, subjects, defaultLanguage] = await Promise.all([
    loadGradeOptions(),
    loadSubjectOptions(),
    loadTeacherPreferredLanguage(userId),
  ]);
  return {
    screen: 'GRADE_SUBJECT',
    data: {
      grade_options: grades,
      subject_options: subjects,
      language_options: [
        { id: 'en', title: 'English' },
        { id: 'ur', title: 'Urdu' },
      ],
      default_language: defaultLanguage,
    },
  };
}

async function chaptersScreen(grade, subject, language) {
  const chapters = await loadChapterOptions(grade, subject, language);
  if (chapters.length === 0) {
    return {
      screen: 'CHAPTERS',
      data: {
        chapter_options: [
          { id: '0', title: 'No chapters yet — please try a different grade/subject/language' },
        ],
      },
    };
  }
  return { screen: 'CHAPTERS', data: { chapter_options: chapters } };
}

function successScreen(message, flowToken) {
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: { flow_token: flowToken || 'exam-generator' },
      },
      message,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// public handlers (mirroring the pattern used by other endpoints)
// ─────────────────────────────────────────────────────────────────────────────

async function handleExamGeneratorInit(userId, flowToken) {
  logToFile('📝 Exam Flow INIT', { userId, flowToken });
  await clearSession(flowToken); // fresh start
  return typeSelectScreen();
}

async function handleExamGeneratorDataExchange(userId, screen, screenData, flowToken) {
  logToFile('📝 Exam Flow data_exchange', { userId, screen, action: screenData?._action, flowToken });
  const state = await readSession(flowToken);

  if (screen === 'TYPE_SELECT') {
    if (screenData._action !== 'select_type') return typeSelectScreen();
    state.exam_type = screenData.exam_type === 'TERM' ? 'TERM' : 'WEEKLY';
    await writeSession(flowToken, state);
    return await gradeSubjectScreen(userId);
  }

  if (screen === 'GRADE_SUBJECT') {
    if (screenData._action !== 'select_grade_subject') return await gradeSubjectScreen(userId);
    state.grade = String(screenData.grade || '').trim();
    state.subject = String(screenData.subject || '').trim();
    state.language = screenData.language === 'ur' ? 'ur' : 'en';
    await writeSession(flowToken, state);
    return await chaptersScreen(state.grade, state.subject, state.language);
  }

  if (screen === 'CHAPTERS') {
    if (screenData._action !== 'generate') {
      return await chaptersScreen(state.grade, state.subject, state.language);
    }
    // Parse chapter selection — flow may send array or comma-separated string.
    let chapters = screenData.chapters;
    if (typeof chapters === 'string') {
      chapters = chapters.split(',').map(s => s.trim());
    }
    if (!Array.isArray(chapters)) chapters = [];
    const chapterInts = chapters
      .map(v => parseInt(v, 10))
      .filter(n => Number.isFinite(n) && n > 0);

    if (chapterInts.length === 0 || !state.exam_type || !state.grade || !state.subject) {
      return { screen: 'CHAPTERS', data: {
        chapter_options: [{ id: '0', title: 'Please pick at least one chapter' }],
      }};
    }

    // Queue the actual work off the webhook thread. groupId = userId per the
    // SQSQueueService convention (see homework-request-endpoint for reference).
    try {
      await SQSQueueService.queueJob(
        userId,
        'exam_generate',
        {
          userId,
          type: state.exam_type,
          grade: state.grade,
          subject: state.subject,
          language: state.language,
          chapters: chapterInts,
        }
      );
    } catch (err) {
      logToFile('[exam-flow] queueJob failed', { err: err.message });
      return successScreen('Something went wrong queueing your exam. Please try again.', flowToken);
    }

    await clearSession(flowToken);

    const chaptersLabel = chapterInts.length === 1
      ? `Chapter ${chapterInts[0]}`
      : `Chapters ${chapterInts.join(', ')}`;
    const typeLabel = state.exam_type === 'WEEKLY' ? 'weekly test' : 'term exam';
    return successScreen(
      `Making your Grade ${state.grade} ${state.subject} ${typeLabel} on ${chaptersLabel}. ~30 sec…`,
      flowToken
    );
  }

  logToFile('⚠️ Unknown screen in exam flow', { screen });
  return typeSelectScreen();
}

async function handleExamGeneratorBack(userId, flowToken /*, screen */) {
  logToFile('📝 Exam Flow BACK', { userId, flowToken });
  // Simple UX: always send them back to TYPE_SELECT. Better than trying to
  // reconstruct a partial forward path when the user's state may have gaps.
  return typeSelectScreen();
}

module.exports = {
  handleExamGeneratorInit,
  handleExamGeneratorDataExchange,
  handleExamGeneratorBack,
};
