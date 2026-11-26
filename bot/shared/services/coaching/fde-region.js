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
 *   3. the observer (the coach or principal): users.source 'main_rumi_gb', else her own school. NEVER her profile
 *      users.region (bd-dsu5mq.2, operator 26 Nov ~21:40: "decide ICT vs GB from the VISIT'S SCHOOL region only, never
 *      the observer's profile region"): a coach-made principal with a blank or wrong users.region was put on the wrong
 *      rubric (Ayyaz, IMCB I-8/3, 26 Nov: FDE's hand-scored form instead of FICO-S with the Digital Coach).
 *
 * visitPlace() answers the same question and also names the region that decided it (the school's, when it was a
 * school), and switchWho() turns it into the lookup every observe switch uses (fico_s_coach, fico_s_dc, obs612_coach,
 * fico_coach_rubric): who the observer IS (users.id, role) and where the VISIT is, never where her profile says she is.
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

const textOf = (v) => (norm(v) ? String(v).trim() : null);

/**
 * The side the schools an observer holds (leader_schools) sit on, when every real one sits on the same side: a coach
 * has no users.school_id, and a visit that names no school yet (the portal's class question) is hers. Throws on a
 * failed read (the caller answers 'error'). Null when she holds none, only test schools, or schools on both sides.
 */
async function placeOfHeldSchools(observerId) {
  const held = await rows('leader_schools', 'school_id', [['leader_user_id', observerId]]);
  const sides = new Map(); // side -> Set of region values
  for (const h of held) {
    // eslint-disable-next-line no-await-in-loop
    const sch = await schoolById(h.school_id);
    if (!sch || sch.is_probable_test) continue;
    // eslint-disable-next-line no-await-in-loop
    const side = await regionOfValue(sch.region);
    if (side === 'unknown') continue;
    if (!sides.has(side)) sides.set(side, new Set());
    if (textOf(sch.region)) sides.get(side).add(textOf(sch.region));
    if (sides.size > 1) return null; // both sides: nothing to go on
  }
  if (sides.size !== 1) return null;
  const [[side, regions]] = [...sides];
  return { side, region: regions.size === 1 ? [...regions][0] : null };
}

/**
 * Where a visit is: its side and the region value that decided it.
 * @param {{observer?: object|string, teacherUserId?: string|null, schoolExtId?: string|null, schoolId?: string|null}} visit
 *   observer: the users row in hand (or its id); a row without source/school_id is re-read
 * @returns {Promise<{side: 'ict'|'gb'|'unknown'|'error', region: string|null}>}  never throws. `region` is the school's
 *   schools.region when a school decided (also when the registry does not list it, side 'unknown'), else the teacher's
 *   users.region when she decided, else null.
 */
async function visitPlace({ observer = null, teacherUserId = null, schoolExtId = null, schoolId = null } = {}) {
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
      if (r !== 'unknown') return { side: r, region: textOf(school.region) };
    }
    // 2. the teacher, unless she sits at a test school (her region is the test school's)
    if (teacher && !(school && school.is_probable_test)) {
      const r = await ownRegion(teacher);
      if (r !== 'unknown') return { side: r, region: GB_SOURCES.has(norm(teacher.source)) ? null : textOf(teacher.region) };
    }
    // 3. the observer: the GB import source, else her own school, else the schools she holds (a coach), when they all
    //    sit on one side. Never her profile users.region (bd-dsu5mq.2).
    if (obs && GB_SOURCES.has(norm(obs.source))) return { side: 'gb', region: null };
    const own = obs ? await schoolById(obs.school_id) : null;
    if (own && !own.is_probable_test) {
      const r = await regionOfValue(own.region);
      return { side: r, region: textOf(own.region) };
    }
    if (obs && obs.id) {
      const heldPlace = await placeOfHeldSchools(obs.id);
      if (heldPlace) return heldPlace;
    }
    // A real school whose region the registry does not list: unknown, but its region still names the place.
    return { side: 'unknown', region: school && !school.is_probable_test ? textOf(school.region) : null };
  } catch (err) {
    logToFile('fde region: the visit\'s region could not be read — no FDE for this visit', { error: err.message }, 'error');
    return { side: 'error', region: null };
  }
}

/** Which region a visit is in: 'ict' | 'gb' | 'unknown' | 'error'. Never throws. */
async function visitRegion(visit = {}) {
  return (await visitPlace(visit)).side;
}

/**
 * bd-dsu5mq.2 — the lookup an observe switch makes for an observer AT a visit: who she is (users.id, role) and where the
 * visit is (its school's region and that side's organization), never her profile users.region. 'unknown' (a school the
 * registry does not list, or nothing to go on) is this deployment's own side, ICT, exactly as fdeAllowed treats it.
 * 'gb' and 'error' are for the caller to refuse before asking (no FICO-S, no FDE).
 * @param {{id: string, role?: string}} user  @param {{side: string, region: string|null}} place
 */
const ORG_OF_SIDE = { ict: 'niete', unknown: 'niete', gb: 'moawin' };
function switchWho(user, place = {}) {
  const u = user || {};
  return {
    userId: u.id,
    ...(u.role !== undefined ? { role: u.role } : {}),
    region: (place && place.region) || null,
    organization: ORG_OF_SIDE[place && place.side] || null,
  };
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

module.exports = { visitRegion, visitPlace, switchWho, fdeAllowed, isGbVisit, GB_SOURCES };
