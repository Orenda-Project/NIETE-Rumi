'use strict';
/**
 * bd-ra8xu.40 — the V3 ('fico') and /observe2 report-narrative and debrief-guide prompts, built from fixed fixtures, so
 * a test can pin them byte for byte while the FICO17 v6 branches are added beside them. Every prompt here must read
 * exactly as it did on origin/sandbox before bd-ra8xu.40 (the pins are those prompts' sha256).
 */
const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const { resolveTarget } = require('../../bot/shared/services/coaching/target-resolver');
const { buildGuidePrompt, buildFallbackGuide } = require('../../bot/shared/services/observe/observe-debrief-guide');
const { buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis');

const ok = (id, name, score, evidence) => ({ id, name, score, applicable: true, evidence: evidence || `Quote for ${name}` });

/** A V3 FICO lesson: four sections, a measured Section B, an NA row, the scorer's focus_area. */
function v3Lesson() {
  return {
    framework: 'fico',
    topic: 'Plural nouns',
    scores: { overall_percentage: 64, overall_marks: 95, overall_max_marks: 148 },
    domains: {
      lesson_plan_fidelity: { domain_score: 24, domain_max: 40, fidelity_derived: true, fidelity_pct: 60, indicators: [ok('B1', 'Fidelity to LP steps', 2)] },
      high_leverage_practices: {
        domain_score: 30, domain_max: 48,
        indicators: [ok('C1', 'Quality Questioning', 3, 'Asked why twice.'), ok('C3', 'Effective Feedback', 1, 'Feedback was only shabash.'), ok('C5', 'Wait time', 2)],
      },
      student_engagement: { domain_score: 20, domain_max: 28, indicators: [ok('D1', 'Student talk', 2), ok('D2', 'Reasoning', 3)] },
      teacher_subject_knowledge: {
        domain_score: 20, domain_max: 32,
        indicators: [ok('F1', 'Content Accuracy', 3), { id: 'F5', name: 'Maths discourse', score: 1, applicable: false, evidence: 'Not applicable' }],
      },
    },
    lp_fidelity: { status: 'ok', fidelity_pct: 60, moves: [{ phase: 'opening', text: 'Recall yesterday', verdict: 'not_done' }] },
    reflective_corpus: { lesson_throughline_en: 'From one to many.', significant_moments: [{ what_happened: 'Pairs sorted cards', significance_reason_en: 'peer talk' }] },
    executive_summary: 'A warm lesson with clear steps.',
    strengths: [{ title: 'Clear aim', evidence: 'You named the aim at the start.' }],
    growth_opportunities: [{ area: 'Feedback', rationale: 'Feedback stayed general.' }],
    focus_area: { domain: 'high_leverage_practices', indicator: 'C3', title: 'Feedback that says what next', rationale: 'Feedback stayed at shabash.', try_this_tomorrow: 'After each wrong answer, say one next step.' },
  };
}

const LEVELS6 = { C1: '3', C2: '2', C3: '3', C4: '2', C5: '2', C6: '3', C7: 'NA', C8: '3', D1: '3', D2: '4', D3: 'IE', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
function observe2Form(rubric) {
  const v6 = rubric === 'fico17_v6';
  const v6Levels = {};
  if (v6) for (const c of ['C3', 'C5', 'C7', 'D2', 'D3', 'D4']) v6Levels[c] = { level: LEVELS6[c], because: 'What I saw from the back of the room.', source: 'coach', set_by: 'coach' };
  return {
    id: `form-${rubric}`, rubric_version: rubric, period_minutes: 40,
    answers: { lp: 'none', priority: 'C5' },
    final_levels: { ...LEVELS6, D3: v6 ? 'IE' : '2', C7: v6 ? 'NA' : '2' },
    rumi_moments: { moments: [{ id: 'm1', type: 'probe', minute: '04:10', quote: 'Why?' }] },
    evidence_review: { heard_m1: 'yes', priority_final: 'C5', ...(v6 ? { v6_levels: v6Levels } : {}) },
  };
}

const TRANSCRIPT = '[00:10] Teacher: Today, plural nouns.\n[01:00] Student: Books!';

function allPrompts() {
  const v3 = v3Lesson();
  const o2v6 = buildAnalysis(observe2Form('fico17_v6'), {});
  const o2v5 = buildAnalysis(observe2Form('fico-ict-17-2026-09'), {});
  const trend = [{ pct: 55 }, { pct: 61 }];
  const out = {};
  for (const language of ['en', 'ur']) {
    out[`narrative-v3-${language}`] = buildPrompt(v3, { transcript: TRANSCRIPT, trend, language, teacherName: 'Rabia', target: resolveTarget(v3) });
    out[`narrative-v3-notarget-${language}`] = buildPrompt({ ...v3, focus_area: null }, { transcript: TRANSCRIPT, language, teacherName: 'Rabia', target: null });
    out[`narrative-observe2-v6-${language}`] = buildPrompt(o2v6, { transcript: TRANSCRIPT, language, teacherName: 'Rabia', target: resolveTarget(o2v6) });
    out[`narrative-observe2-v5-${language}`] = buildPrompt(o2v5, { transcript: TRANSCRIPT, trend, language, teacherName: 'Rabia', target: resolveTarget(o2v5) });
    out[`guide-v3-${language}`] = buildGuidePrompt(v3, { language });
    out[`guide-fallback-v3-${language}`] = JSON.stringify(buildFallbackGuide(v3, { language }));
  }
  out['target-v3'] = JSON.stringify(resolveTarget(v3));
  out['target-observe2-v6'] = JSON.stringify(resolveTarget(o2v6));
  out['target-observe2-v5'] = JSON.stringify(resolveTarget(o2v5));
  return out;
}

module.exports = { v3Lesson, observe2Form, allPrompts, TRANSCRIPT };
