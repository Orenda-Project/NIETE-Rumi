/**
 * bd-r2uzg1.12 (ICT sheet DC row 142, plan #10) — a lesson-mismatch report keeps its Section B
 * score and explanation, and ADDS one soft line.
 *
 * The grader sets `lp_fidelity.moderators.note = 'lesson_mismatch'` when it judges the recording to
 * be a different lesson from the chosen plan. The operator (13 Nov): "I dont know how reliably we can
 * tell if the lesson was mismatched. How about if we add both? We say low score but also Perhaps you
 * chose a different lesson?" So nothing is taken away: the score and the model's why-line stay as they
 * are on production, and one catalogue sentence follows the why-line, in the report's language, on the
 * teacher's own (Digital Coach) recording. A coach visit is left alone: there the coach picked the plan.
 *
 * Surfaces: the hero report image (WhatsApp) and the portal's report page, which is where groups C and
 * D read Section B (their WhatsApp image is the slim card, which has no sections).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: { chat: { completions: { create: jest.fn() } } } }));

const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');
const { buildFicoGroups } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
const { attachDomainWhys } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');

const NOTE_PATH = '../../bot/shared/services/coaching/report-v2/lesson-mismatch-note';
const note = () => require(NOTE_PATH);

const EN = 'Perhaps the lesson plan you chose was for a different lesson? Next time, pick the plan for the lesson you are teaching.';
const PLAN_MOVE = 'Teacher explains countable and uncountable nouns with real classroom objects';
const MODEL_WHY = 'This is developing because you read the sentences aloud — it\'s not full marks because the nouns sorting step was not done.';

function analysis({ note: flag = 'lesson_mismatch', bScore = 0 } = {}) {
  return {
    framework: 'fico',
    scores: { overall_percentage: 52 },
    domains: {
      lesson_plan_fidelity: {
        assessed: true, fidelity_derived: true, fidelity_pct: bScore ? 10 : 0,
        domain_score: bScore, domain_max: 40,
        indicators: [{ id: 'B1', score: 3, evidence: 'purpose stated' }],
      },
      high_leverage_practices: { domain_score: 30, domain_max: 48, indicators: [{ id: 'C1', score: 2, evidence: 'recall questions' }] },
      student_engagement: { domain_score: 20, domain_max: 28, indicators: [{ id: 'D1', score: 3, evidence: 'choral reading' }] },
      teacher_subject_knowledge: { domain_score: 16, domain_max: 24, indicators: [{ id: 'F1', score: 2, evidence: 'syllables' }] },
    },
    lp_fidelity: {
      status: 'ok', fidelity_pct: bScore ? 10 : 0,
      moderators: flag ? { note: flag, plan_navigability: 'a different lesson' } : null,
      moves: [
        { move_id: 'm1', verdict: 'not_done', text: PLAN_MOVE },
        { move_id: 'm2', verdict: 'not_done', text: 'Children sort picture cards into countable and uncountable piles' },
      ],
    },
  };
}

const DC = { id: 's1', user_id: 'u1', observation_type: null };
const VISIT = { id: 's2', user_id: 'u1', observation_type: 'leader_observation' };
const sectionB = (groups) => groups.find((g) => (g.domainKey || g.key) === 'lesson_plan_fidelity');

describe('the catalogue line', () => {
  test('English is the operator\'s wording, word for word', () => {
    expect(UX_STRINGS.reportLpMismatchSoft).toBeDefined();
    expect(UX_STRINGS.reportLpMismatchSoft.en).toBe(EN);
  });

  test('Urdu: Urdu script, Urdu punctuation, nothing for the bidi algorithm to reorder', () => {
    const ur = UX_STRINGS.reportLpMismatchSoft.ur;
    expect(ur).toMatch(/[؀-ۿ]/);
    expect(ur).not.toMatch(/[A-Za-z]/);
    expect(ur).not.toMatch(/[0-9٠-٩۰-۹%]/);
    expect(ur).toContain('؟');
    expect(ur.trim().endsWith('۔')).toBe(true);
  });

  test('never the word "app", in either language (NIETE is WhatsApp)', () => {
    expect(UX_STRINGS.reportLpMismatchSoft.en).not.toMatch(/\bapp\b/i);
    expect(UX_STRINGS.reportLpMismatchSoft.ur).not.toMatch(/ایپ/);
  });
});

describe('lessonMismatchNote — who gets the line', () => {
  test.each(['en', 'ur'])('%s: a flagged Digital Coach recording gets the catalogue line', (lang) => {
    expect(note().lessonMismatchNote(analysis(), DC, lang)).toBe(resolveUx('reportLpMismatchSoft', { language: lang }));
  });
  test('a flagged recording whose Section B kept some marks still gets it (the line claims nothing about the score)', () => {
    expect(note().lessonMismatchNote(analysis({ bScore: 4 }), DC, 'en')).toBe(EN);
  });
  test('no flag, another note, or no analysis → no line', () => {
    expect(note().lessonMismatchNote(analysis({ note: null }), DC, 'en')).toBeNull();
    expect(note().lessonMismatchNote(analysis({ note: 'recording_unusable' }), DC, 'en')).toBeNull();
    expect(note().lessonMismatchNote({}, DC, 'en')).toBeNull();
    expect(note().lessonMismatchNote(null, DC, 'en')).toBeNull();
  });
  test('a coach visit → no line (the coach chose that plan, not the teacher)', () => {
    expect(note().lessonMismatchNote(analysis(), VISIT, 'en')).toBeNull();
  });
});

describe('the Section B row: score and explanation as today, plus the line', () => {
  test.each(['en', 'ur'])('%s: the model\'s why stays and the line follows it', (lang) => {
    const groups = buildFicoGroups(analysis(), lang);
    attachDomainWhys(groups, { lesson_plan_fidelity: MODEL_WHY, student_engagement: 'D why' });
    note().attachLessonMismatchNote(groups, analysis(), DC, lang);
    const b = sectionB(groups);
    expect(b.score).toBe(0);
    expect(b.max).toBe(40);
    expect(b.why).toBe(`${MODEL_WHY} ${resolveUx('reportLpMismatchSoft', { language: lang })}`);
    expect(groups.find((g) => g.domainKey === 'student_engagement').why).toBe('D why');
  });

  test('no model why (the narrative failed) → the line alone', () => {
    const groups = buildFicoGroups(analysis(), 'en');
    note().attachLessonMismatchNote(groups, analysis(), DC, 'en');
    expect(sectionB(groups).why).toBe(EN);
  });

  test('idempotent: attached twice, it appears once', () => {
    const groups = buildFicoGroups(analysis(), 'en');
    attachDomainWhys(groups, { lesson_plan_fidelity: MODEL_WHY });
    note().attachLessonMismatchNote(groups, analysis(), DC, 'en');
    note().attachLessonMismatchNote(groups, analysis(), DC, 'en');
    expect(sectionB(groups).why.split(EN).length - 1).toBe(1);
  });

  test('an unflagged session and a coach visit render exactly as before', () => {
    for (const [a, s] of [[analysis({ note: null }), DC], [analysis(), VISIT]]) {
      const groups = buildFicoGroups(a, 'en');
      attachDomainWhys(groups, { lesson_plan_fidelity: MODEL_WHY });
      const before = JSON.stringify(groups);
      note().attachLessonMismatchNote(groups, a, s, 'en');
      expect(JSON.stringify(groups)).toBe(before);
    }
  });

  test('a not-assessed Section B keeps its own code-written line', () => {
    const a = analysis();
    a.domains.lesson_plan_fidelity.assessed = false;
    const groups = buildFicoGroups(a, 'en');
    const before = sectionB(groups).why;
    note().attachLessonMismatchNote(groups, a, DC, 'en');
    expect(sectionB(groups).why).toBe(before);
  });
});

describe('the why-writer still explains Section B with the plan, as today', () => {
  test('a flagged session\'s prompt carries the plan\'s missed moves for Section B', () => {
    const p = buildPrompt(analysis(), { transcript: '[00:05] read the sentences', language: 'en', teacherName: 'Annie' });
    expect(p).toContain('Moves missed or partial');
    expect(p).toContain(PLAN_MOVE);
  });
});

describe('the line as it renders', () => {
  const vm = (lang, groups) => ({
    language: lang, brand: 'niete', teacherName: 'Annie', topic: 'x', date: '2026-11-13',
    score: { overall: 52, marks: 66, max: 140 },
    groups, narrative: { affirmation: 'x', moments: [] }, trend: [],
  });

  test.each(['en', 'ur'])('%s: both sentences paint inside the Section B why line', (lang) => {
    const groups = buildFicoGroups(analysis(), lang);
    attachDomainWhys(groups, { lesson_plan_fidelity: MODEL_WHY });
    note().attachLessonMismatchNote(groups, analysis(), DC, lang);
    const html = buildHeroReportHtml(vm(lang, groups));
    expect(html).toContain('class="sc-why"');
    expect(html).toContain('nouns sorting step');
    const line = resolveUx('reportLpMismatchSoft', { language: lang });
    expect(html).toContain(lang === 'en' ? 'Perhaps the lesson plan you chose was for a different lesson?' : line.split(' ').slice(0, 4).join(' '));
    if (lang === 'ur') expect(html).toMatch(/<html dir="rtl"/);
  });
});

describe('generateHeroReport puts the line on the image', () => {
  jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []) }));
  jest.mock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
  jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn(async () => Buffer.from('png')) }));

  async function render(session, a) {
    jest.resetModules();
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
      generateReportNarrative: jest.fn(async () => ({ affirmation: 'x', moments: [], domain_whys: { lesson_plan_fidelity: MODEL_WHY } })),
    }));
    const { htmlToImage } = require('../../bot/shared/utils/html-to-pdf');
    htmlToImage.mockClear();
    const { generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    await generateHeroReport({ ...session, transcript_text: 't', created_at: '2026-11-13' }, a, { teacherName: 'Annie', language: 'en', brand: 'niete' });
    return htmlToImage.mock.calls[0][0];
  }

  test('a flagged Digital Coach report: the model\'s why and the line', async () => {
    const html = await render(DC, analysis());
    expect(html).toContain('nouns sorting step');
    expect(html).toContain('Perhaps the lesson plan you chose was for a different lesson?');
  });

  test('an unflagged report and a coach visit: no line', async () => {
    expect(await render(DC, analysis({ note: null }))).not.toContain('Perhaps the lesson plan');
    expect(await render(VISIT, analysis())).not.toContain('Perhaps the lesson plan');
  });
});

describe('the portal report page (groups C and D read Section B here)', () => {
  const { buildReportView } = require('../../dashboard/services/coaching-report-view');
  const view = (session, lang = 'en') => buildReportView({
    session: { ...session, created_at: '2026-11-13T05:00:00Z', analysis_data: { ...session.analysis_data, report_narrative: { domain_whys: { lesson_plan_fidelity: MODEL_WHY } } } },
    firstName: 'Annie', language: lang, trend: [],
  });
  const b = (v) => v.sections.find((s) => s.key === 'lesson_plan_fidelity');

  test.each(['en', 'ur'])('%s: a flagged recording shows the stored why and the line', (lang) => {
    const v = view({ ...DC, analysis_data: analysis() }, lang);
    expect(b(v).why).toBe(`${MODEL_WHY} ${resolveUx('reportLpMismatchSoft', { language: lang })}`);
  });

  test('unflagged, and a coach visit: the stored why only', () => {
    expect(b(view({ ...DC, analysis_data: analysis({ note: null }) })).why).toBe(MODEL_WHY);
    expect(b(view({ ...VISIT, analysis_data: analysis() })).why).toBe(MODEL_WHY);
  });

  // The real loader, against a fake database that, like PostgREST, returns only the columns asked for:
  // if the page never selects observation_type, every coach visit reads as her own recording.
  function fakeDb(row) {
    const pick = (cols) => {
      if (!cols || cols.trim() === '*') return { ...row };
      return Object.fromEntries(cols.split(',').map((c) => c.trim()).filter((c) => c in row).map((c) => [c, row[c]]));
    };
    const chain = (data) => {
      const q = {
        eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] || null : data, error: null }),
        then: (res, rej) => Promise.resolve({ data: Array.isArray(data) ? data : [data], error: null }).then(res, rej),
      };
      return q;
    };
    return {
      from: (table) => ({
        select: (cols) => {
          if (table === 'coaching_sessions') return chain(pick(cols));
          if (table === 'users') return chain({ preferred_language: 'en', name: 'Annie Test' });
          return chain(null);
        },
      }),
    };
  }

  test.each([
    ['a flagged Digital Coach recording', DC, true],
    ['a flagged coach visit', VISIT, false],
  ])('through loadReport: %s', async (_label, s, shows) => {
    const { loadReport } = require('../../dashboard/routes/coaching-report.routes');
    const row = { ...s, created_at: '2026-11-13T05:00:00Z', prioritized_action: null, report_pdf_url: null, voice_debrief_url: null,
      analysis_data: { ...analysis(), report_narrative: { domain_whys: { lesson_plan_fidelity: MODEL_WHY } } } };
    const data = await loadReport(fakeDb(row), row.id, row.user_id);
    const why = b(buildReportView(data)).why;
    expect(why.startsWith(MODEL_WHY)).toBe(true);
    expect(why.includes('Perhaps the lesson plan')).toBe(shows);
  });
});
