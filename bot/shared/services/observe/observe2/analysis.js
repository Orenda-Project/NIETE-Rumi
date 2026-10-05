'use strict';

/**
 * /observe2 — the checked record as /observe's analysis (coaching_sessions.analysis_data).
 *
 * Only the middle of /observe2 differs from /observe. When the coach submits the check, the record is
 * written in the shape /observe's submitted form leaves (framework 'fico', the four FICO sections,
 * scores, the thing to work on first), so everything after it runs as in /observe: the debrief guide,
 * the coach card, the teacher's report (the same hero report, from these numbers), sending it,
 * completion, the coach's dashboards.
 *
 *   Sections C, D and F are the coach's 17 levels (fico17), on the workbook's own 1-4 scale: a section
 *   is the sum of its levels out of 4 for each indicator the coach could judge (NA and IE are left out).
 *   FICO V3 totalled its 1-4 levels the same way.
 *   Section B is the lesson plan, scored exactly as /observe scores it (applyLpFidelity): the share of
 *   the plan's steps the coach confirmed were taught, on the marks of its 7 indicators at 4 each. With
 *   no plan, or a plan that could not be checked, B says which and is left out of the total.
 *
 * The /observe2 brief is kept here (observe2.brief): it is this visit's debrief guide.
 * Nothing in here calls a model; the record and the brief are data.
 */

const { CODES, PLAIN, ROW, PRIORITY } = require('./fico17');
const { buildBrief, TYPE_CODE } = require('./brief');

const RUBRIC = 'fico17';
const LEVEL_MAX = 4;
const SECTION_B_MAX = 7 * LEVEL_MAX;
const SECTION_OF = { C: 'high_leverage_practices', D: 'student_engagement', F: 'teacher_subject_knowledge' };
const NOT_JUDGED = { NA: 'N/A · No chance to see it', IE: "IE · Couldn't tell" };
const LEVER_QUESTION = 'What were you hoping for at that moment? What else could you try?';

const numeric = (v) => (/^[1-4]$/.test(String(v)) ? Number(v) : null);

function confirmedMoments(form) {
  const review = form.evidence_review || {};
  return ((form.rumi_moments && form.rumi_moments.moments) || []).filter((m) => review[`heard_${m.id}`] === 'yes');
}

// What the level means, in the workbook's words, and the confirmed moments that show it.
function evidenceFor(code, level, raw, form) {
  if (level == null) return NOT_JUDGED[String(raw)] || 'Not judged';
  const review = form.evidence_review || {};
  const hole = (review.added_hole || {})[code];
  const kept = String(raw) === String((review.added || {})[code]);
  const seen = hole && kept ? hole : PLAIN[code][level - 1];
  const heard = confirmedMoments(form).filter((m) => TYPE_CODE[m.type] === code).slice(0, 2)
    .map((m) => `${m.minute} "${m.quote}"`);
  return heard.length ? `${seen}. Heard: ${heard.join('; ')}` : seen;
}

function section(letter, form) {
  const finals = form.final_levels || {};
  const indicators = CODES.filter((c) => c[0] === letter).map((code) => {
    const level = numeric(finals[code]);
    const evidence = evidenceFor(code, level, finals[code], form);
    return { id: code, name: ROW[code], score: level, applicable: level != null, evidence, evidence_summary: evidence };
  });
  const judged = indicators.filter((i) => i.applicable);
  return {
    indicators,
    domain_score: judged.reduce((sum, i) => sum + i.score, 0),
    domain_max: judged.length * LEVEL_MAX,
    indicators_applicable: judged.length,
  };
}

/**
 * The plan's grading as Section B reads it: the recording's grading with the coach's corrections from
 * the check, or a status that says why there is none.
 */
function planFidelity(form) {
  const a = form.answers || {};
  const graded = form.rumi_moments && form.rumi_moments.fidelity;
  // A grading exists only for a plan that was given (moments.gradeFidelity), so it decides first.
  if (!graded) return { status: a.lp !== 'none' && (a.lp_ref || a.lp_upload) ? 'fidelity_unavailable' : 'lp_absent' };
  if (graded.status !== 'ok' || graded.fidelity_pct == null) return { status: graded.status || 'fidelity_unavailable' };
  const confirmed = (form.evidence_review || {}).fidelity;
  if (!confirmed || confirmed.fidelity_pct == null) return { ...graded };
  const byId = new Map((confirmed.moves || []).map((m) => [m.move_id, m]));
  return {
    ...graded,
    status: 'ok',
    fidelity_pct: confirmed.fidelity_pct,
    band: confirmed.band || graded.band || null,
    prescribed_count: confirmed.prescribed_count != null ? confirmed.prescribed_count : graded.prescribed_count,
    observer_edited: Boolean(confirmed.observer_edited),
    moves: (graded.moves || []).map((m) => {
      const c = byId.get(m.move_id);
      return c ? { ...m, verdict: c.verdict, evidence: c.evidence || m.evidence || '' } : m;
    }),
  };
}

function strengthsOf(form, priority) {
  const finals = form.final_levels || {};
  return CODES
    .filter((c) => c !== priority && numeric(finals[c]) >= 3)
    .sort((x, y) => numeric(finals[y]) - numeric(finals[x]))
    .slice(0, 2)
    .map((c) => ({ title: ROW[c], evidence: PLAIN[c][numeric(finals[c]) - 1] }));
}

function focusOf(form, priority) {
  if (!priority || !PRIORITY[priority]) return null;
  const level = numeric((form.final_levels || {})[priority]);
  const seen = level ? PLAIN[priority][level - 1] : null;
  return {
    domain: SECTION_OF[priority[0]],
    indicator: priority,
    title: PRIORITY[priority],
    rationale: seen ? `What was seen: ${seen}` : '',
    try_this_tomorrow: level && level < LEVEL_MAX ? PLAIN[priority][level] : '',
    lever_question: LEVER_QUESTION,
  };
}

/**
 * @param {object} form observation_field_forms row after the check (final_levels, evidence_review)
 * @param {{brief?: string}} [opts] the brief as the coach received it (teacher's name, coach's language)
 * @returns {object} analysis_data
 */
function buildAnalysis(form, opts = {}) {
  const { applyLpFidelity } = require('../../coaching/frameworks/fico-framework');
  const review = form.evidence_review || {};
  const priority = review.priority_final || (form.answers || {}).priority || null;
  const analysis = {
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: [], domain_score: 0, domain_max: SECTION_B_MAX, indicators_applicable: 0 },
      high_leverage_practices: section('C', form),
      student_engagement: section('D', form),
      teacher_subject_knowledge: section('F', form),
    },
    scores: {},
    lp_fidelity: planFidelity(form),
    strengths: strengthsOf(form, priority),
    observe2: {
      form_id: form.id,
      rubric: RUBRIC,
      rubric_version: form.rubric_version || null,
      final_levels: form.final_levels || {},
      priority,
      why: review.why || null,
      brief: opts.brief || buildBrief(form),
    },
  };
  const focus = focusOf(form, priority);
  if (focus) {
    analysis.focus_area = focus;
    analysis.growth_opportunities = [{ area: focus.title, rationale: focus.rationale }];
  }
  // Section B and the total, by /observe's own rule.
  return applyLpFidelity(analysis, analysis.lp_fidelity);
}

module.exports = { buildAnalysis, planFidelity, SECTION_B_MAX, RUBRIC };
