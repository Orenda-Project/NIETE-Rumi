'use strict';

/**
 * bd-pni007 — what an FDE (obs612) coach visit stores when the coach submits the form: coaching_sessions.analysis_data
 * for a leader_observation. Pure: the endpoint writes it, the coach summary, the teacher report and the portal read
 * it. The shape is the contract between them (tests/observe/obs612-record.test.js).
 *
 *   analysis_data = {
 *     framework, rubric        the rubric id ('obs612-enur-v1' …): the stamp every FICO average reader skips
 *     rubric_label             'FDE v1'
 *     scores: { rubric }       no overall_* numbers: FDE's own numbers live in obs612.result only
 *     obs612: {
 *       rubric_id, tool, sheet, label, tool_title, grade, subject, subject_label, via ('observe' | 'observe2'),
 *       form_id, observer_user_id, teacher_user_id, scored_by: 'coach', submitted_at,
 *       answers      { itemKey: 'yes'|'no' | '0'..'3' | '1'..'4' }          every scored item, as the coach chose
 *       context      { ctx_6 topic, ctx_7 lesson type, ctx_8 class size, ctx_9 prior learning, ctx_5 subject }  (enur)
 *       comments     { <section key or 'students'>: text }                   optional, as the coach wrote
 *       observations { <indicator key>: text }                               (msci) the Observations column
 *       result       frameworks/obs612 score(): enur sections/total/max/pct/band; gen sections/yes/of;
 *                    msci indicators/students
 *       development_plan [{ area, area_title, current, goal, action }]       (msci)
 *       feedback     { strengths, areas, recommendations, timeline }        (enur, Section 8, required)
 *                    { line }                                               (gen: one written line, required)
 *       source       { letter, annexure, document }
 *     }
 *   }
 */

const O = require('../../coaching/frameworks/obs612');

const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();

function pickText(src, keys) {
  const out = {};
  for (const k of keys) {
    const v = str((src || {})[k]);
    if (v) out[k] = v;
  }
  return out;
}

function subjectLabel(subject) {
  const s = O.SUBJECTS.find((x) => x.key === subject);
  return s ? s.label : null;
}

/**
 * The visit's lesson as stamped on its form: { rubricId, tool, sheet, grade, subject }.
 * @param {object} form  observation_field_forms row (rubric_version, visit_context)
 */
function lessonOf(form) {
  const vc = (form && form.visit_context) || {};
  const rubricId = form && O.isObs612Id(form.rubric_version) ? form.rubric_version : null;
  return {
    rubricId,
    tool: O.toolOf(rubricId),
    sheet: vc.sheet === 'en' || vc.sheet === 'ur' ? vc.sheet : null,
    grade: O.normGrade(vc.grade),
    subject: O.normSubject(vc.subject),
    via: vc.via === 'observe' ? 'observe' : 'observe2',
  };
}

/**
 * The analysis_data for a submitted FDE form.
 * @param {object} form       observation_field_forms row (rubric_version obs612-…, visit_context with the lesson)
 * @param {object} draft      what the Flow saved, flat: item answers by key, plus context (ctx_*), comments
 *                            (comment_<section>), observations (obs_<indicator>), development plan (dp_area, dp_goal,
 *                            dp_action), feedback (fb_strengths … or fb_line)
 * @param {object} [opts]     { now }
 */
function buildAnalysis(form, draft = {}, opts = {}) {
  const lesson = lessonOf(form);
  const tool = O.toolById(lesson.rubricId);
  if (!tool) throw new Error(`obs612 record: not an obs612 form (${form && form.rubric_version})`);
  const d = draft || {};
  const items = O.requiredItems(lesson.rubricId, lesson.sheet);
  const answers = {};
  for (const i of items) {
    const v = O.normAnswer(i.kind, d[i.key]);
    if (v !== null) answers[i.key] = v;
  }
  const result = O.score(lesson.rubricId, lesson.sheet, answers);

  const commentKeys = Object.keys(d).filter((k) => /^comment_[a-z0-9_]+$/.test(k));
  const comments = Object.fromEntries(Object.entries(pickText(d, commentKeys)).map(([k, v]) => [k.slice('comment_'.length), v]));

  const obs612 = {
    rubric_id: lesson.rubricId,
    tool: lesson.tool,
    sheet: lesson.sheet,
    label: O.LABEL,
    tool_title: O.SHORT.tools[lesson.tool],
    grade: lesson.grade,
    subject: lesson.subject,
    subject_label: subjectLabel(lesson.subject),
    via: lesson.via,
    form_id: form.id || null,
    observer_user_id: form.observer_user_id || null,
    teacher_user_id: form.teacher_user_id || null,
    scored_by: 'coach',
    submitted_at: new Date(opts.now || Date.now()).toISOString(),
    answers,
    comments,
    result,
    source: { letter: O.RUBRIC.source.letter, annexure: O.RUBRIC.source.annexure, document: O.RUBRIC.source.document },
  };

  if (lesson.tool === 'enur') {
    obs612.context = pickText(d, O.TOOLS.enur.context.map((c) => c.key));
    obs612.feedback = Object.fromEntries(O.TOOLS.enur.feedback.map((f) => [f.key, str(d[`fb_${f.key}`])]).filter(([, v]) => v));
  }
  if (lesson.tool === 'gen') {
    const line = str(d.fb_line);
    obs612.feedback = line ? { line } : {};
  }
  if (lesson.tool === 'msci') {
    obs612.observations = Object.fromEntries(Object.entries(pickText(d, O.TOOLS.msci.indicators.map((i) => `obs_${i.key}`)))
      .map(([k, v]) => [k.slice('obs_'.length), v]));
    const plan = [];
    for (const suffix of ['', '_2']) {
      const area = str(d[`dp_area${suffix}`]);
      if (!area) continue;
      const ind = O.TOOLS.msci.indicators.find((i) => i.key === area);
      const current = ind ? (result.indicators.find((x) => x.key === area) || {}).level : null;
      const goal = O.normAnswer('level', d[`dp_goal${suffix}`]);
      plan.push({
        area,
        area_title: ind ? ind.text : area,
        current: current === undefined ? null : current,
        goal: goal === null ? null : Number(goal),
        action: str(d[`dp_action${suffix}`]),
      });
    }
    obs612.development_plan = plan;
  }

  return {
    framework: lesson.rubricId,
    rubric: lesson.rubricId,
    rubric_label: O.LABEL,
    scores: { rubric: lesson.rubricId },
    obs612,
  };
}

/** What is still needed before the form can be submitted: missing item keys, and missing required text fields. */
function whatIsMissing(form, draft = {}) {
  const lesson = lessonOf(form);
  const missing = O.missingItems(lesson.rubricId, lesson.sheet, draft || {});
  if (lesson.tool === 'enur') {
    for (const f of O.TOOLS.enur.feedback) if (!str((draft || {})[`fb_${f.key}`])) missing.push(`fb_${f.key}`);
  }
  if (lesson.tool === 'gen' && !str((draft || {}).fb_line)) missing.push('fb_line');
  return missing;
}

module.exports = { lessonOf, buildAnalysis, whatIsMissing, subjectLabel };
