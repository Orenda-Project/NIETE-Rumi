'use strict';
/**
 * One session, shaped for a screen that is not WhatsApp.
 *
 * WHY THIS IS NOT IN THE PORTAL
 * -----------------------------
 * The portal built its own score breakdown from six hardcoded OECD goal names
 * reading `scores.goal1_total…goal5_total`. Every NIETE region is configured
 * for FICO, and a FICO session contains none of those keys — 30 of 30 recent
 * completed sessions on production. A `|| 0` on each read is what made it
 * silent: five bars at zero, under labels her framework has never used, and
 * "Strongest Area" chosen by sorting that empty list.
 *
 * The bot already solved this. `buildScoreViewModel` dispatches to five
 * adapters (fico · oecd · hots · teach · mewaka) and returns one normalised
 * shape — it is what renders the report image she receives in chat. So the
 * portal must hold NO framework logic at all: it asks here and renders the
 * answer, and a sixth framework never requires a portal change.
 *
 * WHAT THIS ADDS ON TOP OF THE ADAPTER
 * ------------------------------------
 * The adapter returns section-level groups, which is right for a 1080px
 * report image. A browser has room for the level below it — the indicators,
 * each carrying the quoted evidence from her own lesson that justifies its
 * score. That is the most useful thing in the payload and it has never been
 * visible on any surface.
 */

const { buildScoreViewModel } = require('./report-v2/score-adapter.service');
const { logToFile } = require('../../utils/logger');

/**
 * Domain display order.
 *
 * Strongest first, weakest last, so the page can open the weakest section by
 * default without the caller re-sorting and without the ORDER carrying an
 * implied judgement of its own. The section letters (B/C/D/F) travel with each
 * group, so a trainer cross-referencing the printed rubric still can.
 */
function byStrength(groups) {
  return [...groups].sort((a, b) => (b.pct || 0) - (a.pct || 0));
}

/**
 * The indicators under one domain, with their evidence.
 *
 * `applicable: false` is meaningful rather than missing — FICO gates seven
 * Section F indicators on the subject, so a maths lesson is scored out of 42
 * and a literacy lesson out of 44. An indicator that did not apply is not a
 * zero she lost; it is a question that was never asked, and the UI has to be
 * able to tell those apart.
 */
function indicatorsFor(domain) {
  return (domain.indicators || []).map((i) => ({
    id: i.id || null,
    name: i.name || null,
    score: typeof i.score === 'number' ? i.score : null,
    // Both are stored; the summary is the short form, `evidence` the full
    // quote with its timestamps. Send both and let the surface choose.
    evidence: i.evidence || null,
    evidence_summary: i.evidence_summary || null,
    applicable: i.applicable !== false,
  }));
}

/**
 * A session's scores, ready to render.
 *
 * Returns null when there is nothing scored yet — a caller must be able to
 * tell "not analysed" from "analysed and scored zero", which is precisely the
 * distinction `|| 0` destroyed.
 */
function buildBreakdown(analysisData, language = 'en') {
  if (!analysisData || typeof analysisData !== 'object') return null;

  let vm;
  try {
    vm = buildScoreViewModel(analysisData, language);
  } catch (err) {
    logToFile('[coaching-breakdown] score adapter failed', { error: err.message });
    return null;
  }
  if (!vm) return null;

  const domains = analysisData.domains || analysisData.areas || {};

  return {
    framework: vm.framework || null,
    language: vm.language || language,
    overall: vm.overall ?? null,
    marks: vm.marks ?? null,
    max: vm.max ?? null,
    // Strongest first. The caller opens the last one.
    groups: byStrength(vm.groups || []).map((g) => ({
      ...g,
      indicators: indicatorsFor(domains[g.domainKey] || {}),
    })),
  };
}

module.exports = { buildBreakdown, byStrength };
