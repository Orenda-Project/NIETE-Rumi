/**
 * FDE (obs612) Report Data Transformer (bd-pni007) — a teacher report record for a visit the coach scored on one of
 * FDE's grade 6-12 observation tools (Annexure G of FDE's 2026-27 guidelines). Registered for every obs612 id.
 *
 * Generic reportData shape (as fico17-v6-report-transformer.js) plus what an FDE report needs. The teacher's image is
 * rendered by report-v2/obs612-report.js from the same view (observe/obs612/view.js); this is the record and any other
 * consumer. Only FDE's own numbers, nothing made up:
 *   - enur: one goal per section (score / max), each item 1-4 of 4; totalScore / maxScore / percentage / band FDE's
 *     (score × 100 ÷ 148 English, ÷ 156 Urdu); Section 8 as feedbackSections.
 *   - msci: goals by FDE's stage, criteria "<n> · <short name>: Level N" (0-3 of 3) with FDE's full wording as the
 *     evidence; the 5-student check; the development plan. NO total: totalScore, maxScore and every goal score null.
 *   - gen:  one goal per section with yes / of; each item Yes or No, no score. totalScore and maxScore null.
 * Every criterion is setBy 'coach': the coach scored every item; nothing here is a model's.
 *   - ficos (bd-31ziu8, FICO-S v1.1): one goal per section (its total / its max), each indicator 1-4 of 4 with the
 *     level's name and the observer's evidence; total / max / % / band as FICO-S computes them; the strengths, the focus
 *     and its action as feedbackSections and developmentPlan.
 */

const O = require('../frameworks/obs612');
const { obs612View, obs612Of } = require('../../observe/obs612/view');
const { formatDate } = require('./_shared');

const { FDE_FOOTNOTE: FOOTER, FICO_S_FOOTNOTE } = require('../../observe/obs612/view');
const FicoS = require('../frameworks/fico-s');

function ficosGoals(v) {
  return v.ficos.sections.map((s) => ({
    title: `${s.key}. ${s.name}`,
    section: s.key,
    score: s.scored ? s.total : null,
    maxScore: s.scored ? s.max : null,
    comment: null,
    criteria: v.ficos.indicators.filter((i) => i.section === s.key).map((i) => ({
      key: i.code,
      name: `${i.code} ${i.name}`,
      score: i.level,
      max: 4,
      na: i.na,
      evidence: [i.levelName, i.evidence].filter(Boolean).join(' · '),
      photoEvidence: null,
      timestamp: null,
      setBy: 'coach',
    })),
  }));
}

function enurGoals(o, v) {
  const answers = o.answers || {};
  const comments = o.comments || {};
  const defs = O.enurSections(v.sheet);
  return v.enur.sections.map((s) => {
    const def = defs.find((d) => d.key === s.key) || { items: [] };
    return {
      title: s.title,
      section: s.section,
      score: s.score,
      maxScore: s.max,
      comment: comments[s.key] || null,
      criteria: def.items.map((i) => {
        const a = O.normAnswer('points', answers[i.key]);
        return {
          key: i.key, name: i.text, score: a === null ? null : Number(a), max: 4,
          evidence: a === null ? '' : O.TOOLS.enur.scale.labels[Number(a) - 1], photoEvidence: null, timestamp: null, setBy: 'coach',
        };
      }),
    };
  });
}

function msciGoals(v) {
  const stages = [];
  for (const i of v.msci.indicators) {
    let g = stages.find((s) => s.title === i.stage);
    if (!g) { g = { title: i.stage, score: null, maxScore: null, criteria: [] }; stages.push(g); }
    g.criteria.push({
      key: i.key,
      name: `${i.n} · ${i.short}${i.level === null ? '' : `: Level ${i.level}`}`,
      score: i.level, max: 3,
      evidence: [i.text, i.levelText ? `Level ${i.level}: ${i.levelText}` : null, i.observation ? `Your coach noted: ${i.observation}` : null]
        .filter(Boolean).join(' · '),
      photoEvidence: null, timestamp: null, setBy: 'coach',
    });
  }
  const st = v.msci.students;
  if (st.level !== null) {
    stages.push({
      title: O.TOOLS.msci.student_check.title, score: null, maxScore: null,
      criteria: [{
        key: O.TOOLS.msci.student_check.key, name: `${O.SHORT.msci.students}: ${st.short}`, score: st.level, max: 3,
        evidence: st.text, photoEvidence: null, timestamp: null, setBy: 'coach',
      }],
    });
  }
  return stages;
}

function genGoals(o, v) {
  const answers = o.answers || {};
  return v.gen.sections.map((s) => {
    const def = O.TOOLS.gen.sections.find((d) => d.key === s.key) || { items: [] };
    return {
      title: s.title, yes: s.yes, of: s.of, score: null, maxScore: null,
      criteria: def.items.map((i) => {
        const a = O.normAnswer('yes_no', answers[i.key]);
        return {
          key: i.key, name: i.text, score: null, max: null, evidence: a === 'yes' ? 'Yes' : a === 'no' ? 'No' : '',
          photoEvidence: null, timestamp: null, setBy: 'coach',
        };
      }),
    };
  });
}

/** "Wrapping up the lesson: Level 0 → Level 1. <action>" — one line per development plan row. */
function planLine(p) {
  const move = [p.current === null ? null : `Level ${p.current}`, p.goal === null ? null : `Level ${p.goal}`].filter(Boolean).join(' → ');
  return `${p.short}${move ? `: ${move}` : ''}${p.action ? `. ${p.action}` : ''}`;
}

/**
 * @param {object} session      coaching_sessions row (created_at)
 * @param {string} teacherName
 * @param {object} analysis     an FDE visit's analysis_data (observe/obs612/record.js)
 */
function transformObs612ToReportData(session, teacherName, analysis) {
  const v = obs612View(analysis);
  const id = (v && v.rubricId) || (analysis && analysis.framework) || null;
  const tool = O.toolOf(id);
  const base = {
    framework: id,
    rubric: id,
    rubricLabel: O.LABEL,
    frameworkDisplayName: 'FDE',
    tool,
    toolName: tool ? O.SHORT.tools[tool] : 'FDE',
    teacherName,
    observationDate: formatDate(session && session.created_at),
    grade: v ? v.grade : null,
    subject: (v && v.subjectLabel) || 'N/A',
    topic: (v && v.tool === 'enur' && (obs612Of(analysis).context || {}).ctx_6) || 'N/A',
    observerName: 'Your coach',
    hasLessonPlan: false,
    totalScore: null,
    maxScore: null,
    percentage: null,
    band: null,
    noTotal: true,
    priorFeedback: null,
    goals: [],
    focusArea: null,
    debriefReflection: null,
    fidelitySection: null,
    feedback: '',
    feedbackSections: [],
    developmentPlan: [],
    footer: FOOTER,
    isPartialReport: false,
    partialReportNote: null,
    headerLabels: {
      eyebrow: "CLASSROOM OBSERVATION · FDE'S TOOL",
      title: v ? v.toolTitle : (tool ? O.SHORT.tools[tool] : 'FDE observation'),
      sub: O.LABEL,
    },
  };
  if (!v) return base;

  const o = obs612Of(analysis);
  if (v.tool === 'ficos') {
    const f = v.ficos;
    const fs = [];
    if (v.feedback.strengths) fs.push({ key: 'strengths', label: 'Strengths', text: v.feedback.strengths });
    const plan = v.plan.map((p) => `${p.code} ${p.name}${p.level === null ? '' : ` (Level ${p.level})`}: ${p.action}`.trim());
    if (plan.length) fs.push({ key: 'focus', label: 'To work on', text: plan.join('\n') });
    if (v.feedback.by_when) fs.push({ key: 'by_when', label: 'By when', text: v.feedback.by_when });
    return {
      ...base,
      rubricLabel: FicoS.labelOf(v.rubricId) || FicoS.LABEL, // queue #218: the visit's own version
      frameworkDisplayName: 'FICO 6-12',
      totalScore: f.total,
      maxScore: f.max,
      percentage: f.pct,
      band: f.band,
      noTotal: false,
      goals: ficosGoals(v),
      feedbackSections: fs,
      developmentPlan: plan,
      feedback: fs.map((x) => `${x.label}: ${x.text}`).join('\n'),
      footer: FICO_S_FOOTNOTE,
      observerName: 'Your observer',
      headerLabels: { eyebrow: 'CLASSROOM OBSERVATION · FICO 6-12', title: v.toolTitle, sub: FicoS.labelOf(v.rubricId) || FicoS.LABEL },
      scaleLegend: { title: 'FICO 6-12 SCALE', stops: [1, 2, 3, 4].map((n) => ({ n: String(n), label: FicoS.levelName(n) })) },
    };
  }
  if (v.tool === 'enur') {
    const fs = O.TOOLS.enur.feedback.filter((f) => v.feedback[f.key]).map((f) => ({ key: f.key, label: f.label, text: v.feedback[f.key] }));
    return {
      ...base,
      totalScore: v.enur.total,
      maxScore: v.enur.max,
      percentage: v.enur.pct,
      score108: v.enur.score_108,
      band: v.enur.band,
      noTotal: false,
      goals: enurGoals(o, v),
      feedbackSections: fs,
      feedback: fs.map((f) => `${f.label}: ${f.text}`).join('\n'),
      scaleLegend: {
        title: 'FDE SCALE',
        stops: O.TOOLS.enur.scale.labels.map((label, i) => ({ n: String(i + 1), label })),
      },
    };
  }
  if (v.tool === 'gen') {
    return {
      ...base, yes: v.gen.yes, of: v.gen.of, goals: genGoals(o, v), feedback: v.feedback.line || '',
    };
  }
  const plan = v.plan.map(planLine);
  return {
    ...base,
    goals: msciGoals(v),
    developmentPlan: plan,
    feedback: plan.join('\n'),
    scaleLegend: { title: 'FDE SCALE', stops: O.TOOLS.msci.scale.labels.map((label, i) => ({ n: String(i), label })) },
  };
}

module.exports = { transformObs612ToReportData, planLine, FOOTER };
