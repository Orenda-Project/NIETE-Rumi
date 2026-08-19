/**
 * bd-gipr1 — decide which language a hero report renders and is written in.
 *
 * Split out of hero-report.service.js so the decision is unit-testable without
 * booting the service's whole dependency graph (R2, the LLM client, env
 * validation). The logic is the interesting part; everything around it is I/O.
 *
 * The rule it enforces is language-protocol invariant 7: a language this
 * deployment does not offer must never take effect. That matters here because
 * one of the candidate sources is `coaching_sessions.transcript_language` — an
 * STT LABEL, not a decision. Soniox has returned 'hindi', 'javanese' and
 * 'sindhi' for Urdu classroom audio since 2026-08-11 (bd-bfy69), and that value
 * was selecting BOTH the template's script branch and the language the
 * narrative LLM was instructed to write in.
 *
 * An unofferable label lands on `offerDefaultLanguage()` — Urdu — not on the
 * emergency English floor. NIETE is a single Urdu-medium tenant, so "we could
 * not read the label" is far better answered with Urdu than with English.
 */

const { isOffered, offerDefaultLanguage } = require('../../../config/languages');

/**
 * @param {object} [opts]     - caller options; `opts.language` is an explicit override
 * @param {object} [analysis] - enhancedAnalysis; `analysis.language` is the analyser's view
 * @param {object} [session]  - coaching_sessions row; `session.transcript_language` is the STT label
 * @returns {string} a language code guaranteed to be in LANGUAGE_OFFER
 */
function resolveReportLanguage(opts, analysis, session) {
  const candidates = [
    opts && opts.language,
    analysis && analysis.language,
    session && session.transcript_language,
  ];
  // First OFFERED candidate wins. An unofferable one is skipped, not fatal —
  // a junk analysis label must not shadow a perfectly good transcript label.
  for (const candidate of candidates) {
    if (isOffered(candidate)) return candidate;
  }
  return offerDefaultLanguage();
}

module.exports = { resolveReportLanguage };
