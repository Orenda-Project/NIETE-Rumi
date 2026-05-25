#!/usr/bin/env node
/**
 * render-sample-report.js — render a sample coaching report through the REAL pipeline.
 *
 * Produces docs/samples/coaching-report-sample.pdf so prospective adopters can see what a
 * Rumi classroom-observation report actually looks like, without deploying anything.
 *
 * Design notes:
 *  - Renders IN-MEMORY via PDFReportService.generateClassroomObservationReport (pdfkit, pure JS —
 *    no Chromium, no DB, no network). It does NOT touch the database, object storage, or WhatsApp.
 *  - The data below is HAND-AUTHORED and representative. We deliberately do NOT pull a real
 *    coaching session: production analysis contains transcript-derived `evidence` quotes with
 *    teacher/student/place names that cannot be reliably anonymised for a public repo. Authored
 *    data gives an authentic-looking sample with zero PII risk.
 *  - Re-run any time: `node scripts/render-sample-report.js`
 */

const fs = require('fs');
const path = require('path');
const PDFReportService = require('../bot/shared/services/pdf-report.service');

// A representative OECD-framework report. Scores are illustrative; evidence strings are generic
// classroom observations with no real names, schools, or locations.
const reportData = {
  teacherName: 'Ms. Ayesha Khan',
  observationDate: 'March 12, 2026',
  subject: 'Science',
  topic: 'Photosynthesis',
  observerName: 'Rumi Digital Coach',
  hasLessonPlan: false,
  totalScore: 71,
  maxScore: 103,
  feedback:
    'A warm, well-paced lesson with strong student participation. The teacher opened with a clear ' +
    'objective and used a real-world hook that landed well. The biggest opportunity is to push for ' +
    'higher-order questioning — most questions were recall; a few "why" and "what if" prompts would ' +
    'lift cognitive rigor. Checking for understanding before moving on would catch the misconception ' +
    'about where plants get their mass.',
  goals: [
    {
      title: 'Goal 1: Formative Assessment and Feedback',
      score: 15,
      maxScore: 22,
      criteria: [
        { name: 'SMART Objectives', score: 4, max: 4, evidence: 'Lesson opened by stating the objective on the board and reading it aloud; objective was specific and measurable.', timestamp: '00:01:20' },
        { name: "Teacher's Role", score: 3, max: 4, evidence: 'Teacher circulated during group work and prompted thinking, though a few groups were left unattended for several minutes.', timestamp: '00:14:05' },
        { name: 'Assessment', score: 8, max: 9, evidence: 'Frequent thumbs-up/down checks and one exit-ticket question; could add a quick mid-lesson check before the practice task.', timestamp: '00:22:40' },
      ],
    },
    {
      title: 'Goal 2: Student Engagement',
      score: 16,
      maxScore: 22,
      criteria: [
        { name: 'Cognitive Rigor', score: 5, max: 9, evidence: 'Most questions were recall ("what is chlorophyll?"). Few prompts asked students to reason or predict.', timestamp: '00:09:10' },
        { name: 'Real World Connections', score: 4, max: 4, evidence: 'Strong hook linking photosynthesis to why leaves are green and to food on the table.', timestamp: '00:02:30' },
        { name: 'Multimodality', score: 4, max: 5, evidence: 'Used a labelled diagram and a short demonstration; no hands-on student activity.', timestamp: '00:11:00' },
        { name: 'Addressing Misconceptions', score: 3, max: 4, evidence: 'Surfaced the "plants eat soil" misconception but moved on before fully resolving it.', timestamp: '00:18:15' },
      ],
    },
    {
      title: 'Goal 3: Quality Subject Content',
      score: 22,
      maxScore: 30,
      criteria: [
        { name: 'Prior Knowledge', score: 7, max: 10, evidence: 'Activated prior knowledge of plant parts before introducing the process.', timestamp: '00:03:45' },
        { name: 'Content Accuracy', score: 9, max: 10, evidence: 'Explanation of the light-dependent stage was accurate and clearly sequenced.', timestamp: '00:12:20' },
        { name: 'Coherence', score: 6, max: 10, evidence: 'Logical flow overall; the transition from the demo to independent practice was abrupt.', timestamp: '00:20:05' },
      ],
    },
    {
      title: 'Goal 4: Classroom Management',
      score: 10,
      maxScore: 14,
      criteria: [
        { name: 'Routines', score: 6, max: 7, evidence: 'Clear handout and grouping routines; transitions were quick and orderly.', timestamp: '00:05:00' },
        { name: 'Time on Task', score: 4, max: 7, evidence: 'Strong start; the last ten minutes lost some momentum during clean-up.', timestamp: '00:33:10' },
      ],
    },
    {
      title: 'Goal 5: Supportive Learning Environment',
      score: 8,
      maxScore: 15,
      criteria: [
        { name: 'Respect & Rapport', score: 5, max: 8, evidence: 'Warm tone; praised effort by name and invited quieter students to contribute.', timestamp: '00:07:30' },
        { name: 'Equitable Participation', score: 3, max: 7, evidence: 'A small group of students answered most questions; consider a cold-call or think-pair-share to widen participation.', timestamp: '00:16:50' },
      ],
    },
  ],
  priorFeedback: null,
  debriefReflection: null,
  fidelitySection: null,
  isPartialReport: false,
  partialReportNote: null,
};

(async () => {
  const buf = await PDFReportService.generateClassroomObservationReport(reportData);
  const outDir = path.resolve(__dirname, '..', 'docs', 'samples');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'coaching-report-sample.pdf');
  fs.writeFileSync(out, buf);
  console.log(`Wrote ${out} (${Math.round(buf.length / 1024)} KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
