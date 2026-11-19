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
 *   {"role:principal": "v6"}                    everyone with that users.role (bd-9bppaz), so a new account joins on
 *                                               its own; "role:coach" the same for coaches
 *   {"role:principal@ict": "v6"}                that role in one organization ("ict", "gb") or one region ("sihala")
 *
 * Queue #191 (operator 19 Nov): the coach switch is no longer a gate for coaches: users.role 'coach' is always 'v6'
 * (coachRubric). The rows below decide only for everyone else (principals and any other role).
 *
 * Lookup order: "user:<id>"; the role keys, scoped to the user's region, then to its organization, then the bare
 * role; the user's region; its organization ('niete'/'ict', 'moawin'/'gb'); "*"; then OFF. Who you are beats where
 * you are: {"role:principal": "v6", "sihala": "current"} puts a Sihala principal on v6.
 * The role is users.role, trimmed and lowercased. A caller that holds the users row passes it (`role`); otherwise it is
 * read, and only when the map holds a role key that the user's own key does not already override.
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
 *   - the user's role cannot be read while the map holds a role key: OFF, never "*", for the same reason (bd-9bppaz).
 *     A user with no role is not a failure: the role keys simply do not apply.
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
// Queue #184: 'off' | 'on', the same keys and lookup, OFF by default. On for a user: FICO17 v6's starred indicators
// (rubric field `starred`: the six HITL-only) are never sent to the Digital Coach for that user's v6 visits (the
// observer) or self-recordings (the teacher): frameworks/fico17-v6-framework.js starredVariant.
const STARRED_SETTING = 'fico_v6_starred';
const STARRED_VALUES = ['off', 'on'];
const TTL_MS = 30 * 1000;

const COACH_VALUES = ['current', 'shadow', 'v6'];
const DC_VALUES = ['v3', 'shadow', 'v6'];
const COACH_OFF = 'current';
const DC_OFF = 'v3';

const ORG_ALIASES = { niete: ['niete', 'ict'], moawin: ['moawin', 'gb'] };
const ORG_KEYS = ['niete', 'ict', 'moawin', 'gb'];
const ROLE_PREFIX = 'role:';
// regionOfUser's answer when the users read failed (as opposed to a user with no region).
const REGION_UNKNOWN = Symbol('region unknown');
// roleOfUser's answer when the users read failed (as opposed to a user with no role).
const ROLE_UNKNOWN = Symbol('role unknown');

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
  off: () => ({ coach: {}, dc: {}, starred: {} }),
  read: async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value').in('key', [COACH_KEY, DC_KEY, STARRED_SETTING]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = new Map((data || []).map((r) => [r.key, r.value]));
    return { coach: asMap(byKey.get(COACH_KEY)), dc: asMap(byKey.get(DC_KEY)), starred: asMap(byKey.get(STARRED_SETTING)) };
  },
  log: (err) => logToFile('fico rubric switch: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/** Pure: the value a map gives a user (by id, role, region and its organization, when known), else off. */
function resolve(map, { userId, role, region, organization } = {}, allowed, off) {
  const reg = norm(region);
  const org = norm(organization);
  const orgKeys = org ? (ORG_ALIASES[org] || [org]) : [];
  const r = typeof role === 'string' ? norm(role) : '';
  const tries = [userId ? `user:${norm(String(userId))}` : ''];
  if (r) tries.push(...[reg, ...orgKeys].filter(Boolean).map((s) => `${ROLE_PREFIX}${r}@${s}`), `${ROLE_PREFIX}${r}`);
  tries.push(reg, ...orgKeys, '*');
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

/** Does the organization decide anything here? (Only then is the region registry read.) */
function needsOrg(map, region, userId, role) {
  const keys = Object.keys(map);
  if (!keys.length) return false;
  if (userId && map[`user:${norm(String(userId))}`] !== undefined) return false;
  const reg = norm(region);
  const r = typeof role === 'string' ? norm(role) : '';
  if (r) {
    if (reg && map[`${ROLE_PREFIX}${r}@${reg}`] !== undefined) return false;
    if (ORG_KEYS.some((o) => map[`${ROLE_PREFIX}${r}@${o}`] !== undefined)) return true;
    if (map[`${ROLE_PREFIX}${r}`] !== undefined) return false;
  }
  if (map[reg] !== undefined) return false;
  return keys.some((k) => ORG_KEYS.includes(k));
}

const hasRoleKeys = (map) => Object.keys(map).some((k) => k.startsWith(ROLE_PREFIX));

async function pickFor(map, who, allowed, off) {
  const w = who || {};
  const own = Boolean(w.userId) && map[`user:${norm(String(w.userId))}`] !== undefined;
  // bd-9bppaz: the role, when a role key could decide and the caller did not say it. Read before the region branch so
  // that a failed read is OFF wherever a role key exists (T2.2: never "*" past the key that could have decided).
  let role = w.role;
  if (role === undefined && !own && hasRoleKeys(map)) role = await roleOfUser(w.userId);
  if (role === ROLE_UNKNOWN) return off;
  if (w.region === REGION_UNKNOWN) {
    // The users read failed: only a key that needs no region ("user:<id>", or "*" alone) can decide.
    if (!own && Object.keys(map).some((k) => k !== '*' && !k.startsWith('user:'))) return off;
    return resolve(map, { userId: w.userId }, allowed, off);
  }
  let organization = w.organization || null;
  if (!organization && needsOrg(map, w.region, w.userId, role)) {
    try {
      organization = await organizationFor(w.region);
    } catch (err) {
      logToFile('fico rubric switch: region registry lookup failed — treating as off', { error: err.message }, 'error');
      return off;
    }
  }
  return resolve(map, { userId: w.userId, role, region: w.region, organization }, allowed, off);
}

/**
 * @param {{userId?: string, role?: string, region?: string, organization?: string}} who  the user (users.id), role
 *   (users.role; read when a role key needs it and it is omitted) and region (users.region)
 * @returns {Promise<'current'|'shadow'|'v6'>}  never throws; OFF on any failure
 */
// Queue #191 (operator, 19 Nov ~17:40: "since we want to have it live for all the coaches, lets just remove the feature
// flag. it should be live for all of them no matter if we added their thingy or not"): for a coach (users.role 'coach')
// fico_coach_rubric and obs612_coach are no longer a gate. Everyone else (principals, teachers) reads them as before.
const COACH_ROLE = 'coach';
const isCoachRole = (role) => typeof role === 'string' && norm(role) === COACH_ROLE;

/**
 * Queue #191: the users.role of `who`: the role the caller passed, else read once. Undefined when it cannot be known
 * (no id, or a failed read), so the rows then decide exactly as before (pickFor reads it again only for a role key).
 */
async function knownRole(who = {}) {
  const w = who || {};
  if (w.role !== undefined) return w.role;
  if (!w.userId) return undefined;
  const r = await roleOfUser(w.userId);
  return r === ROLE_UNKNOWN ? undefined : r;
}

async function coachRubric(who = {}, now = Date.now()) {
  try {
    const { coach } = await cache.get(now);
    const w = { ...(who || {}) };
    // A row that already says v6 for this account decides with no role read.
    if (w.userId && coach[`user:${norm(String(w.userId))}`] === 'v6') return 'v6';
    w.role = await knownRole(w);
    if (isCoachRole(w.role)) return 'v6';
    return await pickFor(coach, w, COACH_VALUES, COACH_OFF);
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
 * Queue #184: FICO17 v6 in starred mode for this user (fico_v6_starred)? Never throws: false on any failure, and no
 * region lookup while the switch has no value anywhere.
 */
async function v6Starred(who = {}, now = Date.now()) {
  try {
    const { starred } = await cache.get(now);
    if (!starred || !Object.keys(starred).length) return false;
    return (await pickFor(starred, who, STARRED_VALUES, 'off')) === 'on';
  } catch (_) {
    return false;
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

/**
 * bd-9bppaz — the users.role of a user id, for a map that holds a role key. Null when there is no id or no role; a
 * failed read is ROLE_UNKNOWN, which pickFor resolves to OFF.
 */
async function roleOfUser(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
    if (error) return ROLE_UNKNOWN;
    return (data && typeof data.role === 'string' && data.role) || null;
  } catch (_) {
    return ROLE_UNKNOWN;
  }
}

function _resetCache() { cache.reset(); }

module.exports = {
  COACH_KEY, DC_KEY, STARRED_SETTING, COACH_VALUES, DC_VALUES, COACH_OFF, DC_OFF,
  asMap, resolve, pickFor, coachRubric, dcRubric, v6Starred, isAnySet, regionOfUser, roleOfUser, _resetCache,
  COACH_ROLE, isCoachRole, knownRole,
};
