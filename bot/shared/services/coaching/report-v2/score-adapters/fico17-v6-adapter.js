/**
 * FICO17 v6 score adapter (bd-ra8xu.39) — the hero report's bars for a visit scored on FICO17 v6.
 *
 * A v6 analysis keeps its rows under its own domain keys (v6_teacher / v6_children / v6_subject; frameworks/fico17-v6
 * SECTIONS), so the V3 adapter would find nothing and the card would show empty bars. Three bars come from the
 * indicators themselves (the coach's review may change a level after the analysis, and does not recompute
 * domain_score): the sum of the numeric levels over the rows that have one. N/A and couldn't-tell count on neither
 * side; they are not low marks.
 *
 * Lesson-plan fidelity (B) is not one of the 17 (operator, 11 Nov). It is shown as its own bar when it was measured,
 * marked outsideTotal, and the v6 headline (scores.overall_percentage) never includes it. With no plan it says "not
 * assessed", in the same words as the V3 card, never a zero.
 */

const v6 = require('../../frameworks/fico17-v6');
const { notAssessedWords, notAssessedWhy } = require('./fico-adapter');

// The section names are catalog strings (config/ux-strings.js, Rule 20); the Urdu there is a draft for review.
const SECTION_KEYS = { C: 'reportV6SectionTeacher', D: 'reportV6SectionChildren', F: 'reportV6SectionSubject', B: 'reportV6SectionPlan' };
const FIDELITY_MAX = 40; // shown on the same /40 the V3 card uses for Section B

function nameOf(key, language) {
  const { resolveUx } = require('../../../../config/ux-strings');
  return resolveUx(SECTION_KEYS[key], { language });
}

function levelOf(ind) {
  if (!ind) return null;
  if (ind.result !== undefined && ind.result !== null) return v6.normLevel(ind.result);
  if (ind.level !== undefined && ind.level !== null) return v6.normLevel(ind.level);
  return v6.normLevel(ind.score);
}

function fidelityGroup(a, language) {
  const lp = a && a.lp_fidelity;
  const pct = lp ? Number(lp.fidelity_pct) : NaN;
  const measured = !!lp && lp.status === 'ok' && lp.fidelity_pct != null && !Number.isNaN(pct);
  if (!measured) {
    return {
      key: 'B', domainKey: 'lesson_plan_fidelity', name: nameOf('B', language),
      score: null, max: null, pct: null, notAssessed: true, outsideTotal: true,
      notAssessedWords: notAssessedWords(language),
      why: notAssessedWhy(lp && lp.status, language),
    };
  }
  const score = Math.round((pct / 100) * FIDELITY_MAX);
  return {
    key: 'B', domainKey: 'lesson_plan_fidelity', name: nameOf('B', language),
    score, max: FIDELITY_MAX, pct: Math.round(pct), outsideTotal: true,
  };
}

function buildFico17V6Groups(a, language) {
  const domains = (a && a.domains) || {};
  const groups = ['C', 'D', 'F'].map((key) => {
    const sec = v6.SECTIONS[key];
    const rows = ((domains[sec.domain] || {}).indicators) || [];
    let score = 0;
    let counted = 0;
    for (const ind of rows) {
      const lv = levelOf(ind);
      if (typeof lv !== 'number') continue;
      score += lv;
      counted += 1;
    }
    const max = counted * 4;
    return {
      key, domainKey: sec.domain, name: nameOf(key, language),
      score, max, pct: max > 0 ? Math.round((score / max) * 100) : 0,
    };
  });
  return [fidelityGroup(a, language), ...groups];
}

module.exports = { buildFico17V6Groups, SECTION_KEYS };
