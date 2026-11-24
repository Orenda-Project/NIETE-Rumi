/**
 * The 15:00 LP quiz offer's pure rules: which day a lesson counts for, and a
 * class's stable key. They live here, not in lp-quiz-offer.service.js, so the
 * Grades 6-12 offer (lp-quiz-offer-612.js) and the lp612 quiz provider can read
 * them without requiring the offer service, which requires them back
 * (bd-97daxo.34.12: that closed an import cycle). The service re-exports these.
 */
const PktTime = require('./pkt-time');

/** An unreadable value falls back to the documented default rather than NaN. */
function intEnv(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

const cutoffHour = () => intEnv('LP_QUIZ_OFFER_CUTOFF_HOUR_PKT', 14);

/**
 * Which day's offer a lesson taken at `deliveredAt` belongs to (D2).
 * @param {Date|string} deliveredAt
 * @returns {string} a PKT calendar date, `YYYY-MM-DD`
 */
function cohortRuleDate(deliveredAt) {
  const at = deliveredAt instanceof Date ? deliveredAt : new Date(deliveredAt);
  const day = PktTime.pktDate(at);
  return PktTime.pktHour(at) < cutoffHour() ? day : PktTime.nextSchoolDay(day);
}

/**
 * The stable id for one class within one offer. It rides in a WhatsApp list
 * row id (`lpquiz_pick_<nudgeId>_<classKey>` — the nudge id is a uuid, which
 * has no underscore, so the parser splits on the first one) and it is stored
 * as the choice `class:<key>`, which the store admits only as [A-Za-z0-9_].
 * A hyphen here made recordAnswer throw on the very tap it records.
 */
function classKey(grade, subject) {
  const g = String(grade === null || grade === undefined ? '' : grade)
    .trim().replace(/[^0-9a-zA-Z]+/g, '').toLowerCase() || '0';
  const s = String(subject === null || subject === undefined ? '' : subject)
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'lesson';
  return `g${g}_${s}`;
}

module.exports = { intEnv, cutoffHour, cohortRuleDate, classKey };
