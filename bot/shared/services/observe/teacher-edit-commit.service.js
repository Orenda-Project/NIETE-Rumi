'use strict';
/**
 * bd-o15qnr.13 — a coach edits a teacher she holds: name, level, role, number.
 *
 * PORTED FROM origin/main. On main these writes live INLINE in
 * bot/shared/handlers/observe-visit-flow.handler.js — the WhatsApp /observe
 * "Edit a teacher" steps (teacher_edit_name_commit, _level_commit, _role_commit,
 * _phone_check, _phone_commit) with their helpers _editPerson,
 * _loadTargetWithHistory, writeRosterAudit and buildEditAuditRow. Sandbox
 * branched before that path landed. Here the same writes are functions, so the
 * coach app's Edit teacher (portal → internal API) saves exactly as /observe
 * does, instead of through a second writer:
 *
 *   · the same authorisation — _editPerson resolves the person through the
 *     coach's OWN derived roster at that school; not in it, not editable;
 *   · the same decisions — the ported teacher-edit.service planners
 *     (planNameEdit / planLevelEdit / planRoleEdit / classifyTarget);
 *   · the same writes, in the same order, and the same audit actions
 *     (edit_name, edit_level, edit_role, edit_phone, edit_phone_escalated).
 *
 * The only difference is the return value: a result object instead of a Flow
 * screen, and the done-screen sentences dropped (the portal shows its own
 * short words). The refusal copy for a TAKEN number is main's, unchanged —
 * deliberately vague so it never reveals that the number reaches someone else.
 *
 * ONE ADDITION main's handler does not have yet: when her number takes a
 * shell's, the shell's own rows (classes, lesson-plan opens, nudges) move to
 * her, see reparentShellRows. main's inline commit should call the same
 * function when it is next touched.
 *
 * ONE ADAPTATION — the level column. main renamed users.training_bands to
 * users.teacher_level. Sandbox's code has not taken that rename: its
 * one writer, applyBandSelection, still writes training_bands and stamps
 * training_bands_updated_at, and patch-resolver reads training_bands. (The
 * sandbox DB carries both columns, unsynced.) So the planner reads sandbox's
 * live columns, mapped onto the names it expects — see levelRow(). When sandbox
 * takes that rename the mapping becomes the identity and can go.
 */

const E = require('./teacher-edit.service');
const { normaliseTeacherPhone } = require('./observe-teacher-admin.service');
const { teacherLevelOf } = require('../../utils/teacher-level');
const { logToFile } = require('../../utils/logger');

const VIA = 'portal_coach_v2';

// main's copy for a TAKEN destination — same words on the check and the commit.
const TAKEN_HEADING = 'Please wait while we fix your data';
const TAKEN_BODY = 'This change will take some time, please check back later.';

const _db = () => require('../../config/supabase');
const _P = () => require('./patch-resolver.service');

/** main: writeRosterAudit (observe-visit-flow.handler.js:38). Never throws. */
async function writeRosterAudit(supabase, row, log) {
  const report = (why, extra) => {
    try {
      (log || logToFile)('roster audit row REJECTED - the edit stands, the record does not', {
        why, action: row && row.action, actor_user_id: row && row.actor_user_id, ...extra,
      }, 'error');
    } catch (_) { /* a broken logger must not break the edit either */ }
    return false;
  };
  try {
    const { error } = await supabase.from('leader_roster_audit').insert([row]) || {};
    if (error) return report('insert_rejected', { code: error.code, message: error.message });
    return true;
  } catch (e) {
    return report('insert_threw', { message: e && e.message });
  }
}

/** main: buildEditAuditRow (observe-visit-flow.handler.js:57). */
function buildEditAuditRow(actorId, person, action, detail) {
  return {
    action,
    actor_user_id: actorId,
    affected_leader_user_id: actorId,
    teacher_ext_id: person && person.userId,
    teacher_phone_e164: (person && person.phone) || null,
    teacher_name: (person && person.name) || null,
    detail: { via: 'observe_flow', ...(detail || {}) },
  };
}

const _editAudit = (actorId, person, action, detail) =>
  writeRosterAudit(_db(), buildEditAuditRow(actorId, person, action, { via: VIA, ...(detail || {}) }));

/**
 * main: _editPerson. The person the coach picked, resolved through HER OWN
 * derived roster at that school — authorisation is the list itself.
 */
async function editPerson(leaderUserId, schoolExtId, pickedUserId) {
  if (!leaderUserId || !schoolExtId || !pickedUserId || pickedUserId === 'none') return null;
  const supabase = _db();
  const people = await _P().listPatchViaSupabase(supabase, leaderUserId, schoolExtId).catch(() => []);
  const p = people.find((x) => x.userId === pickedUserId);
  if (!p) return null;
  const { data: row } = await supabase.from('users')
    .select('id, name, phone_number, role, training_bands, training_bands_updated_at')
    .eq('id', pickedUserId).maybeSingle();
  return { ...p, row: row || null };
}

/** Sandbox's live level columns, under the names the ported planner reads. */
function levelRow(row) {
  return {
    ...(row || {}),
    teacher_level: (row && row.training_bands) || null,
    teacher_level_updated_at: (row && row.training_bands_updated_at) || null,
  };
}

/**
 * main: _loadTargetWithHistory. The account on a number plus the counts of what
 * cannot be replaced; any count it cannot read returns NO counts, which
 * classifyTarget reads as TAKEN (fail closed).
 */
async function loadTargetWithHistory(phone) {
  const supabase = _db();
  const { data: row } = await supabase.from('users')
    .select('id, name, phone_number').eq('phone_number', phone).maybeSingle();
  if (!row) return null;
  try {
    const tables = [
      ['certificates', 'training_certificates'],
      ['attempts', 'training_assessment_attempts'],
      ['progress', 'teacher_training_progress'],
      ['coaching', 'coaching_sessions'],
    ];
    const counts = {};
    for (const [key, table] of tables) {
      // eslint-disable-next-line no-await-in-loop
      const { count, error } = await supabase.from(table)
        .select('id', { count: 'exact', head: true }).eq('user_id', row.id);
      if (error) return row;
      counts[key] = count || 0;
    }
    return { ...row, counts };
  } catch (_) {
    return row;
  }
}

/**
 * What a retired shell owns, and moves to the survivor when she takes its number.
 *
 * The shell is retired, but anything keyed to its id stays there, where neither the teacher (once signed in on the
 * new number) nor any report reads it. A shell holds nothing irreplaceable when the commit re-classifies it
 * (classifyTarget), but it may hold what its app session made: classes, lesson-plan opens, nudges. The training rows
 * and coaching are listed too, for anything written between the re-classification and the retirement.
 *
 * Each table's unique key decides what may move: a row the survivor already has an equal of stays on the shell
 * (moving it would break the index). `activeOnly`: the index is partial (WHERE is_active), so an inactive row always
 * moves. Mirrors the operator's manual merge, table for table; teacher_training_assignments is NOT moved: her
 * programmes are written by applyBandSelection from her own level, never inherited from a shell.
 */
const REPARENT = Object.freeze([
  { table: 'niete_lp_opens', owner: 'user_id' },
  { table: 'student_lists', owner: 'user_id', cols: 'id, class_name, academic_year, is_active', activeOnly: true,
    key: (r) => `${String(r.class_name == null ? '' : r.class_name).toLowerCase()}|${r.academic_year}` },
  { table: 'class_teachers', owner: 'teacher_user_id', cols: 'id, class_id, is_active', activeOnly: true,
    key: (r) => String(r.class_id) },
  { table: 'teacher_nudges', owner: 'user_id', cols: 'id, nudge_date, kind', key: (r) => `${r.nudge_date}|${r.kind}` },
  { table: 'teacher_training_progress', owner: 'user_id', cols: 'id, module_id', key: (r) => String(r.module_id) },
  { table: 'training_assessment_attempts', owner: 'user_id' },
  { table: 'training_certificates', owner: 'user_id', cols: 'id, level_id', key: (r) => String(r.level_id) },
  { table: 'coaching_sessions', owner: 'user_id' },
]);

/** Moves one table's shell rows to the survivor. Returns { moved, skipped }; throws on a refused read or write. */
async function reparentTable(supabase, spec, shellId, survivorId) {
  const { table, owner } = spec;
  if (!spec.key) {
    const { data, error } = await supabase.from(table)
      .update({ [owner]: survivorId }).eq(owner, shellId).select('id');
    if (error) throw new Error(error.message || 'update refused');
    return { moved: (data || []).length, skipped: 0 };
  }
  const { data: mine, error: mineErr } = await supabase.from(table).select(spec.cols).eq(owner, shellId);
  if (mineErr) throw new Error(mineErr.message || 'read refused');
  if (!mine || mine.length === 0) return { moved: 0, skipped: 0 };
  const { data: hers, error: hersErr } = await supabase.from(table).select(spec.cols).eq(owner, survivorId);
  if (hersErr) throw new Error(hersErr.message || 'read refused');
  const held = new Set((hers || []).filter((r) => !spec.activeOnly || r.is_active).map(spec.key));
  const ids = mine.filter((r) => (spec.activeOnly && !r.is_active) || !held.has(spec.key(r))).map((r) => r.id);
  if (ids.length === 0) return { moved: 0, skipped: mine.length };
  const { data, error } = await supabase.from(table)
    .update({ [owner]: survivorId }).in('id', ids).eq(owner, shellId).select('id');
  if (error) throw new Error(error.message || 'update refused');
  const moved = (data || []).length;
  return { moved, skipped: mine.length - moved };
}

/**
 * Re-parents a retired shell's rows to the survivor, table by table. Never throws: a table that fails is named in
 * `failed` and the rest still move; the number change it follows has already been made and stands.
 *
 * @returns {Promise<{reparented: Object<string, number>, skipped: Object<string, number>, failed: string[]}>}
 *   reparented: every table, with how many rows moved; skipped: only tables where a row stayed (the survivor held
 *   its equal); failed: tables whose read or write was refused.
 */
async function reparentShellRows(supabase, shellId, survivorId) {
  const reparented = {};
  const skipped = {};
  const failed = [];
  for (const spec of REPARENT) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await reparentTable(supabase, spec, shellId, survivorId);
      reparented[spec.table] = out.moved;
      if (out.skipped > 0) skipped[spec.table] = out.skipped;
    } catch (e) {
      reparented[spec.table] = 0;
      failed.push(spec.table);
      logToFile('shell re-parent failed for one table - the number change stands', {
        table: spec.table, message: e && e.message,
      }, 'error');
    }
  }
  return { reparented, skipped, failed };
}

const notFound = () => ({ ok: false, reason: 'not_found' });

/** main: teacher_edit_name_commit. */
async function editName({ actorLeaderUserId, schoolExtId, userId, name }) {
  const person = await editPerson(actorLeaderUserId, schoolExtId, userId);
  if (!person) return notFound();
  const plan = E.planNameEdit(person.row || {}, name);
  if (!plan.ok) return { ok: false, reason: 'name_required' };
  if (plan.unchanged) return { ok: true, outcome: 'unchanged', name: plan.name };
  const { error } = await _db().from('users').update(plan.patch).eq('id', userId);
  if (error) return { ok: false, reason: 'failed' };
  await _editAudit(actorLeaderUserId, person, 'edit_name', { to: plan.name });
  return { ok: true, outcome: 'saved', name: plan.name };
}

/** main: teacher_edit_level_commit — the write is applyBandSelection, the ONE writer. */
async function editLevel({ actorLeaderUserId, schoolExtId, userId, bands }) {
  const person = await editPerson(actorLeaderUserId, schoolExtId, userId);
  if (!person) return notFound();
  const raw = Array.isArray(bands) ? bands : String(bands || '').split(',').filter(Boolean);
  const plan = E.planLevelEdit(levelRow(person.row), raw);
  if (!plan.ok) {
    if (plan.reason === 'cooldown') return { ok: false, reason: 'cooldown', hoursRemaining: plan.hoursRemaining };
    return { ok: false, reason: plan.reason === 'empty_selection' ? 'empty_selection' : 'failed' };
  }
  if (plan.unchanged) return { ok: true, outcome: 'unchanged', bands: plan.bands };

  const { applyBandSelection } = require('../training/band-selection.service');
  const res = await applyBandSelection(userId, plan.bands).catch(() => ({ ok: false }));
  if (!res || !res.ok) {
    if (res && res.reason === 'cooldown') return { ok: false, reason: 'cooldown', hoursRemaining: res.hoursRemaining };
    return { ok: false, reason: 'failed' };
  }
  await _editAudit(actorLeaderUserId, person, 'edit_level', { to: plan.bands });
  return { ok: true, outcome: 'saved', bands: plan.bands };
}

/** main: teacher_edit_role_commit. A privilege change: Principal can observe. */
async function editRole({ actorLeaderUserId, schoolExtId, userId, role }) {
  const person = await editPerson(actorLeaderUserId, schoolExtId, userId);
  if (!person) return notFound();
  const plan = E.planRoleEdit(person.row || {}, role);
  if (!plan.ok) return { ok: false, reason: plan.reason === 'invalid_role' ? 'invalid_role' : 'failed' };
  if (plan.unchanged) return { ok: true, outcome: 'unchanged', role: plan.role };
  const { error } = await _db().from('users').update(plan.patch).eq('id', userId);
  if (error) return { ok: false, reason: 'failed' };
  await _editAudit(actorLeaderUserId, person, 'edit_role', {
    from: (person.row && person.row.role) || null, to: plan.role,
  });
  return { ok: true, outcome: 'saved', role: plan.role };
}

/**
 * main: teacher_edit_phone_check. READS ONLY (apart from the escalation audit):
 * classifies the destination number before anything moves.
 *   free      — no account on it;
 *   shell     — an account with nothing irreplaceable; it will be retired and
 *               its recent activity kept;
 *   taken     — a real teacher's record (certificates, attempts, progress or
 *               coaching): REFUSED and recorded, never merged;
 *   unchanged — it is already her number.
 */
async function checkPhone({ actorLeaderUserId, schoolExtId, userId, phone: raw }) {
  const person = await editPerson(actorLeaderUserId, schoolExtId, userId);
  if (!person) return notFound();
  const phone = normaliseTeacherPhone(raw);
  if (!phone) return { ok: false, reason: 'invalid_phone' };
  if (person.row && phone === person.row.phone_number) return { ok: true, outcome: 'unchanged', phone };

  const verdict = E.classifyTarget(await loadTargetWithHistory(phone));
  if (verdict === E.CASE_TAKEN) {
    await _editAudit(actorLeaderUserId, person, 'edit_phone_escalated', {
      to_phone: phone, reason: 'destination_has_history',
    });
    return { ok: false, reason: 'taken', heading: TAKEN_HEADING, message: TAKEN_BODY };
  }
  return { ok: true, outcome: verdict === E.CASE_SHELL ? 'shell' : 'free', phone, from: person.phone || null };
}

/** main: teacher_edit_phone_commit — RE-CLASSIFIES, then moves her number. */
async function commitPhone({ actorLeaderUserId, schoolExtId, userId, phone: raw }) {
  const person = await editPerson(actorLeaderUserId, schoolExtId, userId);
  if (!person) return notFound();
  const phone = normaliseTeacherPhone(raw);
  if (!phone) return { ok: false, reason: 'invalid_phone' };
  if (person.row && phone === person.row.phone_number) return { ok: true, outcome: 'unchanged', phone };

  const target = await loadTargetWithHistory(phone);
  const verdict = E.classifyTarget(target);
  if (verdict === E.CASE_TAKEN) {
    await _editAudit(actorLeaderUserId, person, 'edit_phone_escalated', {
      to_phone: phone, reason: 'destination_has_history_at_commit',
    });
    return { ok: false, reason: 'taken', heading: TAKEN_HEADING, message: TAKEN_BODY };
  }

  const supabase = _db();
  const oldPhone = person.row && person.row.phone_number;

  // Retire the shell FIRST: phone_number is UNIQUE, and a soft delete keeps it
  // recoverable if the classifier was ever wrong.
  if (verdict === E.CASE_SHELL && target && target.id) {
    const { error: rErr } = await supabase.from('users')
      .update({ ...E.retireMergedPatch(actorLeaderUserId), phone_number: `merged:${target.id}` })
      .eq('id', target.id);
    if (rErr) return { ok: false, reason: 'failed' };
  }

  const { error } = await supabase.from('users').update({ phone_number: phone }).eq('id', userId);
  if (error) return { ok: false, reason: 'failed' };

  // The roster and any booked visit key on the phone STRING, so they follow.
  await supabase.from('observation_schedules').update({ teacher_ext_id: phone }).eq('teacher_ext_id', oldPhone);

  // What the retired shell owns moves to her, after the number has (a failure here never undoes the move).
  const retiredId = verdict === E.CASE_SHELL && target ? target.id : null;
  const moved = retiredId ? await reparentShellRows(supabase, retiredId, userId) : null;

  await _editAudit(actorLeaderUserId, person, 'edit_phone', {
    from_phone: oldPhone, to_phone: phone, case: verdict,
    retired_user_id: retiredId,
    ...(moved ? { reparented: moved.reparented } : {}),
    ...(moved && Object.keys(moved.skipped).length ? { reparent_skipped: moved.skipped } : {}),
    ...(moved && moved.failed.length ? { reparent_failed: moved.failed } : {}),
  });
  return { ok: true, outcome: 'moved', phone, case: verdict };
}

/** Her current bands, for the edit screen (read with the ported reader). */
function currentLevels(row) {
  return teacherLevelOf(levelRow(row));
}

module.exports = {
  editPerson,
  editName,
  editLevel,
  editRole,
  checkPhone,
  commitPhone,
  currentLevels,
  writeRosterAudit,
  buildEditAuditRow,
  loadTargetWithHistory,
  reparentShellRows,
  REPARENT,
};
