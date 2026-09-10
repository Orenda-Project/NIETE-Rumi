'use strict';
/**
 * Transcript Quiz Flow endpoint — `/quiz` as ONE coherent WhatsApp Flow.
 *
 * Screens: LESSONS → LESSON → DONE (`docs/flows/transcript-quiz-flow.json`).
 * Every step is a `data_exchange`, so the teacher never drops back into the
 * chat mid-task: paging answers with the SAME `LESSONS` screen and the next
 * slice, a lesson tap answers with that lesson's live results and the actions
 * that apply to it, and the only way out is the terminal DONE screen or the
 * Flow's own back arrow.
 *
 * META'S CAPS, MEASURED NOT GUESSED (Flow JSON reference, NavigationList; the
 * numbers this module's layout depends on, written down so nobody re-derives
 * them from a rendered screen):
 *   NavigationList        max 20 list-items · at most 2 per screen · may NOT
 *                         share a screen with any other component type, and may
 *                         not sit on a terminal screen.
 *   list item main-content  title 30 · description 20 · metadata 80 code points
 *   TextHeading 80 · TextBody 4096 · Footer label 35
 *   RadioButtonsGroup option  title 30 · description 300
 *
 * The item description is 20 — a quarter of a WhatsApp list row's 72 — so the
 * lesson's FULL topic lives in the 80-code-point `metadata` slot and the short
 * status lives in `description`. That is the one place this module departs from
 * the round-6 plan's wording ("description = the full topic"): the plan assumed
 * the NavigationList description was larger than a list row's, and it is not.
 *
 * NOTHING IS FORKED FROM THE LIST MESSAGE. Eligibility, the counts (self-test
 * excluded, R5 D8), the state taxonomy and the claim/enqueue write all come
 * from `transcript-quiz-list.service.js`; only the field layout is this file's.
 * The list-message path stays live and stays tested — the Flow is additive and
 * TRANSCRIPT_QUIZ_FLOW_ID is its on/off switch.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const { LANGUAGE_OFFER, getLanguage } = require('../config/languages');
const List = require('../services/quiz/transcript-quiz-list.service');
const { normaliseTopic, truncateWords, isolateIfMixed, composeTitle } = require('../services/quiz/transcript-quiz-rows');
const {
  teacherLanguageFor, formatLessonDate, subjectLabel, quizLanguageFor, needsLanguageAsk,
} = require('../services/quiz/transcript-quiz-language');
const { excludeSelfTests } = require('../services/quiz/teacher-self-test');

// Meta's NavigationList caps.
const NAV_MAX_ITEMS = 20;
const TITLE_MAX = 30;
const DESC_MAX = 20;
const META_MAX = 80;
// Two slots are reserved for "Newer lessons…" / "Older lessons…" so a page
// never has to drop a lesson to make room for its own paging row.
const PER_PAGE = NAV_MAX_ITEMS - 2;
// A class bigger than this is summarised — a TextBody holds 4,096 code points
// and forty lines is already more than anyone reads on a phone.
const MAX_STUDENT_LINES = 40;
const HEADING_MAX = 80;

const NEWER_ID = '__newer__';
const OLDER_ID = '__older__';
const EMPTY_ID = '__empty__';

// LEFT-TO-RIGHT ISOLATE / POP DIRECTIONAL ISOLATE — for an atom whose content
// is unambiguously Latin-ordered (a score, a fraction, a per-cent) sitting
// inside prose that may be right-to-left.
const LRI = '\u2066';
const PDI = '\u2069';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const cp = (s) => [...String(s || '')].length;

/** Fit `text` to `max` code points, keeping room for the bidi isolates the
 *  other script needs (the cost is 0 or 2 — see transcript-quiz-rows.js). */
function fitIsolated(text, max, language) {
  const raw = String(text || '');
  const isolated = isolateIfMixed(raw, language);
  const cost = cp(isolated) - cp(raw);
  return isolateIfMixed(truncateWords(raw, max - cost), language);
}

/** The lesson's state in the 20-code-point description slot. */
function flowStatus(quiz, language, counts) {
  const c = counts || { started: 0, finished: 0 };
  switch (List.quizState(quiz)) {
    case 'offered': return resolveUx('tqFlowStatusOffered', { language });
    case 'making': return resolveUx('tqFlowStatusMaking', { language });
    case 'sent': return resolveUx('tqFlowStatusSent', { language, params: { started: c.started } });
    case 'report_sent': return resolveUx('tqFlowStatusReport', { language, params: { finished: c.finished } });
    case 'failed': return resolveUx('tqFlowStatusFailed', { language });
    default: return resolveUx('tqFlowStatusNone', { language });
  }
}

function topicOf(quiz, session, language) {
  return normaliseTopic(
    quiz?.topic || session?.analysis_data?.topic || resolveUx('tqLessonWord', { language }),
  );
}

/** The teacher behind a `<userId>:transcript-quiz:<ts>` token. */
async function resolveTeacher(flowToken) {
  const userId = String(flowToken || '').split(':')[0];
  if (!userId) return { teacher: null, error: null };
  const { data, error } = await supabase.from('users')
    .select('id, phone_number, preferred_language').eq('id', userId).maybeSingle();
  // A lookup that FAILED is not a teacher that does not exist. Seen live on
  // staging 2026-09-06: the deployed endpoint answered "could not be found"
  // for valid teachers while the same query succeeded everywhere else, and
  // the swallowed error was the only evidence — so it is logged, counted and
  // answered with retry copy, never with the not-found line.
  return { teacher: data || null, error: error ? String(error.message || error) : null };
}

/** The LESSONS screen with the retry line, after the lookup itself failed. */
function lookupFailedScreen(error, extra = {}) {
  const language = clampLanguage(null);
  logToFile('❌ transcript quiz flow: teacher lookup failed', { error, ...extra }, 'error');
  logEvent('transcript_quiz.flow_lookup_failed', { error, ...extra });
  return lessonsScreen(null, 1, { error_message: resolveUx('tqFlowErrLookup', { language }) });
}

// ---------------------------------------------------------------------------
// LESSONS
// ---------------------------------------------------------------------------

function emptyItem(language) {
  return {
    id: EMPTY_ID,
    'main-content': {
      title: resolveUx('tqFlowEmptyTitle', { language }),
      description: resolveUx('tqFlowEmptyDesc', { language }),
      metadata: resolveUx('tqFlowEmptyMeta', { language }),
    },
    // Tapping it just asks for page 1 again — a lesson recorded since the Flow
    // opened shows up, and nothing is a dead end.
    'on-click-action': { name: 'data_exchange', payload: { step: 'page', page: 1 } },
  };
}

/**
 * One page of the teacher's lessons as NavigationList items.
 * Returns the full LESSONS screen response.
 */
async function lessonsScreen(teacher, page, extra = {}) {
  const language = teacherLanguageFor({ preferredLanguage: teacher?.preferred_language });
  const base = {
    screen: 'LESSONS',
    data: { screen_title: resolveUx('tqFlowLessonsTitle', { language }), items: [emptyItem(language)], ...extra },
  };
  if (!teacher?.id) return base;

  const p = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
  const { sessions } = await List.loadEligibleSessions(teacher.id, p * PER_PAGE + 1);
  const sorted = [...(sessions || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = sorted.length;
  let start = (p - 1) * PER_PAGE;
  let pageNo = p;
  // A Flow left open while lessons were deleted can ask for a page that no
  // longer exists. The teacher meant "show me more lessons", so they get the
  // list — never "no lessons yet".
  if (start >= total && total > 0) { start = 0; pageNo = 1; }
  const slice = sorted.slice(start, start + PER_PAGE);
  if (!slice.length) return base;

  const ids = slice.map((s) => s.id);
  const { data: quizRows } = await supabase.from('quizzes')
    .select('id, coaching_session_id, status, topic, subject, meta')
    .eq('teacher_id', teacher.id).eq('quiz_source', 'transcript').in('coaching_session_id', ids);
  const quizzes = quizRows || [];
  const counts = await List.countsFor(
    quizzes.filter((q) => ['sent', 'report_sent'].includes(q.status)).map((q) => q.id),
    teacher.id,
  );
  const byId = new Map(quizzes.map((q) => [q.coaching_session_id, q]));

  const items = slice.map((s) => {
    const quiz = byId.get(s.id) || null;
    const subject = subjectLabel(quiz?.subject || s.analysis_data?.subject, language);
    const date = formatLessonDate(s.created_at, language);
    return {
      id: s.id,
      'main-content': {
        title: composeTitle({ date, subject }, TITLE_MAX),
        description: truncateWords(flowStatus(quiz, language, quiz && counts.get(quiz.id)), DESC_MAX),
        metadata: fitIsolated(topicOf(quiz, s, language), META_MAX, language),
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'lesson', session_id: s.id } },
    };
  });

  if (pageNo > 1) {
    items.unshift({
      id: NEWER_ID,
      'main-content': {
        title: resolveUx('tqFlowNewer', { language }),
        description: resolveUx('tqFlowPageNum', { language, params: { page: pageNo - 1 } }),
        metadata: truncateWords(resolveUx('tqFlowNewerMeta', { language, params: { n: PER_PAGE } }), META_MAX),
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'page', page: pageNo - 1 } },
    });
  }
  if (total > start + PER_PAGE) {
    items.push({
      id: OLDER_ID,
      'main-content': {
        title: resolveUx('tqFlowOlder', { language }),
        description: resolveUx('tqFlowPageNum', { language, params: { page: pageNo + 1 } }),
        metadata: truncateWords(resolveUx('tqFlowOlderMeta', { language, params: { n: PER_PAGE } }), META_MAX),
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'page', page: pageNo + 1 } },
    });
  }

  return {
    screen: 'LESSONS',
    data: { screen_title: resolveUx('tqFlowLessonsTitle', { language }), items, ...extra },
  };
}

// ---------------------------------------------------------------------------
// LESSON
// ---------------------------------------------------------------------------

/** The teacher's lesson + its quiz + the children who took it. Never another
 *  teacher's: both reads are filtered on the owner, not checked afterwards. */
async function loadLesson(teacher, sessionId) {
  if (!teacher?.id || !sessionId) return null;
  const { data: session } = await supabase.from('coaching_sessions')
    .select('id, user_id, created_at, transcript_text, transcript_language, analysis_data')
    .eq('id', sessionId).eq('user_id', teacher.id).maybeSingle();
  if (!session) return null;
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, coaching_session_id, status, topic, subject, language, meta')
    .eq('coaching_session_id', sessionId).eq('teacher_id', teacher.id)
    .eq('quiz_source', 'transcript').maybeSingle();
  return { session, quiz: quiz || null };
}

/** Every child who took this quiz, the teacher's own test run removed. */
async function loadStudents(quizId, teacherUserId) {
  if (!quizId) return [];
  const { data } = await supabase.from('quiz_sessions')
    .select('id, user_id, student_name, student_class, status, total_questions_answered, '
            + 'correct_answers, mastery_percentage')
    .eq('quiz_id', quizId)
    .is('invited_by_student_id', null);
  return excludeSelfTests(data || [], teacherUserId);
}

/**
 * `• Ayesha (5-A) — 7/8 (88%)`.
 *
 * A child's name and class are the one thing on this screen whose script is
 * not knowable: an Urdu name sits in an English teacher's results and vice
 * versa. Both are isolated, so the bullet, the brackets and the score stay on
 * the side of the line they belong to (language-protocol §9.2). The brackets
 * are punctuation, not copy, so they live here rather than in the catalog.
 */
function studentLine(s, language) {
  const name = isolateIfMixed(s.student_name || resolveUx('tqFlowUnnamed', { language }), language);
  const klass = s.student_class ? ` (${isolateIfMixed(s.student_class, language)})` : '';
  // `8/8 (100%)` is one LEFT-TO-RIGHT atom. Un-isolated, after an Urdu name it
  // renders as `(%100) 8/8` — the per-cent sign and the brackets migrate,
  // because UAX#9 gives digits following an Arabic-class letter the Arabic
  // Number class and then orders the run right-to-left. A Latin name on the
  // very next line renders correctly, so half the class reads wrong and half
  // reads right. LRI…PDI settles it (language-protocol §9.2/§9.3).
  const score = `${LRI}${s.correct_answers || 0}/${s.total_questions_answered || 0}`
    + ` (${s.mastery_percentage || 0}%)${PDI}`;
  return resolveUx('tqFlowStudentLine', { language, params: { name, klass, score } });
}

/** The live results block, in the teacher's language. */
function resultsText(state, students, language) {
  if (state === 'making') return resolveUx('tqFlowResultsMaking', { language });
  if (state === 'failed') return resolveUx('tqFlowResultsFailed', { language });
  if (state !== 'sent' && state !== 'report_sent') return resolveUx('tqFlowResultsNoQuiz', { language });
  if (!students.length) return resolveUx('tqFlowResultsNobody', { language });

  const done = students.filter((s) => s.status === 'completed');
  const unfinished = students.filter((s) => s.status !== 'completed');
  const lines = [];
  if (done.length) {
    const avg = Math.round(done.reduce((a, s) => a + (s.mastery_percentage || 0), 0) / done.length);
    lines.push(resolveUx('tqFlowResultsHead', {
      language, params: { started: students.length, finished: done.length, avg },
    }));
    lines.push('');
    lines.push(resolveUx('tqFlowEachStudent', { language }));
    const sorted = [...done].sort((a, b) => (b.mastery_percentage || 0) - (a.mastery_percentage || 0));
    sorted.slice(0, MAX_STUDENT_LINES).forEach((s) => lines.push(studentLine(s, language)));
    if (sorted.length > MAX_STUDENT_LINES) {
      lines.push(resolveUx('tqFlowMoreStudents', { language, params: { n: sorted.length - MAX_STUDENT_LINES } }));
    }
  } else {
    lines.push(resolveUx('tqFlowResultsStartedOnly', { language, params: { started: students.length } }));
  }
  if (unfinished.length) {
    lines.push('');
    const names = unfinished
      .slice(0, MAX_STUDENT_LINES)
      .map((s) => isolateIfMixed(s.student_name || resolveUx('tqFlowUnnamed', { language }), language))
      .join(language === 'ur' ? '، ' : ', ');
    lines.push(resolveUx('tqFlowStillGoing', { language, params: { names } }));
  }
  return lines.join('\n');
}

/** The actions this lesson can actually offer, newest-decision-first. */
function actionsFor({ state, quiz, session, language }) {
  if (state === 'making') return [];
  if (state === 'sent' || state === 'report_sent') {
    const out = [];
    // A report needs a class link to count sessions against; a resend needs the
    // student message that link was published with. A quiz that has never been
    // handed off has neither, and must not mint a new code here.
    if (quiz?.meta?.share_code_id) {
      out.push({
        id: 'report',
        title: resolveUx('tqFlowActionReport', { language }),
        description: resolveUx('tqFlowActionReportDesc', { language }),
      });
    }
    if (quiz?.meta?.share_code_id && quiz?.meta?.student_message) {
      out.push({
        id: 'link',
        title: resolveUx('tqFlowActionLink', { language }),
        description: resolveUx('tqFlowActionLinkDesc', { language }),
      });
    }
    return out;
  }

  // none / offered / failed → make it. The subject rule seeds the order; only
  // Urdu and Islamiyat leave no real choice and so get a single option.
  const subject = quiz?.subject || session?.analysis_data?.subject || null;
  const rule = quiz?.language || quizLanguageFor(subject, session?.transcript_language);
  const description = resolveUx('tqFlowActionMakeDesc', { language });
  if (!needsLanguageAsk(subject)) {
    return [{ id: `make_${rule}`, title: resolveUx('tqFlowActionMake', { language }), description }];
  }
  const first = LANGUAGE_OFFER.includes(rule) ? rule : LANGUAGE_OFFER[0];
  return [first, ...LANGUAGE_OFFER.filter((c) => c !== first)].map((code) => ({
    id: `make_${code}`,
    title: resolveUx('tqFlowActionMakeIn', {
      language, params: { language: getLanguage(code).languageTitle },
    }),
    description,
  }));
}

function lessonScreenFrom({ teacher, session, quiz, students, language, extra = {} }) {
  const state = List.quizState(quiz);
  const counts = {
    started: students.length,
    finished: students.filter((s) => s.status === 'completed').length,
  };
  const subject = subjectLabel(quiz?.subject || session.analysis_data?.subject, language);
  const date = formatLessonDate(session.created_at, language);
  // The SHORT status, not the list message's long one: the results block
  // directly below already carries started/finished/average, and the caption
  // repeating it in longer words was the same sentence twice.
  const status = flowStatus(quiz, language, counts);
  const actions = actionsFor({ state, quiz, session, language });

  return {
    screen: 'LESSON',
    data: {
      screen_title: resolveUx('tqFlowLessonTitle', { language }),
      heading: fitIsolated(topicOf(quiz, session, language), HEADING_MAX, language),
      subline: subject
        ? resolveUx('tqFlowLessonSub', { language, params: { date, subject, status } })
        : resolveUx('tqFlowLessonSubNoSubject', { language, params: { date, status } }),
      results: resultsText(state, students, language),
      actions_label: resolveUx('tqFlowActionsLabel', { language }),
      actions,
      actions_visible: actions.length > 0,
      action_required: actions.length > 0,
      cta: actions.length
        ? resolveUx('tqFlowContinue', { language })
        : resolveUx('tqFlowClose', { language }),
      session_id: session.id,
      quiz_id: quiz?.id || '',
      ...extra,
    },
  };
}

// ---------------------------------------------------------------------------
// DONE
// ---------------------------------------------------------------------------

const DONE_COPY = {
  report: ['tqFlowDoneReportHead', 'tqFlowDoneReportBody'],
  link: ['tqFlowDoneLinkHead', 'tqFlowDoneLinkBody'],
  make: ['tqFlowDoneMakeHead', 'tqFlowDoneMakeBody'],
  wait: ['tqFlowDoneWaitHead', 'tqFlowDoneWaitBody'],
};

function doneScreen(kind, language, meta = {}) {
  const [head, body] = DONE_COPY[kind] || DONE_COPY.wait;
  logEvent('transcript_quiz.flow_closed', { kind, ...meta });
  return {
    screen: 'DONE',
    data: {
      screen_title: resolveUx('tqFlowDoneTitle', { language }),
      heading: resolveUx(head, { language }),
      body: resolveUx(body, { language }),
      close: resolveUx('tqFlowClose', { language }),
    },
  };
}

/**
 * The work happens AFTER the screen is on the teacher's phone.
 *
 * Meta's data_exchange budget is ten seconds; a report generation is a model
 * call and a PDF render, and a resend is two WhatsApp uploads. Both would blow
 * it, and a Flow that times out shows "Something went wrong" over work that
 * actually succeeded. Same discipline as student-videos' deliverVideoAsync.
 */
function runAfterResponse(action, quizId, fn) {
  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .then((ok) => logEvent('transcript_quiz.flow_action_done', { action, quizId, ok: Boolean(ok) }))
      .catch((err) => {
        logToFile('❌ transcript quiz flow: action failed after response', { action, quizId, error: err.message }, 'error');
        logEvent('transcript_quiz.flow_action_done', { action, quizId, ok: false, error: err.message });
      });
  });
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

/** An id as it arrived, safe to log: server-minted ids are short and plain, so
 *  anything else is reported by shape rather than echoed into the log. */
function safeId(v) {
  if (v === undefined) return '(absent)';
  if (typeof v !== 'string') return `(${typeof v})`;
  if (v === '') return '(empty)';
  return /^[A-Za-z0-9_:.-]{1,40}$/.test(v) ? v : `(unexpected:${v.length}ch)`;
}

async function stepLesson(teacher, screenData) {
  const language = teacherLanguageFor({ preferredLanguage: teacher?.preferred_language });
  const loaded = await loadLesson(teacher, screenData && screenData.session_id);
  if (!loaded) {
    return lessonsScreen(teacher, 1, { error_message: resolveUx('tqFlowErrNotYours', { language }) });
  }
  const { session, quiz } = loaded;
  const state = List.quizState(quiz);
  const students = (state === 'sent' || state === 'report_sent')
    ? await loadStudents(quiz.id, teacher.id) : [];
  logEvent('transcript_quiz.flow_lesson', {
    userId: teacher.id,
    quizId: quiz?.id || null,
    status: state,
    started: students.length,
    finished: students.filter((s) => s.status === 'completed').length,
  });
  // A quiz still being written has nothing to tap. Sending it to the terminal
  // screen says so plainly instead of serving a lesson whose only control is an
  // empty, hidden chooser.
  if (!actionsFor({ state, quiz, session, language }).length) {
    return doneScreen('wait', language, { userId: teacher.id, quizId: quiz?.id || null });
  }
  return lessonScreenFrom({ teacher, session, quiz, students, language });
}

async function stepAction(teacher, screenData) {
  const language = teacherLanguageFor({ preferredLanguage: teacher?.preferred_language });
  // The choice ships as `tq_action`, never `action`: `action` is the request's
  // own top-level field and the client drops a payload key that collides with
  // it — on 10 Sep the submit arrived as {step, session_id, quiz_id} with the
  // choice absent, not empty. quiz-flow and status-flow carry theirs as
  // `_action` for the same reason.
  const submitted = String((screenData && screenData.tq_action) || '').trim();
  const loaded = await loadLesson(teacher, screenData && screenData.session_id);
  if (!loaded) {
    logEvent('transcript_quiz.flow_action_refused', {
      userId: teacher.id, reason: 'lesson_not_found', action: submitted,
    });
    return lessonsScreen(teacher, 1, { error_message: resolveUx('tqFlowErrNotYours', { language }) });
  }
  const { session, quiz } = loaded;
  const state = List.quizState(quiz);
  const students = (state === 'sent' || state === 'report_sent')
    ? await loadStudents(quiz.id, teacher.id) : [];
  const available = actionsFor({ state, quiz, session, language }).map((a) => a.id);

  const refuse = (key) => lessonScreenFrom({
    teacher, session, quiz, students, language,
    extra: { error_message: resolveUx(key, { language }) },
  });

  if (!submitted && !available.length) {
    return doneScreen('wait', language, { userId: teacher.id });
  }

  // A submit carrying no choice is not a teacher changing their mind — in
  // production it was every submit there has ever been, 187 of them, 183 inside
  // a retry burst. Where the lesson offers exactly one thing, do that thing: a
  // tap on Continue under a single option cannot mean anything else.
  const action = submitted || (available.length === 1 ? available[0] : '');
  if (!action) {
    logEvent('transcript_quiz.flow_action_refused', {
      userId: teacher.id, reason: 'no_action_picked', available: available.length,
    });
    return refuse('tqFlowErrPickAction');
  }
  if (!available.includes(action)) {
    logEvent('transcript_quiz.flow_action_refused', {
      userId: teacher.id, reason: 'action_unavailable', action, available: available.length,
    });
    return refuse('tqFlowErrPickAction');
  }
  if (!submitted) {
    logEvent('transcript_quiz.flow_action_defaulted', { userId: teacher.id, action });
  }

  logEvent('transcript_quiz.flow_action', { userId: teacher.id, action, quizId: quiz?.id || null });

  if (action === 'report') {
    const shareCodeId = quiz.meta.share_code_id;
    runAfterResponse('report', quiz.id, async () => {
      const Report = require('../services/quiz/video-quiz-report.service');
      return Report.generate(shareCodeId, { reason: 'requested', force: true });
    });
    return doneScreen('report', language, { userId: teacher.id, quizId: quiz.id });
  }

  if (action === 'link') {
    const quizId = quiz.id;
    const phone = teacher.phone_number;
    runAfterResponse('link', quizId, async () => {
      const Handoff = require('../services/quiz/transcript-quiz-handoff.service');
      const out = await Handoff.sendHandoff(quizId, phone, { firstSend: false });
      logEvent('transcript_quiz.link_resent', {
        quizId, reused: Boolean(out && out.reused), pdfSent: Boolean(out && out.pdfSent), from: 'flow',
      });
      return Boolean(out && out.ok);
    });
    return doneScreen('link', language, { userId: teacher.id, quizId });
  }

  // make_<language>.
  //
  // The separator is an underscore because a colon does not survive the trip.
  // These ids are the `id` of a RadioButtonsGroup data-source item, and the one
  // the teacher picks comes back as ${form.tq_action}. With `make:en` that value
  // arrived EMPTY every time — 187 times in production, and once more on sandbox
  // with the radio visibly selected, logged as flow_action_refused
  // reason=no_action_picked. Every RadioButtonsGroup in this repo that works uses
  // plain ids (`pdf`, `english`); the two flows shipping colon ids feed a
  // Dropdown, not a radio.
  const chosen = clampLanguage(action.slice('make_'.length));
  const teacherId = teacher.id;
  const sessionId = session.id;
  const phone = teacher.phone_number;
  runAfterResponse('make', quiz?.id || null, async () => {
    const claimed = await List.claimForGeneration({
      userId: teacherId, sessionId, session, quiz, quizLanguage: chosen, source: 'flow',
    });
    if (claimed.error) return false;
    await List.enqueueGenerate(claimed.quizId, phone, language, 'flow');
    logEvent('transcript_quiz.list_generate', {
      userId: teacherId, quizId: claimed.quizId, from: claimed.from, source: 'flow', language: chosen,
    });
    return true;
  });
  return doneScreen('make', language, { userId: teacher.id, language: chosen });
}

// ---------------------------------------------------------------------------
// the three entry points the route dispatches to
// ---------------------------------------------------------------------------

async function handleTranscriptQuizInit(flowToken) {
  const { teacher, error } = await resolveTeacher(flowToken);
  if (error) return lookupFailedScreen(error, { action: 'INIT' });
  if (!teacher) {
    logToFile('⚠️ transcript quiz flow: unknown token', { hasToken: Boolean(flowToken) });
    return lessonsScreen(null, 1, { error_message: resolveUx('tqFlowErrNotYours', { language: clampLanguage(null) }) });
  }
  logEvent('transcript_quiz.flow_opened', { userId: teacher.id });
  return lessonsScreen(teacher, 1);
}

async function handleTranscriptQuizDataExchange(flowToken, screen, screenData) {
  const { teacher, error } = await resolveTeacher(flowToken);
  if (error) return lookupFailedScreen(error, { action: 'data_exchange', step: String((screenData && screenData.step) || '') });
  const language = teacherLanguageFor({ preferredLanguage: teacher?.preferred_language });
  if (!teacher) {
    return lessonsScreen(null, 1, { error_message: resolveUx('tqFlowErrNotYours', { language }) });
  }
  const step = String((screenData && screenData.step) || '');
  // Three separate theories about the dead /quiz action have now been wrong,
  // each argued from what the client OUGHT to send. Nothing here has ever
  // recorded what it DID send, so the question that settles it — does `action`
  // arrive absent, empty, or under another key? — was unanswerable from the
  // logs. Keys and lengths only: every value in this payload is a server-minted
  // id, and none of it is the teacher's own text.
  logEvent('transcript_quiz.flow_payload', {
    userId: teacher.id,
    step,
    screen: String(screen || ''),
    keys: Object.keys(screenData || {}).sort().join(','),
    action: safeId(screenData && screenData.tq_action),
    actionLen: String((screenData && screenData.tq_action) || '').length,
    actionType: typeof (screenData && screenData.tq_action),
  });
  try {
    if (step === 'page') {
      const page = Number(screenData.page) || 1;
      logEvent('transcript_quiz.flow_page', { userId: teacher.id, page });
      return await lessonsScreen(teacher, page);
    }
    if (step === 'lesson') return await stepLesson(teacher, screenData);
    if (step === 'action') return await stepAction(teacher, screenData);
  } catch (err) {
    logToFile('❌ transcript quiz flow: step threw', { step, screen, error: err.message }, 'error');
    return lessonsScreen(teacher, 1, { error_message: resolveUx('tqFlowErrGeneric', { language }) });
  }
  logToFile('⚠️ transcript quiz flow: unknown step', { step, screen });
  return lessonsScreen(teacher, 1, { error_message: resolveUx('tqFlowErrGeneric', { language }) });
}

/** The Flow's own back arrow re-enters LESSONS; the endpoint re-serves page 1
 *  so a lesson whose quiz finished while the teacher was inside is current. */
async function handleTranscriptQuizBack(flowToken) {
  const { teacher, error } = await resolveTeacher(flowToken);
  if (error) return lookupFailedScreen(error, { action: 'BACK' });
  return lessonsScreen(teacher, 1);
}

module.exports = {
  handleTranscriptQuizInit,
  handleTranscriptQuizDataExchange,
  handleTranscriptQuizBack,
  // exported for tests and for the publish/structural guards
  flowStatus,
  actionsFor,
  resultsText,
  lessonsScreen,
  PER_PAGE,
  NAV_MAX_ITEMS,
  TITLE_MAX,
  DESC_MAX,
  META_MAX,
};
