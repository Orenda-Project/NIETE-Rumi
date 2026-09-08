/**
 * bd-xc6jv — the report must stop telling an Urdu teacher her lesson lacked maths.
 *
 * FICO Section F carries subject-tagged indicators, and only the one matching the
 * lesson's subject applies. The other two (or seven, on v4) are NOT a low mark —
 * they are outside the lesson entirely.
 *
 * The per-domain "why" line the teacher reads is grounded in the domain's two
 * LOWEST-scoring indicators. A non-applicable row sorts to the very bottom
 * (`score: null` → `(x.score || 0)` → 0, and on V3 it is literally floored to 1),
 * so it is selected DETERMINISTICALLY, in every report, for every teacher whose
 * subject is not the tagged one. Its evidence reads "Not applicable — lesson
 * subject is Urdu, indicator applies to math", and the prompt then REQUIRES the
 * model to "ALWAYS name ONE concrete missing element". So it names maths.
 *
 * Field reports, 7 Sep 2026 (three coaches, multiple teachers): "Regardless of
 * which subject the teacher is using DC for, Section F is asking them to work on
 * Maths pedagogy." Two delivered reports confirmed it verbatim — an Urdu lesson
 * told it lacked "mathematical or scientific material", and a SCIENCE lesson told
 * it lacked "mathematical teaching".
 *
 * A non-applicable indicator must never reach the narrative as evidence of a
 * weakness, on either rubric version.
 */
const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');

// Section F as the analyser emits it for an URDU lesson: the literacy row applies,
// maths and science do not.
const urduLesson = {
  framework: 'fico',
  scores: { overall_percentage: 64 },
  domains: {
    lesson_plan_fidelity: { domain_score: 25, domain_max: 40, indicators: [] },
    high_leverage_practices: { domain_score: 30, domain_max: 48, indicators: [] },
    student_engagement: { domain_score: 20, domain_max: 28, indicators: [] },
    teacher_subject_knowledge: {
      domain_score: 20,
      domain_max: 32,
      // All eight V3 rows, as the analyser emits them: F5 (math) and F6 (science)
      // do not apply to an Urdu lesson and are floored to 1.
      indicators: [
        { id: 'F1', score: 3, evidence: 'Content accurate throughout.' },
        { id: 'F2', score: 2, evidence: 'Key terms named but not explained.' },
        { id: 'F3', score: 3, evidence: 'Anticipated the common confusion.' },
        { id: 'F4', score: 2, evidence: 'Explained the why once.' },
        { id: 'F5', score: 1, applicable: false, evidence: 'Not applicable — lesson subject is Urdu, indicator applies to math.' },
        { id: 'F6', score: 1, applicable: false, evidence: 'Not applicable — lesson subject is Urdu, indicator applies to science.' },
        { id: 'F7', score: 3, evidence: 'Modelled reading strategies aloud.' },
        { id: 'F8', score: 3, evidence: 'Linked the poem to social studies.' },
      ],
    },
  },
};

describe('bd-xc6jv — a non-applicable indicator is not a weakness', () => {
  it('THE BUG: the maths and science rows must not ground the Section F "why" line', () => {
    const p = buildPrompt(urduLesson, { transcript: 't', language: 'ur', teacherName: 'Tahira' });
    const sectionF = p.split('\n').find((l) => l.includes('teacher_subject_knowledge (Teacher Subject Knowledge)'));
    expect(sectionF).toBeDefined();
    expect(sectionF).not.toContain('F5');
    expect(sectionF).not.toContain('F6');
    expect(sectionF).not.toContain('Not applicable');
  });

  it('the genuinely weakest APPLICABLE indicator is still surfaced', () => {
    const p = buildPrompt(urduLesson, { transcript: 't', language: 'ur', teacherName: 'Tahira' });
    const sectionF = p.split('\n').find((l) => l.includes('teacher_subject_knowledge (Teacher Subject Knowledge)'));
    expect(sectionF).toMatch(/F2|F4/);
    expect(sectionF).toMatch(/Key terms named but not explained|Explained the why once/);
  });

  it('no subject name leaks into the grounding as a missing element', () => {
    const p = buildPrompt(urduLesson, { transcript: 't', language: 'ur', teacherName: 'Tahira' });
    const sectionF = p.split('\n').find((l) => l.includes('teacher_subject_knowledge (Teacher Subject Knowledge)'));
    expect(sectionF.toLowerCase()).not.toMatch(/\bmath\b|mathematic/);
  });

  it('the model is told never to blame a missing subject for the score', () => {
    const p = buildPrompt(urduLesson, { transcript: 't', language: 'ur', teacherName: 'Tahira' });
    expect(p).toMatch(/never .*another subject|not .*because .*subject/i);
  });

  it('a domain with NO applicable indicators degrades to the score alone, not a crash', () => {
    const allNa = JSON.parse(JSON.stringify(urduLesson));
    allNa.domains.teacher_subject_knowledge.indicators =
      allNa.domains.teacher_subject_knowledge.indicators.map((i) => ({ ...i, applicable: false }));
    const p = buildPrompt(allNa, { transcript: 't', language: 'en', teacherName: 'T' });
    const sectionF = p.split('\n').find((l) => l.includes('teacher_subject_knowledge (Teacher Subject Knowledge)'));
    expect(sectionF).toContain('20/32');
    expect(sectionF).not.toContain('Not applicable');
  });

  it('an indicator with no applicable flag is treated as applicable (pre-cutover sessions)', () => {
    const legacy = JSON.parse(JSON.stringify(urduLesson));
    legacy.domains.teacher_subject_knowledge.indicators = [
      { id: 'F1', score: 1, evidence: 'Factual error about the poet went uncorrected.' },
      { id: 'F2', score: 3, evidence: 'Terms explained well.' },
    ];
    const p = buildPrompt(legacy, { transcript: 't', language: 'en', teacherName: 'T' });
    const sectionF = p.split('\n').find((l) => l.includes('teacher_subject_knowledge (Teacher Subject Knowledge)'));
    expect(sectionF).toContain('F1');
    expect(sectionF).toContain('Factual error');
  });
});

/**
 * bd-xc6jv.2 — the grounding line hardcoded "/4", which is the V3 scale.
 * FICO v4 (on develop, 26 indicators) scores 0-2, so a teacher who scored FULL
 * marks on an indicator was described to the narrative model as "2/4" — half.
 * That systematically biases every "why" line downward on the new rubric.
 * Derive the per-indicator max from the domain instead of assuming it.
 */
describe('bd-xc6jv.2 — the indicator denominator follows the rubric, not a constant', () => {
  it('V3: eight indicators out of 32 renders as /4', () => {
    const p = buildPrompt(urduLesson, { transcript: 't', language: 'en', teacherName: 'T' });
    const sectionF = p.split('\n').find((l) => l.includes('teacher_subject_knowledge (Teacher Subject Knowledge)'));
    expect(sectionF).toContain('F2 scored 2/4');
  });

  it('v4: three applicable indicators out of 6 renders as /2, never /4', () => {
    const v4 = {
      framework: 'fico',
      scores: { overall_percentage: 50 },
      domains: {
        teacher_subject_knowledge: {
          domain_score: 3,
          domain_max: 6,
          indicators_applicable: 3,
          indicators: [
            { id: 'F1', score: 2, evidence: 'Explained why, not just what.' },
            { id: 'F2', score: 1, evidence: 'Terms used, not explained.' },
            { id: 'F3', score: 0, evidence: 'Misconceptions never surfaced.' },
            { id: 'F4', score: null, applicable: false, evidence: 'Not applicable — lesson subject is Urdu.' },
          ],
        },
      },
    };
    const p = buildPrompt(v4, { transcript: 't', language: 'en', teacherName: 'T' });
    const sectionF = p.split('\n').find((l) => l.includes('teacher_subject_knowledge (Teacher Subject Knowledge)'));
    expect(sectionF).toContain('F3 scored 0/2');
    expect(sectionF).not.toContain('/4');
  });
});

/**
 * bd-xc6jv.3 — the v4 analysis prompt contradicted itself.
 *
 * The SUBJECT-CONDITIONAL block tells the scorer, correctly, to emit
 * `"applicable": false` with `"score": null` and says in capitals that a
 * non-applicable indicator LEAVES THE TOTAL ENTIRELY and must NOT be scored 0.
 * Forty lines later the EVIDENCE RULES still carried the V3 instruction to
 * "score 1 with evidence noting the mismatch". A model handed both rules can
 * satisfy either, which is exactly how a row that should have left the total
 * comes back as the domain's lowest mark.
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

describe('bd-xc6jv.3 — the analysis prompt states ONE rule for non-applicable rows', () => {
  const prompt = fico.buildAnalysisPrompt('transcript', { language: 'ur' }, null, null);

  it('does not tell the scorer to score a subject-mismatched row', () => {
    expect(prompt).not.toMatch(/non-applicable Section F rows \(subject mismatch\), score \d/i);
  });

  it('still carries the applicable/null rule it is meant to follow', () => {
    expect(prompt).toMatch(/"applicable"/);
  });
});
