/**
 * bd-o15qnr.11 — the coach app's Edit teacher, portal side.
 *
 * The writes are the WhatsApp /observe teacher admin's (commitAdd moves a
 * teacher who is already on record; commitRemovals takes her off a school),
 * run by the bot over the internal API — the portal cannot load bot modules
 * (bd-60085). This module is the portal's half of the guard: the teacher must
 * be in THIS coach's patch, and only what the patch says about her (her number,
 * her account, her current school) is sent. Nothing from the request body
 * names who is changed. The bot then applies its own `myschool` check to the
 * school.
 *
 * Name, role and teaching level are NOT here: the /observe teacher admin has no
 * writer for them (its Flow offers only Add — which moves — and Remove), and a
 * second writer is exactly what the operator ruled out.
 *
 * Every answer is { status, data } — the HTTP status and body the route returns.
 */

const { getPatchTeachers } = require('./leader-patch.service');

async function findPatchTeacher(query, leaderUserId, teacherExtId) {
  const patch = await getPatchTeachers(query, leaderUserId, { role: 'coach' });
  return patch.find((t) => t.teacherExtId && t.teacherExtId === teacherExtId) || null;
}

const notFound = () => ({ status: 404, data: { success: false, reason: 'not_found' } });

/** Move her to another of the coach's schools (commitAdd's 'move'). */
async function moveTeacher(query, client, leaderUserId, teacherExtId, toSchoolExtId) {
  const target = String(toSchoolExtId || '').trim();
  if (!target) return { status: 400, data: { success: false, reason: 'missing_field' } };
  const t = await findPatchTeacher(query, leaderUserId, teacherExtId);
  if (!t || !t.phone) return notFound();
  return client.moveTeacher({ leaderUserId, teacherPhone: t.phone, schoolExtId: target });
}

/** Take her off her current school (commitRemovals). Needs her account. */
async function removeTeacher(query, client, leaderUserId, teacherExtId) {
  const t = await findPatchTeacher(query, leaderUserId, teacherExtId);
  if (!t || !t.rumiUserId || !t.emis) return notFound();
  return client.removeTeacher({ leaderUserId, userId: t.rumiUserId, schoolExtId: `niete:${t.emis}` });
}

module.exports = { moveTeacher, removeTeacher, findPatchTeacher };
