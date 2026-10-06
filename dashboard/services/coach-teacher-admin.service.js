/**
 * The coach app's Edit teacher, portal side.
 *
 * The writes are the WhatsApp /observe teacher admin's (commitAdd moves a
 * teacher who is already on record; commitRemovals takes them off a school),
 * run by the bot over the internal API — the portal cannot load bot modules
 * This module is the portal's half of the guard: the teacher must
 * be in THIS coach's patch, and only what the patch says about them (their number,
 * their account, their current school) is sent. Nothing from the request body
 * names who is changed. The bot then applies its own `myschool` check to the
 * school.
 *
 * Name, role, teaching level and phone go through main's /observe edit path,
 * ported to the bot (bd-o15qnr.13) — see editTeacher below.
 *
 * Every answer is { status, data } — the HTTP status and body the route returns.
 */

const { getPatchTeachers } = require('./leader-patch.service');

async function findPatchTeacher(query, leaderUserId, teacherExtId) {
  const patch = await getPatchTeachers(query, leaderUserId, { role: 'coach' });
  return patch.find((t) => t.teacherExtId && t.teacherExtId === teacherExtId) || null;
}

const notFound = () => ({ status: 404, data: { success: false, reason: 'not_found' } });

/** Move the teacher to another of the coach's schools (commitAdd's 'move'). */
async function moveTeacher(query, client, leaderUserId, teacherExtId, toSchoolExtId) {
  const target = String(toSchoolExtId || '').trim();
  if (!target) return { status: 400, data: { success: false, reason: 'missing_field' } };
  const t = await findPatchTeacher(query, leaderUserId, teacherExtId);
  if (!t || !t.phone) return notFound();
  return client.moveTeacher({ leaderUserId, teacherPhone: t.phone, schoolExtId: target });
}

/** Take the teacher off their current school (commitRemovals). Needs their account. */
async function removeTeacher(query, client, leaderUserId, teacherExtId) {
  const t = await findPatchTeacher(query, leaderUserId, teacherExtId);
  if (!t || !t.rumiUserId || !t.emis) return notFound();
  return client.removeTeacher({ leaderUserId, userId: t.rumiUserId, schoolExtId: `niete:${t.emis}` });
}

/**
 * bd-o15qnr.13 — name, teaching level, role and phone, saved by main's
 * /observe edit path (ported to the bot as teacher-edit-commit.service). Same
 * guard: she must be in this coach's patch; her account and school come from
 * the patch. The bot then re-checks her roster at that school (_editPerson).
 */
const EDITS = Object.freeze(['name', 'level', 'role', 'phone_check', 'phone']);

async function editTeacher(query, client, leaderUserId, teacherExtId, edit, value) {
  if (!EDITS.includes(edit)) return { status: 400, data: { success: false, reason: 'unknown_edit' } };
  const t = await findPatchTeacher(query, leaderUserId, teacherExtId);
  if (!t || !t.rumiUserId || !t.emis) return notFound();
  return client.editTeacher({ leaderUserId, schoolExtId: `niete:${t.emis}`, userId: t.rumiUserId, edit, value });
}

module.exports = { moveTeacher, removeTeacher, editTeacher, findPatchTeacher, EDITS };
