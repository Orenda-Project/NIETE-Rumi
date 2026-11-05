'use strict';
/**
 * Which region a teacher teaches in — 'ict' | 'gb' | 'unknown' (bd-rj6w0n.14.2).
 *
 * The one rule, pure (no I/O, no requires) so the bot and the teacher app's API read the same function.
 * Stored on the existing users.region column — no new table or column. Detection order, all zero messages:
 *   1. users.source 'main_rumi_gb'  — how the GB cohort was imported
 *   2. users.region                 — sub-district (ICT) or 'Gilgit-Baltistan' (the roster seed, the app choice)
 *   3. school_region                — her school's schools.region, when the caller has it
 * Anything else is 'unknown'; the teacher app's Lesson Plans page asks once (never a WhatsApp question).
 */

const GB_SOURCES = new Set(['main_rumi_gb']);
const GB_VALUES = new Set(['gilgit-baltistan', 'gb']);
const ICT_VALUES = new Set([
  'ict', 'islamabad', 'federal', 'niete',
  'b.k', 'barakahu', 'sihala', 'urban-i', 'urban-ii', 'nilore', 'tarnol',
]);

/** The spelling users.region holds for each region; what a one-time choice writes. */
const STORED_VALUE = Object.freeze({ ict: 'ICT', gb: 'Gilgit-Baltistan' });

const keyOf = (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s_]+/g, '-') : '');

/** A users.region / schools.region value -> 'ict' | 'gb' | 'unknown'. */
function regionOfValue(value) {
  const k = keyOf(value);
  if (GB_VALUES.has(k)) return 'gb';
  if (ICT_VALUES.has(k)) return 'ict';
  return 'unknown';
}

/** user: { source?, region?, school_region? } -> 'ict' | 'gb' | 'unknown'. */
function regionForUser(user) {
  if (!user) return 'unknown';
  if (GB_SOURCES.has(keyOf(user.source).replace(/-/g, '_'))) return 'gb';
  const own = regionOfValue(user.region);
  if (own !== 'unknown') return own;
  return regionOfValue(user.school_region);
}

module.exports = { regionForUser, regionOfValue, STORED_VALUE };
