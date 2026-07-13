/**
 * FICO Report Data Transformer
 *
 * Transforms FICO Unified Observation Tool analysis into the generic
 * reportData shape consumed by pdf-report.service.js.
 *
 * 5 domains → 5 goals, indicators → criteria, scale 1-4, no debrief, no LP bonus.
 * Photo-aware indicators (3.2 Routines & Transitions, 4.4 Use of Materials)
 * include photo evidence in the evidence text when available.
 *
 * Bead: (Phase 1C-A2)
 */

const { formatDate, extractFidelity, buildPartialNote } = require('./_shared');

const DOMAIN_CONFIG = [
  { key: 'lesson_structure', title: 'Domain 1: Lesson Structure' },
  { key: 'instructional_quality', title: 'Domain 2: Instructional Quality' },
  { key: 'classroom_climate', title: 'Domain 3: Classroom Climate' },
  { key: 'student_engagement', title: 'Domain 4: Student Engagement' },
  { key: 'assessment_feedback', title: 'Domain 5: Assessment & Feedback' },
];

const SCALE_MAX = 4;
const MAX_MARKS = 84;

// Indicators that should reference photo evidence when available
const PHOTO_AWARE_INDICATORS = ['3.2', '4.4'];

/**
 * Transform FICO analysis into generic report data.
 * @param {object} session - Coaching session record
 * @param {string} teacherName - Teacher's full name
 * @param {object} analysis - FICO analysis from GPT
 * @returns {object} Report data in the generic shape for PDF rendering
 */
function transformFICOToReportData(session, teacherName, analysis) {
  const goals = [];
  const hasPhotoAnalysis = !!analysis.photo_analysis;

  for (const { key, title } of DOMAIN_CONFIG) {
    const domain = analysis.domains?.[key];
    if (!domain) continue;

    goals.push({
      title,
      score: domain.domain_score || 0,
      maxScore: domain.domain_max || 0,
      criteria: (domain.indicators || []).map(ind => {
        // Photo evidence for photo-aware indicators travels as a distinct
        // field so the renderer can style it as its own callout, not smash
        // it inline with the transcript evidence.
        const photoEvidence = (hasPhotoAnalysis && PHOTO_AWARE_INDICATORS.includes(ind.id))
          ? analysis.photo_analysis
          : null;

        return {
          // Prepend the FICO indicator ID so trainers can cross-reference
          // the printed rubric ("1.1 Lesson Goal Clarity", "3.2 Routines…").
          name: ind.id ? `${ind.id} ${ind.name}` : ind.name,
          score: ind.score || 0,
          max: SCALE_MAX,
          evidence: ind.evidence || 'No evidence provided',
          photoEvidence,
          timestamp: ind.timestamp || null,
        };
      }),
    });
  }

  const totalScore = goals.reduce((sum, g) => sum + g.score, 0);

  return {
    // framework key drives the renderer-registry dispatch to the hero PNG path.
    // Without it, reportData.framework is undefined, getReportRenderer() returns
    // the default (pdfkit) renderer, and FICO silently ships the legacy 5-page
    // PDF instead of the celebration hero card.
    framework: 'fico',
    teacherName,
    observationDate: formatDate(session.created_at),
    subject: session.lesson_plan_structured?.subject || analysis.subject || 'N/A',
    topic: session.lesson_plan_structured?.topic || analysis.topic || 'N/A',
    observerName: 'Rumi Digital Coach',
    frameworkDisplayName: 'FICO Framework',
    hasLessonPlan: !!(session.lesson_plan_structured || analysis.has_lesson_plan),
    totalScore,
    maxScore: MAX_MARKS,
    priorFeedback: null,
    goals,
    debriefReflection: null,
    fidelitySection: extractFidelity(analysis),
    feedback: analysis.executive_summary || 'Analysis complete.',
    isPartialReport: session._isPartialReport || false,
    partialReportNote: buildPartialNote(session),

    // Renderer config — the framework-specific chrome that used to live in
    // pdf-report.service.js branches (the conformance guard forbids that).
    // Any framework wanting FICO-style institutional presentation just adds
    // its own analogues; the PDFKit renderer reads whatever's provided and
    // falls back to generic defaults otherwise.
    headerLabels: {
      eyebrow: 'A CELEBRATION OF YOUR TEACHING',
      title:   'FICO Unified Observation Tool',
      sub:     'Powered by Rumi · for NIETE',
    },
    scaleLegend: {
      title: 'FICO SCALE',
      stops: [
        { n: '1', label: 'Not Observed',     color: 'emerging' },
        { n: '2', label: 'Emerging',         color: 'developing' },
        { n: '3', label: 'Effective',        color: 'proficient' },
        { n: '4', label: 'Highly Effective', color: 'excellent' },
      ],
    },
    // Colour bins are (min-inclusive threshold, colour) pairs, ordered high→low.
    colorBins: [
      { threshold: 88, color: 'excellent' },   // 3.5+/4 avg
      { threshold: 63, color: 'proficient' },  // 2.5+/4 avg
      { threshold: 38, color: 'developing' },  // 1.5+/4 avg
      { threshold: 0,  color: 'emerging' },
    ],
    // Performance level word for the top-right header badge, same shape.
    performanceLevels: [
      { threshold: 88, label: 'Highly Effective', color: 'excellent' },
      { threshold: 63, label: 'Effective',        color: 'proficient' },
      { threshold: 38, label: 'Emerging',         color: 'developing' },
      { threshold: 0,  label: 'Not Observed',     color: 'emerging' },
    ],
  };
}

module.exports = { transformFICOToReportData };
