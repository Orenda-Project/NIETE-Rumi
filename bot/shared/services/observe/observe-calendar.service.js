'use strict';
/**
 * bd-dk6hy — the invite for a scheduled observation.
 *
 * A coach schedules a visit in WhatsApp and then has to hold it in her head. The
 * invite puts it where the rest of her week already lives.
 *
 * THREE RULES, IN ORDER OF IMPORTANCE
 * -----------------------------------
 * 1. **The invite may never break the scheduling.** Scheduling is the product;
 *    the invite is a courtesy on top of it. Every call here is best-effort and
 *    non-blocking — an expired token, a 403, a stalled network must leave the
 *    coach with her visit saved and no exception in sight. Same discipline
 *    markDone already keeps: a lifecycle miss never blocks the real work.
 * 2. **No directory row means no invite, silently.** The address is READ from
 *    coach_directory, never derived from a name. One guessed match puts a school
 *    visit on a stranger's calendar; a miss costs a coach an invite.
 * 3. **The coach only.** Teachers are not invited and are not attendees — they
 *    have phones, not email — and not "for visibility" either (operator, 19 Aug).
 *
 * ROLLOUT
 * -------
 * OBSERVE_CALENDAR_ENABLED, default OFF.
 *   unset / 'false' / ''      — dormant, zero calls
 *   'true'                    — every coach with a directory row
 *   'id-a,id-b'               — only those leader_user_ids (the first group)
 *
 * The comma form exists so this can go to one sector before all six without a
 * deploy in between.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { portalUrl } = require('../../config/branding');
const google = require('./google-calendar.client');

// How long a lesson observation blocks out when she picked a start time.
const VISIT_MINUTES = 60;

/** Read at call time; a worker outlives any one env snapshot. */
function _enabledFor(leaderUserId) {
  const raw = (process.env.OBSERVE_CALENDAR_ENABLED || '').trim();
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(String(leaderUserId));
}

/** The coach's work address, or null. Never derived — only read. */
async function _workEmail(leaderUserId) {
  const { data, error } = await supabase
    .from('coach_directory')
    .select('work_email, full_name')
    .eq('leader_user_id', leaderUserId)
    .maybeSingle();
  if (error || !data || !data.work_email) return null;
  return data.work_email;
}

function _addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * When she picked a slot, book it. When she did not, book the DAY — inventing a
 * start time she never chose would be a worse answer than an all-day entry.
 *
 * The timeZone rides on the event rather than being baked into the timestamp, so
 * a deployment sets OBSERVE_CALENDAR_TIMEZONE once and every event is correct.
 */
function _timing(schedule) {
  const date = schedule.scheduled_for;
  const slot = schedule.scheduled_slot;
  if (!slot) return { start: { date }, end: { date } };
  const timeZone = process.env.OBSERVE_CALENDAR_TIMEZONE || 'UTC';
  return {
    start: { dateTime: `${date}T${slot}:00`, timeZone },
    end: { dateTime: `${date}T${_addMinutes(slot, VISIT_MINUTES)}:00`, timeZone },
  };
}

function _buildEvent(schedule, email) {
  const teacher = (schedule.teacher_name || '').trim() || 'a teacher';
  const school = (schedule.school_name || '').trim();
  const link = portalUrl();
  const lines = [`Classroom observation with ${teacher}${school ? ` at ${school}` : ''}.`];
  // Degrade rather than ship a placeholder when the portal is not configured.
  if (link) lines.push('', `Your brief and schedule: ${link}/portal/leader/observations`);
  return {
    summary: school ? `Observation: ${teacher} — ${school}` : `Observation: ${teacher}`,
    description: lines.join('\n'),
    attendees: [{ email }],
    ..._timing(schedule),
  };
}

/** Remember (or forget) which event this schedule owns. Best-effort. */
async function _storeEventId(scheduleId, eventId) {
  try {
    await supabase
      .from('observation_schedules')
      .update({ calendar_event_id: eventId, updated_at: new Date().toISOString() })
      .eq('id', scheduleId);
  } catch (err) {
    logToFile('observe-calendar: could not store event id (non-blocking)', {
      scheduleId, eventId, error: err.message,
    });
  }
}

/**
 * The one guard every entry point runs: flag on, transport configured, coach in
 * the directory. Returns the email, or null to skip silently.
 */
async function _gate(schedule) {
  if (!schedule || !schedule.leader_user_id) return null;
  if (!_enabledFor(schedule.leader_user_id)) return null;
  if (!google.isConfigured()) return null;
  return _workEmail(schedule.leader_user_id);
}

async function _create(schedule, email) {
  const created = await google.insertEvent(_buildEvent(schedule, email));
  if (created && created.id) await _storeEventId(schedule.id, created.id);
  // Operator telemetry: a working invite used to leave no trace at all, so
  // "did she actually get it?" was unanswerable without opening her calendar.
  logToFile('observe-calendar: invite sent', {
    scheduleId: schedule && schedule.id,
    eventId: created && created.id,
    email,
    teacher: schedule && schedule.teacher_name,
    when: schedule && schedule.scheduled_for,
  });
  return created;
}

/** A visit was scheduled. */
async function onScheduled(schedule) {
  try {
    const email = await _gate(schedule);
    if (!email) return;
    await _create(schedule, email);
  } catch (err) {
    logToFile('observe-calendar: create failed (non-blocking)', {
      scheduleId: schedule && schedule.id, error: err.message,
    });
  }
}

/**
 * A visit moved. Patch the event it already owns — searching the calendar for
 * "the event this probably was" is the same class of mistake as matching a coach
 * by name. A schedule with no event id was made before the flag went on, so it
 * gets one now rather than losing its invite forever.
 */
async function onRescheduled(schedule) {
  try {
    const email = await _gate(schedule);
    if (!email) return;
    if (!schedule.calendar_event_id) return _create(schedule, email);
    await google.patchEvent(schedule.calendar_event_id, _timing(schedule));
    logToFile('observe-calendar: invite moved', {
      scheduleId: schedule.id, eventId: schedule.calendar_event_id, email,
      when: schedule.scheduled_for, slot: schedule.scheduled_slot,
    });
  } catch (err) {
    logToFile('observe-calendar: patch failed (non-blocking)', {
      scheduleId: schedule && schedule.id,
      eventId: schedule && schedule.calendar_event_id,
      error: err.message,
    });
  }
}

/** A visit was cancelled. Clearing the id is what makes a second cancel a no-op. */
async function onCancelled(schedule) {
  try {
    const email = await _gate(schedule);
    if (!email) return;
    if (!schedule.calendar_event_id) return;
    const removedId = schedule.calendar_event_id;
    await google.deleteEvent(removedId);
    await _storeEventId(schedule.id, null);
    logToFile('observe-calendar: invite removed', {
      scheduleId: schedule.id, eventId: removedId, email,
    });
  } catch (err) {
    logToFile('observe-calendar: delete failed (non-blocking)', {
      scheduleId: schedule && schedule.id,
      eventId: schedule && schedule.calendar_event_id,
      error: err.message,
    });
  }
}

module.exports = { onScheduled, onRescheduled, onCancelled, _enabledFor, _buildEvent };
