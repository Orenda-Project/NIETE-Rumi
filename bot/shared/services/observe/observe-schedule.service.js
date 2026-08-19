'use strict';
/**
 * bd-2441 — observation-schedule store (the /observe scheduling UI's state).
 *
 * Table: observation_schedules (V1.0.10). Keyed on
 * (leader_user_id, school_ext_id, teacher_ext_id) — the leader_teachers
 * external-id model, so off-Rumi teachers (name-slug ids) work. Exactly ONE
 * 'upcoming' row per key (partial unique index); re-scheduling updates it.
 *
 * Ascending scheduled_for naturally lists overdue rows first; each row gets
 * an `overdue` flag for display. markDone flips the matching upcoming row
 * when the observation actually starts (observe-capture, bd-2445) and is
 * deliberately tolerant — a lifecycle miss must never block a capture.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

// bd-dk6hy — the calendar invite. Lazily required inside a helper, and every
// call wrapped: an invite is a courtesy ON TOP of the scheduling, and the
// scheduling is the product. A Google outage must leave the coach with her visit
// saved and nothing else different. Same discipline markDone already keeps.
async function _calendar(hook, row) {
  try {
    if (!row) return;
    const Calendar = require('./observe-calendar.service');
    await Calendar[hook](row);
  } catch (err) {
    logToFile('observe-schedule: calendar hook failed (non-blocking)', {
      hook, scheduleId: row && row.id, error: err.message,
    });
  }
}

// School-hour half-hour slots (no native time picker in Meta Flows — the
// SCHEDULE_PICKER renders these in a Dropdown).
const SLOTS = [
  '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
];

function _validDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  // Reject silently-rolled-over dates like 2026-13-45.
  return new Date(ms).toISOString().slice(0, 10) === d;
}

async function _activeRow(leaderUserId, schoolExtId, teacherExtId) {
  const { data, error } = await supabase
    .from('observation_schedules')
    // bd-dk6hy: calendar_event_id and the display fields ride along — a
    // re-save has to PATCH the event this row already owns, and searching the
    // calendar for "the event this probably was" is how two visits that look
    // alike become one.
    .select('id, leader_user_id, school_ext_id, teacher_ext_id, teacher_name, school_name, scheduled_for, scheduled_slot, status, calendar_event_id')
    .eq('leader_user_id', leaderUserId)
    .eq('school_ext_id', schoolExtId)
    .eq('teacher_ext_id', teacherExtId)
    .eq('status', 'upcoming');
  if (error) throw new Error(`observe-schedule: lookup failed: ${error.message}`);
  return (data && data[0]) || null;
}

/**
 * Create or update THE active schedule for a coach×school×teacher.
 * @returns the saved row.
 */
async function saveSchedule(leaderUserId, { school_ext_id, teacher_ext_id, teacher_name, school_name, date, slot }) {
  if (!_validDate(date)) throw new Error(`observe-schedule: invalid date "${date}" (want YYYY-MM-DD)`);
  const existing = await _activeRow(leaderUserId, school_ext_id, teacher_ext_id);
  if (existing) {
    const patch = {
      scheduled_for: date,
      scheduled_slot: slot || null,
      teacher_name: teacher_name || null,
      school_name: school_name || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('observation_schedules')
      .update(patch)
      .eq('id', existing.id);
    if (error) throw new Error(`observe-schedule: update failed: ${error.message}`);
    const moved = { ...existing, ...patch };
    // The picker re-uses saveSchedule to CHANGE a date. Creating here would
    // leave the coach holding two invites for one visit.
    await _calendar('onRescheduled', moved);
    return moved;
  }
  const { data, error } = await supabase
    .from('observation_schedules')
    .insert({
      leader_user_id: leaderUserId,
      school_ext_id,
      teacher_ext_id,
      teacher_name: teacher_name || null,
      school_name: school_name || null,
      scheduled_for: date,
      scheduled_slot: slot || null,
      status: 'upcoming',
    })
    .select()
    .single();
  if (error) throw new Error(`observe-schedule: insert failed: ${error.message}`);
  await _calendar('onScheduled', data);
  return data;
}

/** Upcoming schedules, ascending date (overdue first), each with `overdue`. */
async function listUpcoming(leaderUserId, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('observation_schedules')
    .select('id, school_ext_id, teacher_ext_id, teacher_name, school_name, scheduled_for, scheduled_slot')
    .eq('leader_user_id', leaderUserId)
    .eq('status', 'upcoming')
    .order('scheduled_for', { ascending: true });
  if (error) {
    logToFile('observe-schedule: listUpcoming failed', { leaderUserId, error: error.message });
    return [];
  }
  const rows = (data || []).map((r) => ({ ...r, overdue: r.scheduled_for < today }));
  // Ascending date already puts overdue first; make it explicit and stable.
  rows.sort((a, b) => (a.scheduled_for < b.scheduled_for ? -1 : a.scheduled_for > b.scheduled_for ? 1 : 0));
  return rows;
}

async function countUpcoming(leaderUserId) {
  try {
    return (await listUpcoming(leaderUserId)).length;
  } catch (_) {
    return 0;
  }
}

/**
 * The observation started — retire the matching upcoming schedule. Tolerant:
 * school-missing falls back to teacher-only; no match / DB error is a no-op.
 */
async function markDone(leaderUserId, teacherExtId, schoolExtId, sessionId) {
  try {
    let q = supabase
      .from('observation_schedules')
      .update({ status: 'done', session_id: sessionId || null, updated_at: new Date().toISOString() })
      .eq('leader_user_id', leaderUserId)
      .eq('teacher_ext_id', teacherExtId)
      .eq('status', 'upcoming');
    if (schoolExtId) q = q.eq('school_ext_id', schoolExtId);
    const { error } = await q;
    if (error) {
      logToFile('observe-schedule: markDone failed (non-blocking)', { leaderUserId, teacherExtId, error: error.message });
    }
  } catch (err) {
    logToFile('observe-schedule: markDone threw (non-blocking)', { leaderUserId, teacherExtId, error: err.message });
  }
}


/**
 * bd-88krt — cancel an upcoming visit from WhatsApp (HITL R39). Scoped to the
 * coach and to status='upcoming': a 'done' row is the record of who was
 * observed (bd-2668), so it must never be cancelled out from under a report.
 */
async function cancelById(leaderUserId, scheduleId) {
  const { data, error } = await supabase
    .from('observation_schedules')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', scheduleId)
    .eq('leader_user_id', leaderUserId)
    .eq('status', 'upcoming')
    .select('id, leader_user_id, teacher_name, school_name, scheduled_for, scheduled_slot, calendar_event_id');
  if (error) {
    logToFile('observe-schedule: cancelById failed', { leaderUserId, scheduleId, error: error.message });
    return false;
  }
  const cancelled = Array.isArray(data) && data.length > 0;
  // Only a row that actually matched — the guards that protect the record of who
  // was observed must also stop us deleting somebody else's invite.
  if (cancelled) await _calendar('onCancelled', data[0]);
  return cancelled;
}

/** bd-88krt — move an upcoming visit to a new date/slot. Same guards as cancel. */
async function rescheduleById(leaderUserId, scheduleId, date, slot) {
  if (!_validDate(date)) throw new Error(`observe-schedule: invalid date "${date}"`);
  const { data, error } = await supabase
    .from('observation_schedules')
    .update({ scheduled_for: date, scheduled_slot: slot || null, updated_at: new Date().toISOString() })
    .eq('id', scheduleId)
    .eq('leader_user_id', leaderUserId)
    .eq('status', 'upcoming')
    .select('id, leader_user_id, teacher_name, school_name, scheduled_for, scheduled_slot, calendar_event_id');
  if (error) {
    logToFile('observe-schedule: rescheduleById failed', { leaderUserId, scheduleId, error: error.message });
    return false;
  }
  const moved = Array.isArray(data) && data.length > 0;
  if (moved) await _calendar('onRescheduled', data[0]);
  return moved;
}

module.exports = {
  saveSchedule, listUpcoming, countUpcoming, markDone, SLOTS,
  cancelById, rescheduleById,
};
