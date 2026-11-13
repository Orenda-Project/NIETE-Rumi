/**
 * FICO Report Data Transformer — ICT Canonical Rubric
 *
 * Transforms FICO analysis into the generic reportData shape consumed by
 * pdf-report.service.js and the hero renderer.
 *
 * 4 scored sections (B, C, D, F) → 4 goals, indicators → criteria,
 * scale 1-4, max marks from the framework module, no debrief, no LP bonus.
 *
 * focusArea — the ONE focus indicator + try-this + lever question, mirrored
 * from mewaka-report-transformer.js so "FICO = the MEWAKA flow with only the
 * framework swapped". The analyser (fico-framework.buildAnalysisPrompt) emits
 * a focus_area object in the teacher's registered language (en/ur); this
 * transformer camel-cases it onto reportData.focusArea. IMPORTANT — like
 * MEWAKA, this field does NOT surface in the hero PNG (the default
 * teacher-facing render): the hero renderer reads _heroInput and never
 * touches reportData.focusArea. It is consumed only by the legacy Playwright
 * HTML→PDF template path (templates/mewaka-report.template.js, behind the
 * `html` renderer that no framework currently dispatches to). We replicate
 * MEWAKA's actual behaviour rather than inventing a new FICO surface.
 *
 * Sheet: 1UZaHrXARlJ2cWiZAGFEuc-_o1zOiC5LNXaz11_XVkFU
 */

const ficoFramework = require('../frameworks/fico-framework');
const { formatDate, extractFidelity, buildPartialNote } = require('./_shared');
const { coachRoleLabelForRegion } = require('../../../config/region-config');
const V6 = require('../frameworks/fico17-v6');
const { observe2Strings } = require('../../observe/observe2/strings');

const SCALE_MAX = 4;
// bd-5n1a2: derive from the framework — the 104 literal was FICO V2 and the
// framework moved to V3 (37 indicators / 148 marks) without this file noticing.
const MAX_MARKS = ficoFramework.getScoringConstants().maxMarks;

// v6 report lines (CONTRACTS §6.5), read from the /observe2 strings with this English until the keys land there.
const REPORT_IE = "The recording didn't cover this part of the lesson.";
const REPORT_BROKEN = "The recording couldn't be used, so this report has no levels from it.";
const RUBRIC_SECTIONS = new Set(['high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge']);

// Section title map (rendered above each block in the report). The Latin-letter
// section key (B/C/D/F) is preserved so trainers can cross-reference the sheet.
const SECTION_TITLES = {
  lesson_plan_fidelity:      'Section B: Lesson Plan Fidelity',
  high_leverage_practices:   'Section C: High-Leverage Practices',
  student_engagement:        'Section D: Student Engagement',
  teacher_subject_knowledge: 'Section F: Teacher Subject Knowledge',
};

/**
 * Transform FICO analysis into generic report data.
 * @param {object} session - Coaching session record
 * @param {string} teacherName - Teacher's full name
 * @param {object} analysis - FICO analysis from GPT
 * @returns {object} Report data in the generic shape for PDF rendering
 */
function transformFICOToReportData(session, teacherName, analysis) {
  const DOMAINS = ficoFramework.getScoringConstants().domains;
  const goals = [];
  // bd-ra8xu.38: an /observe2 visit scored on FICO17 v6 never prints an N/A or couldn't-tell row as 0/4; those
  // rows are left out of its report (they are left out of its totals already). Every other report is unchanged.
  const o2 = (analysis && analysis.observe2) || {};
  const v6 = o2.rubric === 'fico17_v6';
  // Spec §9.3, v6 only: rows by their v6 names, no codes; a broken recording keeps only the six levels the coach
  // set in the room and says so once; IE rows are listed as one line each, never scored; a section's total is its
  // printed rows out of 4 each; the report is held until the six coach levels exist (NA or IE counts as set, blank
  // does not).
  const finals = o2.final_levels || {};
  const broken = v6 && (o2.transcript_quality || {}).status === 'broken';
  const held = v6 && V6.COMBINED_CODES.some((c) => !/^([1-4]|NA|IE)$/.test(String(finals[c] == null ? '' : finals[c])));
  const S = observe2Strings('en');
  const recordingGaps = [];

  for (const [sectionKey, sectionDef] of Object.entries(DOMAINS)) {
    const section = analysis.domains?.[sectionKey];
    if (!section) continue;
    const rubricSection = v6 && RUBRIC_SECTIONS.has(sectionKey);
    if (rubricSection && held) continue;

    let indicators = section.indicators || [];
    if (rubricSection && !broken) {
      for (const ind of indicators) {
        if (ind && String(finals[ind.id]) === 'IE') recordingGaps.push({ name: ind.name, line: S.v6_report_ie || REPORT_IE });
      }
    }
    if (v6) indicators = indicators.filter((ind) => !(ind && ind.applicable === false));
    if (rubricSection && broken) indicators = indicators.filter((ind) => V6.isCombined(ind.id));

    goals.push({
      title: SECTION_TITLES[sectionKey] || sectionDef.displayName,
      score: rubricSection ? indicators.reduce((sum, ind) => sum + (ind.score || 0), 0) : (section.domain_score || 0),
      maxScore: rubricSection ? indicators.length * SCALE_MAX : (section.domain_max || (sectionDef.indicatorCount * SCALE_MAX)),
      criteria: indicators.map(ind => ({
        // Prepend the FICO indicator code (B1, C2, D3, F8…) so trainers can
        // cross-reference the printed rubric. A v6 report shows no codes.
        name: ind.id && !v6 ? `${ind.id} ${ind.name}` : ind.name,
        score: ind.score || 0,
        max: SCALE_MAX,
        evidence: ind.evidence || 'No evidence provided',
        // FICO ICT rubric is audio-scoreable by design; no photo-aware
        // indicators. Field retained (null) for renderer contract stability.
        photoEvidence: null,
        timestamp: ind.timestamp || null,
      })),
    });
  }

  const totalScore = goals.reduce((sum, g) => sum + g.score, 0);

  // Focus area — the ONE focus indicator + try-this + lever question. Mirrors
  // mewaka-report-transformer.js: the analyser emits a focus_area object and
  // the transformer camel-cases it onto reportData.focusArea so the report
  // templates can read JS-idiomatic names. FICO teachers are English/Urdu, so
  // (unlike MEWAKA's Swahili-suffixed fields) the strings are un-suffixed and
  // already come back in the teacher's registered language from the prompt.
  const focusAreaSrc = analysis.focus_area || null;
  const focusArea = focusAreaSrc ? {
    domain: focusAreaSrc.domain,
    indicator: focusAreaSrc.indicator,
    title: focusAreaSrc.title,
    rationale: focusAreaSrc.rationale,
    tryThisTomorrow: focusAreaSrc.try_this_tomorrow,
    leverQuestion: focusAreaSrc.lever_question,
  } : null;

  return {
    // framework key drives the renderer-registry dispatch to the hero PNG path.
    framework: 'fico',
    teacherName,
    observationDate: formatDate(session.created_at),
    subject: session.lesson_plan_structured?.subject || analysis.subject || 'N/A',
    topic: session.lesson_plan_structured?.topic || analysis.topic || 'N/A',
    // observerName is the coach-role label surfaced in the report chrome —
    // region-routed so ICT / NIETE renders "Human Coach" while other
    // deployments (or unset regions) keep the default "Rumi Digital Coach".
    observerName: coachRoleLabelForRegion(session.users?.region),
    // bd-ra8xu.46: a v6 visit is labelled with its framework and version only ("FICO17 v6", operator 11 Nov ~18:45).
    frameworkDisplayName: v6 ? (require('../rubric-label').rubricLabelText({ session, analysis }) || 'FICO17 v6') : 'FICO Framework',
    hasLessonPlan: !!(session.lesson_plan_structured || analysis.has_lesson_plan),
    totalScore,
    maxScore: v6 ? goals.reduce((sum, g) => sum + g.maxScore, 0) : MAX_MARKS,
    priorFeedback: null,
    goals,
    // Lead element mirrored from MEWAKA. Null when the analyser omitted it, so
    // report templates guard on truthiness. Consumed by the same surface as
    // MEWAKA's focusArea — see the module note above on where that renders.
    focusArea,
    debriefReflection: null,
    fidelitySection: extractFidelity(analysis),
    feedback: analysis.executive_summary || 'Analysis complete.',
    isPartialReport: session._isPartialReport || false,
    partialReportNote: buildPartialNote(session),
    ...(v6 ? { held, recordingNote: broken ? (S.v6_report_broken || REPORT_BROKEN) : null, recordingGaps } : {}),

    // Renderer config — same shape as before; the FICO chrome stays.
    headerLabels: {
      eyebrow: 'A CELEBRATION OF YOUR TEACHING',
      title:   'FICO — Fidelity & Impact Classroom Observation',
      sub:     'Powered by NIETE · for NIETE',
    },
    scaleLegend: {
      title: 'FICO SCALE',
      stops: [
        { n: '1', label: 'Not Observed',     color: 'emerging' },
        { n: '2', label: 'Developing',       color: 'developing' },
        { n: '3', label: 'Effective',        color: 'proficient' },
        { n: '4', label: 'Highly Effective', color: 'excellent' },
      ],
    },
    // Colour bins mirror the sheet's Interpretation Guide (85 / 70 / 50 / <50).
    colorBins: [
      { threshold: 85, color: 'excellent' },
      { threshold: 70, color: 'proficient' },
      { threshold: 50, color: 'developing' },
      { threshold: 0,  color: 'emerging' },
    ],
    performanceLevels: [
      { threshold: 85, label: 'Highly Effective', color: 'excellent' },
      { threshold: 70, label: 'Effective',        color: 'proficient' },
      { threshold: 50, label: 'Developing',       color: 'developing' },
      { threshold: 0,  label: 'Needs Support',    color: 'emerging' },
    ],
  };
}

module.exports = { transformFICOToReportData };
