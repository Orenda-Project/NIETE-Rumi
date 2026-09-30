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
const { scoreBandFor } = require('../../bot/shared/config/score-bands');
const { pooledPct, isHumanObservation, S_DOMAINS, T_DOMAINS, E_DOMAINS } = require('./steps-grid.service');

// The three STEPS observation areas, in the words the principal reads.
const AREAS = [
  { key: 's', name: 'Subject knowledge', domains: S_DOMAINS },
  { key: 't', name: 'Teaching skills', domains: T_DOMAINS },
  { key: 'e', name: 'Engagement', domains: E_DOMAINS },
];

/** "2026-09" in Pakistan time — a lesson at 11pm on 31 Aug is still August there. */
function monthOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' })
    .formatToParts(d);
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}

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
/**
 * @param {object} [opts]
 * @param {boolean} [opts.rateDigital] a TEACHER's own page rates her Digital Coach
 *   Observations in the list (operator, 2026-09-30); a principal's does not. The
 *   progress line, the areas and the average stay Human-only either way.
 */
function summarizeSchoolAnalytics(sessions, opts = {}) {
  const all = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
  // Ratings — the progress line, the areas, the average, the domain cards —
  // come from Human Observations ONLY (operator, 2026-09-29). On prod 83% of
  // analysed sessions are Digital Coach Observations; pooled, they decided a
  // teacher's rating from lessons nobody watched. They are still COUNTED, and
  // still appear on the monthly chart.
  const list = all.filter(isHumanObservation);

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

  const areas = AREAS
    .map((a) => {
      const pcts = list
        .map((s) => pooledPct(s.analysis_data && s.analysis_data.domains, a.domains))
        .filter((v) => v !== null);
      if (!pcts.length) return null;
      const pct = round1(pcts.reduce((x, y) => x + y, 0) / pcts.length);
      return { key: a.key, name: a.name, pct, band: scoreBandFor(pct), observations: pcts.length };
    })
    .filter(Boolean)
    .sort((x, y) => y.pct - x.pct);

  const observations = all
    .map((s) => {
      const human = isHumanObservation(s);
      const rated = human || opts.rateDigital === true;
      const o = rated && s.analysis_data ? getOverall(s.analysis_data) : null;
      return {
        date: s.created_at,
        kind: human ? 'human' : 'digital_coach',
        // A Digital Coach Observation carries no rating on the principal's page.
        percentage: rated && o && o.percentage != null && o.maxPoints > 0 ? o.percentage : null,
        teacherName: s.teacher_name || null,
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const months = new Map();
  for (const o of observations) {
    const m = monthOf(o.date);
    if (!m) continue;
    const acc = months.get(m) || { month: m, human: 0, digitalCoach: 0 };
    if (o.kind === 'human') acc.human += 1; else acc.digitalCoach += 1;
    months.set(m, acc);
  }
  const byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

  return {
    // Scored sessions of BOTH kinds, as before: a session with no usable score
    // is skipped, never counted as a zero.
    totalSessions: all.filter((x) => {
      const o = x.analysis_data ? getOverall(x.analysis_data) : null;
      return o && o.percentage != null && Number.isFinite(o.maxPoints) && o.maxPoints > 0;
    }).length,
    humanObservations: list.length,
    digitalCoachObservations: all.length - list.length,
    averageScore,
    areas,
    byMonth,
    observations,
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
