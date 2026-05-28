/**
 * Coaching Report v2 — Score Adapter.
 *
 * Turns a framework's `analysis_data` into ONE normalized ScoreViewModel that
 * the unified celebration ("hero") renderer consumes — so the template never
 * has to know each framework's bespoke score shape.
 *
 * ScoreViewModel:
 *   {
 *     framework, language,
 *     overall,            // rounded overall %
 *     marks, max,         // overall marks / max (null if absent)
 *     groups: [           // the scorecard rows
 *       { key, name, score, max, pct }
 *     ]
 *   }
 *
 * Per-framework `groups` are produced by adapters under
 * `./score-adapters/`. The dispatcher maps a framework key to its adapter
 * with an empty-groups fallback for unknown frameworks.
 */

const { getScoreAdapter } = require('./score-adapters/dispatch');

function round(n) {
  const v = parseFloat(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * @param {object} analysisData - coaching_sessions.analysis_data
 * @param {object} [opts]
 * @param {string} [opts.framework] - override analysisData.framework
 * @param {string} [opts.language]  - 'sw' | 'en' | 'ur' | 'ar' (display language)
 * @returns {{framework:string, language:string, overall:number, marks:?number, max:?number, groups:Array}}
 */
function buildScoreViewModel(analysisData, opts = {}) {
  const a = analysisData || {};
  const framework = String(opts.framework || a.framework || 'oecd').toLowerCase();
  const language = opts.language || a.language || 'en';

  const overall = round(a.scores?.overall_percentage);
  const marks = a.scores?.overall_marks ?? null;
  const max = a.scores?.overall_max_marks ?? null;

  const groups = getScoreAdapter(framework)(a, language);

  return { framework, language, overall, marks, max, groups };
}

module.exports = { buildScoreViewModel };
