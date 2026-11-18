/**
 * bd-5lrgh — a lesson-plan MISMATCH is explained as a mismatch, not with the plan.
 *
 * ICT sheet, DC tab row 142 (30 Sep, session 2dfc50b0): the grader read a clear
 * recording of a reading/sentence lesson against an uploaded plan for countable and
 * uncountable nouns, set `moderators.note = "lesson_mismatch"` and scored Section B
 * 0/40 — correctly. The report then explained that 0 with the plan: the why-writer is
 * handed "Moves missed or partial: <the plan's first three moves>", so the teacher
 * was told what she had not done from a lesson she never taught.
 *
 * The fix is report text only; no score changes. When the grader flagged a mismatch
 * AND Section B is 0, the Section B line is written in code — the catalogue line the
 * field team asked for, and nothing else (operator, 2026-10-01: "just need to have that
 * why it was marked zero because of mismatch"); the plan's moves never reach the model,
 * and the "next horizon" never lands on that 0.
 * A flagged session whose Section B is still above 0 is left exactly as it was — a
 * line saying "0%" beside a non-zero bar would be a second contradiction.
 *
 * bd-r2uzg1.12 (13 Nov) retired the code-written line. The operator: "I dont know how reliably we can tell
 * if the lesson was mismatched. How about if we add both?" Section B is again explained by the model with
 * the plan's moves, as on production, and one soft catalogue line follows it
 * (tests/coaching/bd-r2uzg1.12-mismatch-soft-line.test.js). What stays from bd-5lrgh: the horizon never
 * lands on that 0, the header never falls back to the plan's topic, and no taught-sentence travels on.
 */
const { buildFicoGroups, isLessonMismatch } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
const { attachDomainWhys } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');

const PLAN_MOVE = 'Teacher explains countable and uncountable nouns with real classroom objects';

function analysis({ note = 'lesson_mismatch', bScore = 0, pct = 0, focus = null } = {}) {
  return {
    framework: 'fico',
    scores: { overall_percentage: 52 },
    focus_area: focus,
    domains: {
      lesson_plan_fidelity: {
        assessed: true, fidelity_derived: true, fidelity_pct: pct,
        domain_score: bScore, domain_max: 40,
        indicators: [{ id: 'B1', score: 3, evidence: 'purpose stated' }],
      },
      high_leverage_practices: { domain_score: 30, domain_max: 48, indicators: [{ id: 'C1', score: 2, evidence: 'recall questions' }] },
      student_engagement: { domain_score: 20, domain_max: 28, indicators: [{ id: 'D1', score: 3, evidence: 'choral reading' }] },
      teacher_subject_knowledge: { domain_score: 16, domain_max: 24, indicators: [{ id: 'F1', score: 2, evidence: 'syllables' }] },
    },
    lp_fidelity: {
      status: 'ok', fidelity_pct: pct,
      moderators: note ? { note, plan_navigability: 'clear' } : null,
      moves: [
        { move_id: 'm1', verdict: 'not_done', text: PLAN_MOVE },
        { move_id: 'm2', verdict: 'not_done', text: 'Children sort picture cards into countable and uncountable piles' },
      ],
    },
  };
}

const sectionB = (groups) => groups.find((g) => g.domainKey === 'lesson_plan_fidelity');

describe('isLessonMismatch — only a flagged mismatch that scored 0', () => {
  test('flag + Section B 0 → true', () => {
    expect(isLessonMismatch(analysis())).toBe(true);
  });
  test('flag but Section B above 0 → false (the score and the line would contradict)', () => {
    expect(isLessonMismatch(analysis({ bScore: 4, pct: 9.1 }))).toBe(false);
  });
  test('no flag → false, whatever the score', () => {
    expect(isLessonMismatch(analysis({ note: null }))).toBe(false);
    expect(isLessonMismatch(analysis({ note: 'recording_unusable' }))).toBe(false);
  });
  test('a not-assessed Section B or a non-FICO / empty analysis → false', () => {
    const a = analysis();
    a.domains.lesson_plan_fidelity.assessed = false;
    expect(isLessonMismatch(a)).toBe(false);
    expect(isLessonMismatch({})).toBe(false);
    expect(isLessonMismatch(null)).toBe(false);
  });
});

describe('buildFicoGroups — the Section B row is flagged for the horizon, with no code-written line', () => {
  test.each(['en', 'ur'])('%s: mismatch row keeps its 0/40 bar and carries no why of its own', (lang) => {
    const b = sectionB(buildFicoGroups(analysis(), lang));
    expect(b.lessonMismatch).toBe(true);
    expect(b.why).toBeUndefined();
    expect(b.score).toBe(0);
    expect(b.max).toBe(40);
  });

  test('an unflagged 0 and a flagged non-zero row are unchanged', () => {
    for (const a of [analysis({ note: null }), analysis({ bScore: 4, pct: 9.1 })]) {
      const b = sectionB(buildFicoGroups(a, 'en'));
      expect(b.lessonMismatch).toBeUndefined();
      expect(b.why).toBeUndefined();
    }
  });
});

describe('attachDomainWhys — a mismatch Section B takes the model\'s why, as on production', () => {
  test.each(['en', 'ur'])('%s: the model\'s line attaches; other rows as before', (lang) => {
    const groups = buildFicoGroups(analysis(), lang);
    attachDomainWhys(groups, { lesson_plan_fidelity: 'B why', student_engagement: 'D why' });
    expect(sectionB(groups).why).toBe('B why');
    expect(groups.find((g) => g.domainKey === 'student_engagement').why).toBe('D why');
  });
});

describe('buildPrompt on a mismatch', () => {
  const opts = { transcript: '[00:05] read the sentences', language: 'en', teacherName: 'Annie' };

  test('Section B is explained with the plan\'s moves as on production; no mismatch instruction, no extra field', () => {
    const p = buildPrompt(analysis(), opts);
    expect(p).toContain('Moves missed or partial');
    expect(p).toContain(PLAN_MOVE);
    expect(p).not.toMatch(/LESSON MISMATCH/);
    expect(p).not.toMatch(/was for a different lesson/);
    expect(p).not.toContain('lesson_mismatch_taught');
  });

  test('the next horizon is not the mismatched Section B', () => {
    const p = buildPrompt(analysis(), opts);
    expect(p).not.toMatch(/LOWEST-SCORING domain this lesson is "Lesson Plan Fidelity"/);
    // Without B, the lowest is C: 30/48 (62.5%) under D 20/28 and F 16/24.
    expect(p).toMatch(/LOWEST-SCORING domain this lesson is "High-Leverage Practices"/);
  });

  test('a scorer focus on a Section B indicator is not used as the horizon on a mismatch', () => {
    const target = { indicator: 'B1', domain: 'lesson_plan_fidelity', name: 'Lesson purpose' };
    const p = buildPrompt(analysis(), { ...opts, target });
    expect(p).not.toMatch(/the indicator to grow next is "Lesson purpose"/);
  });

  test('the plan\'s topic is not handed over as the lesson topic on a mismatch', () => {
    const a = analysis();
    a.topic = 'Countable and Uncountable Nouns';
    const p = buildPrompt(a, opts);
    expect(p).not.toContain('Countable and Uncountable Nouns');
    expect(p).toMatch(/LESSON TOPIC: take it from the TRANSCRIPT/);
  });

  test('a normal session\'s prompt is unchanged: moves listed, no mismatch field', () => {
    const p = buildPrompt(analysis({ note: null }), opts);
    expect(p).toContain('Moves missed or partial');
    expect(p).toContain(PLAN_MOVE);
    expect(p).not.toContain('lesson_mismatch_taught');
    expect(p).not.toMatch(/LESSON MISMATCH/);
  });
});

describe('heroTopic — the header never names the plan\'s lesson on a mismatch', () => {
  const { heroTopic } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
  const withTopic = (opts) => Object.assign(analysis(opts), { topic: 'Countable and Uncountable Nouns' });

  test('mismatch + no narrative topic → empty, not the plan\'s topic', () => {
    expect(heroTopic(null, withTopic())).toBe('');
    expect(heroTopic({}, withTopic())).toBe('');
  });
  test('mismatch + narrative topic (from the transcript) → the narrative topic', () => {
    expect(heroTopic({ topic: 'Sentence order' }, withTopic())).toBe('Sentence order');
  });
  test('a normal session keeps today\'s fallback to analysis.topic', () => {
    expect(heroTopic(null, withTopic({ note: null }))).toBe('Countable and Uncountable Nouns');
  });
});
