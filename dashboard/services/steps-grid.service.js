/**
 * Observation scoring shared by the Analytics page (school-analytics.service).
 *
 * The STEPS grid that used to live here — the principal's home, one row per
 * teacher — was removed on 2026-09-30 (operator: "Analytics is there for
 * exactly this kind of data"). What stays is the part Analytics reads:
 *   · which sessions are Human Observations (the only ones that rate), and
 *   · the FICO sections behind each area, pooled by POINTS: the sections
 *     differ in size (10 and 12 indicators), so averaging two percentages
 *     would overweight the smaller one.
 */

// A Human Observation is one a coach or principal made in class (/observe);
// every other analysed session is a Digital Coach Observation — a lesson the
// teacher recorded herself. Only a Human Observation rates S/T/E: STEPS feeds
// her ACR (operator, 2026-09-29).
const HUMAN_OBSERVATION = 'leader_observation';
const isHumanObservation = (s) => !!s && s.observation_type === HUMAN_OBSERVATION;

// FICO section → domain key, as the analysis writes them.
const S_DOMAINS = ['teacher_subject_knowledge'];                         // F
const T_DOMAINS = ['lesson_plan_fidelity', 'high_leverage_practices'];   // B + C
const E_DOMAINS = ['student_engagement'];                                // D

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Points-pooled percentage over whichever of `keys` this session scored. */
function pooledPct(domains, keys) {
  if (!domains || typeof domains !== 'object') return null;
  let score = 0;
  let max = 0;
  for (const k of keys) {
    const d = domains[k];
    const m = Number(d && d.domain_max);
    const s = Number(d && d.domain_score);
    if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(s)) continue;
    score += s;
    max += m;
  }
  return max > 0 ? round1((score / max) * 100) : null;
}

// bd-97x22y.5 — the FICO sections the schools analytics Observations tab shows, as the ICT
// dashboard does (her Section B / C / D, sync_observations.py:38-41). One domain each;
// teacher_subject_knowledge (F) is not in her rubric and is not shown.
const FICO_SECTIONS = Object.freeze({
  b: 'lesson_plan_fidelity',
  c: 'high_leverage_practices',
  d: 'student_engagement',
});

/**
 * One FICO section's percentage for one session, or null when it was not scored. A section
 * marked `assessed: false` is not scored — the framework leaves it out of the total
 * (fico-framework.js:796, 847) and the report shows no number for it (fico-adapter.js:81) —
 * even though its proxy domain_score / domain_max stay stamped on the row.
 */
function sectionPct(domains, key) {
  const d = domains && typeof domains === 'object' ? domains[key] : null;
  if (!d || d.assessed === false) return null;
  return pooledPct(domains, [key]);
}

module.exports = {
  pooledPct, isHumanObservation, HUMAN_OBSERVATION, S_DOMAINS, T_DOMAINS, E_DOMAINS,
  FICO_SECTIONS, sectionPct,
};
