'use strict';
/**
 * /quiz lesson provider — the Grades 6-12 lesson plans a teacher RECEIVED (quiz_source 'lp612').
 *
 * Listed in the quiz menu before any quiz exists, labelled "From lesson plan", and made into a
 * quiz ONLY when the teacher taps one — the recording's behaviour and the K-5 plans' (operator,
 * 24 Sep 2026). Contract: quiz-lesson-providers.js — {source, labelKey, list, start, get,
 * existingQuiz}.
 *
 * WHAT IS LISTED — a lesson is offered only if a quiz can be made from it:
 *   - the teacher's own rows in `niete_lp612_deliveries` (the ledger lp612-serving.deliverRender
 *     writes after a confirmed send), the last 30 days, the newest delivery per (segment, language);
 *   - not a held lesson (`is_religious`, unless LP_612_RELIGIOUS_ENABLED), not an assessment day
 *     (`lp_type = 'assessment'`), in a subject the quiz is on for (TRANSCRIPT_QUIZ_SUBJECTS);
 *   - and that no lp612 quiz of this teacher covers yet.
 * The quiz is written from the EXACT stored document of that delivery (lp612-quiz-source), which
 * every production render since 6 Sep 2026 has; a lesson whose document is missing fails
 * `source_missing` with the lesson-plan copy, as a K-5 lesson without its slide script does.
 *
 * KILL SWITCH: QUIZ_LP612_SOURCE (quiz-sources.lp612SourceOn, read at call time). Not `on`: nothing
 * is listed, nothing is read, a tap is answered as unavailable — and the generate step writes no
 * lp612 quiz. A quiz already made is not gated anywhere.
 *
 * ONE QUIZ PER LESSON: a Redis lock per (teacher, segment, language) around read-covered → insert →
 * re-read-and-keep-the-oldest (the K-5 claim's shape; Class P — never check-then-act alone), so a
 * double tap or two replicas make one quiz.
 *
 * Load (Class R): one indexed read of the teacher's ledger (idx_lp612_deliveries_user_recent),
 * one IN read of at most 80 segments and one read of the teacher's recent lp612 quizzes, on a
 * command a teacher sends by hand.
 */

const supabase = require('../../../config/supabase');
const redisService = require('../../cache/railway-redis.service');
const WhatsAppService = require('../../whatsapp.service');
const { logToFile } = require('../../../utils/logger');
const { logEvent } = require('../../../utils/structured-logger');
const { resolveUx } = require('../../../config/ux-strings');
const { LP612, lp612SourceOn } = require('../quiz-sources');
const {
  canonicalSubject, needsLanguageAsk, quizLanguageFor, teacherLanguageFor,
} = require('../transcript-quiz-language');
const Deliveries = require('../../lp612-deliveries.store');

const SOURCE = LP612;
const LABEL_KEY = 'tqRowFromLessonPlan';
const WINDOW_DAYS = 30;
const LOCK_TTL_SECS = 30;

/** The 6-12 books' subject names → the subjects the quiz pipeline speaks. */
const SUBJECT_612 = {
  mathematics: 'maths',
  physics: 'science',
  chemistry: 'science',
  biology: 'science',
  'general science': 'science',
  'computer science': 'science',
  'computer studies': 'science',
  history: 'sst',
  geography: 'sst',
  'pakistan studies': 'sst',
  'social studies': 'sst',
};
function quizSubject(bookSubject) {
  const raw = String(bookSubject || '').trim().toLowerCase();
  return SUBJECT_612[raw] || canonicalSubject(bookSubject);
}

function enabled() {
  return lp612SourceOn();
}

function religiousAllowed() {
  return String(process.env.LP_612_RELIGIOUS_ENABLED || '').trim().toLowerCase() === 'true';
}

/** The subject gate every lesson quiz obeys (transcript-quiz-offer.subjectAllowed). */
function subjectAllowed(subject) {
  return require('../transcript-quiz-offer.service').subjectAllowed(subject);
}

/** The 15:00 offer's lesson-date rule: a lesson taken after the cutoff is for the next school day. */
function lessonDate(deliveredAt) {
  return require('../../nudges/lp-quiz-offer.service').cohortRuleDate(deliveredAt);
}

const lessonKey = (row) => `${row.segment_id}|${row.lang}`;

function sinceIso(since) {
  return since ? new Date(since).toISOString() : new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
}

async function segmentsById(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('niete_lp612_segments')
    .select('segment_id, grade, subject, subtopic_title, menu_title, lp_type, is_religious')
    .in('segment_id', unique);
  if (error) throw new Error(`lp612 provider: segments: ${error.message || error}`);
  return new Map((data || []).map((s) => [s.segment_id, s]));
}

/** The teacher's lp612 quizzes (since `since`) — each covers the lesson in its meta.lessons[0]. */
async function coveringQuizzes(teacherId, since) {
  let q = supabase.from('quizzes')
    .select('id, status, created_at, meta, language, subject, topic, quiz_source, teacher_id')
    .eq('teacher_id', teacherId).eq('quiz_source', SOURCE);
  if (since) q = q.gte('created_at', since);
  const { data, error } = await q;
  if (error) throw new Error(`lp612 provider: quizzes: ${error.message || error}`);
  return (data || []).sort((a, b) => (new Date(a.created_at) - new Date(b.created_at)) || (String(a.id) < String(b.id) ? -1 : 1));
}
function covers(quiz, key) {
  const lessons = (quiz && quiz.meta && Array.isArray(quiz.meta.lessons)) ? quiz.meta.lessons : [];
  return lessons.some((l) => l && lessonKey(l) === key);
}

/** A delivery + its segment → a menu item, or null when no quiz can be made from it. */
function toItem(row, segment) {
  if (!row || !segment) return null;
  if (segment.lp_type === 'assessment') return null;
  if (segment.is_religious && !religiousAllowed()) return null;
  const subject = quizSubject(segment.subject);
  if (!subjectAllowed(subject)) return null;
  const title = segment.subtopic_title || segment.menu_title || null;
  return {
    source: SOURCE,
    lessonRef: row.id,
    date: `${lessonDate(row.delivered_at)}T12:00:00+05:00`,
    deliveredAt: row.delivered_at,
    grade: segment.grade == null ? null : segment.grade,
    subject,
    topic: title,
    lesson: {
      segment_id: row.segment_id,
      lang: row.lang,
      template_version: row.template_version,
      render_id: row.render_id || null,
      delivered_at: row.delivered_at,
      title,
    },
  };
}

/**
 * The teacher's 6-12 lessons with no quiz yet, newest first. Never throws.
 * @returns {Promise<Array<{source, lessonRef, date, deliveredAt, grade, subject, topic, lesson}>>}
 */
async function list(teacherId, { since = null, limit = 20 } = {}) {
  if (!teacherId || !enabled()) return [];
  const from = sinceIso(since);
  try {
    const rows = await Deliveries.recentForTeacher(teacherId, { since: from, limit: Math.max(1, limit) * 2 });
    if (!rows.length) return [];
    const segments = await segmentsById(rows.map((r) => r.segment_id));
    const quizzes = await coveringQuizzes(teacherId, from);
    const items = rows
      .filter((r) => !quizzes.some((q) => covers(q, lessonKey(r))))
      .map((r) => toItem(r, segments.get(r.segment_id)))
      .filter(Boolean)
      .sort((a, b) => (new Date(b.date) - new Date(a.date)) || (new Date(b.deliveredAt) - new Date(a.deliveredAt)));
    logEvent('quiz_menu.lesson_listed', { userId: teacherId, source: SOURCE, listed: items.length, delivered: rows.length });
    return items.slice(0, Math.max(0, limit));
  } catch (err) {
    logToFile('❌ quiz menu: 6-12 lessons could not be listed — none offered', { userId: teacherId, error: err.message }, 'error');
    logEvent('quiz_menu.lesson_list_failed', { userId: teacherId, source: SOURCE, reason: 'read_failed', error: err.message });
    return [];
  }
}

/** One of the teacher's 6-12 lessons by its delivery id — only if a quiz can be made from it. */
async function get(teacherId, lessonRef) {
  if (!teacherId || !lessonRef || !enabled()) return null;
  const row = await Deliveries.byIdForTeacher(lessonRef, teacherId);
  if (!row) return null;
  const segments = await segmentsById([row.segment_id]);
  return toItem(row, segments.get(row.segment_id));
}

/** The quiz that covers this lesson now, if one was made since the list was drawn. */
async function existingQuiz(teacherId, item) {
  if (!teacherId || !item || !item.lesson) return null;
  const since = new Date(new Date(item.deliveredAt).getTime() - 86400000).toISOString();
  return (await coveringQuizzes(teacherId, since)).find((q) => covers(q, lessonKey(item.lesson))) || null;
}

async function insertQuiz(teacherId, item, { askLanguage, quizLanguage, via }) {
  const { data, error } = await supabase.from('quizzes')
    .insert({
      teacher_id: teacherId,
      quiz_source: SOURCE,
      coaching_session_id: null,
      lesson_plan_id: null,
      topic: item.topic || 'Lesson',
      grade: item.grade == null ? null : String(item.grade),
      subject: item.subject || null,
      language: quizLanguage || null,
      status: askLanguage ? 'offered' : 'generating',
      meta: {
        step: askLanguage ? 'awaiting_language' : 'digest',
        ...(askLanguage ? { awaiting_language: true } : {}),
        ...(quizLanguage ? { language_choice: quizLanguage } : {}),
        source: via === 'flow' ? 'flow' : 'list',
        lessons: [item.lesson],
        class: { grade: item.grade, subject: item.subject },
        lesson_date: lessonDate(item.deliveredAt),
        claimed_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`lp612 provider: quiz insert failed — ${error ? error.message : 'no row'}`);
  return data.id;
}

/** One quiz per (teacher, lesson, language), whichever tap or replica asks. */
async function claim(teacherId, item, insert) {
  const key = `quiz:lesson-claim:${SOURCE}:${teacherId}:${lessonKey(item.lesson)}`;
  const since = new Date(new Date(item.deliveredAt).getTime() - 86400000).toISOString();
  let held = false;
  try {
    try { held = await redisService.setNX(key, { at: Date.now() }, LOCK_TTL_SECS); } catch (err) {
      held = true;   // the re-read below keeps it single when Redis is away
      logToFile('⚠️ lp612 provider: lock unavailable — relying on the re-read', { error: err.message }, 'warn');
    }
    const covering = async () => (await coveringQuizzes(teacherId, since)).filter((q) => covers(q, lessonKey(item.lesson)));
    if (!held) return { won: false, existing: (await covering())[0] || null };
    const before = await covering();
    if (before.length) return { won: false, existing: before[0] };
    const quizId = await insert();
    const [winner] = await covering();
    if (winner && winner.id !== quizId) {
      const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
      if (error) logToFile('❌ lp612 provider: could not remove the losing quiz row', { quizId, error: error.message }, 'error');
      return { won: false, existing: winner };
    }
    return { won: true, quizId };
  } finally {
    if (held) {
      try { await redisService.delete(key); } catch (err) {
        logToFile('⚠️ lp612 provider: unlock failed (the lock expires on its own)', { error: err.message }, 'warn');
      }
    }
  }
}

/**
 * The teacher tapped a 6-12 lesson: make its quiz — once.
 * @returns {Promise<{outcome: 'asked'|'queued'|'queue_failed'|'already'|'unavailable', quizId?: string}>}
 */
async function start(teacher, lessonRef, { phone, quizLanguage = null, via = 'list' } = {}) {
  const lang = teacherLanguageFor({ preferredLanguage: teacher && teacher.preferred_language });
  const userId = (teacher && teacher.id) || null;
  const done = (outcome, quizId = null) => {
    logEvent('quiz_menu.lesson_picked', { userId, source: SOURCE, quizId, outcome, via });
    return { outcome, ...(quizId ? { quizId } : {}) };
  };

  const item = userId ? await get(userId, lessonRef) : null;
  if (!item) {
    await WhatsAppService.sendMessage(phone, resolveUx('tqNotYours', { language: lang }));
    return done('unavailable');
  }

  const askLanguage = !quizLanguage && needsLanguageAsk(item.subject);
  const won = await claim(userId, item, () => insertQuiz(userId, item, { askLanguage, quizLanguage, via }));
  if (!won.won) {
    if (won.existing) {
      const List = require('../transcript-quiz-list.service');
      await List.handleListPick(`${List.LP_PICK_PREFIX}${won.existing.id}`, phone, teacher);
    } else {
      await WhatsAppService.sendMessage(phone, resolveUx('tqAlreadyMaking', { language: lang }));
    }
    return done('already', won.existing ? won.existing.id : null);
  }

  const TranscriptQuizOffer = require('../transcript-quiz-offer.service');
  if (askLanguage) {
    await TranscriptQuizOffer.sendLanguageAsk(won.quizId, phone, lang, quizLanguageFor(item.subject, item.lesson.lang), {
      subject: item.subject,
    });
    return done('asked', won.quizId);
  }
  const queued = await TranscriptQuizOffer.queueLpQuiz({ quizId: won.quizId, nudgeId: null, phone, language: lang });
  return done(queued ? 'queued' : 'queue_failed', won.quizId);
}

module.exports = {
  source: SOURCE,
  labelKey: LABEL_KEY,
  list,
  get,
  existingQuiz,
  start,
  quizSubject,
  enabled,
};
