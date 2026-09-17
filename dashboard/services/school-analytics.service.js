/**
 * bd-60117 — school-level coaching analytics, for a principal.
 *
 * The teacher Analytics page answers "how am I doing?" from one teacher's own
 * sessions. A principal needs that question asked of her whole school, so this
 * takes the school's terminal, scored sessions and produces: how many, the
 * average, the trend, and which domains the school is strongest and weakest in.
 *
 * Pure: it takes rows and returns a shape, with no DB round-trip of its own —
 * same contract as summarizePatch, and unit-testable without a live DB.
 *
 * TWO measurements on NIETE prod (2026-09-17) decided the maths here, and both
 * rule out reusing what the teacher page does:
 *
 *   1. NIETE writes NO goal1_total..goal5_total. The teacher page's six
 *      hardcoded goal areas are upstream shape this deployment never produces,
 *      so pointed at NIETE data every one renders a confident 0% — a wrong
 *      answer that looks like a real one. The per-area scores NIETE does write
 *      live in `analysis_data.domains` as {domain_score, domain_max}.
 *
 *   2. There is no single domain set. Across 200 sessions: student_engagement
 *      197; lesson_plan_fidelity / high_leverage_practices /
 *      teacher_subject_knowledge 182 each; and an older quartet
 *      (lesson_structure, classroom_climate, assessment_feedback,
 *      instructional_quality) 15 each. Two rubrics coexist in live data.
 *
 * So domains are DISCOVERED per session and each is averaged only over the
 * sessions that actually carry it. Enumerating them in code would bake in
 * today's rubric; averaging an absent domain as zero would make the 15-session
 * rubric look like the school's catastrophic weakness instead of a different
 * measuring stick.
 */

const { getOverall } = require('./coaching-frameworks.service');

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * snake_case key → human title. A title-cased key is right for every domain
 * NIETE writes today and stays right for one added tomorrow, which an explicit
 * lookup table would not — an unmapped key would fall through to the raw
 * `lesson_plan_fidelity` in front of a principal.
 */
function humanize(key) {
  return String(key)
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * @param {Array<{created_at: string, analysis_data: object}>} sessions
 *   the school's terminal sessions that carry analysis_data
 * @returns {{
 *   totalSessions: number, averageScore: number|null,
 *   scoreTrend: Array<{date: string, percentage: number}>,
 *   domainBreakdown: Array<{key: string, name: string, percentage: number, sessions: number}>,
 *   strongestDomain: string|null, focusDomain: string|null
 * }}
 */
function summarizeSchoolAnalytics(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];

  // Framework-agnostic, via the same getOverall the patch + teacher detail use.
  // A session with no usable percentage is SKIPPED, never counted as zero: an
  // unscored session is missing information, and averaging it in as 0 would
  // quietly drag a school's headline down for sessions nobody failed.
  // NOTE on the maxPoints guard: getOverall returns {points:0, maxPoints:0,
  // percentage:0} for an empty or absent scores object — a real 0, not a null.
  // Taking that at face value is how "we have no score for this session"
  // becomes "this teacher scored zero", so a session is only counted when it
  // was actually measured against something (maxPoints > 0).
  const scored = [];
  for (const s of list) {
    const overall = s && s.analysis_data ? getOverall(s.analysis_data) : null;
    if (!overall || overall.percentage == null) continue;
    if (!Number.isFinite(overall.maxPoints) || overall.maxPoints <= 0) continue;
    scored.push({
      date: s.created_at,
      percentage: overall.percentage,
      // bd-60119: the trend doubles as the portal's coaching-history list, so
      // each point carries what a principal actually points at in a
      // conversation — the marks behind the percentage, and whose lesson it
      // was. Null teacher name is fine: the UI only shows it school-wide.
      points: overall.points,
      maxPoints: overall.maxPoints,
      teacherName: s.teacher_name || null,
      analysis: s.analysis_data,
    });
  }

  // Oldest first — a trend is read left to right, and callers pass whatever
  // order the query returned.
  scored.sort((a, b) => new Date(a.date) - new Date(b.date));

  // key → running total across the sessions that HAVE that domain.
  const domains = new Map();
  for (const s of scored) {
    const d = s.analysis && s.analysis.domains;
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    for (const [key, val] of Object.entries(d)) {
      if (!val || typeof val !== 'object') continue;
      const max = Number(val.domain_max);
      const score = Number(val.domain_score);
      // A missing or zero max is not a zero score, it is an unmeasurable
      // domain; dividing by it yields Infinity/NaN and poisons the sort.
      if (!Number.isFinite(max) || max <= 0) continue;
      if (!Number.isFinite(score)) continue;
      const acc = domains.get(key) || { pctSum: 0, sessions: 0 };
      acc.pctSum += (score / max) * 100;
      acc.sessions += 1;
      domains.set(key, acc);
    }
  }

  const domainBreakdown = [...domains.entries()]
    .map(([key, acc]) => ({
      key,
      name: humanize(key),
      percentage: round1(acc.pctSum / acc.sessions),
      sessions: acc.sessions,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const averageScore = scored.length
    ? round1(scored.reduce((sum, s) => sum + s.percentage, 0) / scored.length)
    : null;

  return {
    totalSessions: scored.length,
    averageScore,
    scoreTrend: scored.map((s) => ({
      date: s.date,
      percentage: s.percentage,
      points: s.points,
      maxPoints: s.maxPoints,
      teacherName: s.teacherName,
    })),
    domainBreakdown,
    // Strongest/weakest by the same averages, so the two can never disagree
    // with the list the principal is looking at.
    strongestDomain: domainBreakdown.length ? domainBreakdown[0].name : null,
    focusDomain: domainBreakdown.length ? domainBreakdown[domainBreakdown.length - 1].name : null,
  };
}

module.exports = { summarizeSchoolAnalytics, humanize };
