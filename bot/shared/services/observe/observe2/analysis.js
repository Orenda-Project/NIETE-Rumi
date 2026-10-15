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

const { CODES, PLAIN, ROW, PRIORITY, FOCUS, PLAN_FOCUS, THINKING, pickAlso } = require('./fico17');
const { buildBrief, TYPE_CODE } = require('./brief');
const { seenNotes } = require('./rules');

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

// What the level means, in the workbook's words, the confirmed moments that show it, and what the coach
// saw on the form.
function evidenceFor(code, level, raw, form) {
  if (level == null) return NOT_JUDGED[String(raw)] || 'Not judged';
  const review = form.evidence_review || {};
  const hole = (review.added_hole || {})[code];
  const kept = String(raw) === String((review.added || {})[code]);
  const seen = hole && kept ? hole : PLAIN[code][level - 1];
  const heard = confirmedMoments(form).filter((m) => TYPE_CODE[m.type] === code).slice(0, 2)
    .map((m) => `${m.minute} "${m.quote}"`);
  // What the coach saw on the form beyond the level (the desks in Part 2, R4/R10), by name.
  const noted = seenNotes(form.answers)[code];
  return [seen, heard.length ? `Heard: ${heard.join('; ')}` : '', noted ? `Seen ${noted}` : ''].filter(Boolean).join('. ');
}

function section(letter, form) {
  const finals = form.final_levels || {};
  const indicators = CODES.filter((c) => c[0] === letter).map((code) => {
    const level = numeric(finals[code]);
    const evidence = evidenceFor(code, level, finals[code], form);
    // `group: 'thinking'` marks the six that score children's thinking (R16); the section sum is unchanged.
    const group = THINKING.codes.includes(code) ? { group: 'thinking' } : {};
    return { id: code, name: ROW[code], score: level, applicable: level != null, evidence, evidence_summary: evidence, ...group };
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

const DONE_VERDICTS = new Set(['executed', 'substituted_equivalent', 'substituted_better']);
const clipText = (text, n) => {
  const chars = [...String(text || '').trim()];
  return chars.length <= n ? chars.join('') : `${chars.slice(0, n - 1).join('')}…`;
};

// What the coach's own record says about the plan's steps, for the plan as a focus (R14): how many
// steps were done and the first one not done, or why there is no count.
function planSeen(form) {
  const a = form.answers || {};
  const lp = planFidelity(form);
  if (lp.status === 'ok' && lp.fidelity_pct != null) {
    const counted = (lp.moves || []).filter((m) => m.counted);
    const done = counted.filter((m) => DONE_VERDICTS.has(m.verdict)).length;
    const total = lp.prescribed_count != null ? lp.prescribed_count : counted.length;
    const missed = counted.find((m) => m.verdict === 'not_done' || m.verdict === 'partial');
    return {
      seen: `${done} of ${total} planned steps done (${Math.round(lp.fidelity_pct)}%)`,
      next: missed ? clipText(missed.text, 160) : '',
    };
  }
  if (a.lp === 'none') return { seen: 'there was no lesson plan for this lesson', next: '' };
  if (a.lp === 'notfollowed') return { seen: 'the teacher had a plan and did not follow it', next: '' };
  return { seen: "the plan's steps could not be checked this time", next: '' };
}

function focusOf(form, priority) {
  if (priority === PLAN_FOCUS) {
    const p = planSeen(form);
    return {
      domain: 'lesson_plan_fidelity',
      indicator: PLAN_FOCUS,
      title: FOCUS[PLAN_FOCUS],
      rationale: `What was seen: ${p.seen}`,
      try_this_tomorrow: p.next,
      lever_question: LEVER_QUESTION,
    };
  }
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
  const a = form.answers || {};
  const priority = review.priority_final || a.priority || null;
  // "Also work on" (R14): as the check kept them, or for a record checked before it existed, as sealed.
  const also = Array.isArray(review.also_final) ? pickAlso(review.also_final, priority) : pickAlso([a.also_1, a.also_2], priority);
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
      also,
      thinking: { teacher: THINKING.teacher, children: THINKING.children, seen: (Array.isArray(a.p2_think) ? a.p2_think : []).map(String) },
      why: review.why || null,
      brief: opts.brief || buildBrief(form),
    },
  };
  // ONE focus: the first pick. It alone is the report's target (target-resolver); the others are for
  // the debrief and the record, listed after it.
  const focus = focusOf(form, priority);
  const more = also.map((id) => focusOf(form, id)).filter(Boolean);
  if (focus) {
    analysis.focus_area = focus;
    analysis.growth_opportunities = [focus, ...more].map((f) => ({ area: f.title, rationale: f.rationale }));
  }
  analysis.also_work_on = more;
  // Section B and the total, by /observe's own rule.
  return applyLpFidelity(analysis, analysis.lp_fidelity);
}

module.exports = { buildAnalysis, planFidelity, planSeen, SECTION_B_MAX, RUBRIC };
