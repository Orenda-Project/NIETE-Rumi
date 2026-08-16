/**
 * bd-2676 — schedule a visit from the portal.
 *
 * Riffat R33: visits could only be scheduled in WhatsApp, so a coach who clears
 * her chats to free storage lost the record. The portal has only ever READ
 * observation_schedules; this is the write side.
 *
 * Operator decision (2026-08-13): create + cancel, NO edit. Two writers on one
 * table is where conflicts start, and an edit path doubles the surface for no
 * clear gain — cancel-and-recreate does the same job visibly.
 *
 * Semantics deliberately mirror the bot's observe-schedule.service.saveSchedule
 * so the two writers cannot disagree: ONE active visit per coach×school×teacher,
 * updated in place rather than stacked.
 *
 * `query` is injected ((sql, params) => Promise<{rows}>) like every leader-*
 * service, so this is unit-testable without a live DB.
 */

const SLOTS = ['09:00', '11:30', '14:00'];

const PATCH_SQL = `
  SELECT lt.teacher_ext_id, lt.teacher_name, lt.school_ext_id, s.school_name
  FROM leader_teachers lt
  LEFT JOIN LATERAL (
    SELECT school_name FROM leader_schools ls
    WHERE ls.school_ext_id = lt.school_ext_id LIMIT 1
  ) s ON true
  WHERE lt.leader_user_id = $1 AND lt.teacher_ext_id = $2
  LIMIT 1
`;

const ACTIVE_SQL = `
  SELECT id FROM observation_schedules
  WHERE leader_user_id = $1 AND school_ext_id = $2 AND teacher_ext_id = $3 AND status = 'upcoming'
  LIMIT 1
`;

const UPDATE_SQL = `
  UPDATE observation_schedules
  SET scheduled_for = $2, scheduled_slot = $3, teacher_name = $4, school_name = $5, updated_at = now()
  WHERE id = $1
  RETURNING id
`;

const INSERT_SQL = `
  INSERT INTO observation_schedules
    (leader_user_id, school_ext_id, teacher_ext_id, teacher_name, school_name,
     scheduled_for, scheduled_slot, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, 'upcoming')
  RETURNING id
`;

const OWNED_SQL = `
  SELECT id, status, leader_user_id FROM observation_schedules WHERE id = $1 LIMIT 1
`;

const CANCEL_SQL = `
  UPDATE observation_schedules SET status = 'cancelled', updated_at = now()
  WHERE id = $1 AND leader_user_id = $2 AND status = 'upcoming'
  RETURNING id
`;

/** Strict YYYY-MM-DD that is also a real calendar date. */
function validDate(value) {
  if (!value || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * @param {(sql:string, params:any[]) => Promise<{rows:object[]}>} query
 * @param {string} leaderUserId  the SESSION's user id — never a posted value
 * @param {{schoolExtId:string, teacherExtId:string, date:string, slot?:string}} input
 */
async function createSchedule(query, leaderUserId, input = {}, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { teacherExtId, date, slot } = input;

  if (!validDate(date)) throw new Error('Invalid date — expected YYYY-MM-DD');
  if (date < today) throw new Error('That date is in the past');
  if (slot && !SLOTS.includes(slot)) throw new Error('Unknown time slot');

  // The teacher must be in THIS coach's patch. This is the authorisation check:
  // it stops a hand-posted id from scheduling against another coach's teacher,
  // and it is also where the names come from — never from the caller, so a
  // spoofed teacher_name cannot be written into the record.
  const { rows: patch } = await query(PATCH_SQL, [leaderUserId, teacherExtId]);
  const teacher = patch && patch[0];
  if (!teacher) throw new Error('That teacher is not in your patch');

  const schoolExtId = teacher.school_ext_id;
  const { rows: active } = await query(ACTIVE_SQL, [leaderUserId, schoolExtId, teacherExtId]);
  if (active && active[0]) {
    const { rows } = await query(UPDATE_SQL, [
      active[0].id, date, slot || null, teacher.teacher_name || null, teacher.school_name || null,
    ]);
    return { id: (rows && rows[0] && rows[0].id) || active[0].id, updated: true };
  }
  const { rows } = await query(INSERT_SQL, [
    leaderUserId, schoolExtId, teacherExtId,
    teacher.teacher_name || null, teacher.school_name || null, date, slot || null,
  ]);
  return { id: rows && rows[0] && rows[0].id, updated: false };
}

/**
 * Cancel one upcoming visit. A 'done' row is refused outright: since bd-2668
 * those rows ARE the record of who was observed, so cancelling one would erase
 * a teacher's identity from a completed observation.
 */
async function cancelSchedule(query, leaderUserId, scheduleId) {
  const { rows } = await query(OWNED_SQL, [scheduleId]);
  const row = rows && rows[0];
  if (!row || row.leader_user_id !== leaderUserId) throw new Error('Schedule not found');
  if (row.status === 'done') throw new Error('That visit is already completed and cannot be cancelled');
  if (row.status !== 'upcoming') throw new Error('Schedule not found');
  const { rows: done } = await query(CANCEL_SQL, [scheduleId, leaderUserId]);
  if (!done || !done[0]) throw new Error('Schedule not found');
  return { id: done[0].id, cancelled: true };
}

module.exports = { createSchedule, cancelSchedule, SLOTS, validDate };
