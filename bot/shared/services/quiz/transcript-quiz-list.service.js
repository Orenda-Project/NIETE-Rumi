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
const { composeTitle, composeDescription, normaliseTopic } = require('./transcript-quiz-rows');
const { teacherLanguageFor, formatLessonDate, subjectLabel, quizLanguageFor, needsLanguageAsk } = require('./transcript-quiz-language');
const { MIN_TRANSCRIPT_CHARS, sendLanguageAsk } = require('./transcript-quiz-offer.service');
const { isSelfTest } = require('./teacher-self-test');

const PICK_PREFIX = 'tq_pick_';
const LINK_PREFIX = 'tq_link_';
const REPORT_PREFIX = 'tq_report_';
const PAGE_PREFIX = 'tq_page_';
const BACK_PREFIX = 'tq_back_';
const MAX_ROWS = 10;            // WhatsApp's hard cap on total rows in one list
const PER_PAGE = 9;             // 9 lessons + one "Older lessons…" row when there is more
const TITLE_MAX = 24;
const DESC_MAX = 72;
const CHUNK = 25;                // sessions fetched per DB round-trip
const MAX_FETCHES = 8;           // never scan more than 200 sessions for one /quiz

function isQuizCommand(text) {
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

function statusLine(quiz, language) {
  const started = quiz?.meta?.started ?? quiz?._started ?? 0;
  const finished = quiz?.meta?.finished ?? quiz?._finished ?? 0;
  switch (quizState(quiz)) {
    case 'offered': return resolveUx('tqRowOffered', { language });
    case 'making': return resolveUx('tqRowMaking', { language });
    case 'sent': return resolveUx('tqRowSent', { language, params: { started, finished } });
    case 'report_sent': return resolveUx('tqRowReportSent', { language, params: { finished } });
    case 'failed': return resolveUx('tqRowFailed', { language });
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
function buildRows(sessions, quizzes, language, { page = 1 } = {}) {
  const byId = new Map((quizzes || []).map((q) => [q.coaching_session_id, q]));
  const eligible = (sessions || [])
    .filter((s) => String(s.transcript_text || '').length >= MIN_TRANSCRIPT_CHARS)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = eligible.length;
  const p = Number.isFinite(page) && page > 0 ? page : 1;
  const start = (p - 1) * PER_PAGE;
  const slice = eligible.slice(start, start + PER_PAGE);
  const hasMore = total > start + PER_PAGE;

  const rows = slice.map((s) => {
    const quiz = byId.get(s.id) || null;
    const topic = quiz?.topic || s.analysis_data?.topic || resolveUx('tqLessonWord', { language });
    const subject = subjectLabel(quiz?.subject || s.analysis_data?.subject, language);
    const status = statusLine(quiz, language);
    const date = formatLessonDate(s.created_at, language);
    return {
      id: `${PICK_PREFIX}${s.id}`,
      title: composeTitle({ date, subject }, TITLE_MAX),
      description: composeDescription({ topic, status }, DESC_MAX, { language }),
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
 * PLAN_R5 §1 D8 — `teacherUserId`, when passed, drops her own self-test row
 * from both counts. Deliberately filtered in JS, not with a Postgres
 * `.neq('user_id', teacherUserId)`: `user_id != X` evaluates to NULL (not
 * true) for every row where `user_id IS NULL`, so that filter would drop
 * every real child along with her.
 */
async function countsFor(quizIds, teacherUserId = null) {
  const counts = new Map();
  if (!quizIds.length) return counts;
  const { data } = await supabase.from('quiz_sessions')
    .select('quiz_id, status, user_id').in('quiz_id', quizIds).is('invited_by_student_id', null);
  (data || [])
    .filter((s) => !isSelfTest(s, teacherUserId))
    .forEach((s) => {
      const c = counts.get(s.quiz_id) || { started: 0, finished: 0 };
      c.started += 1;
      if (s.status === 'completed') c.finished += 1;
      counts.set(s.quiz_id, c);
    });
  return counts;
}

/**
 * Load enough of the teacher's eligible sessions (transcript long enough to
 * quiz) to answer for `needed` of them, fetching in CHUNK-sized round-trips
 * rather than one `.limit(25)` that could never see lesson 26 onward.
 * Returns `{ sessions, exhausted }` — `sessions` holds only the eligible
 * ones found so far; `exhausted` is true once a short batch shows the table
 * has no more rows. Never scans more than `MAX_FETCHES * CHUNK` sessions for
 * one /quiz — a runaway teacher history cannot loop this forever.
 */
async function loadEligibleSessions(userId, needed) {
  let sessions = [];
  let exhausted = false;
  for (let fetch = 0; fetch < MAX_FETCHES; fetch += 1) {
    const offset = fetch * CHUNK;
    const { data } = await supabase.from('coaching_sessions')
      .select('id, created_at, transcript_text, analysis_data')
      .eq('user_id', userId)
      .is('observation_type', null)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .range(offset, offset + CHUNK - 1);
    const batch = data || [];
    const eligible = batch.filter((s) => String(s.transcript_text || '').length >= MIN_TRANSCRIPT_CHARS);
    sessions = sessions.concat(eligible);
    if (batch.length < CHUNK) { exhausted = true; break; }
    if (sessions.length >= needed) break;
  }
  return { sessions, exhausted };
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
  return sessions.length > 0;
}

async function showList(user, phone, language, page = 1) {
  const lang = teacherLanguageFor({ preferredLanguage: language || user?.preferred_language });
  const p = Number.isFinite(page) && page > 0 ? page : 1;
  const { sessions } = await loadEligibleSessions(user.id, p * PER_PAGE + 1);
  const ids = sessions.map((s) => s.id);
  let quizzes = [];
  if (ids.length) {
    const { data } = await supabase.from('quizzes')
      .select('id, coaching_session_id, status, topic, subject, meta')
      .eq('teacher_id', user.id).eq('quiz_source', 'transcript').in('coaching_session_id', ids);
    quizzes = data || [];
  }
  const counts = await countsFor(
    quizzes.filter((q) => ['sent', 'report_sent'].includes(q.status)).map((q) => q.id),
    user.id,
  );
  quizzes.forEach((q) => { const c = counts.get(q.id); if (c) { q._started = c.started; q._finished = c.finished; } });

  let { rows, from, to } = buildRows(sessions, quizzes, lang, { page: p });
  // A stale list tapped a week later can ask for a page that no longer exists.
  // She meant "show me more lessons", so she gets the list — not "no lessons yet".
  if (!rows.length && p > 1) {
    ({ rows, from, to } = buildRows(sessions, quizzes, lang, { page: 1 }));
  }
  if (!rows.length) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqListEmpty', { language: lang }));
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
  logEvent('transcript_quiz.list_shown', { userId: user.id, rows: rows.length, page: p });
  return true;
}

async function enqueueGenerate(quizId, phone, lang, source = 'list') {
  const SQSQueueService = require('../queue/sqs-queue.service');
  await SQSQueueService.queueJob(quizId, 'quiz_generate', { quizId, phone, language: lang, source }, { delaySeconds: 0 });
  await WhatsAppService.sendMessage(phone, resolveUx('tqMaking', { language: lang }));
}

/**
 * Claim a lesson for generation — the ONE place a menu turns "make this one"
 * into a `generating` quizzes row, whether the tap came from the list message
 * or from the /quiz Flow. It is called only once the quiz language is settled
 * (by the subject rule, or by the teacher answering the ask); the paths that
 * still have to ASK keep their own `offered` write above.
 *
 * Returns `{ quizId, from }` or `{ error }` — never throws, never sends.
 */
async function claimForGeneration({ userId, sessionId, session, quiz, quizLanguage, source = 'list' }) {
  if (quiz) {
    await supabase.from('quizzes')
      .update({
        status: 'generating', language: quizLanguage,
        meta: {
          ...(quiz.meta || {}), step: quiz.meta?.digest ? 'author' : 'digest',
          awaiting_language: false, source, retried_at: new Date().toISOString(),
        },
      })
      .eq('id', quiz.id);
    return { quizId: quiz.id, from: quiz.status };
  }
  const { data: created, error } = await supabase.from('quizzes').insert({
    teacher_id: userId, quiz_source: 'transcript', coaching_session_id: sessionId,
    topic: session?.analysis_data?.topic || 'Lesson', subject: session?.analysis_data?.subject || null,
    language: quizLanguage,
    status: 'generating',
    meta: { step: 'digest', awaiting_language: false, source, claimed_at: new Date().toISOString() },
  }).select('id').single();
  if (error || !created) {
    logToFile('⚠️ transcript quiz: list claim failed', { sessionId, error: error?.message });
    return { error: error?.message || 'claim failed' };
  }
  return { quizId: created.id, from: 'none' };
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
  const sessionId = listId.slice(PICK_PREFIX.length);
  const lang = teacherLanguageFor({ preferredLanguage: user?.preferred_language });
  if (!user?.id) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  const { data: session } = await supabase.from('coaching_sessions')
    .select('id, user_id, created_at, transcript_text, transcript_language, analysis_data')
    .eq('id', sessionId).eq('user_id', user.id).maybeSingle();
  if (!session) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  const { data: quiz } = await supabase.from('quizzes')
    .select('id, status, topic, subject, language, meta, coaching_session_id')
    .eq('coaching_session_id', sessionId).eq('quiz_source', 'transcript').maybeSingle();

  // The quiz language is hers to choose here too — a lesson picked from /quiz
  // reaches exactly the same decision as a "yes" on the offer. The subject
  // rule seeds the button order; only Urdu and Islamiyat skip the ask.
  const subject = quiz?.subject || session.analysis_data?.subject || null;
  const ruleLanguage = quiz?.language || quizLanguageFor(subject, session.transcript_language);
  const ask = needsLanguageAsk(subject);

  if (!quiz) {
    if (ask) {
      const { data: created, error } = await supabase.from('quizzes').insert({
        teacher_id: user.id, quiz_source: 'transcript', coaching_session_id: sessionId,
        topic: session.analysis_data?.topic || 'Lesson', subject: session.analysis_data?.subject || null,
        language: null,
        status: 'offered',
        meta: {
          step: 'awaiting_language', awaiting_language: true,
          source: 'list', claimed_at: new Date().toISOString(),
        },
      }).select('id').single();
      if (error || !created) {
        logToFile('⚠️ transcript quiz: list claim failed', { sessionId, error: error?.message });
        await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
        return true;
      }
      await sendLanguageAsk(created.id, phone, lang, ruleLanguage);
      logEvent('transcript_quiz.language_asked', { userId: user.id, quizId: created.id, ruleLanguage, from: 'list' });
      return true;
    }
    const claimed = await claimForGeneration({
      userId: user.id, sessionId, session, quiz: null, quizLanguage: ruleLanguage,
    });
    if (claimed.error) {
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    }
    await enqueueGenerate(claimed.quizId, phone, lang);
    logEvent('transcript_quiz.list_generate', { userId: user.id, quizId: claimed.quizId, from: 'none' });
    return true;
  }

  switch (quiz.status) {
    case 'generating':
    case 'ready':
      await WhatsAppService.sendMessage(phone, resolveUx('tqStillMaking', { language: lang }));
      return true;
    case 'sent':
    case 'report_sent': {
      const counts = await countsFor([quiz.id], user.id);
      const c = counts.get(quiz.id) || { started: 0, finished: 0 };
      // Named for what they DO. "Report now" read as "show me the one I have";
      // this button refetches every session and recomputes (operator, item 8).
      // The third button exists because a tap into a lesson was otherwise a
      // dead end — she had to type /quiz again to get back to the menu.
      await WhatsAppService.sendInteractiveButtons(phone, {
        body: resolveUx('tqQuizStatus', {
          language: lang,
          params: {
            topic: normaliseTopic(quiz.topic || session.analysis_data?.topic || ''),
            date: formatLessonDate(session.created_at, lang),
            started: c.started, finished: c.finished,
          },
        }),
        buttons: [
          { id: `${LINK_PREFIX}${quiz.id}`, title: resolveUx('tqLinkButton', { language: lang }) },
          { id: `${REPORT_PREFIX}${quiz.id}`, title: resolveUx('tqReportButton', { language: lang }) },
          { id: `${BACK_PREFIX}${quiz.id}`, title: resolveUx('tqBackButton', { language: lang }) },
        ],
      });
      return true;
    }
    default: {
      // offered / declined / skipped / failed / cancelled → (re)make it, after
      // the language ask where the subject leaves a real choice.
      if (ask) {
        await supabase.from('quizzes')
          .update({
            status: 'offered',
            meta: {
              ...(quiz.meta || {}), step: 'awaiting_language', awaiting_language: true,
              source: 'list', retried_at: new Date().toISOString(),
            },
          })
          .eq('id', quiz.id);
        await sendLanguageAsk(quiz.id, phone, lang, ruleLanguage);
        logEvent('transcript_quiz.language_asked', { userId: user.id, quizId: quiz.id, ruleLanguage, from: 'list' });
        return true;
      }
      const claimed = await claimForGeneration({
        userId: user.id, sessionId, session, quiz, quizLanguage: ruleLanguage,
      });
      await enqueueGenerate(quiz.id, phone, lang);
      logEvent('transcript_quiz.list_generate', { userId: user.id, quizId: quiz.id, from: claimed.from });
      return true;
    }
  }
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
    // The SAME hand-off she got after her coaching debrief: the pre-send PDF
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
  loadEligibleSessions, hasEligibleLessons, quizState, claimForGeneration, enqueueGenerate,
  PICK_PREFIX, LINK_PREFIX, REPORT_PREFIX, PAGE_PREFIX, BACK_PREFIX, MAX_ROWS, PER_PAGE,
};
