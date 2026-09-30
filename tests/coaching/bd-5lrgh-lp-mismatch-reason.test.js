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
 * AND Section B is 0, the Section B line is written in code (the catalogue line the
 * field team asked for) plus one sentence on what the RECORDING shows was taught; the
 * plan's moves never reach the model, and the "next horizon" never lands on that 0.
 * A flagged session whose Section B is still above 0 is left exactly as it was — a
 * line saying "0%" beside a non-zero bar would be a second contradiction.
 */
const { buildFicoGroups, isLessonMismatch } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
const { attachDomainWhys } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

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

describe('the catalogue line', () => {
  test('exists in both offered languages, English exactly as the field team worded it', () => {
    expect(UX_STRINGS.reportLpMismatch).toBeDefined();
    expect(UX_STRINGS.reportLpMismatch.en)
      .toBe('The classroom recording does not match the selected lesson plan. Therefore, LP Fidelity is 0%.');
    expect(/[؀-ۿ]/.test(UX_STRINGS.reportLpMismatch.ur)).toBe(true);
  });

  test('the Urdu variant has nothing for the bidi algorithm to reorder', () => {
    const ur = UX_STRINGS.reportLpMismatch.ur;
    expect(ur).not.toMatch(/[A-Za-z]/);
    expect(ur).not.toMatch(/[0-9٠-٩۰-۹%]/);
  });
});

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

describe('buildFicoGroups — the Section B row carries the line', () => {
  test.each(['en', 'ur'])('%s: mismatch row gets the catalogue why and keeps its 0/40 bar', (lang) => {
    const b = sectionB(buildFicoGroups(analysis(), lang));
    expect(b.lessonMismatch).toBe(true);
    expect(b.why).toBe(resolveUx('reportLpMismatch', { language: lang }));
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

describe('attachDomainWhys — the model cannot overwrite the mismatch line', () => {
  test('the model\'s Section B diagnosis is ignored; the taught-sentence is appended', () => {
    const groups = buildFicoGroups(analysis(), 'en');
    attachDomainWhys(groups, { lesson_plan_fidelity: `not full marks because ${PLAN_MOVE}`, student_engagement: 'D why' },
      { lessonMismatchTaught: 'The recording shows a reading lesson on sentence order and syllables.' });
    const b = sectionB(groups);
    expect(b.why).toBe(`${resolveUx('reportLpMismatch', { language: 'en' })} The recording shows a reading lesson on sentence order and syllables.`);
    expect(b.why).not.toContain('countable');
    expect(groups.find((g) => g.domainKey === 'student_engagement').why).toBe('D why');
  });

  test('no taught-sentence → the catalogue line stands alone', () => {
    const groups = buildFicoGroups(analysis(), 'ur');
    attachDomainWhys(groups, { lesson_plan_fidelity: 'model text' });
    expect(sectionB(groups).why).toBe(resolveUx('reportLpMismatch', { language: 'ur' }));
  });

  test('a normal session still takes the model\'s Section B why', () => {
    const groups = buildFicoGroups(analysis({ note: null }), 'en');
    attachDomainWhys(groups, { lesson_plan_fidelity: 'B why' }, { lessonMismatchTaught: 'ignored' });
    expect(sectionB(groups).why).toBe('B why');
  });
});

describe('buildPrompt — the plan never reaches the why-writer on a mismatch', () => {
  const opts = { transcript: '[00:05] read the sentences', language: 'en', teacherName: 'Annie' };

  test('no plan move text, a mismatch instruction, and a taught-sentence field', () => {
    const p = buildPrompt(analysis(), opts);
    expect(p).not.toContain(PLAN_MOVE);
    expect(p).not.toContain('Moves missed or partial');
    expect(p).toMatch(/LESSON MISMATCH/);
    expect(p).toContain('"lesson_mismatch_taught"');
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

describe('the line as it renders', () => {
  const vm = (lang, groups) => ({
    language: lang, brand: 'niete', teacherName: 'Annie', topic: 'x', date: '2026-09-30',
    score: { overall: 52, marks: 66, max: 140 },
    groups, narrative: { affirmation: 'x', moments: [] }, trend: [],
  });

  test.each(['en', 'ur'])('%s: it paints inside the Section B why line', (lang) => {
    const fragment = lang === 'en'
      ? 'does not match the selected lesson plan'
      : UX_STRINGS.reportLpMismatch.ur.split(' ').slice(0, 3).join(' ');
    const groups = buildFicoGroups(analysis(), lang);
    attachDomainWhys(groups, {});
    const html = buildHeroReportHtml(vm(lang, groups));
    expect(html).toContain('class="sc-why"');
    expect(html).toContain(fragment);
  });
});
