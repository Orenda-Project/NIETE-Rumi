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

// ch3-8 only (bd-5o0ay.10.17): ch9-10 never had an August plan, so everyone gets v9 there.
function inScope({ grade, chapter }) {
  return grade >= 1 && grade <= 5 && chapter >= 3 && chapter <= 8;
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

/** The newest August row of a set, in any order. Pure: the one August rule assetFor and pickAsset share. */
function newestAugust(rows) {
  return (rows || [])
    .filter((a) => isAugust(a.version_stamp))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
}

async function latestAugust(lessonId, assetKind) {
  const { data } = await supabase
    .from('niete_lp_assets')
    .select('id, lesson_id, asset_kind, r2_key, content_hash, version_stamp, is_current, created_at')
    .eq('lesson_id', lessonId)
    .eq('asset_kind', assetKind)
    .order('created_at', { ascending: false });
  return newestAugust(data);
}

const day1Of = (lessonId) => lessonId.replace(/(seg\d+)b$/, '$1');

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
    const day1 = day1Of(lessonId);
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
 * assetFor over asset rows already in hand — for a reader that resolves many opens at once and
 * must not query per lesson. `assets` holds the lesson's rows (and, for group A, its day-1
 * twin's), each with lesson_id, asset_kind, version_stamp, is_current, created_at. Same rule as
 * assetFor: not A → the current row; A → the newest August row, then the day-1 twin's, else null.
 */
function pickAsset({ group, lessonId, assetKind = 'lesson', assets }) {
  const of = (id) => (assets || []).filter((a) => a.lesson_id === id && a.asset_kind === assetKind);
  if (group !== 'A') return of(lessonId).find((a) => a.is_current) || null;
  const own = newestAugust(of(lessonId));
  if (own) return own;
  const day1 = day1Of(lessonId);
  return day1 !== lessonId ? newestAugust(of(day1)) : null;
}

/**
 * groupFor for many teachers at once: userId → 'A' | 'B' | null, before the per-lesson scope
 * (inScope) is applied. Flag off: every teacher null, and nothing else is read. Never throws —
 * a read that fails leaves everyone null (today's delivery), exactly as groupFor does.
 */
async function groupsForUsers(userIds, { chunk = 200 } = {}) {
  const out = new Map();
  const ids = [...new Set((userIds || []).filter(Boolean))];
  ids.forEach((id) => out.set(id, null));
  if (!ids.length || !(await flagOn())) return out;
  try {
    const schoolOf = new Map();
    for (let i = 0; i < ids.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase
        .from('users').select('id, school_id').in('id', ids.slice(i, i + chunk));
      if (error) throw new Error(error.message);
      (data || []).forEach((u) => { if (u.school_id) schoolOf.set(u.id, u.school_id); });
    }
    const schools = [...new Set(schoolOf.values())];
    const groupOf = new Map();
    for (let i = 0; i < schools.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase
        .from('niete_lp_ab_assignment').select('school_id, ab_group').in('school_id', schools.slice(i, i + chunk));
      if (error) throw new Error(error.message);
      (data || []).forEach((r) => {
        if (r.ab_group === 'A' || r.ab_group === 'B') groupOf.set(r.school_id, r.ab_group);
      });
    }
    ids.forEach((id) => out.set(id, groupOf.get(schoolOf.get(id)) || null));
  } catch (err) {
    logToFile('LP A/B: batch group lookup failed — today\'s delivery', { users: ids.length, error: err.message });
    ids.forEach((id) => out.set(id, null));
  }
  return out;
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

module.exports = {
  FLAG_KEY, groupFor, groupsForUsers, inScope, assetFor, pickAsset, augustListable, isAugust, __resetForTests,
};
