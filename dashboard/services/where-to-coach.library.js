'use strict';
/**
 * WHERE TO COACH — the content library's lookups (bd-17v39c.4.14.2). The words live in
 * dashboard/data/where-to-coach/library.json (language is data, not code): per framework and practice id, the "Look for
 * in class" line and the "Try this with her" move, in English and Urdu, each marked with its source — "rifat:<her
 * prototype code>" for her 14 tips placed on the live practice they mean, "draft" for the rest (her review pick 3A:
 * drafted now, reviewed by her team before production). Her B tips sit on the plan steps; her check-in is per feature.
 */
const LIBRARY = require('../data/where-to-coach/library.json');

/** The report card's five plan steps, in order (bot report-card.js STEPS). */
const STEPS = Object.freeze(['Opening', 'Explanation', 'We Do', 'You Do', 'Check']);
const CHECKIN_FEATURES = Object.freeze(['dc', 'lp', 'training', 'papers']);

const own = (o, k) => (o && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);

/** { source, en: { lookFor, tryThis }, ur: { lookFor, tryThis } } for one practice on one framework, else null. */
function suggestionsFor(framework, id) {
  const t = own(own(LIBRARY.practices, framework), id);
  return t ? { source: t.source, en: { ...t.en }, ur: { ...t.ur } } : null;
}

/** The tip for a plan step she skipped (her B tips), else null. */
function stepTipFor(step) {
  const t = own(LIBRARY.steps, step);
  return t ? { source: t.source, en: { ...t.en }, ur: { ...t.ur } } : null;
}

/** Her check-in for a feature: { en: { questions, blockers: [[blocker, support]] }, ur: … }, else null. */
function checkinFor(feature) {
  const c = own(LIBRARY.checkin, feature);
  return c ? JSON.parse(JSON.stringify(c)) : null;
}

module.exports = { STEPS, CHECKIN_FEATURES, suggestionsFor, stepTipFor, checkinFor };
