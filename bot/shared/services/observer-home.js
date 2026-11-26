'use strict';
/**
 * bd-dsu5mq (queue #291) — a person's home: the region and organization their SCHOOL says they belong to.
 *
 * Many accounts carry no users.region (FDE's July import left it blank on hundreds of teachers). That was harmless
 * until a coach made such a teacher a Principal: the region-scoped switch keys ("role:principal@ict" in fico_s_coach
 * and fico_s_dc) never reached him, and his grade 6-12 visit fell to FDE's hand-scored form with no Digital Coach
 * (Muhammad Ayyaz Nawaz, IMCB I-8/3, 26 Nov). Two uses, one answer:
 *
 *   homePatch(userId, schoolExtId)  the role edit (teacher-edit-commit.service writeRoleChange): what to fill on the
 *                                   users row, ONLY where region / organization are blank. Never overwrites.
 *   fallbackFor(who)                the switches (fico-s-switch, obs612-switch) when users.region is blank: the
 *                                   school's region, else the organization users.organization names, else nothing.
 *
 * Where the school comes from, in order: users.school_id; the school the coach picked the person from (schoolExtId
 * through leader_schools, role edit only); for a coach with neither, the schools she holds (leader_schools), when
 * they all sit in one region. The organization is the region registry's owner of that region (region-registry.js).
 *
 * Never throws: a failed read answers {} and everything behaves exactly as before this file existed. A region the
 * caller already holds, or a failed users read upstream (a Symbol, not blank), is never replaced.
 */

const { logToFile } = require('../utils/logger');

const db = () => require('../config/supabase');

/** A person's keyed reference for a log line (quiz/web-quiz-kid tk), never the raw users.id; null without a key. */
function tkOf(userId) {
  try { return require('./quiz/web-quiz-kid').tk(userId); } catch (_) { return null; }
}
const TTL_MS = 60 * 1000;
let _cache = new Map(); // userId -> { at, value } for fallbackFor

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim());

/** users.organization is free text ('niete', 'moawin', or a longer name holding one): the registry's spelling, or null. */
function orgFromText(org) {
  const s = String(org || '').toLowerCase();
  if (s.includes('moawin')) return 'moawin';
  if (s.includes('niete') || s.includes('fde')) return 'niete';
  return null;
}

async function rows(q) {
  const { data, error } = await q;
  if (error) throw new Error(error.message || 'read refused');
  return data || [];
}

async function regionOfSchool(client, schoolId) {
  if (!schoolId) return null;
  const [s] = await rows(client.from('schools').select('id, region').eq('id', schoolId).limit(1));
  return s && !blank(s.region) ? String(s.region).trim() : null;
}

/** The person's school region: users.school_id, else the school the coach picked them from, else a coach's schools. */
async function schoolRegionFor(client, row, schoolExtId) {
  let region = await regionOfSchool(client, row.school_id);
  if (!region && schoolExtId) {
    const [ls] = await rows(client.from('leader_schools').select('school_id').eq('school_ext_id', schoolExtId).limit(1));
    region = await regionOfSchool(client, ls && ls.school_id);
  }
  if (!region && String(row.role || '').trim().toLowerCase() === 'coach') {
    const held = await rows(client.from('leader_schools').select('school_id').eq('leader_user_id', row.id));
    const ids = [...new Set(held.map((h) => h.school_id).filter(Boolean))];
    if (ids.length) {
      const regions = new Set((await rows(client.from('schools').select('id, region').in('id', ids)))
        .map((s) => (blank(s.region) ? null : String(s.region).trim())).filter(Boolean));
      if (regions.size === 1) region = [...regions][0];
    }
  }
  return region;
}

/** { region, organization } the school gives this users row; either may be null. Throws on a failed read. */
async function homeOf(client, row, schoolExtId) {
  const region = await schoolRegionFor(client, row, schoolExtId);
  let organization = null;
  if (region) {
    const { organizationForRegion } = require('./region-registry');
    organization = await organizationForRegion(client, region);
  }
  return { region, organization: organization || orgFromText(row.organization) };
}

async function readUser(client, userId) {
  const [row] = await rows(client.from('users').select('id, role, region, organization, school_id').eq('id', userId).limit(1));
  return row || null;
}

/**
 * For a role edit: the columns to fill on this person's users row, only where blank. Never throws ({} on failure).
 * @returns {Promise<{region?: string, organization?: string}>}
 */
async function homePatch(userId, schoolExtId, client = db()) {
  if (!userId) return {};
  try {
    const row = await readUser(client, userId);
    if (!row || (!blank(row.region) && !blank(row.organization))) return {};
    const home = await homeOf(client, row, schoolExtId);
    const patch = {};
    if (blank(row.region) && home.region) patch.region = home.region;
    if (blank(row.organization) && home.organization) patch.organization = home.organization;
    return patch;
  } catch (e) {
    logToFile('observer home: lookup failed - the role edit stands without a region', { tk: tkOf(userId), error: e && e.message }, 'warn');
    return {};
  }
}

/**
 * For the switches: when the caller's region is blank, the school's region ({region}), else the organization
 * users.organization names ({organization}), else {}. A region already held (or a failed-read Symbol) is left alone.
 * Never throws; cached 60 s per user.
 */
async function fallbackFor(who, now = Date.now()) {
  const w = who || {};
  if (!w.userId || !blank(w.region)) return {};
  const hit = _cache.get(w.userId);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  let value = {};
  try {
    const client = db();
    const row = await readUser(client, w.userId);
    if (row) {
      if (!blank(row.region)) value = { region: String(row.region).trim() };
      else {
        const home = await homeOf(client, row, null);
        if (home.region) value = { region: home.region };
        else if (home.organization) value = { organization: home.organization };
      }
    }
  } catch (e) {
    logToFile('observer home: switch fallback failed - deciding as before', { tk: tkOf(w.userId), error: e && e.message }, 'warn');
    return {}; // not cached: the next read may succeed
  }
  _cache.set(w.userId, { at: now, value });
  return value;
}

function _resetCache() { _cache = new Map(); }

module.exports = { homePatch, fallbackFor, orgFromText, blank, tkOf, _resetCache };
