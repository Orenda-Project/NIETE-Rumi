/**
 * bd-tju8f — explicit audio→observation binding.
 *
 * An unbound classroom-length recording from a coach is PARKED (Redis FIFO,
 * media id + sha, TTL 6h — Meta media ids stay downloadable ~30 days, the TTL
 * is about conversation freshness, not media expiry) and the coach is asked ONE
 * list question: whose observation is this? Today's scheduled visits come
 * first; "another teacher" opens the existing school→teacher picker; a debrief
 * row appears when any observation is awaiting its debrief.
 *
 * The park is a FIFO capped at PARK_CAP — a coach who records two classes
 * before answering the question loses NEITHER (a single slot would silently
 * overwrite; caught in operator review 2026-08-24). Binding always consumes
 * the OLDEST entry; if more remain after a bind, the question re-asks.
 *
 * Idempotency: the tap handler takes a setNX bind lock on the parked sha (or
 * media id) — a double-tap or webhook retry creates exactly one session. An
 * identical re-sent recording (same sha256, seen ≤24h) is answered with
 * "already got this one" instead of a second pipeline (Sumaya and Naveera both
 * re-sent the same 20-min audio on 24 Aug after the first vanished into the
 * teacher flow).
 */

const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { logToFile } = require('../../utils/logger');

const PARK_TTL_S = 6 * 3600;
const SHA_TTL_S = 24 * 3600;
const PARK_CAP = 3;
const BIND_LOCK_TTL_S = 300;

const parkKey = (userId) => `observe:parked:${userId}`;
const shaKey = (userId, sha) => `observe:recentsha:${userId}:${sha}`;
const bindLockKey = (token) => `observe:bind:${token}`;

async function _readQueue(userId) {
  try {
    const raw = await redisService.get(parkKey(userId));
    if (!raw) return [];
    const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(val) ? val : [val];
  } catch (err) {
    logToFile('⚠️ observe-binding: unreadable park, treating as empty', { userId, error: err.message });
    return [];
  }
}

async function _writeQueue(userId, queue) {
  if (!queue.length) return redisService.delete(parkKey(userId));
  return redisService.setexWithCeiling(parkKey(userId), PARK_TTL_S, JSON.stringify(queue));
}

/**
 * Park an unbound recording and ask whose it is. Returns
 * {action: 'asked'|'dupe'|'park_full', ...}.
 */
async function parkAndAsk(user, from, { audioId, sha256 = null, durationSeconds = null }) {
  const S = observeStrings(observeLang(user));

  // Dedupe: identical bytes already bound recently → point at the live one.
  if (sha256) {
    try {
      const existing = await redisService.get(shaKey(user.id, sha256));
      if (existing) {
        const rec = typeof existing === 'string' ? { sessionId: existing } : existing;
        const name = rec.teacherName || S.bind_dupe_fallback_name;
        await WhatsAppService.sendMessage(from, S.bind_dupe_ack.replace('{name}', name));
        logToFile('🔁 observe-binding: duplicate recording answered as dupe', {
          userId: user.id, sha256, sessionId: rec.sessionId,
        });
        return { action: 'dupe', sessionId: rec.sessionId };
      }
    } catch (_) { /* dedupe is best-effort — never blocks a park */ }
  }

  const queue = await _readQueue(user.id);
  if (queue.length >= PARK_CAP) {
    await WhatsAppService.sendMessage(from, S.bind_park_full);
    return { action: 'park_full' };
  }
  queue.push({ audioId, sha256, durationSeconds, parkedAt: new Date().toISOString() });
  await _writeQueue(user.id, queue);

  const payload = await buildBindingList(user, S);
  await WhatsAppService.sendInteractiveMessage(from, payload);
  logToFile('🅿️ observe-binding: recording parked, coach asked', {
    userId: user.id, audioId, queued: queue.length, durationSeconds,
  });
  return { action: 'asked' };
}

/** Scheduled visits first (overdue included — listUpcoming sorts them first). */
async function buildBindingList(user, S) {
  let visitRows = [];
  try {
    const ScheduleStore = require('./observe-schedule.service');
    const upcoming = await ScheduleStore.listUpcoming(user.id);
    visitRows = (upcoming || []).slice(0, 6).map((v) => ({
      id: `observe_bind_visit_${v.id}`,
      title: `📋 ${v.teacher_name || S.bind_row_visit_fallback}`.slice(0, 24),
      description: [v.school_name, v.scheduled_for].filter(Boolean).join(' · ').slice(0, 72),
    }));
  } catch (err) {
    logToFile('⚠️ observe-binding: schedule lookup failed (list degrades)', {
      userId: user.id, error: err.message,
    });
  }

  const rows = [...visitRows];
  rows.push({
    id: 'observe_bind_other',
    title: S.bind_row_other.slice(0, 24),
    description: S.bind_row_other_desc.slice(0, 72),
  });
  try {
    const Debrief = require('./observe-debrief.service');
    const pendings = await Debrief.listPendingDebriefs(user.id, { limit: 1 });
    if (pendings.length) {
      rows.push({
        id: 'observe_bind_debrief',
        title: S.bind_row_debrief.slice(0, 24),
        description: S.bind_row_debrief_desc.slice(0, 72),
      });
    }
  } catch (_) { /* row simply absent */ }
  rows.push({
    id: 'observe_bind_not_obs',
    title: S.bind_row_not_obs.slice(0, 24),
    description: S.bind_row_not_obs_desc.slice(0, 72),
  });

  return {
    body: S.bind_prompt_body,
    action: {
      button: S.bind_button.slice(0, 20),
      sections: [{ title: S.bind_section_title.slice(0, 24), rows: rows.slice(0, 10) }],
    },
  };
}

/**
 * List-tap entry (wired in whatsapp-bot.js). Exactly-once per parked recording
 * via setNX on the parked sha/media id: the winner creates the session; a
 * loser re-tap gets the dupe ack.
 */
async function handleBindingTap(listId, from, user) {
  const S = observeStrings(observeLang(user));
  const queue = await _readQueue(user.id);

  if (listId === 'observe_bind_not_obs') {
    if (queue.length) { queue.shift(); await _writeQueue(user.id, queue); }
    await WhatsAppService.sendMessage(from, S.bind_not_obs_ack);
    if (queue.length) await _reask(user, from, S);
    return true;
  }

  if (!queue.length) {
    await WhatsAppService.sendMessage(from, S.bind_expired);
    return true;
  }
  const head = queue[0];

  if (listId === 'observe_bind_debrief') {
    // She picks WHICH observation next; the observe_debrief_ tap consumes the
    // parked head via consumeParkedDebrief (wired in whatsapp-bot.js).
    const ObserveState = require('./observe-state.service');
    await ObserveState.setState(user.id, 'awaiting_debrief_pick', { parkedHead: head });
    const Debrief = require('./observe-debrief.service');
    const pendings = await Debrief.listPendingDebriefs(user.id);
    await WhatsAppService.sendInteractiveMessage(from, Debrief.buildPendingListPayload(pendings, S, []));
    return true;
  }

  if (listId === 'observe_bind_other') {
    // The existing picker owns school→teacher; it arms awaiting_audio with a
    // boundTeacher, and consumeParkedIfArmed feeds the parked head through the
    // normal capture instead of asking her to re-send.
    const { sendVisitRedirect } = require('../../handlers/observe-command.handler');
    await sendVisitRedirect(user, from);
    return true;
  }

  // A scheduled-visit row.
  const visitId = listId.replace('observe_bind_visit_', '');
  const lock = await redisService.setNX(bindLockKey(head.sha256 || head.audioId), '1', BIND_LOCK_TTL_S);
  if (!lock) {
    await WhatsAppService.sendMessage(from, S.bind_dupe_ack.replace('{name}', S.bind_dupe_fallback_name));
    return true;
  }

  let visit = null;
  try {
    const ScheduleStore = require('./observe-schedule.service');
    const upcoming = await ScheduleStore.listUpcoming(user.id);
    visit = (upcoming || []).find((v) => String(v.id) === visitId) || null;
  } catch (_) { /* fall through to expired */ }
  if (!visit) {
    await redisService.delete(bindLockKey(head.sha256 || head.audioId));
    await WhatsAppService.sendMessage(from, S.bind_expired);
    return true;
  }

  // Bind exactly the way the visit Flow does (resolveTeacher shape), so the
  // capture path — teacher ownership, schedule markDone, who-ask skip — is
  // byte-identical to a picker-armed recording.
  let teacher = null;
  try {
    const LeaderSource = require('./assignment/leader-source');
    teacher = await LeaderSource.resolveTeacher(user.id, visit.teacher_ext_id, visit.school_ext_id);
  } catch (err) {
    logToFile('⚠️ observe-binding: resolveTeacher failed — binding by name only', {
      userId: user.id, teacherExtId: visit.teacher_ext_id, error: err.message,
    });
  }
  const ObserveState = require('./observe-state.service');
  await ObserveState.setState(user.id, 'awaiting_audio', {
    boundTeacher: teacher
      ? { ...teacher, school_ext_id: String(visit.school_ext_id || '') }
      : { teacher_ext_id: visit.teacher_ext_id, school_ext_id: visit.school_ext_id, teacher_name: visit.teacher_name },
  });

  const consumed = await consumeParkedIfArmed(user, from, { teacherName: visit.teacher_name });
  if (consumed) {
    await WhatsAppService.sendMessage(from, S.bind_ack.replace('{name}', visit.teacher_name || S.bind_row_visit_fallback));
  }
  return true;
}

/**
 * Feed the OLDEST parked recording through the normal armed capture. Called
 * after a visit-row bind, and safe to call after the picker Flow arms a
 * teacher too. Returns true when a session was created.
 */
async function consumeParkedIfArmed(user, from, { teacherName = null } = {}) {
  const queue = await _readQueue(user.id);
  if (!queue.length) return false;
  const head = queue[0];

  const ObserveCapture = require('./observe-capture.service');
  const { getOrCreateSession } = require('../../database/bot-helpers');
  let chatSessionId = null;
  try { chatSessionId = await getOrCreateSession(user.id); } catch (_) { /* capture tolerates null */ }

  const session = await ObserveCapture.startFromAudio(user, from, head.audioId, chatSessionId, head.durationSeconds);
  if (!session) return false;

  queue.shift();
  await _writeQueue(user.id, queue);
  if (head.sha256) {
    try {
      await redisService.setexWithCeiling(shaKey(user.id, head.sha256), SHA_TTL_S,
        JSON.stringify({ sessionId: session.id, teacherName }));
    } catch (_) { /* dedupe memory is best-effort */ }
  }
  logToFile('✅ observe-binding: parked recording bound and captured', {
    userId: user.id, sessionId: session.id, remaining: queue.length,
  });

  if (queue.length) await _reask(user, from, observeStrings(observeLang(user)));
  return true;
}

/**
 * The debrief-pick consumer (wired inside the observe_debrief_ tap): when
 * awaiting_debrief_pick is armed with a parked head, that recording IS the
 * debrief — feed it straight in, never ask her to re-send.
 * Returns true when it consumed the tap.
 */
async function consumeParkedDebrief(user, from, sessionId) {
  const ObserveState = require('./observe-state.service');
  let st = null;
  try { st = await ObserveState.getState(user.id); } catch (_) { return false; }
  if (!st || st.state !== 'awaiting_debrief_pick' || !st.parkedHead) return false;

  const ObserveDebrief = require('./observe-debrief.service');
  await ObserveDebrief.startDebriefFromAudio(user, from, st.parkedHead.audioId,
    { state: 'awaiting_debrief_audio', sessionId });

  const queue = await _readQueue(user.id);
  if (queue.length && queue[0].audioId === st.parkedHead.audioId) {
    queue.shift();
    await _writeQueue(user.id, queue);
  }
  await ObserveState.clearState(user.id);
  logToFile('🎙 observe-binding: parked recording consumed as debrief', {
    userId: user.id, sessionId,
  });
  return true;
}

module.exports = {
  parkAndAsk, buildBindingList, handleBindingTap, consumeParkedIfArmed, consumeParkedDebrief,
};

async function _reask(user, from, S) {
  try {
    const payload = await buildBindingList(user, S);
    await WhatsAppService.sendInteractiveMessage(from, payload);
  } catch (err) {
    logToFile('⚠️ observe-binding: re-ask failed (next recording stays parked)', {
      userId: user.id, error: err.message,
    });
  }
}
