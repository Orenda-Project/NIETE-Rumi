/**
 * ICT G1-5 ch3-10 lesson-plan A/B test (bd-5o0ay.10.1).
 *
 * A = the August v8 PDF, B = the v9 render that is current. The group belongs to the
 * teacher's school and is read from niete_lp_ab_assignment, written once at the draw.
 * Only while app_settings.ab_lp_ch310_enabled is on. Anything that cannot be resolved
 * (flag off, no school, school not drawn, a read error) returns null: today's delivery.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

const FLAG_KEY = 'ab_lp_ch310_enabled';
const FLAG_TTL_MS = 30 * 1000;
const AUGUST = /^v8u?-202608/;
let flagCache = null; // { at, on }

function isOn(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

async function flagOn(now = Date.now()) {
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.on;
  try {
    const { data, error } = await supabase
      .from('app_settings').select('key,value').eq('key', FLAG_KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    flagCache = { at: now, on: Boolean(data && isOn(data.value)) };
    return flagCache.on;
  } catch (err) {
    // Fail closed, and do not cache the failure.
    logToFile('LP A/B: flag lookup failed — treating as off', { error: err.message });
    return false;
  }
}

function inScope({ grade, chapter }) {
  return grade >= 1 && grade <= 5 && chapter >= 3 && chapter <= 10;
}

/** 'A' | 'B' for a teacher whose school is in the draw, else null. Never throws. */
async function groupFor(userId, { grade, chapter }) {
  if (!userId || !inScope({ grade, chapter })) return null;
  try {
    if (!(await flagOn())) return null;
    const { data: user, error: uErr } = await supabase
      .from('users').select('id, school_id').eq('id', userId).maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!user || !user.school_id) return null;
    const { data: row, error } = await supabase
      .from('niete_lp_ab_assignment').select('school_id, ab_group')
      .eq('school_id', user.school_id).maybeSingle();
    if (error) throw new Error(error.message);
    return row && (row.ab_group === 'A' || row.ab_group === 'B') ? row.ab_group : null;
  } catch (err) {
    logToFile('LP A/B: group lookup failed — today\'s delivery', { userId, error: err.message });
    return null;
  }
}

function isAugust(stamp) {
  return AUGUST.test(String(stamp || ''));
}

async function latestAugust(lessonId, assetKind) {
  const { data } = await supabase
    .from('niete_lp_assets')
    .select('id, lesson_id, asset_kind, r2_key, content_hash, version_stamp, is_current, created_at')
    .eq('lesson_id', lessonId)
    .eq('asset_kind', assetKind)
    .order('created_at', { ascending: false });
  return (data || []).find((a) => isAugust(a.version_stamp)) || null;
}

/**
 * The asset this group gets. B (and null) get `current`; A gets the latest August row, and
 * a v9 split day-2 lesson (…seg4b) with no August twin gets …seg4's August plan. A gets
 * nothing that is not v8 (Amena, 2 Oct): no August row means null, logged, never v9.
 */
async function assetFor({ group, lessonId, assetKind = 'lesson', current }) {
  if (group !== 'A') return current(lessonId, assetKind);
  try {
    const own = await latestAugust(lessonId, assetKind);
    if (own) return own;
    const day1 = lessonId.replace(/(seg\d+)b$/, '$1');
    if (day1 !== lessonId) {
      const twin = await latestAugust(day1, assetKind);
      if (twin) return twin;
    }
  } catch (err) {
    logToFile('LP A/B: August lookup failed', { lessonId, assetKind, error: err.message });
  }
  logToFile('LP A/B: no August version for group A — nothing sent', { lessonId, assetKind });
  return null;
}

/**
 * For the portal list: the lesson ids group A can open, i.e. ones with an August lesson plan
 * of their own or (a split day 2, …seg4b) on day 1. null means no filtering: not group A, or
 * the lookup failed, in which case the list shows as today.
 */
async function augustListable(group, lessonIds) {
  if (group !== 'A' || !lessonIds.length) return null;
  const day1 = (id) => id.replace(/(seg\d+)b$/, '$1');
  try {
    const { data, error } = await supabase
      .from('niete_lp_assets').select('lesson_id, version_stamp')
      .in('lesson_id', [...new Set([...lessonIds, ...lessonIds.map(day1)])])
      .eq('asset_kind', 'lesson');
    if (error) throw new Error(error.message);
    const august = new Set((data || []).filter((a) => isAugust(a.version_stamp)).map((a) => a.lesson_id));
    return new Set(lessonIds.filter((id) => august.has(id) || august.has(day1(id))));
  } catch (err) {
    logToFile('LP A/B: August list lookup failed — full list', { error: err.message });
    return null;
  }
}

function __resetForTests() { flagCache = null; }

module.exports = { FLAG_KEY, groupFor, assetFor, augustListable, isAugust, __resetForTests };
