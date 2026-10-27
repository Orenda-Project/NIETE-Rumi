'use strict';
/**
 * Stage 0 reads (NIGHTLY_JOB §3): the scope (real ICT schools, roster coaches and their leader_schools, live teachers),
 * the sessions in the window, the open steps and booked visits. analysis_data is fetched by JSON path, so the
 * never-read keys (B1) are never even transferred: lp_fidelity, domains, framework, subject, observe2.rubric only.
 * users.name and users.phone_number are never selected; schools.name is used only in the NIETE% filter.
 */
const crypto = require('crypto');
const C = require('./constants');

const PAGE = 500;
const SESSION_PAGE = 100;

async function fetchAll(client, table, select, apply = (q) => q, order = 'id') {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(select);
    q = apply(q).order(order, { ascending: true }).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/**
 * hex(HMAC-SHA256(secret, 'coachip-teacher|' + users.id))[0:16]: the same bytes as the routes' codec
 * (dashboard/services/coachip-codes.service.js teacherKeyFor, API.md A13; m-api 11:47Z). A secret under 32 bytes → null.
 * A test pins a vector and, once both PRs are merged, compares this with teacherKeyFor directly.
 */
const MIN_SECRET_BYTES = 32;
function teacherKey(secret, userId) {
  const id = userId == null ? '' : String(userId).trim();
  if (!id || typeof secret !== 'string' || Buffer.byteLength(secret) < MIN_SECRET_BYTES) return null;
  return crypto.createHmac('sha256', secret).update(`coachip-teacher|${id}`).digest('hex').slice(0, 16);
}

/** Karachi day [from, to] inclusive → UTC ISO bounds [start, end). */
function karachiBounds(fromDate, toDate) {
  const start = new Date(`${fromDate}T00:00:00+05:00`).toISOString();
  const end = new Date(new Date(`${toDate}T00:00:00+05:00`).getTime() + 86400000).toISOString();
  return { start, end };
}

async function loadScope(client) {
  const schoolsRaw = await fetchAll(client, 'schools', 'id,region,is_probable_test,name');
  const schools = new Map();
  for (const s of schoolsRaw) {
    const isNiete = typeof s.name === 'string' && /^niete/i.test(s.name);
    if (C.SECTORS.includes(s.region) && s.is_probable_test !== true && !isNiete) schools.set(s.id, s.region);
  }
  const settings = await fetchAll(client, 'app_settings', 'key,value', (q) => q.in('key', ['analytics_rdf_coaches', 'portal_coachip', 'portal_coachip_rm']), 'key');
  const roster = settings.find((r) => r.key === 'analytics_rdf_coaches');
  const rosterCoaches = new Map(); // userId → declared sector
  const rv = roster && (typeof roster.value === 'string' ? JSON.parse(roster.value) : roster.value);
  for (const c of (rv && rv.coaches) || []) for (const id of c.userIds || []) rosterCoaches.set(id, C.SECTORS.includes(c.sector) ? c.sector : null);

  const holdings = await fetchAll(client, 'leader_schools', 'leader_user_id,school_id', (q) => q.not('school_id', 'is', null));
  const coaches = new Map(); // coachId → {sector, schoolIds:Set}
  const holders = new Map(); // schoolId → Set(coachId)
  for (const h of holdings) {
    if (!rosterCoaches.has(h.leader_user_id) || !schools.has(h.school_id)) continue;
    if (!coaches.has(h.leader_user_id)) coaches.set(h.leader_user_id, { sector: rosterCoaches.get(h.leader_user_id), schoolIds: new Set() });
    coaches.get(h.leader_user_id).schoolIds.add(h.school_id);
    if (!holders.has(h.school_id)) holders.set(h.school_id, new Set());
    holders.get(h.school_id).add(h.leader_user_id);
  }
  for (const c of coaches.values()) {
    if (!c.sector) { // live claim fills a gap: the modal region of the coach's schools (RDF render.py rule)
      const n = new Map();
      for (const s of c.schoolIds) n.set(schools.get(s), (n.get(schools.get(s)) || 0) + 1);
      c.sector = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  const teachersRaw = await fetchAll(client, 'users', 'id,school_id,is_test_user,deleted_at',
    (q) => q.eq('role', 'teacher').not('school_id', 'is', null));
  const teachers = new Map(); // teacherId → schoolId
  for (const t of teachersRaw) if (t.deleted_at == null && t.is_test_user !== true && schools.has(t.school_id)) teachers.set(t.id, t.school_id);
  const testUsers = new Set((await fetchAll(client, 'users', 'id', (q) => q.eq('is_test_user', true))).map((u) => u.id));
  return { schools, coaches, holders, teachers, testUsers, rosterCoaches, flags: settings.filter((r) => r.key !== 'analytics_rdf_coaches') };
}

const SESSION_SELECT = [
  'id', 'user_id', 'observer_user_id', 'observation_type', 'status', 'created_at', 'audio_url', 'audio_duration_seconds',
  'audio_hash', 'duplicate_of_session_id', 'has_lesson_plan',
  'lp:analysis_data->lp_fidelity', 'domains:analysis_data->domains', 'framework:analysis_data->framework',
  'subject:analysis_data->subject', 'rubric:analysis_data->observe2->rubric',
].join(',');

const VISIT_BAD = ['cancelled', 'abandoned', 'failed', 'test_cleanup'];

/** The governed population (coaching-query-rules §1 v0.39.1; NIGHTLY_JOB §3). */
function inPopulation(s, scope) {
  if (!scope.teachers.has(s.user_id)) return false;
  if (s.observer_user_id && (s.observer_user_id === s.user_id || scope.testUsers.has(s.observer_user_id))) return false;
  if (s.observation_type == null) return s.status !== 'test_cleanup';
  return s.observation_type === 'leader_observation' && !VISIT_BAD.includes(s.status);
}

/** Rebuilds the allow-listed analysis_data subset from the JSON-path columns. */
function analysisOf(row) {
  const ad = {};
  if (row.lp != null) ad.lp_fidelity = row.lp;
  if (row.domains != null) ad.domains = row.domains;
  if (row.framework != null) ad.framework = row.framework;
  if (row.subject != null) ad.subject = row.subject;
  if (row.rubric != null) ad.observe2 = { rubric: row.rubric };
  return Object.keys(ad).length ? ad : null;
}

/** Streams the window's sessions page by page into onRow(row, analysis); raw pages are dropped after each call. */
async function forEachSession(client, { fromDate, toDate, scope }, onRow) {
  const { start, end } = karachiBounds(fromDate, toDate);
  let seen = 0; let kept = 0;
  // Keyset pages (created_at, id): an OFFSET over JSON-path columns times out on prod (probe 26 Oct).
  let after = null;
  for (;;) {
    let q = client.from('coaching_sessions').select(SESSION_SELECT).lt('created_at', end);
    q = after
      ? q.or(`created_at.gt.${after.created_at},and(created_at.eq.${after.created_at},id.gt.${after.id})`)
      : q.gte('created_at', start);
    const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(SESSION_PAGE);
    if (error) throw new Error(`read coaching_sessions: ${error.message}`);
    for (const row of data) {
      seen += 1;
      if (!inPopulation(row, scope)) continue;
      kept += 1;
      await onRow(row, analysisOf(row));
    }
    if (data.length < SESSION_PAGE) return { seen, kept };
    after = data[data.length - 1];
  }
}

async function loadVisits(client, fromDate) {
  return fetchAll(client, 'observation_schedules', 'leader_user_id,teacher_user_id,scheduled_for,status,session_id',
    (q) => q.gte('scheduled_for', fromDate));
}

module.exports = { fetchAll, teacherKey, karachiBounds, loadScope, forEachSession, inPopulation, analysisOf, loadVisits, SESSION_SELECT };
