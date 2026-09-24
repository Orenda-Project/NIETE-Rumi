'use strict';
/**
 * /quiz lesson provider — the K-5 lesson plans (lp_v8) a teacher TOOK.
 *
 * Listed in the quiz menu before any quiz exists, labelled "From lesson plan",
 * and made into a quiz ONLY when the teacher taps one — the recording's
 * behaviour exactly. The quiz is the row the 15:00 offer writes (quiz_source
 * 'lp_v8', `meta.lessons`, `meta.class`, `meta.lesson_date`), goes through the
 * same language ask and the same queue step, so everything downstream (the
 * author, the PDF, the hand-off, the report, the scorecard) cannot tell which
 * door it came through except by `meta.source` ('list' | 'flow').
 *
 * WHAT IS LISTED — a lesson is offered only if a quiz can really be made from it:
 *   - the teacher's own `niete_lp_downloads` with status 'sent', last 30 days;
 *   - whose asset is a LESSON (an answer key is never a quiz source);
 *   - not an assessment day (`_seg995`, D9);
 *   - whose EXACT served version (lesson_id, version_stamp, content_hash) has a
 *     slide script in `niete_lp_asset_sources` — the key resolveSlideScript
 *     uses; the 13 KB script itself is never read here;
 *   - and that no lp_v8 quiz covers yet (its quiz row stands for it).
 * One row per lesson (its newest delivery). A store error lists NOTHING — a
 * lesson we cannot prove makeable is never offered — and says so at error
 * level (on production the source table does not exist until V1.5.2).
 *
 * Load (Class R): one indexed read of the teacher's downloads
 * (idx_lp_downloads_user_time), then three IN reads over at most 200 ids, on a
 * command a teacher sends by hand.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx } = require('../../config/ux-strings');
const { LP_V8 } = require('./quiz-sources');
const { needsLanguageAsk, quizLanguageFor, teacherLanguageFor } = require('./transcript-quiz-language');
const LessonClaim = require('./lp-lesson-claim');
const Funnel = require('./quiz-funnel');

const SOURCE = LP_V8;
const LABEL_KEY = 'tqRowFromLessonPlan';
const WINDOW_DAYS = 30;
const MAX_DOWNLOADS = 200;
const IN_CHUNK = 200;
const ASSESSMENT_SUFFIX = '_seg995';
const DOWNLOAD_SELECT = 'id, user_id, lesson_id, asset_id, version_stamp, content_hash, grade, subject, status, created_at';

/** The 15:00 offer owns the lesson-date rule (D2), the catalog topic and the subject names. */
function offer() {
  return require('../nudges/lp-quiz-offer.service');
}

const versionKey = (r) => `${r.lesson_id}|${r.version_stamp}|${r.content_hash}`;

function chunks(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** PostgREST's answer for a table this database does not have (PGRST205 / 42P01). */
function isMissingTable(error) {
  const code = String((error && error.code) || '');
  return code === 'PGRST205' || code === '42P01'
    || /does not exist|schema cache/i.test(String((error && error.message) || ''));
}

function mustRead(label, { data, error }) {
  if (error) {
    const err = new Error(`${label}: ${error.message || error}`);
    err.missingTable = isMissingTable(error);
    throw err;
  }
  return data || [];
}

/**
 * The source store (V1.5.2) is absent on a database that has not had the
 * migration — production until the LP stream is switched on. That is a
 * deployment state, not a fault: /quiz lists no lesson plan (correctly: none
 * can be made there) and it is said at warn, once per ten minutes per process,
 * instead of an error on every teacher's /quiz. Any other failure is an error.
 */
const MISSING_TABLE_WARN_MS = 10 * 60 * 1000;
let lastMissingWarnAt = 0;

/** Asset ids that are a LESSON (not an answer key). */
async function lessonAssetIds(assetIds) {
  const found = new Set();
  for (const part of chunks([...new Set(assetIds.filter(Boolean))])) {
    // eslint-disable-next-line no-await-in-loop
    const rows = mustRead('lp lesson provider: assets', await supabase.from('niete_lp_assets')
      .select('id, asset_kind').in('id', part));
    rows.forEach((r) => { if (r.asset_kind === 'lesson') found.add(r.id); });
  }
  return found;
}

/** Version keys that have an ingested slide script — the quiz's only source. */
async function resolvableVersions(rows) {
  const found = new Set();
  const lessonIds = [...new Set(rows.map((r) => r.lesson_id))];
  for (const part of chunks(lessonIds)) {
    // eslint-disable-next-line no-await-in-loop
    const sources = mustRead('lp lesson provider: sources', await supabase.from('niete_lp_asset_sources')
      .select('lesson_id, version_stamp, content_hash').in('lesson_id', part));
    sources.forEach((s) => found.add(versionKey(s)));
  }
  return found;
}

/** Catalog lesson ids some lp_v8 quiz of this teacher already covers. */
async function coveredLessonIds(teacherId, sinceIso) {
  // Every lesson any of the teacher's lp_v8 quizzes covers — the claim reads
  // the same rows for one lesson (LessonClaim.covers); here all at once.
  const { data, error } = await supabase.from('quizzes')
    .select(LessonClaim.COVERAGE_SELECT)
    .eq('teacher_id', teacherId).eq('quiz_source', SOURCE).gte('created_at', sinceIso);
  if (error) throw new Error(`lp lesson provider: quizzes: ${error.message || error}`);
  const out = new Set();
  (data || []).forEach((q) => LessonClaim.lessonIdsOf(q).forEach((id) => out.add(id)));
  return out;
}

/** A PKT school day as the instant /quiz sorts and prints it (noon PKT, as lessonSessionFor pins it). */
function lessonDateIso(deliveredAt) {
  return `${offer().cohortRuleDate(deliveredAt)}T12:00:00+05:00`;
}

function toItem(row) {
  const topic = offer().catalogTopic(row.lesson_id);
  return {
    source: SOURCE,
    lessonRef: row.id,
    lessonId: row.lesson_id,
    date: lessonDateIso(row.created_at),
    deliveredAt: row.created_at,
    grade: row.grade == null ? null : row.grade,
    subject: row.subject || null,
    topic: topic || null,
    lesson: {
      lesson_id: row.lesson_id,
      asset_id: row.asset_id,
      version_stamp: row.version_stamp,
      content_hash: row.content_hash,
      delivered_at: row.created_at,
    },
  };
}

/** Keep the rows a quiz can be made from (kind, day, source), newest delivery per lesson. */
async function makeable(rows) {
  const candidates = rows.filter((r) => r.asset_id && r.status === 'sent'
    && !String(r.lesson_id || '').endsWith(ASSESSMENT_SUFFIX));
  if (!candidates.length) return [];
  const lessons = await lessonAssetIds(candidates.map((r) => r.asset_id));
  const seen = new Set();
  const newest = [];
  candidates
    .filter((r) => lessons.has(r.asset_id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((r) => { if (!seen.has(r.lesson_id)) { seen.add(r.lesson_id); newest.push(r); } });
  if (!newest.length) return [];
  const ok = await resolvableVersions(newest);
  return newest.filter((r) => ok.has(versionKey(r)));
}

function sinceIso(since) {
  return since ? new Date(since).toISOString() : new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
}

/**
 * The teacher's lesson-plan lessons with no quiz yet, newest first.
 * @param {string} teacherId
 * @param {{since?: string|Date, limit?: number}} [opts]
 * @returns {Promise<Array<{source, lessonRef, lessonId, date, deliveredAt, grade, subject, topic, lesson}>>}
 */
async function list(teacherId, { since = null, limit = 20 } = {}) {
  if (!teacherId) return [];
  const from = sinceIso(since);
  try {
    const rows = mustRead('lp lesson provider: downloads', await supabase.from('niete_lp_downloads')
      .select(DOWNLOAD_SELECT)
      .eq('user_id', teacherId).eq('status', 'sent').gte('created_at', from)
      .order('created_at', { ascending: false })
      .limit(MAX_DOWNLOADS));
    const ready = await makeable(rows);
    const covered = ready.length ? await coveredLessonIds(teacherId, from) : new Set();
    const items = ready.filter((r) => !covered.has(r.lesson_id)).map(toItem)
      .sort((a, b) => (new Date(b.date) - new Date(a.date)) || (new Date(b.deliveredAt) - new Date(a.deliveredAt)));
    logEvent('quiz_menu.lesson_listed', {
      userId: teacherId, source: SOURCE, listed: items.length, covered: ready.length - items.length,
    });
    return items.slice(0, Math.max(0, limit));
  } catch (err) {
    if (err.missingTable) {
      if (Date.now() - lastMissingWarnAt > MISSING_TABLE_WARN_MS) {
        lastMissingWarnAt = Date.now();
        logToFile('⚠️ quiz menu: the lesson-plan source store is not on this database — no lesson plan is listed', { error: err.message }, 'warn');
      }
      logEvent('quiz_menu.lesson_list_failed', { userId: teacherId, source: SOURCE, reason: 'source_store_missing' });
      return [];
    }
    logToFile('❌ quiz menu: lesson plans could not be listed — none offered', { userId: teacherId, error: err.message }, 'error');
    logEvent('quiz_menu.lesson_list_failed', { userId: teacherId, source: SOURCE, reason: 'read_failed', error: err.message });
    return [];
  }
}

/**
 * One of the teacher's lessons by its delivery id — only if a quiz can be made
 * from it. Owner-filtered in the query, never afterwards.
 * @returns {Promise<object|null>}
 */
async function get(teacherId, lessonRef) {
  if (!teacherId || !lessonRef) return null;
  const { data, error } = await supabase.from('niete_lp_downloads')
    .select(DOWNLOAD_SELECT)
    .eq('id', lessonRef).eq('user_id', teacherId).eq('status', 'sent')
    .maybeSingle();
  if (error) throw new Error(`lp lesson provider: download read failed — ${error.message || error}`);
  if (!data) return null;
  const [ok] = await makeable([data]);
  return ok ? toItem(ok) : null;
}

/**
 * The quiz that covers this lesson now, if one was made since the list was
 * drawn (from /quiz or the 15:00 offer) — the Flow's lesson screen then shows
 * that quiz instead of a second "make".
 */
async function existingQuiz(teacherId, item) {
  if (!teacherId || !item) return null;
  const since = new Date(new Date(item.deliveredAt).getTime() - 86400000).toISOString();
  const [quiz] = await LessonClaim.coveringQuizzes(teacherId, [item.lessonId], { since });
  return quiz || null;
}

/** The quizzes row for a lesson picked in /quiz — the 15:00 offer's shape, one lesson. */
async function insertQuiz(teacherId, item, { askLanguage, quizLanguage, via }) {
  const O = offer();
  const { data, error } = await supabase.from('quizzes')
    .insert({
      teacher_id: teacherId,
      quiz_source: SOURCE,
      coaching_session_id: null,
      lesson_plan_id: null,
      topic: item.topic || `${O.subjectName(item.subject, 'en')} lesson`,
      grade: item.grade == null ? null : String(item.grade),
      subject: item.subject || null,
      language: quizLanguage || null,
      status: askLanguage ? 'offered' : 'generating',
      meta: {
        step: askLanguage ? 'awaiting_language' : 'digest',
        ...(askLanguage ? { awaiting_language: true } : {}),
        ...(quizLanguage ? { language_choice: quizLanguage } : {}),
        ...(askLanguage ? {} : { accepted_at: new Date().toISOString() }),
        source: via === 'flow' ? 'flow' : 'list',
        lessons: [item.lesson],
        class: { grade: item.grade, subject: item.subject },
        lesson_date: O.cohortRuleDate(item.deliveredAt),
        claimed_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`lp lesson provider: quiz insert failed — ${error ? error.message : 'no row'}`);
  return data.id;
}

/**
 * The teacher tapped a lesson: make its quiz — once.
 *
 * @param {object} teacher users row ({id, preferred_language})
 * @param {string} lessonRef the delivery id the row carried
 * @param {object} ctx
 * @param {string} ctx.phone
 * @param {string|null} [ctx.quizLanguage] chosen on the Flow's lesson screen; absent from
 *   the list message, where the subject rule decides whether to ask
 * @param {'list'|'flow'} [ctx.via]
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
    await WhatsAppService.sendMessage(phone, resolveUx('tqLpLessonUnavailable', { language: lang }));
    return done('unavailable');
  }

  const askLanguage = !quizLanguage && needsLanguageAsk(item.subject);
  const claim = await LessonClaim.claimLessons({
    teacherId: userId,
    lessonIds: [item.lessonId],
    since: new Date(new Date(item.deliveredAt).getTime() - 86400000).toISOString(),
    insert: () => insertQuiz(userId, item, { askLanguage, quizLanguage, via }),
    via,
  });

  if (!claim.won) {
    // One quiz per lesson: nothing new is made, and nothing is said here — the
    // caller answers with the quiz that exists (list service answerTakenLesson),
    // which is how a tap on its own quiz row is answered.
    const out = done('already', claim.existing ? claim.existing.id : null);
    return { ...out, existing: claim.existing || null };
  }

  const TranscriptQuizOffer = require('./transcript-quiz-offer.service');
  if (askLanguage) {
    // The ask the recording and the 15:00 offer send; its answer
    // (tq_lang_<code>_<quizId>) runs startGenerating → queueLpQuiz.
    await TranscriptQuizOffer.sendLanguageAsk(claim.quizId, phone, lang, quizLanguageFor(item.subject, null), {
      subject: item.subject,
    });
    return done('asked', claim.quizId);
  }
  const queued = await TranscriptQuizOffer.queueLpQuiz({ quizId: claim.quizId, nudgeId: null, phone, language: lang });
  if (queued) {
    // No language left to ask (Urdu/Islamiyat, or chosen on the Flow): the tap IS
    // the commitment. The asked path emits it when the language is answered.
    Funnel.emit('accepted', {
      quiz_id: claim.quizId, teacher_id: userId, source: SOURCE, channel: Funnel.channelOf(via === 'flow' ? 'flow' : 'list'),
    });
  }
  return done(queued ? 'queued' : 'queue_failed', claim.quizId);
}

module.exports = {
  source: SOURCE,
  labelKey: LABEL_KEY,
  list,
  get,
  existingQuiz,
  start,
};
