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
 *
 * bd-31ziu8 — a FICO-S v1.1 visit (tool 'ficos', rubric 'fico_s_v1_1') has the same envelope, label 'FICO-S v1.1':
 *     obs612: {
 *       rubric_id, tool: 'ficos', sheet: null, label, tool_title, branched_from: 'fico17_v6', grade, subject, …,
 *       scored_by: 'coach', submitted_at,
 *       answers      { A1: '1'..'4', …, C2: '1'..'4' | 'NA' }                 every indicator, as the observer chose
 *       evidence     { A1: text, … }                                           what the observer saw and heard
 *       checklist    { cl_1: 'yes'|'no', … }                                   the sheet's checklist (not scored)
 *       result       frameworks/fico-s score(): sections [{key, name, scored, total, max, average, pct}], total, max,
 *                    counted, pct, band {label, from}, na [codes]
 *       feedback     { strengths, focus: [{ code, action }], by_when }         the sheet's Feedback rule
 *       source       { sheet_id, read_on }
 *     }
 */

const O = require('../../coaching/frameworks/obs612');
const FicoS = require('../../coaching/frameworks/fico-s');

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
    // The English & Urdu tool's sheet (the subject chose it), or null for the other tools. Not a language.
    sheet: rubricId && O.toolOf(rubricId) === 'enur' ? O.normSheet(vc.sheet) : null,
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
/** bd-31ziu8 — the analysis_data of a submitted FICO-S form, on the version the form was made with (queue #218). */
function buildFicoS(form, lesson, d, opts) {
  const id = lesson.rubricId;
  const label = FicoS.labelOf(id) || FicoS.LABEL;
  const answers = {};
  const evidence = {};
  for (const c of FicoS.CODES) {
    const v = FicoS.normLevel(d[c], c, id);
    if (v !== null) answers[c] = String(v);
    const ev = str(d[`ev_${c}`]);
    if (ev) evidence[c] = ev;
  }
  const checklist = {};
  for (const item of FicoS.RUBRIC.checklist) {
    const v = str(d[item.key]).toLowerCase();
    if (v === 'yes' || v === 'no') checklist[item.key] = v;
  }
  const focus = [];
  for (const suffix of ['', '_2']) {
    const code = str(d[`fs_focus${suffix}`]);
    if (!FicoS.CODES.includes(code)) continue;
    focus.push({ code, action: str(d[`fs_action${suffix}`]) });
  }
  const result = FicoS.score(answers, id);
  // Queue #184: a Digital Coach visit keeps, beside every level the observer submitted, who set it ('rumi' when the
  // observer kept Rumi's level, else 'coach'), Rumi's own level and the observer's reason for a change: the calibration
  // pairs, as v6 keeps them. The levels and evidence that count are the observer's as submitted. Starred: always 'coach'.
  const dcRow = require('./fico-s-dc').dcOf(form);
  let dc = null;
  if (dcRow) {
    const FsDc = require('./fico-s-dc');
    const levels = {};
    for (const c of FicoS.CODES) {
      if (answers[c] === undefined) continue;
      const rumi = FsDc.rumiLevelOf(dcRow, c, id);
      const kept = rumi !== null && rumi === answers[c];
      levels[c] = {
        set_by: kept ? 'rumi' : 'coach',
        rumi_level: rumi,
        ...(FicoS.isStarred(c) ? { starred: true } : {}),
        ...(!kept && rumi !== null && str(d[`chg_${c}`]) ? { because: str(d[`chg_${c}`]) } : {}),
      };
    }
    dc = {
      prompt_version: dcRow.prompt_version || null,
      prefilled_at: dcRow.prefilled_at || null,
      levels,
      changed: Object.keys(levels).filter((c) => levels[c].set_by === 'coach' && levels[c].rumi_level !== null),
      rumi: dcRow.levels,
    };
  }
  const obs612 = {
    rubric_id: lesson.rubricId,
    tool: 'ficos',
    sheet: null,
    label,
    tool_title: label,
    branched_from: FicoS.RUBRIC.branched_from,
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
    evidence,
    checklist,
    result,
    feedback: { strengths: str(d.fb_strengths), focus, by_when: str(d.fs_by) || null },
    source: { sheet_id: FicoS.RUBRIC.source.sheet_id, read_on: FicoS.RUBRIC.source.read_on },
    ...(dc ? { dc } : {}),
  };
  return {
    framework: lesson.rubricId,
    rubric: lesson.rubricId,
    rubric_label: label,
    scores: { rubric: lesson.rubricId },
    obs612,
  };
}

function buildAnalysis(form, draft = {}, opts = {}) {
  const lesson = lessonOf(form);
  const tool = O.toolById(lesson.rubricId);
  if (!tool) throw new Error(`obs612 record: not an obs612 form (${form && form.rubric_version})`);
  const d = draft || {};
  if (lesson.tool === 'ficos') return buildFicoS(form, lesson, d, opts);
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
  // bd-31ziu8: every indicator's level and evidence, and the feedback's strengths, focus and action.
  // Queue #184: a level changed from the Digital Coach's pre-fill needs its reason too.
  if (lesson.tool === 'ficos') return require('./fico-s-flow').whatIsMissing(draft || {}, { dc: require('./fico-s-dc').dcOf(form), rubric: lesson.rubricId });
  const missing = O.missingItems(lesson.rubricId, lesson.sheet, draft || {});
  if (lesson.tool === 'enur') {
    for (const f of O.TOOLS.enur.feedback) if (!str((draft || {})[`fb_${f.key}`])) missing.push(`fb_${f.key}`);
  }
  if (lesson.tool === 'gen' && !str((draft || {}).fb_line)) missing.push('fb_line');
  return missing;
}

module.exports = { lessonOf, buildAnalysis, whatIsMissing, subjectLabel };
