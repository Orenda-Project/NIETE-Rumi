'use strict';

/**
 * bd-pni007 — one FDE (obs612) visit, shaped once for every reader: the coach's summary in chat
 * (obs612/summary.js), the teacher's report (report-v2/obs612-report.js, report-transformers/obs612-report-transformer.js)
 * and the portal (dashboard/routes/portal.routes.js). Pure: no I/O, no language. FDE's own wording stays as FDE printed
 * it (English, from obs612.rubric.json); our short names come from frameworks/obs612 (SHORT, STUDENTS_SHORT).
 *
 * Nothing here makes a number FDE does not make: the English & Urdu tool has a total, a % and a band; the General form
 * has Yes counts only; the Maths & Science tool has levels only (FDE gives no total, so none is made).
 *
 *   obs612View(analysis) → null for any analysis that is not an FDE visit, else
 *   {
 *     rubricId, tool ('enur'|'msci'|'gen'), sheet, label ('FDE v1'), toolName (short), toolTitle (FDE's title),
 *     grade, subject, subjectLabel,
 *     enur: { total, max, pct, score_108, band, rating, sections: [{key, title, section, score, max, pct}] }
 *     gen:  { yes, of, sections: [{key, title, yes, of, noItems: [text]}] }
 *     msci: { indicators: [{key, n, stage, short, text, level, levelText, observation}], students: {level, short, text},
 *             counts: {0: n, 1: n, 2: n, 3: n}, answered }
 *     strongest: [row], lowest: [row], even (every row at the same value)
 *     plan: [{area, n, short, text, current, goal, action}]       (msci development plan)
 *     feedback: { strengths, areas, recommendations, timeline } (enur) | { line } (gen) | {}
 *   }
 */

const O = require('../../coaching/frameworks/obs612');

const LABEL = O.LABEL;
// The line under every FDE result (operator's wording). A constant, so the WhatsApp cap audit never reads it as a footer.
const FDE_FOOTNOTE = "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score.";

const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const round1 = (n) => Math.round(n * 10) / 10;
const pctOf = (score, max) => (Number(max) > 0 ? round1((Number(score) * 100) / Number(max)) : null);

/** The obs612 block of an analysis, with its rubric id checked, else null. */
function obs612Of(analysis) {
  const a = analysis && typeof analysis === 'object' ? analysis : null;
  const o = a && a.obs612 && typeof a.obs612 === 'object' ? a.obs612 : null;
  if (!o) return null;
  const id = O.isObs612Id(o.rubric_id) ? o.rubric_id : (O.isObs612Id(a.framework) ? a.framework : null);
  if (!id || !O.toolById(id)) return null;
  return { ...o, rubric_id: id, tool: O.toolOf(id) };
}

/** Is this analysis an FDE (obs612) visit that can be shown? */
function isObs612Analysis(analysis) {
  return obs612Of(analysis) !== null;
}

/** Up to `n` rows at the highest and at the lowest value; `even` when every row has the same value. */
function extremes(rows, valueOf, n = 2) {
  const scored = rows.filter((r) => typeof valueOf(r) === 'number');
  if (!scored.length) return { strongest: [], lowest: [], even: false };
  const vals = scored.map(valueOf);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  if (hi === lo) return { strongest: scored.slice(0, n), lowest: [], even: true };
  return {
    strongest: scored.filter((r) => valueOf(r) === hi).slice(0, n),
    lowest: scored.filter((r) => valueOf(r) === lo).slice(0, n),
    even: false,
  };
}

function enurView(o, r) {
  const sections = (r.sections || []).map((s) => ({
    key: s.key, title: s.title, section: s.section, score: s.score, max: s.max, pct: pctOf(s.score, s.max),
  }));
  // Section 7 (operator 13 Nov): the band is read on FDE's 108-point scale (total × 108 ÷ the sheet's total). Read again
  // here, so a visit saved before the rule changed shows the same band as a new one.
  const score108 = Number.isFinite(r.score_108) ? r.score_108 : O.scoreOn108(r.total, r.max);
  const band = O.bandFor(score108);
  return {
    data: {
      total: r.total, max: r.max, pct: r.pct, score_108: score108, band: band ? band.label : null, rating: band ? band.rating : null, sections,
    },
    ...extremes(sections, (s) => s.pct),
    feedback: Object.fromEntries(O.TOOLS.enur.feedback.map((f) => [f.key, str((o.feedback || {})[f.key])]).filter(([, v]) => v)),
  };
}

function genView(o, r) {
  const answers = o.answers || {};
  const sections = (r.sections || []).map((s) => {
    const def = O.TOOLS.gen.sections.find((x) => x.key === s.key) || { items: [] };
    return {
      key: s.key, title: s.title, yes: s.yes, of: s.of,
      noItems: def.items.filter((i) => O.normAnswer('yes_no', answers[i.key]) === 'no').map((i) => i.text),
    };
  });
  return {
    data: { yes: r.yes, of: r.of, sections },
    ...extremes(sections, (s) => (s.of > 0 ? s.yes / s.of : null)),
    feedback: str((o.feedback || {}).line) ? { line: str(o.feedback.line) } : {},
  };
}

function msciView(o, r) {
  const obs = o.observations || {};
  const indicators = O.TOOLS.msci.indicators.map((def) => {
    const got = (r.indicators || []).find((x) => x.key === def.key) || {};
    const level = typeof got.level === 'number' ? got.level : null;
    return {
      key: def.key, n: def.n, stage: def.stage, short: O.SHORT.msci[def.key], text: def.text,
      level, levelText: level === null ? null : def.levels[level], observation: str(obs[def.key]) || null,
    };
  });
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const i of indicators) if (i.level !== null) counts[i.level] += 1;
  const sl = typeof r.students === 'number' ? r.students : null;
  const students = {
    level: sl,
    short: sl === null ? null : O.STUDENTS_SHORT[sl],
    text: sl === null ? null : O.TOOLS.msci.student_check.levels[sl],
  };
  const plan = (o.development_plan || []).map((p) => {
    const def = O.TOOLS.msci.indicators.find((i) => i.key === p.area);
    return {
      area: p.area,
      n: def ? def.n : null,
      short: def ? O.SHORT.msci[def.key] : str(p.area_title) || str(p.area),
      text: def ? def.text : str(p.area_title),
      current: typeof p.current === 'number' ? p.current : null,
      goal: typeof p.goal === 'number' ? p.goal : null,
      action: str(p.action),
    };
  });
  return {
    data: { indicators, students, counts, answered: indicators.filter((i) => i.level !== null).length },
    ...extremes(indicators, (i) => i.level, 3),
    plan,
    feedback: {},
  };
}

/**
 * The visit's view, or null when the analysis is not an FDE visit.
 * @param {object} analysis  coaching_sessions.analysis_data (record.js buildAnalysis shape)
 */
function obs612View(analysis) {
  const o = obs612Of(analysis);
  if (!o) return null;
  const tool = o.tool;
  const stored = o.result && o.result.tool === tool ? o.result : null;
  const r = stored || O.score(o.rubric_id, o.sheet, o.answers || {});
  const def = O.toolById(o.rubric_id);
  const subject = O.SUBJECTS.find((s) => s.key === o.subject);
  const base = {
    rubricId: o.rubric_id,
    tool,
    sheet: tool === 'enur' ? (r.sheet || o.sheet || null) : null,
    label: LABEL,
    toolName: O.SHORT.tools[tool],
    toolTitle: tool === 'enur' ? `${def.title} ${def.subtitle}` : def.title,
    grade: O.normGrade(o.grade),
    subject: o.subject || null,
    subjectLabel: str(o.subject_label) || (subject ? subject.label : null),
    submittedAt: o.submitted_at || null,
    enur: null,
    gen: null,
    msci: null,
    plan: [],
  };
  const part = tool === 'enur' ? enurView(o, r) : tool === 'gen' ? genView(o, r) : msciView(o, r);
  return {
    ...base,
    [tool]: part.data,
    strongest: part.strongest,
    lowest: part.lowest,
    even: part.even,
    plan: part.plan || [],
    feedback: part.feedback,
  };
}

/** A number as FDE writes it: 73.6, 75 (no trailing .0). */
function num(n) {
  return Number.isInteger(n) ? String(n) : String(round1(n));
}

/**
 * The visit's result in one short English line, for a list row (portal): enur '73.6% · Proficient', msci '11 levels',
 * gen '29/35 Yes'. Null when the analysis is not an FDE visit.
 */
function shortResult(analysis) {
  const v = obs612View(analysis);
  if (!v) return null;
  if (v.tool === 'enur') return `${num(v.enur.pct)}%${v.enur.band ? ` · ${v.enur.band}` : ''}`;
  if (v.tool === 'gen') return `${v.gen.yes}/${v.gen.of} Yes`;
  return `${v.msci.answered} levels`;
}

/**
 * What a list row or an observation page shows for an FDE visit (portal): label, tool, short result, and the rows.
 * Pure, English (FDE's tool is English), no FICO numbers. Null when the analysis is not an FDE visit.
 */
function portalSummary(analysis) {
  const v = obs612View(analysis);
  if (!v) return null;
  const out = {
    label: v.label,
    rubric: v.rubricId,
    tool: v.tool,
    toolName: v.toolName,
    toolTitle: v.toolTitle,
    grade: v.grade,
    subject: v.subjectLabel,
    result: shortResult(analysis),
    noTotal: v.tool !== 'enur',
    footer: FDE_FOOTNOTE,
    rows: [],
    feedback: [],
  };
  if (v.tool === 'enur') {
    out.headline = `${v.enur.total} / ${v.enur.max} · ${num(v.enur.score_108)} / 108${v.enur.band ? ` · ${v.enur.band}` : ''}`;
    out.rows = v.enur.sections.map((s) => ({ name: s.title, value: `${s.score}/${s.max}`, pct: s.pct }));
    out.feedback = O.TOOLS.enur.feedback.filter((f) => v.feedback[f.key]).map((f) => ({ label: f.label, text: v.feedback[f.key] }));
  } else if (v.tool === 'gen') {
    out.headline = `Yes on ${v.gen.yes} of ${v.gen.of}`;
    out.rows = v.gen.sections.map((s) => ({ name: s.title, value: `${s.yes} of ${s.of} Yes`, pct: s.of > 0 ? pctOf(s.yes, s.of) : null }));
    if (v.feedback.line) out.feedback = [{ label: 'Feedback', text: v.feedback.line }];
  } else {
    out.headline = 'FDE gives no total for this tool.';
    out.rows = v.msci.indicators.map((i) => ({
      name: `${i.n} · ${i.short}`, value: i.level === null ? '—' : `Level ${i.level}`, full: i.text, pct: null,
    }));
    if (v.msci.students.level !== null) {
      out.rows.push({ name: O.SHORT.msci.students, value: v.msci.students.short, full: v.msci.students.text, pct: null });
    }
    out.feedback = v.plan.map((p) => ({
      label: 'Development plan',
      text: `${p.short}: ${p.current === null ? '' : `Level ${p.current} → `}${p.goal === null ? '' : `Level ${p.goal}. `}${p.action}`.trim(),
    }));
  }
  return out;
}

module.exports = { LABEL, FDE_FOOTNOTE, obs612Of, isObs612Analysis, obs612View, shortResult, portalSummary, num, pctOf };
