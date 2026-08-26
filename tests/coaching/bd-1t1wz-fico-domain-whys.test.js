/**
 * bd-1t1wz — the narrative pass asks for a grounded one-line "why" per FICO
 * domain, in BOTH en and ur variants, with bd-43497's locked two-clause
 * skeleton, fed the real domain scores — and Section B's MEASURED fidelity
 * (missed moves) when it is fidelity-derived. On an observe session this call
 * runs AFTER the coach's edits persist, so her corrected evidence (evidence_sw
 * / improvement_sw) is preferred as the grounding.
 */
const { buildPrompt, fixCodeswitch } = require('../../bot/shared/services/coaching/report-v2/narrative.service');

const fico = { framework: 'fico', scores: { overall_percentage: 63 }, domains: {
  lesson_plan_fidelity: { domain_score: 24, domain_max: 40, indicators: [
    { id: 'B1', score: 2, evidence_summary: 'opening steps skipped' },
  ] },
  high_leverage_practices: { domain_score: 30, domain_max: 48, indicators: [
    { id: 'C3', score: 1, evidence_summary: 'no wait time after questions' },
    { id: 'C1', score: 4, evidence_summary: 'clear modeling on the board' },
  ] },
  student_engagement: { domain_score: 14, domain_max: 28, indicators: [] },
  teacher_subject_knowledge: { domain_score: 20, domain_max: 32, indicators: [] },
} };

describe('bd-1t1wz — domain_whys in the narrative prompt', () => {
  it.each(['en', 'ur'])('%s prompt requests domain_whys for all four domains', (language) => {
    const p = buildPrompt(fico, { transcript: 't', language, teacherName: 'T' });
    expect(p).toContain('"domain_whys"');
    for (const k of ['lesson_plan_fidelity', 'high_leverage_practices',
      'student_engagement', 'teacher_subject_knowledge']) {
      expect(p).toContain(`"${k}"`);
    }
    expect(p).toContain('PAST TENSE');
    expect(p).toContain('DOMAIN SCORES');
    expect(p).toContain('lesson_plan_fidelity (Lesson Plan Fidelity): 24/40');
    expect(p).toContain('C3 scored 1/4');
  });

  it('carries both locked skeletons (bd-43497) so either language lands the two-clause shape', () => {
    const p = buildPrompt(fico, { transcript: 't', language: 'ur', teacherName: 'T' });
    expect(p).toContain("it's not full marks because");
    expect(p).toContain('مکمل نمبر اس لیے نہیں کیونکہ');
  });

  it('prefers the COACH-EDITED evidence fields over the original summary', () => {
    const edited = JSON.parse(JSON.stringify(fico));
    edited.domains.high_leverage_practices.indicators[0] = {
      id: 'C3', score: 1,
      evidence_summary: 'no wait time after questions',
      evidence_sw: 'coach note: she rushed past every pupil answer',
      improvement_sw: 'pause five seconds after each question',
    };
    const p = buildPrompt(edited, { transcript: 't', language: 'en', teacherName: 'T' });
    expect(p).toContain('coach note: she rushed past every pupil answer');
    expect(p).toContain('pause five seconds after each question');
    expect(p).not.toContain('no wait time after questions');
  });

  it('Section B fidelity-derived → the why is grounded in MEASURED missed moves', () => {
    const derived = JSON.parse(JSON.stringify(fico));
    derived.domains.lesson_plan_fidelity = {
      domain_score: 26, domain_max: 40, fidelity_derived: true, fidelity_pct: 65, indicators: [],
    };
    derived.lp_fidelity = { fidelity_pct: 65, moves: [
      { move_id: 'm1', text: 'Recap yesterday with the number line', verdict: 'not_done' },
      { move_id: 'm2', text: 'Pair-check of sums', verdict: 'partial' },
      { move_id: 'm3', text: 'Exit ticket', verdict: 'done' },
    ] };
    const p = buildPrompt(derived, { transcript: 't', language: 'en', teacherName: 'T' });
    expect(p).toContain('65% of prescribed moves executed');
    expect(p).toContain('Recap yesterday with the number line');
    expect(p).not.toContain('Exit ticket" (done');
  });

  it('non-FICO frameworks are untouched (no domain_whys request)', () => {
    const p = buildPrompt({ framework: 'oecd', scores: {} }, { transcript: 't', language: 'en', teacherName: 'T' });
    expect(p).not.toContain('domain_whys');
  });

  it('fixCodeswitch still normalises transliterated pedagogy terms (net applies to whys)', () => {
    expect(fixCodeswitch('اسکفولڈنگ اچھی رہی')).toContain('scaffolding');
  });
});
