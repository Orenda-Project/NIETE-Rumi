/**
 * FICO17 v6 Report Data Transformer (bd-ra8xu.39) — a teacher report for a visit scored on FICO17 v6.
 *
 * Same generic reportData shape as fico-report-transformer.js (consumed by the PDFKit fallback and the report
 * record; the hero PNG reads its own score view model via report-v2/score-adapters/fico17-v6-adapter.js):
 *   - three goals, one per v6 section (C what the teacher does, D what the children do, F subject knowledge), each
 *     criterion named "<code> <v6 name>: <level title>" so trainers can cross-reference the rubric;
 *   - N/A and never-set levels are left out; couldn't-tell (IE) is one line with no number, never 0/4;
 *   - a level the coach set says so ("Set by your coach: <their reason>"), with setBy 'coach';
 *   - lesson-plan fidelity is its own section (extractFidelity), outside the v6 total: it is not one of the 17;
 *   - totals are the v6 ones (scores.overall_*), never V3's 148.
 */

const v6 = require('../frameworks/fico17-v6');
const { formatDate, extractFidelity, buildPartialNote } = require('./_shared');
const { coachRoleLabelForRegion } = require('../../../config/region-config');
const { rubricLabelText } = require('../rubric-label');

const COULDNT_TELL = "Couldn't tell from the recording.";

function levelOf(ind) {
  if (!ind) return null;
  if (ind.result !== undefined && ind.result !== null) return v6.normLevel(ind.result);
  if (ind.level !== undefined && ind.level !== null) return v6.normLevel(ind.level);
  return v6.normLevel(ind.score);
}

function criterionFor(code, ind) {
  const def = v6.indicator(code);
  const lv = levelOf(ind);
  if (lv === null || lv === 'NA') return null;
  const coach = ind && ind.set_by === 'coach';
  const because = ind && typeof ind.because === 'string' ? ind.because.trim() : '';
  const coachLine = coach && because ? `Set by your coach: ${because}` : null;
  if (lv === 'IE') {
    return {
      name: `${code} ${def.name}`, score: null, max: 4,
      evidence: [COULDNT_TELL, coachLine].filter(Boolean).join(' '),
      photoEvidence: null, timestamp: null, setBy: coach ? 'coach' : 'rumi',
    };
  }
  // bd-ra8xu.46: the evidence as the coach submitted it, with the coach's level. A combined indicator: the coach's
  // justification only. One of the 11: the coach's reason when the coach changed the level, then the Evidence box as
  // submitted (Rumi's text the coach kept, or the coach's edit; observe-fico17-v6 applyReview stores it on the row).
  const shown = v6.isCombined(code) ? [coachLine] : [coachLine, ind && ind.evidence];
  const evidence = shown.filter(Boolean).join(' ') || 'No evidence provided';
  return {
    name: `${code} ${def.name}: ${v6.TITLES[code][lv - 1]}`,
    score: lv, max: 4, evidence, photoEvidence: null, timestamp: (ind && ind.timestamp) || null,
    setBy: coach ? 'coach' : 'rumi',
  };
}

/**
 * @param {object} session      coaching session row
 * @param {string} teacherName
 * @param {object} analysis     a v6 analysis (framework 'fico17_v6', domains under v6 keys)
 */
function transformFICO17V6ToReportData(session, teacherName, analysis) {
  const a = analysis || {};
  const domains = a.domains || {};
  const goals = [];
  let sumMarks = 0;
  let sumMax = 0;

  for (const sec of Object.values(v6.SECTIONS)) {
    const rows = ((domains[sec.domain] || {}).indicators) || [];
    const byCode = Object.fromEntries(rows.filter((r) => r && r.id).map((r) => [r.id, r]));
    const criteria = sec.codes.map((code) => criterionFor(code, byCode[code])).filter(Boolean);
    const scored = criteria.filter((c) => typeof c.score === 'number');
    const score = scored.reduce((s, c) => s + c.score, 0);
    const maxScore = scored.length * 4;
    sumMarks += score;
    sumMax += maxScore;
    goals.push({ title: sec.name, score, maxScore, criteria });
  }

  const s = a.scores || {};
  const totalScore = Number.isFinite(Number(s.overall_marks)) ? Number(s.overall_marks) : sumMarks;
  const maxScore = Number.isFinite(Number(s.overall_max_marks)) && Number(s.overall_max_marks) > 0 ? Number(s.overall_max_marks) : sumMax;

  return {
    framework: 'fico17_v6',
    rubric: v6.RUBRIC_KEY,
    teacherName,
    observationDate: formatDate(session && session.created_at),
    subject: (session && session.lesson_plan_structured && session.lesson_plan_structured.subject) || a.subject || 'N/A',
    topic: (session && session.lesson_plan_structured && session.lesson_plan_structured.topic) || a.topic || 'N/A',
    observerName: coachRoleLabelForRegion(session && session.users && session.users.region),
    // The framework and its version only (operator 11 Nov ~18:45), the same words as the rubric id everywhere else.
    frameworkDisplayName: rubricLabelText({ session, analysis: a }) || 'FICO17 v6',
    hasLessonPlan: !!((session && session.lesson_plan_structured) || a.has_lesson_plan),
    totalScore,
    maxScore,
    priorFeedback: null,
    goals,
    focusArea: null,
    debriefReflection: null,
    // Lesson-plan fidelity: its own section, outside the v6 total.
    fidelitySection: extractFidelity(a),
    feedback: a.executive_summary || 'Analysis complete.',
    isPartialReport: (session && session._isPartialReport) || false,
    partialReportNote: buildPartialNote(session || {}),
    headerLabels: {
      eyebrow: 'A CELEBRATION OF YOUR TEACHING',
      title: 'FICO17 — Classroom Observation',
      sub: 'Powered by NIETE · for NIETE',
    },
    scaleLegend: {
      title: 'FICO17 SCALE',
      stops: [
        { n: '1', label: v6.LEVEL_LABELS['1'], color: 'emerging' },
        { n: '2', label: v6.LEVEL_LABELS['2'], color: 'developing' },
        { n: '3', label: v6.LEVEL_LABELS['3'], color: 'proficient' },
        { n: '4', label: v6.LEVEL_LABELS['4'], color: 'excellent' },
      ],
    },
    colorBins: [
      { threshold: 85, color: 'excellent' },
      { threshold: 70, color: 'proficient' },
      { threshold: 50, color: 'developing' },
      { threshold: 0, color: 'emerging' },
    ],
    performanceLevels: [
      { threshold: 85, label: 'Highly Effective', color: 'excellent' },
      { threshold: 70, label: 'Proficient', color: 'proficient' },
      { threshold: 50, label: 'Developing', color: 'developing' },
      { threshold: 0, label: 'Needs Support', color: 'emerging' },
    ],
  };
}

module.exports = { transformFICO17V6ToReportData, COULDNT_TELL };
