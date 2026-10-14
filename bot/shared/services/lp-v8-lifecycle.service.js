'use strict';
/**
 * Grades 1-5 in the PORTAL and the teacher app: one teacher's ask → its lesson-plan lifecycle row.
 *
 * A registered teacher who asks for a plan on WhatsApp is sent into the teacher app and reads it there:
 * the portal asks the bot for the lesson's PDF (POST /api/internal/lp/v8/pdf, which records here) and
 * shows it. WhatsApp asks for the same lessons are recorded inside lp-v8-delivery; both write the same
 * source (niete_v8_segment), so the two channels count the same way.
 *
 * ONE ASK, NOT ONE FETCH. The portal can fetch the same PDF several times for one tap — a re-render, a
 * double tap, the viewer falling back to another app — so the same lesson asked again by the same
 * teacher within SAME_ASK_MS is the same ask. The portal's own open log (niete_lp_opens) draws the line
 * at the same five minutes for the same reason.
 *
 * Switched by LP_LIFECYCLE_PATHS (niete_v8_segment); off, nothing here touches the database. Never
 * throws: every failure resolves to null and the teacher's plan is served exactly as before.
 */

const supabase = require('../config/supabase');
const Lifecycle = require('./lesson-plan-lifecycle.service');
const V8Catalog = require('./lp-v8-catalog.service');
const { logToFile } = require('../utils/logger');

const { SOURCES, CHANNELS, ERROR_CODES } = Lifecycle.LIFECYCLE;
const SOURCE = SOURCES.NIETE_V8_SEGMENT;
const SAME_ASK_MS = 5 * 60 * 1000;
/** How far before an app open to look for the ask that served the plan she opened. */
const OPEN_LOOKBACK_MS = 30 * 60 * 1000;
/** The same 200-character name lp-v8-delivery gives the lesson (lessonPlanTopic), so a portal row and
 *  a WhatsApp row for one lesson read alike. Not imported: suites stand in a partial lp-v8-delivery. */
const TOPIC_MAX = 200;

function topicOf(hit, lessonId) {
  const lesson = hit && hit.lesson;
  const raw = String((lesson && (lesson.topic_short || lesson.topic || lesson.section)) || lessonId || 'Lesson plan');
  return raw.length <= TOPIC_MAX ? raw : `${raw.slice(0, TOPIC_MAX - 1).trim()}…`;
}

/** Her ask for this lesson in the portal inside the last SAME_ASK_MS, if there is one. Throws on a
 *  failed read (the caller decides what an unanswerable check means). */
async function askedJustNow(userId, lessonId) {
  const { data, error } = await supabase
    .from('lesson_plan_requests')
    .select('id')
    .eq('user_id', userId)
    .eq('source', SOURCE)
    .eq('channel', CHANNELS.PORTAL)
    .eq('artifact_ref', lessonId)
    .gte('created_at', new Date(Date.now() - SAME_ASK_MS).toISOString())
    .limit(1);
  if (error) throw new Error(error.message || 'lifecycle read failed');
  return Array.isArray(data) && data.length > 0;
}

/**
 * A lesson PDF the bot handed to the portal for one teacher: completed when the PDF was there, failed
 * (NO_ASSET) when it was not. An answer key, or a fetch with no teacher named, is not a lesson-plan ask.
 * Resolves to the row id, or null (switched off, not an ask, the same ask again, or the write failed).
 *
 * @param {{ userId: string|null, lessonId: string, assetKind?: 'lesson'|'answer_key',
 *           available: boolean, askedAt?: string }} p
 */
async function recordPortalLesson({ userId, lessonId, assetKind = 'lesson', available, askedAt, error = null } = {}) {
  try {
    if (!Lifecycle.enabled(SOURCE)) return null;
    if (assetKind !== 'lesson' || !userId || !lessonId) return null;
    try {
      if (await askedJustNow(userId, lessonId)) return null;
    } catch (err) {
      // Cannot tell whether she asked a moment ago: record it. One extra row is recoverable in a query;
      // a lost ask is not. Said, so a failing read is not invisible.
      logToFile('⚠️ LP v8 portal lifecycle: same-ask check failed — recording this fetch anyway', { lessonId, error: err.message }, 'warn');
    }
    const hit = V8Catalog.lessonById(lessonId);
    const book = hit && hit.book;
    // `error`: the PDF exists in the catalogue but could not be handed over (the link failed) — a failed
    // delivery, not a missing plan.
    let outcome;
    if (error) {
      outcome = { status: 'failed', generatedAt: askedAt, errorCode: ERROR_CODES.DELIVERY_FAILED, errorMessage: `PDF link failed: ${error.message || error}` };
    } else if (available) {
      // The PDF is pre-rendered: it existed when she asked.
      outcome = { status: 'completed', generatedAt: askedAt };
    } else {
      outcome = { status: 'failed', generatedAt: null, errorCode: ERROR_CODES.NO_ASSET, errorMessage: 'no current PDF for this lesson' };
    }
    return await Lifecycle.recordOutcome({
      userId,
      topic: topicOf(hit, lessonId),
      source: SOURCE,
      channel: CHANNELS.PORTAL,
      grade: book ? book.grade : null,
      subject: book ? book.subject_key : null,
      artifactRef: lessonId,
      askedAt,
      ...outcome,
    });
  } catch (err) {
    logToFile('⚠️ LP v8 portal lifecycle: recording threw — the portal was answered; this ask is not recorded', { lessonId, error: err && err.message }, 'warn');
    return null;
  }
}

/**
 * The portal ask that served the plan she then opened in the app's viewer — so the plan row the
 * survey hangs off can name it. Null when switched off, when there is none, or when the read fails.
 */
async function portalAskFor({ userId, lessonId, openedAt } = {}) {
  if (!Lifecycle.enabled(SOURCE) || !userId || !lessonId) return null;
  try {
    const at = Date.parse(openedAt) || Date.now();
    const { data, error } = await supabase
      .from('lesson_plan_requests')
      .select('id')
      .eq('user_id', userId)
      .eq('source', SOURCE)
      .eq('channel', CHANNELS.PORTAL)
      .eq('artifact_ref', lessonId)
      .eq('status', 'completed')
      .gte('created_at', new Date(at - OPEN_LOOKBACK_MS).toISOString())
      .lte('created_at', new Date(at + 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    return data[0].id || null;
  } catch (err) {
    logToFile('⚠️ LP v8 portal lifecycle: could not find the ask behind an app open — the plan row is written without it', { lessonId, error: err && err.message }, 'warn');
    return null;
  }
}

module.exports = { recordPortalLesson, portalAskFor };
