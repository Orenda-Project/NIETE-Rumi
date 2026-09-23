'use strict';
/**
 * THE COACHING ASK — one message, on the first lesson plan a teacher takes in a day.
 *
 * A teacher downloads a lesson plan; a little later the bot asks whether they
 * would like that lesson recorded and coached. Nothing about this asks for a new
 * action: the lesson is about to be taught either way, and the ask is for the
 * mic button two teachers in three already hold for their recordings.
 *
 * WHY THE ROW, NOT A COUNTER. "The first lesson plan of the day" is not counted
 * anywhere. It is the `teacher_nudges` UNIQUE (user_id, nudge_date, kind): the
 * second download of the day schedules the same key, the INSERT collides, and
 * the store answers `created:false`. Two replicas racing the same delivery land
 * in the same place. A count would have to be read, and a read is a race.
 *
 * WHEN. Delivered before 14:00 PKT → the ask follows the lesson by
 * LP_COACHING_ASK_DELAY_MINUTES (default 10 — long enough that it can never
 * land inside the 30-second LP feedback survey). Delivered at or
 * after 14:00 → the lesson is taught or about to be; the ask waits for 07:30 on the
 * next school day, which is the morning the teacher can act on it. Every time is put
 * through `deferQuietHours`, so nothing is ever booked for the night.
 *
 * NEVER AT THE COST OF THE LESSON. The caller wraps this in its own try/catch
 * AND everything here is defensive, because the teacher's PDF has already been
 * sent by the time it runs. A missing table, a failed insert, a lane that has
 * not merged — all of it is a log line, never a thrown error.
 *
 * SEND (the sweeper hands `send` a claimed row). Everything the teacher's day
 * may have done since the booking is re-checked, in ladder order; the first hit
 * is returned as `{skipped: reason}` and the SWEEPER writes it — this module
 * never marks its own row, so a row has exactly one writer per tick.
 *
 * ANSWER. `lpask_yes_<id>` reuses the menu's Classroom Coaching door
 * (`MenuService._handleClassroomCoachingChoice`) — one entry, one instruction;
 * `lpask_no_<id>` is a one-line acknowledgement and nothing else that day.
 *
 * Flags, all no-op when unset: LP_COACHING_ASK_ENABLED, LP_COACHING_ASK_DELAY_MINUTES,
 * LP_COACHING_ASK_WEEKLY_CAP (2), LP_COACHING_HOWTO_VIDEO_EN / _UR (clip URLs).
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const {
  pktDate, pktHour, nextSchoolDay, atPkt, deferQuietHours,
} = require('./pkt-time');
const WhatsAppService = require('../whatsapp.service');
const FeatureIntro = require('../feature-intro.service');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { canSelfCoach } = require('../../config/role-features');
const Caps = require('./caps');
const { flagOn } = require('./flags');
const { shouldDeferNewClassroomAudio } = require('../coaching/coaching-inflight-guard');
const { formatLessonDate } = require('../quiz/transcript-quiz-language');

/** The `teacher_nudges.kind` this service owns. */
const KIND = 'coaching_after_lp';

/** After this PKT hour the school day is over — the ask waits for the next morning. */
const AFTERNOON_CUTOFF_HOUR = 14;

/** The morning slot on the next school day. */
const MORNING_HOUR = 7;
const MORNING_MINUTE = 30;

/** Default gap between the lesson landing and the ask. */
const DEFAULT_DELAY_MINUTES = 10;

function enabled() {
  return flagOn('LP_COACHING_ASK_ENABLED');
}

/**
 * The delay in minutes. Unreadable or negative values fall back to the default
 * rather than to zero: a zero here would put the ask inside the survey window.
 */
function delayMinutes() {
  const raw = (process.env.LP_COACHING_ASK_DELAY_MINUTES || '').trim();
  if (raw === '') return DEFAULT_DELAY_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DELAY_MINUTES;
}

/**
 * PURE. When the ask for a lesson delivered at `deliveredAt` should go out, and
 * which PKT day it belongs to.
 *
 * @param {Date|string|number} deliveredAt
 * @returns {{nudgeDate: string, scheduledAt: Date, branch: 'same_day'|'next_school_day'}}
 */
function scheduleFor(deliveredAt, { delay = delayMinutes() } = {}) {
  const at = new Date(deliveredAt);
  const day = pktDate(at);

  if (pktHour(at) < AFTERNOON_CUTOFF_HOUR) {
    const scheduledAt = deferQuietHours(new Date(at.getTime() + delay * 60000));
    return { nudgeDate: day, scheduledAt, branch: 'same_day' };
  }

  const nextDay = nextSchoolDay(day);
  return {
    nudgeDate: nextDay,
    scheduledAt: deferQuietHours(atPkt(nextDay, MORNING_HOUR, MORNING_MINUTE)),
    branch: 'next_school_day',
  };
}

/**
 * Has this teacher ever had a coaching session of their own?
 *
 * `observation_type='leader_observation'` rows carry the TEACHER's user_id but
 * belong to a coach who observed the teacher — being observed is not the
 * same as having recorded a lesson, and the first-time copy would be
 * wrong if it counted them. The `or()` form keeps the pre-column NULL rows that
 * a bare `.neq` silently drops.
 *
 * Never throws: on any error the teacher is treated as a returning one, which
 * is the quieter of the two copies.
 */
async function hasCoachedBefore(userId) {
  try {
    const { data, error } = await supabase
      .from('coaching_sessions')
      .select('id')
      .eq('user_id', userId)
      .or('observation_type.is.null,observation_type.neq.leader_observation')
      .limit(1);
    if (error) {
      logToFile('lp coaching ask: coached-before lookup failed', { userId, error: error.message });
      return true;
    }
    return Array.isArray(data) ? data.length > 0 : Boolean(data);
  } catch (err) {
    logToFile('lp coaching ask: coached-before lookup threw', { userId, error: err.message });
    return true;
  }
}

/**
 * Coaches, school leaders and AEOs take lesson plans too, and cannot have their
 * own lesson coached (role-features `dc:false`) — the menu refuses them the
 * Classroom Coaching door, so the ask must not open it for them. An unreadable
 * role is treated as a teacher's, as role-features does for an unknown one.
 */
async function selfCoaches(userId) {
  try {
    const { data, error } = await supabase.from('users').select('id, role').eq('id', userId).maybeSingle();
    if (error) {
      logToFile('lp coaching ask: role lookup failed', { userId, error: error.message }, 'error');
      return true;
    }
    return canSelfCoach(data || {});
  } catch (err) {
    logToFile('lp coaching ask: role lookup threw', { userId, error: err.message }, 'error');
    return true;
  }
}

/**
 * Called from `lp-v8-delivery.service.deliverV8Lesson`, immediately after the
 * 'sent' download row and only for the LESSON asset — an answer key rides along
 * with the same delivery and must not book a second ask.
 *
 * @returns {Promise<{scheduled: boolean, reason?: string, nudgeId?: string, nudgeDate?: string, scheduledAt?: string}>}
 */
async function onLessonDelivered({
  userId, lessonId, assetId = null, versionStamp = null, contentHash = null,
  deliveredAt = null, assetKind = 'lesson',
} = {}) {
  if (!enabled()) return { scheduled: false, reason: 'disabled' };
  if (assetKind !== 'lesson') return { scheduled: false, reason: 'not_a_lesson' };
  if (!userId || !lessonId) return { scheduled: false, reason: 'missing_field' };

  if (!(await selfCoaches(userId))) return { scheduled: false, reason: 'not_self_coach' };

  const delivered = deliveredAt ? new Date(deliveredAt) : new Date();
  const { nudgeDate, scheduledAt, branch } = scheduleFor(delivered);
  const coachedBefore = await hasCoachedBefore(userId);

  const store = require('./teacher-nudges.store');
  const { row, created } = await store.schedule({
    userId,
    kind: KIND,
    nudgeDate,
    scheduledAt,
    context: {
      lesson_id: lessonId,
      asset_id: assetId,
      version_stamp: versionStamp,
      content_hash: contentHash,
      delivered_at: delivered.toISOString(),
      first_time: !coachedBefore,
    },
  });

  logEvent('lp_ask.scheduled', {
    userId, lessonId, nudgeId: row && row.id, nudgeDate, branch,
    scheduledAt: new Date(scheduledAt).toISOString(), created: Boolean(created),
    firstTime: !coachedBefore,
  });

  return {
    scheduled: Boolean(created),
    reason: created ? undefined : 'already_asked_today',
    nudgeId: row && row.id,
    nudgeDate,
    scheduledAt: new Date(scheduledAt).toISOString(),
  };
}

// ─── send ────────────────────────────────────────────────────────────────────

/** The intro-video key the how-to clip is counted under. */
const HOWTO_FEATURE = 'lp_coaching_howto';
/** The clip rides the first N sends of the ask, never more. */
const HOWTO_MAX_SHOWS = 2;
const DEFAULT_WEEKLY_CAP = 2;
/** The free-form service window: a free-form send needs an inbound message in the last 24 h. */
const WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * "In progress" is the voice handler's own rule (coaching-inflight-guard: an
 * analysis running, 30-minute window) plus the waiting-for-the-teacher steps —
 * a photo or a lesson plan still owed — for WAITING_WINDOW_MS. The bound stops
 * a gate nobody ever closed (about forty teachers were once stuck at one) from
 * silencing the ask for good.
 */
const WAITING_STATUSES = new Set(['conducting_conversation', 'awaiting_classroom_photo', 'awaiting_photo', 'awaiting_lesson_plan']);
const WAITING_WINDOW_MS = 12 * 60 * 60 * 1000;
/** How far back the coaching read looks — the longest window above. */
const IN_PROGRESS_LOOKBACK_MS = WAITING_WINDOW_MS;

function weeklyCap() {
  const raw = (process.env.LP_COACHING_ASK_WEEKLY_CAP || '').trim();
  if (raw === '') return DEFAULT_WEEKLY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEEKLY_CAP;
}

function howtoUrl(language) {
  const v = process.env[`LP_COACHING_HOWTO_VIDEO_${String(language).toUpperCase()}`];
  return v && v.trim() ? v.trim() : null;
}

/** The teacher's own sessions — a coach observing them is not one (see hasCoachedBefore). */
function ownSession(s) {
  return s && s.observation_type !== 'leader_observation';
}

async function loadUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, phone_number, preferred_language, last_message_at, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  return data || null;
}

/**
 * coached_today / in_progress_coaching, from one read. The filters are applied
 * in the query AND re-applied here, so the rule is the code's, not the index's.
 */
async function coachingReason(userId, now, today) {
  const since = new Date(now.getTime() - IN_PROGRESS_LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from('coaching_sessions')
    .select('id, status, created_at, observation_type')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`coaching lookup failed: ${error.message}`);
  const own = (data || []).filter(ownSession);
  if (own.some((s) => s.created_at && pktDate(new Date(s.created_at)) === today)) return 'coached_today';
  const latest = own[0];
  if (latest) {
    const age = now.getTime() - Date.parse(latest.created_at || '');
    if (shouldDeferNewClassroomAudio(latest, now.getTime())) return 'in_progress_coaching';
    if (WAITING_STATUSES.has(String(latest.status || '')) && age >= 0 && age <= WAITING_WINDOW_MS) return 'in_progress_coaching';
  }
  return null;
}

/** offered_today — a transcript-quiz offer already went out to this teacher today. */
async function offeredToday(userId, now, today) {
  const since = new Date(now.getTime() - 2 * WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, created_at, meta')
    .eq('teacher_id', userId)
    .gte('created_at', since)
    .limit(20);
  if (error) throw new Error(`quiz lookup failed: ${error.message}`);
  return (data || []).some((q) => {
    const at = q && q.meta && q.meta.offered_at;
    return Boolean(at) && pktDate(new Date(at)) === today;
  });
}

/**
 * PURE. The body the ask is sent with, and its params.
 *
 * A lesson delivered at or after 14:00 is asked about at 07:30 on the NEXT
 * school day (scheduleFor), so the "today" bodies would tell an evening planner
 * they planned the lesson that morning. When the PKT day of the send is later
 * than the PKT day of `context.delivered_at`, the NextDay bodies say when it was
 * planned: "yesterday", or the date when a weekend sits between. A row with no
 * readable `delivered_at` keeps the "today" copy it was booked with.
 *
 * @param {{first_time?:boolean, delivered_at?:string}} context the row's context
 * @param {string} today the PKT date the ask goes out, YYYY-MM-DD
 * @param {string} language the teacher's language
 * @returns {{key:string, params?:{when:string}}}
 */
function askBody(context, today, language) {
  const firstTime = Boolean(context && context.first_time);
  const delivered = context && context.delivered_at ? new Date(context.delivered_at) : null;
  const plannedDay = delivered && !Number.isNaN(delivered.getTime()) ? pktDate(delivered) : null;
  if (!plannedDay || plannedDay >= today) {
    return { key: firstTime ? 'lpAskBodyFirstTime' : 'lpAskBody' };
  }
  const yesterday = pktDate(new Date(delivered.getTime() + 24 * 60 * 60 * 1000)) === today;
  const when = yesterday
    ? resolveUx('lpAskWhenYesterday', { language })
    : resolveUx('lpAskWhenOnDate', { language, params: { date: formatLessonDate(delivered.toISOString(), language) } });
  return { key: firstTime ? 'lpAskBodyFirstTimeNextDay' : 'lpAskBodyNextDay', params: { when } };
}

/** `extra` rides into the row's context via the sweeper's markSkipped. */
function skip(row, reason, extra = {}) {
  logEvent('lp_ask.skipped', { nudgeId: row.id, userId: row.user_id, reason, ...extra });
  return Object.keys(extra).length ? { skipped: reason, context: extra } : { skipped: reason };
}

/**
 * The handler the sweeper calls with a claimed `coaching_after_lp` row.
 * @returns {Promise<{sent:true, messageIds:string[], context:Object}|{skipped:string}>}
 *          — throws when the ask itself could not be delivered (the row fails).
 */
async function send(row, { now = new Date() } = {}) {
  if (!enabled()) return skip(row, 'disabled');

  const at = now instanceof Date ? now : new Date(now);
  const today = pktDate(at);
  const userId = row.user_id;

  const user = await loadUser(userId);
  if (!user || !user.phone_number) return skip(row, 'no_lesson', { why: 'user_missing' });
  // Screened at booking already; a role that changed overnight lands here. The
  // SKIP_REASONS vocabulary is closed, so it is 'disabled' with the why beside it.
  if (!canSelfCoach(user)) return skip(row, 'disabled', { why: 'not_self_coach', role: user.role || null });

  const coaching = await coachingReason(userId, at, today);
  if (coaching) return skip(row, coaching);

  if (await offeredToday(userId, at, today)) return skip(row, 'offered_today');

  const store = require('./teacher-nudges.store');
  const history = (await store.rowsFor(userId, { kind: KIND })) || [];
  const others = history.filter((r) => r && r.id !== row.id);
  const cap = Caps.capReason(others, { nudgeDate: row.nudge_date || today, cap: weeklyCap() });
  if (cap) return skip(row, cap);

  const last = user.last_message_at ? Date.parse(user.last_message_at) : NaN;
  if (!Number.isFinite(last) || at.getTime() - last > WINDOW_MS) return skip(row, 'window_closed');

  // Booked through deferQuietHours, so reaching here at night means the sweeper
  // was down for hours; a morning ask at 22:00 is stale, not deferred.
  if (deferQuietHours(at).getTime() !== at.getTime()) return skip(row, 'quiet_hours');

  const language = clampLanguage(user.preferred_language);
  const to = user.phone_number;
  const context = row.context || {};

  const { key: bodyKey, params: bodyParams } = askBody(context, today, language);
  const body = resolveUx(bodyKey, { language, params: bodyParams });
  const buttons = [
    { id: `lpask_yes_${row.id}`, title: resolveUx('lpAskYes', { language }) },
    { id: `lpask_no_${row.id}`, title: resolveUx('lpAskNo', { language }) },
  ];
  // Meta's message id, kept on the row (context.message_ids); the boolean the
  // send returns stays the delivery verdict.
  const messageIds = [];
  const sendOpts = { onMessageId: (id) => messageIds.push(id) };

  // THE CLIP IS THE ASK'S HEADER. Sent as its own video message first, the clip
  // arrived AFTER the ask on a real phone: Meta fetches a linked video before it
  // delivers it, so a text-sized message sent a moment later overtook it. One
  // interactive message with a video header is one delivery — the order cannot
  // flip. The caption is the footer under the clip.
  let howto = false;
  const clip = howtoUrl(language);
  let shown = null;
  if (clip) {
    try {
      shown = await FeatureIntro.introShownCount(userId, HOWTO_FEATURE);
    } catch (err) {
      logToFile('lp coaching ask: how-to count unreadable, sending the plain ask', { nudgeId: row.id, userId, error: err.message }, 'error');
    }
  }
  if (clip && shown !== null && shown < HOWTO_MAX_SHOWS) {
    howto = await WhatsAppService.sendVideoWithButtons(to, clip, body, buttons, {
      ...sendOpts, footer: resolveUx('lpAskHowtoCaption', { language }),
    });
    if (howto) {
      logEvent('lp_ask.howto_shown', { nudgeId: row.id, userId, language, shownBefore: shown });
      try {
        await FeatureIntro.markVideoShown(userId, HOWTO_FEATURE, { incrementIntroCount: true });
      } catch (err) {
        // The teacher has the ask; only the showing count missed a beat.
        logToFile('lp coaching ask: how-to shown but not counted', { nudgeId: row.id, userId, error: err.message }, 'error');
      }
    } else {
      logToFile('lp coaching ask: the ask with its how-to clip was not delivered, sending the plain ask', { nudgeId: row.id, userId }, 'error');
    }
  }

  const delivered = howto || await WhatsAppService.sendInteractiveButtons(to, { body, buttons }, sendOpts);
  if (!delivered) throw new Error('coaching ask buttons not delivered');

  logEvent('lp_ask.sent', {
    nudgeId: row.id, userId, language, firstTime: Boolean(context.first_time), howto,
    lessonId: context.lesson_id || null,
  });
  return { sent: true, messageIds, context: { language, howto, body: bodyKey } };
}

// ─── prepare: yesterday's unanswered asks are "ignored" ──────────────────────

let ignoredSweptFor = null;

/**
 * An ask nobody answered stays `sent` with no choice; on the first tick of the
 * next PKT day it is called `ignored`. Neutral for the caps — only an
 * explicit "no" counts toward the declined streak. One bulk UPDATE, bounded to
 * the past week, run once per PKT day per process; idempotent, so a second
 * replica doing the same is a no-op.
 */
async function markIgnored({ now = new Date() } = {}) {
  if (!enabled()) return 0;
  const today = pktDate(now instanceof Date ? now : new Date(now));
  if (ignoredSweptFor === today) return 0;
  const weekAgo = pktDate(new Date(new Date(now).getTime() - 7 * WINDOW_MS));
  const { data, error } = await supabase
    .from('teacher_nudges')
    .update({ choice: 'ignored', updated_at: new Date().toISOString() })
    .eq('kind', KIND)
    .eq('status', 'sent')
    .is('choice', null)
    .lt('nudge_date', today)
    .gte('nudge_date', weekAgo)
    .select('id');
  if (error) {
    logToFile('lp coaching ask: marking unanswered asks ignored failed', { error: error.message }, 'error');
    return 0;
  }
  ignoredSweptFor = today;
  const n = (data || []).length;
  if (n) logEvent('lp_ask.answered', { choice: 'ignored', count: n, nudgeDate: today });
  return n;
}

// ─── answer ──────────────────────────────────────────────────────────────────

const BUTTON_RE = /^lpask_(yes|no)_([0-9a-fA-F-]{36})$/;

/**
 * `lpask_yes_<id>` / `lpask_no_<id>`. Returns false for any other id so the
 * dispatcher can fall through.
 *
 * The answer is recorded only on a row that belongs to the tapping user; the
 * reply goes out either way, because the teacher's intent is plain from the
 * tap even when the row is missing (deleted, or another deployment's id).
 */
async function handleButton(buttonId, from, user) {
  const m = BUTTON_RE.exec(String(buttonId || ''));
  if (!m) return false;
  const choice = m[1];
  const nudgeId = m[2];
  const userId = user && user.id;
  const language = clampLanguage(user && user.preferred_language);

  try {
    const { data: row, error } = await supabase
      .from('teacher_nudges')
      .select('id, user_id, kind, choice')
      .eq('id', nudgeId)
      .maybeSingle();
    if (error) {
      logToFile('lp coaching ask: answer lookup failed', { nudgeId, error: error.message }, 'error');
    } else if (row && row.user_id === userId && row.kind === KIND) {
      const store = require('./teacher-nudges.store');
      const ok = await store.recordAnswer(nudgeId, { choice });
      if (!ok) logToFile('lp coaching ask: answer not recorded', { nudgeId, choice }, 'error');
    } else {
      logToFile('lp coaching ask: tap on a row this user does not own', { nudgeId, userId, found: Boolean(row) }, 'warn');
    }
  } catch (err) {
    logToFile('lp coaching ask: recording the answer threw', { nudgeId, error: err.message }, 'error');
  }
  logEvent('lp_ask.answered', { nudgeId, userId, choice });

  if (choice === 'yes') {
    const MenuService = require('../menu.service');
    const { getOrCreateSession } = require('../../database/bot-helpers');
    const sessionId = await getOrCreateSession(userId);
    await MenuService._handleClassroomCoachingChoice(userId, sessionId, from, language);
  } else {
    await WhatsAppService.sendMessage(from, resolveUx('lpAskDeclined', { language }));
  }
  return true;
}

// ─── the short-recording catch ────────────────────────────────────────

/** A "yes" is this fresh for this long: the lesson is taught the same morning. */
const YES_WINDOW_MS = 8 * 60 * 60 * 1000;
/** Probed length band that is "part of a lesson" — under 5 min is a chat voice note. */
const TOO_SHORT_MIN_SECONDS = 5 * 60;
const TOO_SHORT_MAX_SECONDS = 15 * 60; // exclusive: 900 s and up is a classroom recording

/**
 * The teacher tapped "Record my lesson" and then sent 5–15 minutes. That is
 * not a question for the assistant — it is a lesson recording that is too short
 * to coach, and the reply has to say so instead of answering it as chat.
 *
 * `seconds` must be the PROBED length: WhatsApp reports no duration for a voice
 * note, so an unprobed 0 is "unknown", never "short".
 *
 * @returns {Promise<boolean>} true = replied; the caller stops handling this audio.
 */
async function catchShortRecording({ user, from, seconds, path = 'voice', now = new Date() } = {}) {
  if (!enabled() || !user || !user.id) return false;
  const secs = Number(seconds) || 0;
  if (secs < TOO_SHORT_MIN_SECONDS || secs >= TOO_SHORT_MAX_SECONDS) return false;

  try {
    const since = new Date(new Date(now).getTime() - YES_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from('teacher_nudges')
      .select('id, answered_at, choice')
      .eq('user_id', user.id)
      .eq('kind', KIND)
      .eq('choice', 'yes')
      .gte('answered_at', since)
      .order('answered_at', { ascending: false })
      .limit(1);
    if (error) {
      logToFile('lp coaching ask: yes lookup failed — audio handled as usual', { userId: user.id, error: error.message }, 'error');
      return false;
    }
    const row = (data || []).find((r) => r && r.choice === 'yes' && r.answered_at && Date.parse(r.answered_at) >= Date.parse(since));
    if (!row) return false;

    const { getUserLanguage } = require('../../utils/language-cache');
    const language = clampLanguage(await getUserLanguage(user.id));
    const minutes = Math.round(secs / 60);
    await WhatsAppService.sendMessage(from, resolveUx('lpAskTooShort', { language, params: { minutes } }));
    logEvent('lp_ask.too_short', { nudgeId: row.id, userId: user.id, seconds: secs, minutes, path, language });
    return true;
  } catch (err) {
    logToFile('lp coaching ask: short-recording catch threw — audio handled as usual', { userId: user.id, error: err.message }, 'error');
    return false;
  }
}

// Registered at load: the worker requires this module, and the sweeper claims
// only kinds something in the process has registered.
// A failure here must not break the require chain — this module is loaded by
// the lesson-plan delivery path, and the PDF comes first — so it is caught and
// logged at error level: an unregistered kind is never claimed, silently.
try {
  require('./teacher-nudges.sweeper').register(KIND, send, { prepare: markIgnored });
} catch (err) {
  logToFile('lp coaching ask: sweeper registration failed — no asks will be sent', { error: err.message }, 'error');
}

module.exports = {
  KIND,
  AFTERNOON_CUTOFF_HOUR,
  DEFAULT_DELAY_MINUTES,
  HOWTO_FEATURE,
  enabled,
  delayMinutes,
  weeklyCap,
  scheduleFor,
  askBody,
  hasCoachedBefore,
  selfCoaches,
  onLessonDelivered,
  send,
  markIgnored,
  handleButton,
  catchShortRecording,
  caps: Caps,
};
