'use strict';
/**
 * THE TOPIC-END NUDGE (bd-pw1ccr.4) — one button, after she teaches the last day of a topic.
 *
 * A group B teacher takes the plan for a topic's last day (WhatsApp delivery, or a read in the app). At 14:30 PKT,
 * after the lesson is taught, the bot offers "Make my paper": one signed-in tap opens the paper generator on the
 * Topics step for that chapter (app-login-link feature assessment_topic_nudge). Which topic, and when: topic-end.js.
 *
 * ONE A DAY. The row is the teacher_nudges UNIQUE (user_id, nudge_date, kind). A second topic ending the same day
 * collides and is dropped (logged as already_nudged_today); the first one booked is the one she hears about.
 *
 * ONCE A TOPIC. Re-checked at send: a sent row for the same topic_id means a re-take of the same plan says nothing.
 *
 * WINDOW SHUT. Only the sweeper writes a row, so a retry is a NEW row on the next school day of the same week
 * (topic-end.retryDate), and this row is skipped as window_closed with the retry date beside it. None after Friday.
 *
 * Never at the cost of the lesson: booking never throws; a guard that cannot be answered books nothing.
 * The send throws only when Meta refuses it, so the sweeper marks the row failed.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { pktDate, atPkt, deferQuietHours } = require('./pkt-time');
const WhatsAppService = require('../whatsapp.service');
const { resolveUx, clampLanguage, subjectLabelFor } = require('../../config/ux-strings');
const Arm = require('./topic-end-arm');
const {
  SEND_HOUR, SEND_MINUTE, topicsSubject, topicEndingAt, scheduleFor, retryDate,
} = require('./topic-end');

/** The `teacher_nudges.kind` this service owns (V1.8.4). */
const KIND = 'topic_end_nudge';

/** The app-login-link feature the button signs. */
const LINK_FEATURE = 'assessment_topic_nudge';

/** The Meta customer-service window, on users.last_message_at. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** An app open older than this is a late retry: the day has moved on. */
const STALE_OPEN_MS = 6 * 60 * 60 * 1000;

const no = (reason) => ({ scheduled: false, reason });

/**
 * Book the nudge if this lesson is the last day of a topic. Never throws.
 * @returns {Promise<{scheduled: boolean, reason?: string, nudgeId?: string, nudgeDate?: string}>}
 */
async function onLessonDelivered({ userId, lessonId, deliveredAt = null, assetKind = 'lesson' } = {}) {
  try {
    if (!(await Arm.enabled())) return no('disabled');
    if (assetKind !== 'lesson') return no('not_a_lesson');
    if (!userId || !lessonId) return no('missing_field');
    if (!(await Arm.inGroupB(userId))) return no('not_in_group_b');

    const found = require('../lp-v8-catalog.service').lessonById(lessonId);
    if (!found) return no('unknown_plan');
    const { lesson, chapter, book } = found;
    const subject = topicsSubject(book.subject_key);
    if (!subject) return no('no_topics');

    const topics = await require('../assessment/topics/topics.repo').listChapterTopics(book.grade, subject, chapter.number);
    const hit = topicEndingAt({ lessons: chapter.lessons, topics, segmentIndex: lesson.segment_index });
    if (!hit.topic) return no(hit.reason);

    const taken = deliveredAt ? new Date(deliveredAt) : new Date();
    const { nudgeDate, scheduledAt } = scheduleFor(taken);
    const context = {
      topic_id: hit.topic.topicId,
      topic_name: hit.topic.name,
      grade: book.grade,
      subject,
      chapter: chapter.number,
      lesson_id: lessonId,
      taken_at: taken.toISOString(),
    };
    const store = require('./teacher-nudges.store');
    const { row, created } = await store.schedule({ userId, kind: KIND, nudgeDate, scheduledAt, context });

    logEvent('topic_nudge.scheduled', {
      userId, lessonId, topicId: context.topic_id, nudgeId: row && row.id, nudgeDate, created: Boolean(created),
    });
    return {
      scheduled: Boolean(created),
      reason: created ? undefined : 'already_nudged_today',
      nudgeId: row && row.id,
      nudgeDate,
      scheduledAt: new Date(scheduledAt).toISOString(),
    };
  } catch (err) {
    logToFile('❌ topic nudge: could not be decided — not booked', { userId, lessonId, error: err && err.message }, 'error');
    return no('guard_unavailable');
  }
}

/** A K-5 plan read in the app books the same nudge, from the open time. Never throws. */
async function onAppOpen({ openId, now = new Date() } = {}) {
  try {
    if (!openId || typeof openId !== 'string') return no('open_not_found');
    const { data: open, error } = await supabase
      .from('niete_lp_opens').select('id, user_id, plan_kind, plan_ref, opened_at')
      .eq('id', openId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!open) return no('open_not_found');
    if (open.plan_kind !== 'k5') return no('not_k5');
    const openedAt = new Date(open.opened_at);
    const age = new Date(now).getTime() - openedAt.getTime();
    if (!Number.isFinite(age) || age > STALE_OPEN_MS) return no('stale_open');
    return await onLessonDelivered({ userId: open.user_id, lessonId: open.plan_ref, deliveredAt: openedAt.toISOString() });
  } catch (err) {
    logToFile('❌ topic nudge: app open could not be decided — not booked', { openId, error: err && err.message }, 'error');
    return no('guard_unavailable');
  }
}

function skip(row, reason, extra = {}) {
  logEvent('topic_nudge.skipped', { nudgeId: row.id, userId: row.user_id, reason, ...extra });
  return Object.keys(extra).length ? { skipped: reason, context: extra } : { skipped: reason };
}

async function loadUser(userId) {
  const { data, error } = await supabase
    .from('users').select('id, phone_number, preferred_language, last_message_at')
    .eq('id', userId).maybeSingle();
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  return data || null;
}

/** A sent nudge for the same topic, other than this row. */
async function alreadyNudged(row) {
  const topicId = row.context && row.context.topic_id;
  const history = (await require('./teacher-nudges.store').rowsFor(row.user_id, { kind: KIND })) || [];
  return history.some((r) => r && r.id !== row.id && r.status === 'sent' && r.context && r.context.topic_id === topicId);
}

/** Book the same nudge for the next school day of this week, if there is one. Returns the date or null. */
async function bookRetry(row) {
  const next = retryDate(row.nudge_date);
  if (!next) return null;
  const store = require('./teacher-nudges.store');
  await store.schedule({
    userId: row.user_id,
    kind: KIND,
    nudgeDate: next,
    scheduledAt: atPkt(next, SEND_HOUR, SEND_MINUTE),
    context: { ...(row.context || {}), retry_of: row.id },
  });
  return next;
}

/** The sweeper hands this a claimed row. Returns {sent, messageIds, context} or {skipped, context}. */
async function send(row, { now = new Date() } = {}) {
  if (!(await Arm.enabled())) return skip(row, 'disabled');
  const at = now instanceof Date ? now : new Date(now);
  const userId = row.user_id;
  const context = row.context || {};

  const user = await loadUser(userId);
  if (!user || !user.phone_number) return skip(row, 'no_lesson', { why: 'user_missing' });
  if (!(await Arm.inGroupB(userId))) return skip(row, 'disabled', { why: 'not_in_group_b' });
  if (await alreadyNudged(row)) return skip(row, 'already_nudged_topic', { topic_id: context.topic_id || null });
  if (!(await require('../app-redirect.service').isOnTeacherApp(userId))) return skip(row, 'not_on_app');

  const last = user.last_message_at ? Date.parse(user.last_message_at) : NaN;
  if (!Number.isFinite(last) || at.getTime() - last > WINDOW_MS) {
    const retry = await bookRetry(row);
    return skip(row, 'window_closed', { retry_date: retry });
  }
  if (deferQuietHours(at).getTime() !== at.getTime()) return skip(row, 'quiet_hours');

  const base = String(require('../../config/branding').portalUrl() || '').replace(/\/+$/, '');
  const prefill = { grade: context.grade, subject: context.subject, chapter: context.chapter };
  const token = base ? require('../app-login-link').signAppLink(userId, LINK_FEATURE, null, prefill) : null;
  if (!token) throw new Error('topic nudge: no portal link to send');

  const language = clampLanguage(user.preferred_language);
  const body = resolveUx('topicNudgeBody', {
    language,
    params: {
      topic: context.topic_name,
      grade: context.grade,
      subject: subjectLabelFor(context.subject, language) || context.subject,
    },
  });
  const messageIds = [];
  const delivered = await WhatsAppService.sendCtaUrl(user.phone_number, {
    body,
    buttonText: resolveUx('topicNudgeButton', { language }),
    url: `${base}/go/${token}`,
  }, { onMessageId: (id) => messageIds.push(id) });
  if (!delivered) throw new Error('topic nudge not delivered');

  logEvent('topic_nudge.sent', { nudgeId: row.id, userId, language, topicId: context.topic_id || null, sentOn: pktDate(at) });
  return { sent: true, messageIds, context: { language, topic_id: context.topic_id || null } };
}

// Registered at load, like the coaching ask: the sweeper claims only kinds something in the process registered.
try {
  require('./teacher-nudges.sweeper').register(KIND, send);
} catch (err) {
  logToFile('topic nudge: sweeper registration failed — no nudges will be sent', { error: err.message }, 'error');
}

module.exports = { KIND, LINK_FEATURE, STALE_OPEN_MS, onLessonDelivered, onAppOpen, send };
