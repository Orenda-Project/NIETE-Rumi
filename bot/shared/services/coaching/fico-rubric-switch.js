'use strict';
/**
 * bd-ra8xu.38 — which FICO rubric a coach visit and a self-recording use, per region. Two switches in
 * app_settings, both OFF by default. Flipping either (or back) needs no deploy.
 *
 *   fico_coach_rubric   the coach paths (/observe, /observe2):   'current' | 'shadow' | 'v6'
 *   fico_dc_rubric      the Digital Coach on self-recordings:     'v3' | 'shadow' | 'v6'
 *
 * Each value is either one string for every region, or a JSON map from region to value:
 *
 *   {"*": "current", "sihala": "v6"}            region keys are users.region lowercased ("sihala", "gilgit-baltistan")
 *   {"ict": "v6", "gb": "current"}              "ict" = every region FDE owns (organization 'niete'), "gb" = Moawin's
 *   {"user:<users.id uuid>": "v6"}              one account only (the operator's test accounts), whatever its region
 *
 * Lookup order: "user:<id>", the user's region, then its organization ('niete'/'ict', 'moawin'/'gb'), then "*",
 * then OFF.
 * An unknown value, no row, or a failed read is OFF ('current' / 'v3'). Read like ab_v10_enabled: fail closed,
 * 30 s cache (settings/switch-cache).
 *
 * Failures, as built (bd-qix9oh fix-dc, RULINGS R23):
 *   - app_settings unreadable: switch-cache answers with the last value this process read successfully, else OFF.
 *     There is no age limit on that last good value: a process that read 'v6' and then cannot read app_settings
 *     keeps answering 'v6' until a read succeeds (a rollback to 'current' reaches it on its first good read).
 *     Accepted (r1 T2.1): visits are stamped at creation, so a blip must not flip one mid-flight.
 *   - a lookup the map needs to decide fails (the region registry for an "ict"/"gb" key, or the users read for a
 *     caller that holds only the id): OFF, never "*" (r1 T2.2). With {"*": "v6", "ict": "current"}, landing on "*"
 *     would put an ICT coach on v6 exactly when we cannot tell they are ICT. A lookup that succeeds and finds no
 *     region or no organization is not a failure: "*" applies as usual.
 *
 * 'current' on the coach switch means what each tool scores today: /observe FICO V3, /observe2 FICO17 v5.
 * 'shadow' on the coach switch (bd-qix9oh.5, spec §4.2): an /observe2 visit stays v5 in everything the coach and
 * the teacher see, and its transcript is also read on v6 and stored beside it, never sent (observe2/shadow-v6.js).
 * V3 keeps scoring every self-recording whatever fico_dc_rubric says, so the v10 coaching A/B test reads the same
 * numbers it always has; 'shadow' adds a v6 score beside it that is stored and never sent.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');

const COACH_KEY = 'fico_coach_rubric';
const DC_KEY = 'fico_dc_rubric';
const TTL_MS = 30 * 1000;

const COACH_VALUES = ['current', 'shadow', 'v6'];
const DC_VALUES = ['v3', 'shadow', 'v6'];
const COACH_OFF = 'current';
const DC_OFF = 'v3';

const ORG_ALIASES = { niete: ['niete', 'ict'], moawin: ['moawin', 'gb'] };
// regionOfUser's answer when the users read failed (as opposed to a user with no region).
const REGION_UNKNOWN = Symbol('region unknown');

function parse(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return v; }
}

function norm(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }

/** A stored value as { '*': x } or { region: x, ... }, keys lowercased; anything else is {}. */
function asMap(value) {
  const v = parse(value);
  if (typeof v === 'string') return v.trim() ? { '*': norm(v) } : {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[norm(k)] = norm(val);
  return out;
}

const cache = cachedSwitch({
  ttlMs: TTL_MS,
  off: () => ({ coach: {}, dc: {} }),
  read: async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value').in('key', [COACH_KEY, DC_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = new Map((data || []).map((r) => [r.key, r.value]));
    return { coach: asMap(byKey.get(COACH_KEY)), dc: asMap(byKey.get(DC_KEY)) };
  },
  log: (err) => logToFile('fico rubric switch: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/** Pure: the value a map gives a region (and its organization, when known), else off. */
function resolve(map, { userId, region, organization } = {}, allowed, off) {
  const tries = [userId ? `user:${norm(String(userId))}` : '', norm(region)];
  const org = norm(organization);
  if (org) tries.push(...(ORG_ALIASES[org] || [org]));
  tries.push('*');
  for (const k of tries) {
    if (!k) continue;
    const v = map[k];
    if (v !== undefined) return allowed.includes(v) ? v : off;
  }
  return off;
}

/** The organization owning a region, null when there is none. Throws when the registry cannot be read (→ OFF). */
async function organizationFor(region) {
  if (!norm(region)) return null;
  const { organizationForRegion } = require('../region-registry');
  return organizationForRegion(supabase, region);
}

function needsOrg(map, region, userId) {
  const keys = Object.keys(map);
  if (!keys.length) return false;
  if (userId && map[`user:${norm(String(userId))}`] !== undefined) return false;
  if (map[norm(region)] !== undefined) return false;
  return keys.some((k) => ['niete', 'ict', 'moawin', 'gb'].includes(k));
}

async function pickFor(map, who, allowed, off) {
  const w = who || {};
  if (w.region === REGION_UNKNOWN) {
    // The users read failed: only a key that needs no region ("user:<id>", or "*" alone) can decide.
    const own = w.userId && map[`user:${norm(String(w.userId))}`] !== undefined;
    if (!own && Object.keys(map).some((k) => k !== '*' && !k.startsWith('user:'))) return off;
    return resolve(map, { userId: w.userId }, allowed, off);
  }
  let organization = w.organization || null;
  if (!organization && needsOrg(map, w.region, w.userId)) {
    try {
      organization = await organizationFor(w.region);
    } catch (err) {
      logToFile('fico rubric switch: region registry lookup failed — treating as off', { error: err.message }, 'error');
      return off;
    }
  }
  return resolve(map, { userId: w.userId, region: w.region, organization }, allowed, off);
}

/**
 * @param {{userId?: string, region?: string, organization?: string}} who  the user (users.id) and region (users.region)
 * @returns {Promise<'current'|'shadow'|'v6'>}  never throws; OFF on any failure
 */
async function coachRubric(who = {}, now = Date.now()) {
  try {
    const { coach } = await cache.get(now);
    return await pickFor(coach, who, COACH_VALUES, COACH_OFF);
  } catch (_) {
    return COACH_OFF;
  }
}

/** @returns {Promise<'v3'|'shadow'|'v6'>}  never throws; OFF on any failure */
async function dcRubric(who = {}, now = Date.now()) {
  try {
    const { dc } = await cache.get(now);
    return await pickFor(dc, who, DC_VALUES, DC_OFF);
  } catch (_) {
    return DC_OFF;
  }
}

/**
 * Whether a switch has any value at all (cheap: the cached row only). Callers skip their own lookups (a user's
 * region) when it is false, so the default-off path costs no more than one cached settings read.
 */
async function isAnySet(kind, now = Date.now()) {
  try {
    const maps = await cache.get(now);
    return Object.keys(maps[kind === 'coach' ? 'coach' : 'dc'] || {}).length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * The region of a user id, for callers that hold only the id. Null when the user has none; a failed read is
 * REGION_UNKNOWN, which resolves to OFF wherever the region would have mattered (T2.2), and to "*" where it would not.
 */
async function regionOfUser(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase.from('users').select('region').eq('id', userId).maybeSingle();
    if (error) return REGION_UNKNOWN;
    return (data && data.region) || null;
  } catch (_) {
    return REGION_UNKNOWN;
  }
}

function _resetCache() { cache.reset(); }

module.exports = {
  COACH_KEY, DC_KEY, COACH_VALUES, DC_VALUES, COACH_OFF, DC_OFF, REGION_UNKNOWN,
  asMap, resolve, coachRubric, dcRubric, isAnySet, regionOfUser, _resetCache,
};
