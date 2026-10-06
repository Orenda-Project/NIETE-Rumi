'use strict';
/**
 * /quiz "My quiz reports" (W37, M3 SPEC §1.2) — the teacher's SENT quizzes,
 * newest first, each with who played and the average; a tap sends that quiz's
 * live report link (teacher-report-link).
 *
 *   row id      tqr_<quizId>            paging  tqr_page_<n>
 *   title       `date · subject`        (composeTitle, 24 code points — the lesson list's own rule)
 *   description `topic · 12/31 played · avg 68%`   (72 code points)
 *               `topic · 3 played · avg 68%`       when the quiz's class is not known
 *               `topic · no one yet`               when nobody has finished
 *
 * The counts are teacher-report.data's (class codes, self-tests and invited
 * friends out, one attempt per child by attemptRuleFor, the class by
 * web-quiz-roster pickList), so a row and the report page it opens show the
 * same numbers. One page costs a fixed five reads — quizzes, class codes,
 * sessions, class lists, children — whatever the number of rows; never one
 * per quiz.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { composeTitle, composeLabelledDescription, normaliseTopic, truncateWords } = require('./transcript-quiz-rows');
const { teacherLanguageFor, formatLessonDate, subjectLabel } = require('./transcript-quiz-language');
const Data = require('./teacher-report.data');

const ROW_PREFIX = 'tqr_';
const PAGE_PREFIX = 'tqr_page_';
const PER_PAGE = 9;            // 9 quizzes + one "Older quizzes…" row (WhatsApp's cap is 10 rows)
const TITLE_MAX = 24;
const DESC_MAX = 72;
const SENT = ['sent', 'report_sent'];
const QUIZ_COLS = 'id, teacher_id, topic, subject, grade, language, quiz_source, status, list_id, meta, created_at';
const SEP = ' · ';
const cpLen = (s) => [...String(s)].length;
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const pct = (correct, total) => (total > 0 ? Math.round((100 * correct) / total) : 0);

/** The teacher's sent quizzes, newest first — enough for page `p` and one more. */
async function loadSentQuizzes(teacherId, needed) {
  const { data, error } = await supabase.from('quizzes').select(QUIZ_COLS)
    .eq('teacher_id', teacherId).in('status', SENT)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, needed));
  if (error) throw new Error(error.message);
  return data || [];
}

/** { [quizId]: { played, of, avg } } for these quizzes, in five reads. */
async function statsFor(teacherId, quizzes) {
  const out = new Map();
  if (!quizzes.length) return out;
  const codes = await Data.classCodes(teacherId, quizzes.map((q) => q.id));
  const quizOfCode = new Map(codes.map((c) => [c.id, c.quiz_id]));
  const counted = Data.countedSessions(await Data.sessionsFor(codes.map((c) => c.id)), teacherId);
  const scores = new Map();
  counted.forEach((s) => {
    const q = quizOfCode.get(s.share_code_id);
    if (!scores.has(q)) scores.set(q, []);
    scores.get(q).push(pct(s.correct_answers || 0, s.total_questions_answered || 0));
  });
  let roster = null;
  try { roster = await Data.readRoster(teacherId); } catch (err) {
    // The counts still stand without the class size: "N played".
    logToFile('⚠️ quiz reports: class list read failed — rows without "of"', { userId: teacherId, error: err.message });
  }
  quizzes.forEach((q) => {
    const s = scores.get(q.id) || [];
    const { roster: r } = Data.classOf(roster, q, null);
    out.set(q.id, { played: s.length, of: r.state === 'known' ? r.of : null, avg: mean(s) });
  });
  return out;
}

function statusOf(stat, language) {
  if (!stat || !stat.played) return resolveUx('tqrRowNoOne', { language });
  const params = { played: stat.played, avg: stat.avg == null ? 0 : stat.avg };
  return stat.of
    ? resolveUx('tqrRowPlayedOf', { language, params: { ...params, of: stat.of } })
    : resolveUx('tqrRowPlayed', { language, params });
}

/**
 * The row description. The counts are what this list is for, so unlike the
 * lesson list (where the topic owns the field) the topic is word-cut first to
 * leave room for them; then the shared clamp runs.
 */
function describe(topic, status, language) {
  const raw = normaliseTopic(topic);
  const room = DESC_MAX - cpLen(status) - cpLen(SEP) - 2; // 2 = the bidi isolate a mixed-script topic may need
  const fitted = raw && cpLen(raw) > room ? truncateWords(raw, Math.max(1, room)) : raw;
  return composeLabelledDescription({ label: '', topic: fitted, status }, DESC_MAX, { language });
}

/** Pure: quizzes + stats → one page of rows. */
function buildReportRows(quizzes, stats, language, { page = 1 } = {}) {
  const p = Number.isFinite(page) && page > 0 ? page : 1;
  const start = (p - 1) * PER_PAGE;
  const slice = quizzes.slice(start, start + PER_PAGE);
  const hasMore = quizzes.length > start + PER_PAGE;
  const rows = slice.map((q) => ({
    id: `${ROW_PREFIX}${q.id}`,
    title: composeTitle({
      date: formatLessonDate((q.meta && q.meta.lesson_date) || q.created_at, language),
      subject: subjectLabel(q.subject, language),
    }, TITLE_MAX),
    description: describe(q.topic || resolveUx('tqLessonWord', { language }), statusOf(stats.get(q.id), language), language),
  }));
  if (hasMore) {
    rows.push({
      id: `${PAGE_PREFIX}${p + 1}`,
      title: resolveUx('tqrRowOlder', { language }),
      description: resolveUx('tqrRowOlderDesc', { language }),
    });
  }
  return { rows, page: p, from: slice.length ? start + 1 : 0, to: start + slice.length };
}

async function showReports(user, phone, language, page = 1) {
  const lang = teacherLanguageFor({ preferredLanguage: language || (user && user.preferred_language) });
  let p = Number.isFinite(page) && page > 0 ? page : 1;
  const quizzes = await loadSentQuizzes(user.id, p * PER_PAGE + 1);
  // A stale "Older quizzes…" tapped later can ask for a page that is gone: show the first.
  if (quizzes.length <= (p - 1) * PER_PAGE) p = 1;
  const visible = quizzes.slice((p - 1) * PER_PAGE, p * PER_PAGE);
  if (!visible.length) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqrListEmpty', { language: lang }));
    logEvent('quiz_menu.reports_empty', { userId: user.id });
    return true;
  }
  const stats = await statsFor(user.id, visible);
  const { rows, from, to } = buildReportRows(quizzes, stats, lang, { page: p });
  await WhatsAppService.sendInteractiveMessage(phone, {
    header: { type: 'text', text: resolveUx('tqrListHeader', { language: lang, params: { from, to } }) },
    body: { text: resolveUx('tqrListBody', { language: lang }) },
    action: {
      button: resolveUx('tqrListButton', { language: lang }),
      sections: [{ title: resolveUx('tqrListSection', { language: lang }), rows }],
    },
  });
  logEvent('quiz_menu.reports_shown', { userId: user.id, rows: rows.length, page: p });
  return true;
}

/** A row of the list (tqr_<quizId>) or its paging row (tqr_page_<n>). False for any other id. */
async function handleReportsPick(listId, phone, user) {
  if (!listId || !listId.startsWith(ROW_PREFIX) || !user || !user.id) return false;
  const lang = teacherLanguageFor({ preferredLanguage: user.preferred_language });
  if (listId.startsWith(PAGE_PREFIX)) {
    const n = parseInt(listId.slice(PAGE_PREFIX.length), 10);
    await showReports(user, phone, lang, Number.isFinite(n) && n > 0 ? n : 1);
    return true;
  }
  const quizId = listId.slice(ROW_PREFIX.length);
  // Only the teacher's own quiz; anything else is "not found" (never whose it is).
  const { data: quiz } = await supabase.from('quizzes').select(QUIZ_COLS)
    .eq('id', quizId).eq('teacher_id', user.id).maybeSingle();
  if (!quiz) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return true;
  }
  // The row's own counts ride on the link message (the same reads as the row: five, once).
  const stats = await statsFor(user.id, [quiz]);
  const Link = require('./teacher-report-link');
  await Link.sendTeacherReportLink({
    teacher: user, phone, quizId: quiz.id, topic: normaliseTopic(quiz.topic || ''), counts: stats.get(quiz.id) || null, language: lang,
  });
  return true;
}

module.exports = {
  showReports, handleReportsPick, buildReportRows, statsFor, ROW_PREFIX, PAGE_PREFIX, PER_PAGE,
};
