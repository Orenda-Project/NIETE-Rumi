'use strict';
/**
 * Transcript quiz — /quiz.
 *
 * Lists the teacher's recent self-coaching lessons newest-first with the
 * state of each lesson's quiz (none yet / being made / sent · N started /
 * report sent), and turns a tap into the right action: make it, resend the
 * forwardable link, or fetch the class report now.
 *
 * This REPLACES the parent-quiz /quiz on NIETE when the flag is on (that
 * path needed parents' phone numbers, which 68 of 5,310 students have — it
 * produced zero quizzes). The parent-quiz plumbing that the report and the
 * scorecard still use is untouched.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { composeTitle, composeLabelledDescription, normaliseTopic } = require('./transcript-quiz-rows');
const { teacherLanguageFor, formatLessonDate, subjectLabel, quizLanguageFor } = require('./transcript-quiz-language');
const { MIN_TRANSCRIPT_CHARS, sendLanguageAsk } = require('./transcript-quiz-offer.service');
const { isQuizMenuRequest } = require('./quiz-menu-request');
const QuizMenuFlags = require('./quiz-menu-flags');
const Providers = require('./quiz-lesson-providers');
// The recorded lessons' own reads and tap (the transcript lesson provider),
// re-exported below under the names every caller already uses.
const {
  countsFor, loadEligibleSessions, enqueueGenerate, claimForGeneration, startTranscriptLesson,
  LINK_PREFIX, REPORT_PREFIX, BACK_PREFIX,
} = require('./transcript-lesson-provider');
const {
  TRANSCRIPT, LP_V8, lessonSessionFor, failureCopyKey, failureReasonOf, lpRemakeable,
} = require('./quiz-sources');
const Funnel = require('./quiz-funnel');

const PICK_PREFIX = 'tq_pick_';
// An lp_v8 quiz has no coaching session to pick, so its row carries the quiz.
// It rides under PICK_PREFIX on purpose: the entry point already dispatches
// every `tq_pick_` list reply here, so no new route is needed (Class A).
const LP_PICK_PREFIX = `${PICK_PREFIX}lp_`;
const PAGE_PREFIX = 'tq_page_';
const MAX_ROWS = 10;            // WhatsApp's hard cap on total rows in one list
const PER_PAGE = 9;             // 9 lessons + one "Older lessons…" row when there is more
const TITLE_MAX = 24;
const DESC_MAX = 72;
const LP_QUIZ_SELECT = 'id, teacher_id, coaching_session_id, quiz_source, status, topic, subject, language, meta, created_at';

/**
 * Is this text a request for /quiz? `/quiz…` as always, and now every bare
 * spelling a teacher types ("quiz/", "quize", "mera quiz", «کویز») — one
 * matcher, shared with the child's door (quiz-menu-request.js).
 */
function isQuizCommand(text) {
  if (QuizMenuFlags.bareTextToMenu()) return isQuizMenuRequest(text);
  // QUIZ_BARE_TEXT_TO_MENU off: the door as it was — `/quiz…` and three exact words.
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^\/quiz(\s|$)/i.test(t)) return true;
  const low = t.toLowerCase();
  return low === 'quiz' || t === 'کوئز' || t === 'کوئز؟';
}

/**
 * The SIX states a lesson can be in, as far as any menu is concerned. One
 * function so the list message and the /quiz Flow cannot disagree about what
 * `declined` or `ready` means — they render different fields with different
 * caps, but they read the same taxonomy.
 *
 * @returns {'none'|'offered'|'making'|'sent'|'report_sent'|'failed'}
 */
function quizState(quiz) {
  if (!quiz) return 'none';
  switch (quiz.status) {
    case 'offered': return 'offered';
    case 'generating':
    case 'ready': return 'making';
    case 'sent': return 'sent';
    case 'report_sent': return 'report_sent';
    case 'failed': return 'failed';
    default: return 'none';           // declined, skipped, cancelled
  }
}

/**
 * Is this quiz waiting for the teacher to choose its language?
 *
 * The one `offered` state that is NOT "being made": the teacher said yes, was
 * asked Urdu or English, and has not answered. Nothing is queued until they do
 * (the tq_lang_ buttons → startGenerating), so a menu that finds a quiz here
 * must ask again — never say it is on its way.
 */
function isAwaitingLanguage(quiz) {
  return Boolean(quiz && quiz.status === 'offered' && quiz.meta && quiz.meta.awaiting_language === true);
}

function statusLine(quiz, language) {
  const started = quiz?.meta?.started ?? quiz?._started ?? 0;
  const finished = quiz?.meta?.finished ?? quiz?._finished ?? 0;
  switch (quizState(quiz)) {
    case 'offered': return resolveUx('tqRowOffered', { language });
    case 'making': return resolveUx('tqRowMaking', { language });
    case 'sent': return resolveUx('tqRowSent', { language, params: { started, finished } });
    case 'report_sent': return resolveUx('tqRowReportSent', { language, params: { finished } });
    // "tap to retry" only where the tap DOES retry: every failed transcript row
    // (the tap re-makes it), and an lp_v8 row a remake can still help
    // (lpRemakeable — handleLpPick makes it again). An lp_v8 row that cannot be
    // made again just says it did not work.
    case 'failed': return resolveUx(
      quiz?.quiz_source === LP_V8 && !lpRemakeable(quiz.meta) ? 'tqRowFailedLp' : 'tqRowFailed', { language },
    );
    default: return resolveUx('tqRowNoQuiz', { language });
  }
}

/**
 * Pure: sessions + quizzes → one page of list rows, newest first.
 *
 * A lesson whose recording is thinner than the offer gate is left out even if
 * a quiz row already points at it: the author cannot write eight questions
 * from it, so the row could only ever end at "I couldn't make a good quiz".
 *
 * ONE FORMAT, EVERY ROW: the title is always `date · subject` (or the date
 * alone), the description is always `topic · status` (or the topic alone) —
 * see transcript-quiz-rows.js. A real topic does not fit the 24-code-point
 * title, so it lives in the 72-code-point description always, never only
 * when it happens to be long.
 *
 * Returns `{ rows, page, from, to, total, hasMore }`. `total`/`from`/`to` are
 * 1-based positions within the eligible sessions this call was handed —
 * `showList` is responsible for handing it enough of them.
 */
/**
 * ONE list (PLAN_R8 D11): the teacher's lessons, whichever way their quiz was
 * born. A coaching session is an item (joined to its transcript quiz, if any);
 * an lp_v8 quiz is an item of its own, dated by the lesson it was planned for.
 * One sort, newest first. Shared by the list message and the /quiz Flow so the
 * two cannot disagree about what is in the list or in what order.
 *
 * @returns {Array<{kind:'session'|'lp', key:string, session:object, quiz:object|null, date:string}>}
 */
function lessonItems(sessions, quizzes, lessons = []) {
  const all = quizzes || [];
  const bySession = new Map(all.filter((q) => q.quiz_source !== LP_V8).map((q) => [q.coaching_session_id, q]));
  const items = (sessions || [])
    .filter((s) => String(s.transcript_text || '').length >= MIN_TRANSCRIPT_CHARS)
    .map((s) => ({ kind: 'session', key: s.id, session: s, quiz: bySession.get(s.id) || null, date: s.created_at }));
  all.filter((q) => q.quiz_source === LP_V8).forEach((q) => {
    const session = lessonSessionFor(q);
    items.push({
      kind: 'lp', key: `lp_${q.id}`, session, quiz: q, date: session.created_at || q.created_at,
    });
  });
  // A lesson with NO quiz yet from a plan provider (quiz-lesson-providers):
  // listed, made only when tapped. Its pseudo-session carries the fields every
  // row reads (the date, the topic, the subject), so the layout is shared.
  (lessons || []).forEach((l) => {
    items.push({
      kind: 'lesson',
      key: Providers.lessonKey(l),
      session: { created_at: l.date, analysis_data: { topic: l.topic, subject: l.subject } },
      quiz: null,
      date: l.date,
      lesson: l,
    });
  });
  return items.sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * WHERE a row came from, in the teacher's language: "From transcript" for a
 * recorded lesson, "From lesson plan" for a planned one (quiz or not yet) —
 * the provider's own label, so a new source brings its own.
 */
function rowLabel(item, language) {
  let source = TRANSCRIPT;
  if (item.kind === 'lp') source = (item.quiz && item.quiz.quiz_source) || LP_V8;
  else if (item.kind === 'lesson') source = item.lesson.source;
  return resolveUx(Providers.labelKeyFor(source), { language });
}

function buildRows(sessions, quizzes, language, { page = 1, lessons = [] } = {}) {
  const eligible = lessonItems(sessions, quizzes, lessons);
  const total = eligible.length;
  const p = Number.isFinite(page) && page > 0 ? page : 1;
  const start = (p - 1) * PER_PAGE;
  const slice = eligible.slice(start, start + PER_PAGE);
  const hasMore = total > start + PER_PAGE;

  const rows = slice.map((item) => {
    const { key, session: s, quiz, date: when } = item;
    const topic = quiz?.topic || s.analysis_data?.topic || resolveUx('tqLessonWord', { language });
    const subject = subjectLabel(quiz?.subject || s.analysis_data?.subject, language);
    const status = statusLine(quiz, language);
    const date = formatLessonDate(when, language);
    return {
      id: `${PICK_PREFIX}${key}`,
      title: composeTitle({ date, subject }, TITLE_MAX),
      // QUIZ_MENU_SOURCE_LABELS off: no label — `topic · status`, exactly as before.
      description: composeLabelledDescription({
        label: QuizMenuFlags.sourceLabels() ? rowLabel(item, language) : '', topic, status,
      }, DESC_MAX, { language }),
    };
  });

  if (hasMore) {
    rows.push({
      id: `${PAGE_PREFIX}${p + 1}`,
      title: resolveUx('tqRowOlder', { language }),
      description: resolveUx('tqRowOlderDesc', { language }),
    });
  }

  return {
    rows,
    page: p,
    from: total ? start + 1 : 0,
    to: Math.min(start + PER_PAGE, total),
    total,
    hasMore,
  };
}

/**
 * Does this teacher have anything /quiz could list?
 *
 * The Flow answers with a NavigationList, and Meta requires at least one item
 * in one — so the "no lessons yet" case is answered in CHAT, with the same
 * message and the same event the list path has always used, rather than by
 * opening a Flow onto a row that is not a lesson. One indexed round-trip on a
 * command a teacher sends by hand.
 */
async function hasEligibleLessons(userId) {
  if (!userId) return false;
  const { sessions } = await loadEligibleSessions(userId, 1);
  if (sessions.length > 0) return true;
  if ((await loadLpQuizzes(userId, 1)).length > 0) return true;
  return (await Providers.listPlanLessons(userId, { limit: 1 })).length > 0;
}

/**
 * The teacher's lp_v8 quizzes, newest first — at most `needed`, which is all
 * one page of the union can ever show (the union's top N lies within the top N
 * of each half). Filtered on the owner in the query, never afterwards.
 */
async function loadLpQuizzes(userId, needed) {
  if (!userId) return [];
  const { data, error } = await supabase.from('quizzes')
    .select(LP_QUIZ_SELECT)
    .eq('teacher_id', userId).eq('quiz_source', LP_V8)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, needed));
  if (error) logToFile('❌ transcript quiz: lp_v8 quizzes lookup failed', { userId, error: error.message }, 'error');
  return data || [];
}

/**
 * Everything one page of /quiz needs, for the list message and the Flow alike:
 * the eligible sessions, their transcript quizzes, the lp_v8 quizzes, and the
 * started/finished counts stamped on every sent quiz as `_started`/`_finished`.
 */
async function loadLessonPage(userId, needed) {
  // The recorded lessons come through their provider like every other source.
  const recorded = await Providers.providerFor(TRANSCRIPT).list(userId, { limit: needed });
  const sessions = recorded.map((r) => r.session);
  const ids = sessions.map((s) => s.id);
  let quizzes = [];
  if (ids.length) {
    const { data } = await supabase.from('quizzes')
      .select('id, coaching_session_id, quiz_source, status, topic, subject, meta')
      .eq('teacher_id', userId).eq('quiz_source', TRANSCRIPT).in('coaching_session_id', ids);
    quizzes = data || [];
  }
  quizzes = quizzes.concat(await loadLpQuizzes(userId, needed));
  const counts = await countsFor(
    quizzes.filter((q) => ['sent', 'report_sent'].includes(q.status)).map((q) => q.id),
    userId,
  );
  quizzes.forEach((q) => { const c = counts.get(q.id); if (c) { q._started = c.started; q._finished = c.finished; } });
  // Lessons of the plan sources with NO quiz yet — listed, never generated here.
  const lessons = await Providers.listPlanLessons(userId, { limit: needed });
  return { sessions, quizzes, counts, lessons };
}

async function showList(user, phone, language, page = 1) {
  const lang = teacherLanguageFor({ preferredLanguage: language || user?.preferred_language });
  const p = Number.isFinite(page) && page > 0 ? page : 1;
  const { sessions, quizzes, lessons } = await loadLessonPage(user.id, p * PER_PAGE + 1);

  let { rows, from, to } = buildRows(sessions, quizzes, lang, { page: p, lessons });
  // A stale list tapped a week later can ask for a page that no longer exists.
  // The tap means "show me more lessons", so the list is what comes back —
  // not "no lessons yet".
  if (!rows.length && p > 1) {
    ({ rows, from, to } = buildRows(sessions, quizzes, lang, { page: 1, lessons }));
  }
  if (!rows.length) {
    await WhatsAppService.sendMessage(phone, resolveUx(QuizMenuFlags.lessonRows() ? 'tqListEmptyPlans' : 'tqListEmpty', { language: lang }));
    logEvent('transcript_quiz.list_empty', { userId: user.id });
    return true;
  }
  await WhatsAppService.sendInteractiveMessage(phone, {
    header: { type: 'text', text: resolveUx('tqListHeader', { language: lang, params: { from, to } }) },
    body: { text: resolveUx('tqListBody', { language: lang }) },
    action: {
      button: resolveUx('tqListButton', { language: lang }),
      sections: [{ title: resolveUx('tqListSection', { language: lang }), rows }],
    },
  });
  logEvent('transcript_quiz.list_shown', {
    userId: user.id, rows: rows.length, page: p, lessonRows: rows.filter((r) => r.id.startsWith(`${PICK_PREFIX}${Providers.LESSON_KEY_PREFIX}`)).length,
  });
  return true;
}

async function handleListPick(listId, phone, user) {
  if (listId && listId.startsWith(PAGE_PREFIX)) {
    const lang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
    const parsed = parseInt(listId.slice(PAGE_PREFIX.length), 10);
    const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    await showList(user, phone, lang, page);
    return true;
  }
  if (!listId || !listId.startsWith(PICK_PREFIX)) return false;
  if (listId.startsWith(LP_PICK_PREFIX)) return handleLpPick(listId.slice(LP_PICK_PREFIX.length), phone, user);
  // A lesson with no quiz yet, from any provider (`tq_pick_lsn_<source>_<ref>`):
  // the tap is the request — the provider claims the lesson and makes its quiz.
  const lesson = Providers.parseLessonKey(listId.slice(PICK_PREFIX.length));
  if (lesson) {
    if (!QuizMenuFlags.lessonRows()) {
      // QUIZ_MENU_LESSON_ROWS off: a lesson row from an older list makes nothing.
      const lang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
      await WhatsAppService.sendMessage(phone, resolveUx('tqLpLessonUnavailable', { language: lang }));
      logEvent('quiz_menu.lesson_picked', { userId: user?.id || null, source: lesson.provider.source, outcome: 'switched_off', via: 'list' });
      return true;
    }
    const out = await lesson.provider.start(user, lesson.lessonRef, { phone, via: 'list' });
    await answerTakenLesson(out, phone, user);
    return true;
  }
  return startTranscriptLesson(user, listId.slice(PICK_PREFIX.length), { phone, via: 'list' });
}

/**
 * A provider's tap came back `already`: the lesson has its quiz (made by the
 * other tap, the other replica, or the 15:00 offer). Answer with THAT quiz —
 * its buttons when sent, the language ask again while it waits for one, "still
 * being made" otherwise — exactly as a tap on its quiz row would. With no quiz
 * to show (the other tap holds the claim and is still writing it), "already on
 * it". Any other outcome has already answered the teacher itself.
 */
async function answerTakenLesson(out, phone, user) {
  if (!out || out.outcome !== 'already') return false;
  if (out.existing && out.existing.id) return handleLpPick(out.existing.id, phone, user);
  const lang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
  await WhatsAppService.sendMessage(phone, resolveUx('tqAlreadyMaking', { language: lang }));
  return true;
}

/**
 * A tap on an lp_v8 row. There is no session to make a quiz FROM here — the
 * quiz exists because the teacher said yes to the afternoon offer — so the
 * choices are the ones a sent quiz has (resend the link, the report, back), a
 * "still making it", a failed quiz made AGAIN when a remake can help
 * (lpRemakeable — the Flow's "Make it again", on the list's "tap to retry"), or
 * the failure copy that names the step that stopped when it cannot.
 * Never "make it" from a session: that path claims a coaching session.
 *
 * The one decision still open on an lp_v8 quiz is its LANGUAGE: a yes on any
 * subject but Urdu/Islamiyat leaves the row `offered` until the teacher taps
 * Urdu or English. If they ignored that ask, the row says "Offered — tap to
 * make", and the tap re-sends the ask — "still being made" would be false,
 * because nothing is queued until the ask is answered.
 */
async function handleLpPick(quizId, phone, user) {
  const lang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
  const { data: quiz } = user?.id ? await supabase.from('quizzes')
    .select(LP_QUIZ_SELECT)
    .eq('id', quizId).eq('teacher_id', user.id).eq('quiz_source', LP_V8)
    .maybeSingle() : { data: null };
  if (!quiz) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  const state = quizState(quiz);
  if (state === 'sent' || state === 'report_sent') {
    const counts = await countsFor([quiz.id], user.id);
    const c = counts.get(quiz.id) || { started: 0, finished: 0 };
    await WhatsAppService.sendInteractiveButtons(phone, {
      body: resolveUx('tqQuizStatus', {
        language: lang,
        params: {
          topic: normaliseTopic(quiz.topic || ''),
          date: formatLessonDate(lessonSessionFor(quiz).created_at || quiz.created_at, lang),
          started: c.started, finished: c.finished,
        },
      }),
      buttons: [
        { id: `${LINK_PREFIX}${quiz.id}`, title: resolveUx('tqLinkButton', { language: lang }) },
        { id: `${REPORT_PREFIX}${quiz.id}`, title: resolveUx('tqReportButton', { language: lang }) },
        { id: `${BACK_PREFIX}${quiz.id}`, title: resolveUx('tqBackButton', { language: lang }) },
      ],
    });
    logEvent('transcript_quiz.list_pick', { userId: user.id, quizId: quiz.id, state, quiz_source: LP_V8 });
    return true;
  }
  if (isAwaitingLanguage(quiz)) {
    // The same ask and buttons the offer sent; its answer runs startGenerating,
    // which flips offered → generating atomically and queues the LP quiz.
    const ruleLanguage = quiz.language || quizLanguageFor(quiz.subject, null);
    await sendLanguageAsk(quiz.id, phone, lang, ruleLanguage, { digest: quiz.meta?.digest, subject: quiz.subject });
    logEvent('transcript_quiz.language_asked', {
      userId: user.id, quizId: quiz.id, ruleLanguage, from: 'list', quiz_source: LP_V8,
    });
    return true;
  }
  if (state === 'failed' && lpRemakeable(quiz.meta)) {
    // The list's own promise ("tap to retry"), kept the way a failed transcript
    // row keeps it: the tap makes the quiz again. The same remake the Flow's
    // "Make it again" runs — the atomic failed → generating flip, then the one
    // LP queue step, which tells the teacher it is on its way.
    const Offer = require('./transcript-quiz-offer.service');
    const remade = await Offer.remakeLpQuiz({ quiz, phone, teacherLang: lang, source: 'list' });
    logEvent('transcript_quiz.list_pick', {
      userId: user.id, quizId: quiz.id, state, remade: Boolean(remade), quiz_source: LP_V8,
    });
    return true;
  }
  if (state === 'failed') {
    // The reason the generate step persisted, so the sentence repeated here is
    // the one the teacher was sent when it failed (model vs plan, never mixed).
    await WhatsAppService.sendMessage(phone, resolveUx(failureCopyKey(failureReasonOf(quiz.meta), LP_V8), { language: lang }));
  } else {
    await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
  }
  logEvent('transcript_quiz.list_pick', { userId: user.id, quizId: quiz.id, state, quiz_source: LP_V8 });
  return true;
}

async function handleActionButton(buttonId, phone) {
  const isLink = buttonId && buttonId.startsWith(LINK_PREFIX);
  const isReport = buttonId && buttonId.startsWith(REPORT_PREFIX);
  const isBack = buttonId && buttonId.startsWith(BACK_PREFIX);
  if (!isLink && !isReport && !isBack) return false;
  const prefix = isLink ? LINK_PREFIX : isReport ? REPORT_PREFIX : BACK_PREFIX;
  const quizId = buttonId.slice(prefix.length);
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, teacher_id, status, language, topic, meta').eq('id', quizId).maybeSingle();
  if (!quiz) return true;
  const { data: teacher } = await supabase.from('users')
    .select('phone_number, preferred_language').eq('id', quiz.teacher_id).maybeSingle();
  const lang = teacherLanguageFor({ preferredLanguage: teacher?.preferred_language });

  if (isBack) {
    await showList({ id: quiz.teacher_id, preferred_language: teacher?.preferred_language }, phone, lang, 1);
    logEvent('transcript_quiz.list_reopened', { quizId });
    return true;
  }

  if (isLink) {
    // The SAME hand-off the teacher got after their coaching debrief: the pre-send PDF
    // and then the forwardable message — the same share code, the same link,
    // never a new one (operator, item 7/8). A quiz that has not been handed
    // off yet has no code to reuse, and must not mint one here.
    if (!quiz.meta?.student_message || !quiz.meta?.share_code_id) {
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    }
    const Handoff = require('./transcript-quiz-handoff.service');
    const out = await Handoff.sendHandoff(quizId, phone, { firstSend: false });
    if (!out || !out.ok) {
      await WhatsAppService.sendMessage(phone, resolveUx('tqCouldNotSend', { language: lang }));
    }
    logEvent('transcript_quiz.link_resent', { quizId, reused: Boolean(out && out.reused), pdfSent: Boolean(out && out.pdfSent) });
    return true;
  }

  const shareCodeId = quiz.meta?.share_code_id;
  if (!shareCodeId) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNoReportYet', { language: lang }));
    return true;
  }
  await WhatsAppService.sendMessage(phone, resolveUx('tqReportComing', { language: lang }));
  const Report = require('./video-quiz-report.service');
  const sent = await Report.generate(shareCodeId, { reason: 'requested', force: true });
  if (!sent) await WhatsAppService.sendMessage(phone, resolveUx('tqNoReportYet', { language: lang }));
  logEvent('transcript_quiz.report_requested', { quizId, sent: Boolean(sent) });
  return true;
}

module.exports = {
  isQuizCommand, buildRows, showList, handleListPick, handleActionButton, statusLine, countsFor,
  loadEligibleSessions, hasEligibleLessons, quizState, isAwaitingLanguage, claimForGeneration, enqueueGenerate,
  lessonItems, loadLessonPage, loadLpQuizzes, rowLabel, startTranscriptLesson, answerTakenLesson,
  PICK_PREFIX, LP_PICK_PREFIX, LINK_PREFIX, REPORT_PREFIX, PAGE_PREFIX, BACK_PREFIX, MAX_ROWS, PER_PAGE,
};
