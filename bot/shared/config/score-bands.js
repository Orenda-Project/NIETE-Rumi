'use strict';
/**
 * Observation scores are shown as a BAND, never as a number or a percentage
 * (operator, 2026-09-29). This file is the one rule every surface reads — the
 * WhatsApp coaching report, the coaching card, the voice note, and (through a
 * parity-tested copy) the portal.
 *
 * Thresholds only. The words live in the string catalog (ux-strings.js,
 * keys scoreBand*), where every translated string belongs.
 *
 * The band is read off the RAW percentage, never a rounded one: 79.6 is Good.
 * Rounding first would lift every score within half a point of a boundary into
 * the band above — exactly the teacher nearest the line.
 */

/** Highest first; the first `min` a score reaches is its band. */
const BAND_THRESHOLDS = Object.freeze([
  Object.freeze({ key: 'excellent', min: 80, labelKey: 'scoreBandExcellent' }),
  Object.freeze({ key: 'good', min: 60, labelKey: 'scoreBandGood' }),
  Object.freeze({ key: 'average', min: 40, labelKey: 'scoreBandAverage' }),
  Object.freeze({ key: 'below_average', min: 20, labelKey: 'scoreBandBelowAverage' }),
  Object.freeze({ key: 'needs_support', min: 0, labelKey: 'scoreBandNeedsSupport' }),
]);

function toPct(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {number|string|null|undefined} pct  0..100 (out-of-range clamps)
 * @returns {'excellent'|'good'|'average'|'below_average'|'needs_support'|null}
 *   null when there is no score — never a fabricated "Needs support".
 */
function scoreBandFor(pct) {
  const n = toPct(pct);
  if (n === null) return null;
  const band = BAND_THRESHOLDS.find((b) => n >= b.min);
  return (band || BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1]).key;
}

/** Band for a raw score on a known scale, e.g. an indicator's 1 of 2. */
function scoreBandForScore(score, max) {
  const s = toPct(score);
  const m = toPct(max);
  if (s === null || m === null || m <= 0) return null;
  return scoreBandFor((s / m) * 100);
}

/**
 * The words she reads, in her language (en | ur; anything else falls to the
 * catalog's floor). Required lazily so the threshold table above stays a pure
 * module the portal's parity test can load without the bot's config.
 */
function scoreBandLabel(pct, language = 'en') {
  const key = scoreBandFor(pct);
  if (!key) return null;
  const { resolveUx } = require('./ux-strings');
  const { labelKey } = BAND_THRESHOLDS.find((b) => b.key === key);
  return resolveUx(labelKey, { language });
}

/** All five labels, highest first — for prompts that must name the scale. */
function scoreBandScale(language = 'en') {
  const { resolveUx } = require('./ux-strings');
  return BAND_THRESHOLDS.map((b) => resolveUx(b.labelKey, { language }));
}

module.exports = {
  BAND_THRESHOLDS,
  scoreBandFor,
  scoreBandForScore,
  scoreBandLabel,
  scoreBandScale,
};
