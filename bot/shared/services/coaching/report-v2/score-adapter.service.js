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

  const groups = getScoreAdapter(framework)(a, language);

  // bd-5n1a2: the flat scores fields are the source of truth, but a bad writer
  // (the enhance LLM restructuring `scores` — prod 57484afc rendered "0%") can
  // leave them absent while the domain groups are intact. The groups feed the
  // very bars next to the headline, so deriving the headline from them can
  // never contradict what the reader sees.
  const groupMarks = groups.reduce((s, g) => s + (Number(g.score) || 0), 0);
  const groupMax = groups.reduce((s, g) => s + (Number(g.max) || 0), 0);
  const flatPct = parseFloat(a.scores?.overall_percentage);
  const overall = Number.isFinite(flatPct)
    ? Math.round(flatPct)
    : (groupMax > 0 ? Math.round((groupMarks / groupMax) * 100) : 0);
  const marks = a.scores?.overall_marks ?? (groupMax > 0 ? groupMarks : null);
  const max = a.scores?.overall_max_marks ?? (groupMax > 0 ? groupMax : null);

  return { framework, language, overall, marks, max, groups };
}

module.exports = { buildScoreViewModel };
