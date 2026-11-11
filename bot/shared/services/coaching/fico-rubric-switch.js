'use strict';
/**
 * bd-ra8xu.38 — which FICO rubric a coach visit and a self-recording use, per region. Two switches in
 * app_settings, both OFF by default. Flipping either (or back) needs no deploy.
 *
 *   fico_coach_rubric   the coach paths (/observe, /observe2):   'current' | 'v6'
 *   fico_dc_rubric      the Digital Coach on self-recordings:     'v3' | 'shadow' | 'v6'
 *
 * Each value is either one string for every region, or a JSON map from region to value:
 *
 *   {"*": "current", "sihala": "v6"}            region keys are users.region lowercased ("sihala", "gilgit-baltistan")
 *   {"ict": "v6", "gb": "current"}              "ict" = every region FDE owns (organization 'niete'), "gb" = Moawin's
 *
 * Lookup order: the user's region, then its organization ('niete'/'ict', 'moawin'/'gb'), then "*", then OFF.
 * An unknown value, no row, or a failed read is OFF ('current' / 'v3'). Read like ab_v10_enabled: fail closed,
 * 30 s cache (settings/switch-cache).
 *
 * 'current' on the coach switch means what each tool scores today: /observe FICO V3, /observe2 FICO17 v5.
 * V3 keeps scoring every self-recording whatever fico_dc_rubric says, so the v10 coaching A/B test reads the same
 * numbers it always has; 'shadow' adds a v6 score beside it that is stored and never sent.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');

const COACH_KEY = 'fico_coach_rubric';
const DC_KEY = 'fico_dc_rubric';
const TTL_MS = 30 * 1000;

const COACH_VALUES = ['current', 'v6'];
const DC_VALUES = ['v3', 'shadow', 'v6'];
const COACH_OFF = 'current';
const DC_OFF = 'v3';

const ORG_ALIASES = { niete: ['niete', 'ict'], moawin: ['moawin', 'gb'] };

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
function resolve(map, { region, organization } = {}, allowed, off) {
  const tries = [norm(region)];
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

async function organizationFor(region) {
  if (!norm(region)) return null;
  try {
    const { organizationForRegion } = require('../region-registry');
    return await organizationForRegion(supabase, region);
  } catch (_) {
    return null; // the region key and "*" still apply
  }
}

function needsOrg(map, region) {
  const keys = Object.keys(map);
  if (!keys.length) return false;
  if (map[norm(region)] !== undefined) return false;
  return keys.some((k) => ['niete', 'ict', 'moawin', 'gb'].includes(k));
}

/**
 * @param {{region?: string, organization?: string}} who  the user's region (users.region)
 * @returns {Promise<'current'|'v6'>}
 */
async function coachRubric(who = {}, now = Date.now()) {
  const { coach } = await cache.get(now);
  const organization = who.organization || (needsOrg(coach, who.region) ? await organizationFor(who.region) : null);
  return resolve(coach, { region: who.region, organization }, COACH_VALUES, COACH_OFF);
}

/** @returns {Promise<'v3'|'shadow'|'v6'>} */
async function dcRubric(who = {}, now = Date.now()) {
  const { dc } = await cache.get(now);
  const organization = who.organization || (needsOrg(dc, who.region) ? await organizationFor(who.region) : null);
  return resolve(dc, { region: who.region, organization }, DC_VALUES, DC_OFF);
}

/** The region of a user id, for callers that hold only the id. Null on any failure (→ "*" or off). */
async function regionOfUser(userId) {
  if (!userId) return null;
  try {
    const { data } = await supabase.from('users').select('region').eq('id', userId).maybeSingle();
    return (data && data.region) || null;
  } catch (_) {
    return null;
  }
}

function _resetCache() { cache.reset(); }

module.exports = {
  COACH_KEY, DC_KEY, COACH_VALUES, DC_VALUES, COACH_OFF, DC_OFF,
  asMap, resolve, coachRubric, dcRubric, regionOfUser, _resetCache,
};
