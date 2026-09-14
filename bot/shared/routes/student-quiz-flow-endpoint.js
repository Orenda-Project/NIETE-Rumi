'use strict';
/**
 * The CHILD's /quiz Flow endpoint (bd-2yyry.13) — docs/flows/student-quiz-flow.json.
 *
 * Separate from the teacher's transcript-quiz endpoint in every layer: its own
 * route (/api/flows/student-quiz), its own token (the childpick: shape from
 * child-flow-token.js — phone, share code, student, language), its own
 * discriminator (sq_action), its own strings (sq*). Nothing here reads or
 * writes a teacher's quizzes, and a teacher never receives this Flow.
 *
 *   INIT                      → QUIZZES: the quizzes taken on this handset
 *   data_exchange step=quiz   → QUIZ: latest / best attempt, class average, the two actions
 *   data_exchange step=action → the action runs AFTER the screen closes (Meta's
 *                               ten-second budget; same discipline as the teacher
 *                               endpoint's runAfterResponse) and the Flow closes
 *                               with SUCCESS; the chat carries the result
 *   BACK                      → QUIZZES again
 */
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const ChildFlowToken = require('../services/quiz/child-flow-token');
const StudentQuiz = require('../services/quiz/student-quiz.service');

const TITLE_MAX = 30;
const DESC_MAX = 20;
const META_MAX = 80;
const cp = (s) => [...String(s || '')].length;
const fit = (s, max) => (cp(s) <= max ? String(s || '') : `${[...String(s)].slice(0, max - 1).join('')}…`);

function resolveChild(flowToken) {
  const child = ChildFlowToken.parse(flowToken);
  if (!child) return null;
  return { ...child, language: clampLanguage(child.language || 'en') };
}

function dateLabel(iso, language) {
  try {
    const { formatLessonDate } = require('../services/quiz/transcript-quiz-language');
    return formatLessonDate(iso, language);
  } catch { return String(iso || '').slice(0, 10); }
}

function scoreOf(s) {
  return s ? `${s.correct_answers || 0}/${s.total_questions_answered || 0}` : '—';
}

function doneScreen(kind, language) {
  const copy = kind === 'empty' ? ['sqDoneEmptyHeading', 'sqDoneEmptyBody'] : ['sqDoneErrHeading', 'sqDoneErrBody'];
  logEvent('student_quiz.flow_closed', { kind });
  return {
    screen: 'DONE',
    data: {
      screen_title: resolveUx('sqScreenQuizzes', { language }),
      heading: resolveUx(copy[0], { language }),
      body: resolveUx(copy[1], { language }),
      close: resolveUx('sqClose', { language }),
      kind,
    },
  };
}

/** A NavigationList must not be empty: one row that says so, and re-serves the list on tap. */
function emptyItem(language) {
  return {
    id: '__empty__',
    'main-content': {
      title: fit(resolveUx('sqDoneEmptyHeading', { language }), TITLE_MAX),
      description: '',
      metadata: fit(resolveUx('sqDoneEmptyBody', { language }), META_MAX),
    },
    'on-click-action': { name: 'data_exchange', payload: { step: 'quiz', share_code_id: '__empty__' } },
  };
}

async function renderQuizzesScreen(child, extra = {}) {
  const language = child.language;
  const quizzes = child.phone ? await StudentQuiz.quizzesForHandset(child.phone) : [];
  if (!quizzes.length) {
    logEvent('student_quiz.flow_empty', { studentId: child.studentId || null });
    return { screen: 'QUIZZES', data: { screen_title: resolveUx('sqScreenQuizzes', { language }), items: [emptyItem(language)], ...extra } };
  }
  const items = quizzes.map((q) => ({
    id: q.shareCodeId,
    'main-content': {
      title: fit(q.topic || resolveUx('sqUntitled', { language }), TITLE_MAX),
      description: fit(resolveUx('sqRowScores', { language, params: { latest: scoreOf(q.latest), best: scoreOf(q.best) } }), DESC_MAX),
      metadata: fit([dateLabel(q.lastAt, language), q.className, q.studentName].filter(Boolean).join(' · '), META_MAX),
    },
    'on-click-action': { name: 'data_exchange', payload: { step: 'quiz', share_code_id: q.shareCodeId } },
  }));
  return {
    screen: 'QUIZZES',
    data: { screen_title: resolveUx('sqScreenQuizzes', { language }), items, ...extra },
  };
}

async function renderQuizScreen(child, screenData) {
  const language = child.language;
  const shareCodeId = String((screenData && screenData.share_code_id) || '');
  const quizzes = await StudentQuiz.quizzesForHandset(child.phone);
  const q = quizzes.find((x) => x.shareCodeId === shareCodeId);
  if (!q) return renderQuizzesScreen(child, { error_message: resolveUx('sqErrGone', { language }) });

  let average = null;
  try {
    const report = require('../services/quiz/video-quiz-report.service');
    const cls = await report.loadClassRows(shareCodeId);
    if (cls && cls.rows.length) {
      average = Math.round(cls.rows.reduce((s, r) => s + (Number(r.pct) || 0), 0) / cls.rows.length);
    }
  } catch (err) {
    logToFile('⚠️ student-quiz flow: class average unavailable', { error: err.message });
  }
  const lines = [
    resolveUx('sqYourLatest', { language, params: { score: scoreOf(q.latest) } }),
    q.best ? resolveUx('sqYourBest', { language, params: { score: scoreOf(q.best) } }) : null,
    average !== null ? resolveUx('sqClassAverage', { language, params: { n: average } }) : null,
  ].filter(Boolean);
  const actions = [];
  if (q.active) actions.push({ id: 'retry', title: resolveUx('sqActionRetry', { language }), description: resolveUx('sqActionRetryDesc', { language }) });
  if (q.latest) actions.push({ id: 'card', title: resolveUx('sqActionCard', { language }), description: resolveUx('sqActionCardDesc', { language }) });
  if (!actions.length) return renderQuizzesScreen(child, { error_message: resolveUx('sqErrNothingToDo', { language }) });
  return {
    screen: 'QUIZ',
    data: {
      screen_title: fit(q.topic || resolveUx('sqUntitled', { language }), TITLE_MAX),
      heading: q.topic || resolveUx('sqUntitled', { language }),
      subline: [dateLabel(q.lastAt, language), q.className].filter(Boolean).join(' · '),
      results: lines.join('\n'),
      actions_label: resolveUx('sqActionsLabel', { language }),
      actions,
      cta: resolveUx('sqCta', { language }),
      session_id: String((q.latest && q.latest.id) || ''),
      share_code_id: q.shareCodeId,
    },
  };
}

function runAfterResponse(action, shareCodeId, fn) {
  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .then((ok) => logEvent('student_quiz.flow_action_done', { action, shareCodeId, ok: Boolean(ok) }))
      .catch((err) => {
        logToFile('❌ student-quiz flow: action failed after response', { action, shareCodeId, error: err.message }, 'error');
        logEvent('student_quiz.flow_action_done', { action, shareCodeId, ok: false, error: err.message });
      });
  });
}

async function stepAction(child, screenData) {
  const language = child.language;
  const action = String((screenData && screenData.sq_action) || '').trim();
  const shareCodeId = String((screenData && screenData.share_code_id) || '');
  if (!['retry', 'card'].includes(action) || !shareCodeId) {
    return renderQuizzesScreen(child, { error_message: resolveUx('sqErrGeneric', { language }) });
  }
  const quizzes = await StudentQuiz.quizzesForHandset(child.phone);
  const q = quizzes.find((x) => x.shareCodeId === shareCodeId);
  if (!q) return doneScreen('error', language);

  const ctx = { shareCodeId, studentId: q.studentId, code: q.code, active: q.active, language: q.language || language };
  runAfterResponse(action, shareCodeId, () => (action === 'retry'
    ? StudentQuiz.retry(child.phone, ctx)
    : StudentQuiz.sendCard(child.phone, ctx)));
  logEvent('student_quiz.flow_closed', { kind: action, shareCodeId });
  return {
    screen: 'SUCCESS',
    data: { extension_message_response: { params: { sq_action: action } } },
  };
}

const NOBODY = { phone: null, studentId: null, language: clampLanguage(null) };

async function handleStudentQuizInit(flowToken) {
  const child = resolveChild(flowToken);
  if (!child) {
    // INIT may only answer with an entry screen: the empty list with the error line.
    logToFile('⚠️ student-quiz flow: not a child token', { hasToken: Boolean(flowToken) });
    return renderQuizzesScreen(NOBODY, { error_message: resolveUx('sqErrGeneric', { language: NOBODY.language }) });
  }
  logEvent('student_quiz.flow_opened', { studentId: child.studentId });
  return renderQuizzesScreen(child);
}

async function handleStudentQuizDataExchange(flowToken, screen, screenData) {
  const child = resolveChild(flowToken);
  if (!child) return renderQuizzesScreen(NOBODY, { error_message: resolveUx('sqErrGeneric', { language: NOBODY.language }) });
  const step = String((screenData && screenData.step) || '');
  logEvent('student_quiz.flow_payload', {
    studentId: child.studentId, step, screen: String(screen || ''),
    keys: Object.keys(screenData || {}).sort().join(','),
  });
  try {
    if (step === 'quiz') return await renderQuizScreen(child, screenData);
    if (step === 'action') return await stepAction(child, screenData);
  } catch (err) {
    logToFile('❌ student-quiz flow: step threw', { step, screen, error: err.message }, 'error');
    return renderQuizzesScreen(child, { error_message: resolveUx('sqErrGeneric', { language: child.language }) });
  }
  logToFile('⚠️ student-quiz flow: unknown step', { step, screen });
  return renderQuizzesScreen(child, { error_message: resolveUx('sqErrGeneric', { language: child.language }) });
}

async function handleStudentQuizBack(flowToken) {
  const child = resolveChild(flowToken);
  if (!child) return renderQuizzesScreen(NOBODY, { error_message: resolveUx('sqErrGeneric', { language: NOBODY.language }) });
  return renderQuizzesScreen(child);
}

module.exports = {
  handleStudentQuizInit, handleStudentQuizDataExchange, handleStudentQuizBack,
  renderQuizzesScreen, renderQuizScreen, stepAction, doneScreen,
};
