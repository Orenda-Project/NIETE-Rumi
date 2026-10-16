'use strict';

/**
 * /observe2: the report's area to grow is the coach's "Work on first" (pilot sheet R3, 12 Oct).
 *
 * The coach picks it before sealing, may change it at the check, and the brief tells them to talk
 * about it in the debrief. The teacher's report must name the same thing. On 12 Oct it did not: the
 * coach, the brief, the debrief and the teacher's own commitment all said group work, and the report
 * said "subject vocabulary depth", because its horizon came from the lowest-scoring FICO section.
 *
 * For an /observe2 analysis only:
 *   observe2Target(analysis)  the target the narrative is asked to write the horizon about. Unlike the
 *                             scorer-validated resolver, it holds when the pick has no numeric level
 *                             (NA, "couldn't tell") or no C/D/F row of its own: the coach chose it.
 *   pinObserve2Horizon(n, a)  sets the horizon's title in code, in the pick's own words (the words of
 *                             "Work on first" in the form, the check and the brief). The model writes
 *                             only the sentence under it. A model told to name a thing complies most of
 *                             the time and freestyles the rest (Rule 24c); this title is the same every
 *                             time. Urdu reports keep concept names in English, so do these words.
 * Every other analysis is returned untouched.
 */

const numeric = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// The coach's pick, as /observe2's analysis records it (observe2/analysis.js focusOf).
function observe2Focus(analysis) {
  if (!analysis || typeof analysis !== 'object' || !analysis.observe2) return null;
  const fa = analysis.focus_area;
  if (!fa || typeof fa !== 'object') return null;
  const title = typeof fa.title === 'string' ? fa.title.trim() : '';
  return title ? { ...fa, title } : null;
}

function indicatorRow(analysis, id) {
  for (const domain of Object.values(analysis.domains || {})) {
    const row = ((domain && domain.indicators) || []).find((i) => i && String(i.id) === id);
    if (row) return row;
  }
  return null;
}

/**
 * @param {object} analysis analysis_data
 * @returns {null|{indicator:string, domain:(string|null), name:string, rung:(number|null), rationale:string, try:string, title:string, count:null, levels:null}}
 */
function observe2Target(analysis) {
  const fa = observe2Focus(analysis);
  if (!fa) return null;
  const id = String(fa.indicator || '').trim();
  const row = id ? indicatorRow(analysis, id) : null;
  return {
    indicator: id || fa.title,
    domain: fa.domain || null,
    name: (row && row.name) || fa.title,
    rung: row ? numeric(row.score) : null,
    rationale: typeof fa.rationale === 'string' ? fa.rationale : '',
    try: typeof fa.try_this_tomorrow === 'string' ? fa.try_this_tomorrow : '',
    title: fa.title,
    // fico17 ids are also FICO V4 ids with other meanings: no V4 count bar or levels (target-resolver specFor).
    count: null,
    levels: null,
  };
}

/**
 * @param {object|null} narrative the narrative pass's output (mutated and returned)
 * @param {object} analysis analysis_data
 */
function pinObserve2Horizon(narrative, analysis) {
  const fa = observe2Focus(analysis);
  if (!fa || !narrative || typeof narrative !== 'object') return narrative;
  narrative.horizon_title = fa.title;
  return narrative;
}

module.exports = { observe2Target, pinObserve2Horizon };
