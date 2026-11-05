'use strict';
/**
 * Which region a teacher teaches in — 'ict' | 'gb' | 'unknown' (bd-rj6w0n.14.2).
 *
 * The region registry (region-registry.js on region_features, bd-97daxo.2) is the standard: a value is
 * ICT when its row's organization is 'niete' and GB when it is 'moawin'. No region name lives here, so a
 * new region is a registry row and a value the registry does not hold is 'unknown'. Stored on the existing
 * users.region column, spelt as the registry's display_name. Detection order, all zero messages:
 *   1. users.source 'main_rumi_gb'  — how the GB cohort was imported (the registry has no source signal)
 *   2. users.region                 — her sector, or the GB region (the roster seed, the app choice)
 *   3. school_region                — her school's schools.region, when the caller has it
 * Anything else is 'unknown'; the teacher app's Lesson Plans page asks once (never a WhatsApp question).
 * Every function takes the supabase client to read the registry with; a registry that cannot be read
 * throws (it fails closed) and the caller decides.
 */

const Registry = require('./region-registry');

const GB_SOURCES = new Set(['main_rumi_gb']);
/** Our two answers and the registry organization that owns each. */
const ORGANIZATION = Object.freeze({ ict: 'niete', gb: 'moawin' });
const ANSWER_OF = Object.freeze(Object.fromEntries(Object.entries(ORGANIZATION).map(([k, org]) => [org, k])));

/** A users.region / schools.region value -> 'ict' | 'gb' | 'unknown', by the registry. */
async function regionOfValue(client, value) {
  if (!Registry.regionKey(value)) return 'unknown';
  return ANSWER_OF[await Registry.organizationForRegion(client, value)] || 'unknown';
}

/** user: { source?, region?, school_region? } -> 'ict' | 'gb' | 'unknown'. */
async function regionForUser(client, user) {
  if (!user) return 'unknown';
  if (GB_SOURCES.has(Registry.regionKey(user.source))) return 'gb';
  const own = await regionOfValue(client, user.region);
  if (own !== 'unknown') return own;
  return regionOfValue(client, user.school_region);
}

/** 'ict' | 'gb' -> the users.region spellings the registry holds for it, in dashboard order ([] otherwise). */
async function regionsFor(client, answer) {
  const org = Object.prototype.hasOwnProperty.call(ORGANIZATION, answer) ? ORGANIZATION[answer] : null;
  return org ? Registry.regionsForOrganization(client, org) : [];
}

module.exports = { regionForUser, regionOfValue, regionsFor, ORGANIZATION };
