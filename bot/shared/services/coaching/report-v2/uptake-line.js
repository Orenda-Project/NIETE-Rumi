'use strict';
/**
 * The report's "Last time we asked" block — moved here unchanged from hero-report.service.js (bd-z3cadk) so the
 * portal's report page can show the same block, in the same words, without loading the image renderer.
 *
 *   buildUptakeVm(loop, uptake, lang)            the image's block, from the loop state the report generator computed
 *   lastAskedFromStored(card, priorCard, lang)   the same block from what the report STORED: this session's
 *                                                prioritized_action (its uptake record) and the prior session's card
 */
const { resolveUx } = require('../../../config/ux-strings');
const { CHROME } = require('./hero-report.style');

const UPTAKE_LINE_KEY = {
  achieved: 'uptakeLineAchieved',
  partial: 'uptakeLinePartial',
  not_seen: 'uptakeLineNotSeen',
  not_applicable: 'uptakeLineNotApplicable',
  unknown: 'uptakeLineUnknown',
};

/** "specific feedback moves 2, next step feedback 0" — the tally in words, never a score. */
function tallyInWords(count) {
  if (!count || typeof count !== 'object') return '';
  return Object.entries(count)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${String(k).replace(/_/g, ' ')} ${v}`)
    .join(', ');
}

/**
 * The hero's "Last time we asked" block, from the loop state the report
 * generator computed ({ prior, status, state }) and this lesson's tally.
 * Null when there is nothing to show (no loop, no prior, or no verdict).
 * The line is catalog copy in the report language; the ask is verbatim in
 * whatever language it was written. Never a percentage.
 */
function buildUptakeVm(loop, uptake, lang) {
  if (!loop || !loop.prior || !loop.prior.target || !loop.status || loop.status === 'no_prior') return null;
  const status = UPTAKE_LINE_KEY[loop.status] ? loop.status : 'unknown';
  const target = loop.prior.target.name || loop.prior.target.indicator;
  const count = tallyInWords(uptake && uptake.count) || '—';
  let line = resolveUx(UPTAKE_LINE_KEY[status], { language: lang, params: { count, target } });
  if (loop.state && loop.state.hand_over) {
    line += ' ' + resolveUx('uptakeLineHandOver', { language: lang, params: { count, target } });
  }
  return { asked: String(loop.prior.action || ''), status, line };
}

/**
 * The block from what was stored. The report generator wrote this lesson's uptake record into prioritized_action
 * (uptake-loop.service buildRecord: { status, count }, and hand_over); the ask was the prior session's card.
 * @returns {{ text, status, statusLabel, line } | null} null when there is nothing to show (as the image)
 */
function lastAskedFromStored(card, priorCard, lang) {
  if (!card || !card.uptake || !priorCard || !priorCard.target || !priorCard.action) return null;
  const vm = buildUptakeVm(
    { prior: { target: priorCard.target, action: priorCard.action }, status: card.uptake.status, state: { hand_over: !!card.hand_over } },
    { count: card.uptake.count },
    lang,
  );
  if (!vm || !vm.asked) return null;
  const C = CHROME[lang] || CHROME.en;
  return { text: vm.asked, status: vm.status, statusLabel: C[`uptake_${vm.status}`] || C.uptake_unknown, line: vm.line };
}

module.exports = { UPTAKE_LINE_KEY, tallyInWords, buildUptakeVm, lastAskedFromStored };
