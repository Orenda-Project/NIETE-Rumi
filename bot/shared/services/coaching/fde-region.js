'use strict';
/**
 * bd-hk2jm3 — FDE's grade 6-8 tools (obs612) are ICT's only. Operator, 17 Nov ~15:15: "The rubrics that we changed for
 * 6 to 8, those are supposed to be for ICT only, not for GB ... for Gilgit Baltistan, it's gonna be the same Fico one
 * that's live everywhere else. So for DC, it's supposed to be V3, and for HITL, it's supposed to be V6".
 *
 * So whatever the obs612_coach rows say, a GB visit is never FDE, and its HITL rubric is FICO17 v6 at every grade (the
 * grades 1-5 / 9-12 gate exists only because FDE owns grades 6-8 in ICT). This module answers one question: which
 * region is this VISIT in?
 *
 *   1. the visit's school (schools.region, by the region registry): the school the coach picked (her leader_schools
 *      holding for the visit's school_ext_id), else the observed teacher's users.school_id;
 *   2. the observed teacher herself, when she has no school row: users.source 'main_rumi_gb', else users.region;
 *   3. the observer (the coach or principal): users.source 'main_rumi_gb', users.region, else her own school.
 *
 * A test school (schools.is_probable_test) never decides, and neither does a teacher seeded at one: FDE's own testers
 * (ICT) observe test teachers at GB's "(Rumi QA)" test schools, whose phone numbers cannot reach anyone (prod, 17 Nov:
 * 5 of the 6 FDE visits at GB schools were theirs). A visit at a test school is the observer's region.
 *
 * 'unknown' (most ICT coaches hold users.region 'ICT' or none, which the registry does not list) is not GB: FDE stays as
 * the switch says. A failed read is 'error': no FDE (fail closed, as the obs612 switch itself) and no GB widening.
 * Reads use select/eq only, so a caller's stub that answers no rows gets 'unknown' (today's behaviour).
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const GB_SOURCES = new Set(['main_rumi_gb']);
const ANSWER_OF = { niete: 'ict', moawin: 'gb' };

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

async function rows(table, cols, filters) {
  let q = supabase.from(table).select(cols);
  for (const [col, v] of filters) q = q.eq(col, v);
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message || 'read failed'}`);
  return Array.isArray(data) ? data : data ? [data] : [];
}

const firstRow = async (table, cols, filters) => (await rows(table, cols, filters))[0] || null;

/** A users.region / schools.region value → 'ict' | 'gb' | 'unknown', by the region registry (throws if unreadable). */
async function regionOfValue(value) {
  if (!norm(value)) return 'unknown';
  const { organizationForRegion } = require('../region-registry');
  return ANSWER_OF[norm(await organizationForRegion(supabase, value))] || 'unknown';
}

async function schoolById(id) {
  return id ? firstRow('schools', 'id, region, is_probable_test', [['id', id]]) : null;
}

/** A users row's own region: the GB import source, then users.region. */
async function ownRegion(u) {
  if (!u) return 'unknown';
  if (GB_SOURCES.has(norm(u.source))) return 'gb';
  return regionOfValue(u.region);
}

async function userRow(u) {
  if (!u) return null;
  if (typeof u === 'string') return firstRow('users', 'id, region, source, school_id', [['id', u]]);
  if (u.id && (u.source === undefined || u.school_id === undefined)) {
    return (await firstRow('users', 'id, region, source, school_id', [['id', u.id]])) || u;
  }
  return u;
}

/**
 * Which region a visit is in.
 * @param {{observer?: object|string, teacherUserId?: string|null, schoolExtId?: string|null, schoolId?: string|null}} visit
 *   observer: the users row in hand (or its id); a row without source/school_id is re-read
 * @returns {Promise<'ict'|'gb'|'unknown'|'error'>}  never throws
 */
async function visitRegion({ observer = null, teacherUserId = null, schoolExtId = null, schoolId = null } = {}) {
  try {
    const obs = await userRow(observer);
    // 1. the visit's school
    let school = await schoolById(schoolId);
    if (!school && schoolExtId && obs && obs.id) {
      const held = await firstRow('leader_schools', 'school_id', [['leader_user_id', obs.id], ['school_ext_id', String(schoolExtId)]]);
      school = await schoolById(held && held.school_id);
    }
    const teacher = teacherUserId ? await userRow(String(teacherUserId)) : null;
    if (!school && teacher) school = await schoolById(teacher.school_id);
    if (school && !school.is_probable_test) {
      const r = await regionOfValue(school.region);
      if (r !== 'unknown') return r;
    }
    // 2. the teacher, unless she sits at a test school (her region is the test school's)
    if (teacher && !(school && school.is_probable_test)) {
      const r = await ownRegion(teacher);
      if (r !== 'unknown') return r;
    }
    // 3. the observer
    const r = await ownRegion(obs);
    if (r !== 'unknown') return r;
    const own = obs ? await schoolById(obs.school_id) : null;
    if (own && !own.is_probable_test) return regionOfValue(own.region);
    return 'unknown';
  } catch (err) {
    logToFile('fde region: the visit\'s region could not be read — no FDE for this visit', { error: err.message }, 'error');
    return 'error';
  }
}

/** May this visit use FDE's grade 6-8 tools? Not in GB, and not when its region cannot be read. Never throws. */
async function fdeAllowed(visit) {
  const r = await visitRegion(visit);
  return r !== 'gb' && r !== 'error';
}

/** Is this a GB visit (FICO17 v6 at every grade, when the coach switch says v6)? Only a positive answer. */
async function isGbVisit(visit) {
  return (await visitRegion(visit)) === 'gb';
}

module.exports = { visitRegion, fdeAllowed, isGbVisit, GB_SOURCES };
