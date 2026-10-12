/**
 * The coach app's school and teacher admin, portal side: add or remove a school
 * from her list, add a teacher by WhatsApp number, take several teachers off a
 * school.
 *
 * The writes are the WhatsApp /observe writers', run by the bot over the
 * internal API (observe-teacher-admin.client) — the portal cannot load bot
 * modules, and one writer means a coach gets the same behaviour whichever door
 * she uses. This module is the portal's half of the guard, the same shape as
 * Edit teacher's (coach-teacher-admin.service):
 *
 *   · A school is named by the EMIS in the URL and looked up in HER OWN list
 *     (coach-v2 getCoachSchool). Its key comes from that record, never from the
 *     request body; a school that is not hers is a 404 and the bot is not asked.
 *   · People to remove are named by their number and resolved against HER
 *     teachers at THAT school; only their accounts are sent.
 *   · The bot then applies its own `myschool` check, and writes its own audit.
 *
 * Adding a school is the one write whose target is not hers yet, so its key
 * comes from the search result she tapped; the shape is checked here and the
 * bot refuses a key no school carries.
 *
 * Every answer is { status, data } — the HTTP status and body the route returns.
 */

const { getCoachSchool } = require('./coach-v2.service');

const SEARCH_MIN = 2;      // one letter matches most of the district
const SEARCH_CAP = 20;     // a readable list; type more to narrow it
const REMOVE_MAX = 30;     // the bot's own batch cap (observe-teacher-admin REMOVE_BATCH_MAX)
const REASON_MAX = 200;
const SCHOOL_KEY_RX = /^[a-z_]+:[A-Za-z0-9-]{1,32}$/;

const refuse = (status, reason) => ({ status, data: { success: false, reason } });
const notFound = () => refuse(404, 'not_found');

/**
 * Best match first: an exact EMIS, then names that start with what she typed,
 * then EMIS codes that do, then everything else; by name within each.
 */
function rankSchools(schools, term) {
  const t = String(term || '').trim().toLowerCase();
  const tier = (s) => {
    const emis = String(s.emis || '').toLowerCase();
    if (emis && emis === t) return 0;
    if (String(s.name || '').toLowerCase().startsWith(t)) return 1;
    if (emis.startsWith(t)) return 2;
    return 3;
  };
  return [...schools].sort((a, b) => (tier(a) - tier(b))
    || String(a.name || '').localeCompare(String(b.name || '')));
}

async function searchSchools(client, leaderUserId, term) {
  const q = String(term || '').trim().slice(0, 64);
  if (q.length < SEARCH_MIN) return { status: 200, data: { success: true, schools: [] } };
  const out = await client.searchSchools({ leaderUserId, term: q });
  if (out.status !== 200) return out;
  const schools = rankSchools((out.data && out.data.schools) || [], q).slice(0, SEARCH_CAP)
    .map((s) => ({ schoolExtId: s.schoolExtId, name: s.name || null, emis: s.emis || null, alreadyMine: !!s.alreadyMine }));
  return { status: 200, data: { success: true, schools } };
}

async function addSchool(client, leaderUserId, schoolExtId) {
  const key = String(schoolExtId || '').trim();
  if (!SCHOOL_KEY_RX.test(key)) return refuse(400, 'invalid_school');
  return client.addSchool({ leaderUserId, schoolExtId: key });
}

/** One of her schools by EMIS, as her own records hold it; null when it is not hers. */
async function mySchool(query, leaderUserId, emis) {
  const out = await getCoachSchool(query, leaderUserId, String(emis || ''));
  return out && out.school && out.school.schoolExtId ? out : null;
}

async function removeSchool(query, client, leaderUserId, emis) {
  const mine = await mySchool(query, leaderUserId, emis);
  if (!mine) return notFound();
  return client.removeSchool({ leaderUserId, schoolExtId: mine.school.schoolExtId });
}

async function checkTeacher(query, client, leaderUserId, emis, phone) {
  const number = String(phone || '').trim();
  if (!number) return refuse(400, 'invalid_phone');
  const mine = await mySchool(query, leaderUserId, emis);
  if (!mine) return notFound();
  return client.checkTeacher({ leaderUserId, schoolExtId: mine.school.schoolExtId, phone: number });
}

async function addTeacher(query, client, leaderUserId, emis, { phone, name } = {}) {
  const number = String(phone || '').trim();
  if (!number) return refuse(400, 'invalid_phone');
  const mine = await mySchool(query, leaderUserId, emis);
  if (!mine) return notFound();
  return client.addTeacher({
    leaderUserId, schoolExtId: mine.school.schoolExtId, phone: number, name: String(name || '').trim(),
  });
}

async function removeTeachers(query, client, leaderUserId, emis, teacherExtIds, reason) {
  if (!Array.isArray(teacherExtIds)) return refuse(400, 'missing_field');
  const asked = [...new Set(teacherExtIds.map((x) => String(x == null ? '' : x).trim()).filter(Boolean))];
  if (!asked.length || asked.length > REMOVE_MAX) return refuse(400, 'missing_field');
  const mine = await mySchool(query, leaderUserId, emis);
  if (!mine) return notFound();
  const byExt = new Map((mine.teachers || []).map((t) => [t.teacherExtId, t]));
  const userIds = asked.map((ext) => byExt.get(ext)).filter((t) => t && t.rumiUserId).map((t) => t.rumiUserId);
  if (!userIds.length) return notFound();
  const why = String(reason || '').trim().slice(0, REASON_MAX) || null;
  return client.removeTeachers({ leaderUserId, schoolExtId: mine.school.schoolExtId, userIds, reason: why });
}

module.exports = {
  searchSchools, addSchool, removeSchool, checkTeacher, addTeacher, removeTeachers, rankSchools,
  SEARCH_MIN, SEARCH_CAP, REMOVE_MAX,
};
