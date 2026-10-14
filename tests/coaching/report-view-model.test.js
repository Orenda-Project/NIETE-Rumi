'use strict';
/**
 * v10 coaching test (bd-v0toag.55): the report page's data, shaped to Amena's ICT-3 template.
 * Pure: session row + teacher + past scores in, what the card and the detailed screen show out.
 */
const { buildReportView, stepOf, colourOf } = require('../../dashboard/services/coaching-report-view');

const DOMAINS = {
  lesson_plan_fidelity: { domain_score: 26, domain_max: 40 },
  high_leverage_practices: { domain_score: 37, domain_max: 48 },
  student_engagement: { domain_score: 22, domain_max: 28 },
  teacher_subject_knowledge: { domain_score: 5, domain_max: 32 },
};
const SESSION = {
  id: 's1',
  created_at: '2026-10-19T05:30:00Z',
  analysis_data: {
    framework: 'fico', grade: 2, subject: 'Maths', topic: 'Adding tens',
    scores: { overall_percentage: 61, overall_marks: 90, overall_max_marks: 148 },
    domains: DOMAINS,
    strengths: [{ title: 'Clear board work' }, 'Called children by name', { title: 'Kept the plan order' }],
    report_narrative: { domain_whys: { lesson_plan_fidelity: 'You kept the order but the game was not played.' } },
    lp_fidelity: {
      status: 'ok',
      strengths: [{ move_id: 'm4', text: 'Count in tens with sticks', evidence: 'used fingers' }],
      moves: [
        { move_id: 'm2', phase: 'warm_up', text: 'Sing the tens song' },
        { move_id: 'm6', phase: 'guided', text: 'In pairs, solve Q1' },
      ],
    },
  },
  prioritized_action: { action: 'Ask two children by name.', thing_to_try: { move_id: 'm6', text: 'In pairs, solve Q1', tag: 'C9' } },
  report_pdf_url: 'https://r2.example.com/r.png',
  voice_debrief_url: 'https://r2.example.com/v.ogg',
};
const TREND = [
  { created_at: '2026-09-20T05:00:00Z', pct: 40 },
  { created_at: '2026-10-01T05:00:00Z', pct: 72 },
  { created_at: '2026-10-19T05:30:00Z', pct: 61 },
];

const view = (over = {}) => buildReportView({ session: SESSION, firstName: 'Sadia', language: 'en', trend: TREND, quizMessage: 'quiz', ...over });

test('header: first name, grade · subject · topic, PKT date, score and marks', () => {
  const v = view();
  expect(v.header).toEqual({ name: 'Sadia', meta: 'Grade 2 · Maths · Adding tens', date: '19 Oct 2026', pct: 61, marks: 90, max: 148 });
  expect(view({ language: 'ur' }).header.meta).toBe('جماعت 2 · Maths · Adding tens');
});

test('did well: a better swap comes first as a strength, then the grader\'s strengths, three at most', () => {
  expect(view().wells).toEqual(['You did “Count in tens with sticks” your own way, and it worked better.', 'Clear board work', 'Called children by name']);
  expect(view({ language: 'ur' }).wells[0]).toContain('Count in tens with sticks');
});

test('thing to try: the move, why it matters, and the step its move sits in', () => {
  const t = view().thing;
  expect(t.text).toBe('In pairs, solve Q1');
  expect(t.why).toMatch(/partner/i);
  expect(t.step).toEqual({ name: 'We Do', index: 3 });
});

test('thing to try falls back to the action, with no why or step; neither: null', () => {
  const s = { ...SESSION, prioritized_action: { action: 'Ask two children by name.' } };
  expect(view({ session: s }).thing).toEqual({ text: 'Ask two children by name.', why: null, step: null });
  expect(view({ session: { ...SESSION, prioritized_action: null } }).thing).toBeNull();
});

test('step chip by phase; an unknown phase has no chip', () => {
  expect(stepOf('warm_up')).toEqual({ name: 'Opening', index: 1 });
  expect(stepOf('explain')).toEqual({ name: 'Explanation', index: 2 });
  expect(stepOf('independent')).toEqual({ name: 'You Do', index: 4 });
  expect(stepOf('exit')).toEqual({ name: 'Check', index: 5 });
  expect(stepOf('preview')).toBeNull();
});

test('sections: the four FICO sections in order, score/max/pct, colour, and the stored why', () => {
  const s = view().sections;
  expect(s.map((x) => x.name)).toEqual(['Lesson Plan Fidelity', 'High-Leverage Practices', 'Student Engagement', 'Teacher Subject Knowledge']);
  expect(s[0]).toMatchObject({ score: 26, max: 40, pct: 65, colour: 'amber', why: 'You kept the order but the game was not played.' });
  expect(s[2]).toMatchObject({ pct: 79, colour: 'green', why: null });
  expect(s[3]).toMatchObject({ pct: 16, colour: 'red' });
  expect(view({ language: 'ur' }).sections[0].name).toBe('Lesson Plan Fidelity (سبق کے منصوبے پر عمل)');
});

test('a section marked not assessed has no number and no bar', () => {
  const a = { ...SESSION.analysis_data, domains: { ...DOMAINS, lesson_plan_fidelity: { assessed: false, domain_score: 30, domain_max: 40 } } };
  expect(view({ session: { ...SESSION, analysis_data: a } }).sections[0]).toMatchObject({ score: null, pct: null, colour: null, notAssessed: true });
});

test('colour bands: 75 green, 60 amber, below red', () => {
  expect([colourOf(75), colourOf(74), colourOf(60), colourOf(59)]).toEqual(['green', 'amber', 'amber', 'red']);
});

test('journey: first, best and this lesson; fewer than two points: no journey', () => {
  expect(view().journey).toMatchObject({ first: 40, best: 72, now: 61, points: [40, 72, 61] });
  expect(view({ trend: TREND.slice(2) }).journey).toBeNull();
});

test('quiz, voice and report image pass through; a non-https url is dropped', () => {
  const v = view({ session: { ...SESSION, voice_debrief_url: 'http://x/v.ogg' } });
  expect(v.quizMessage).toBe('quiz');
  expect(v.voice).toBeNull();
  expect(v.report).toBe('https://r2.example.com/r.png');
});

test('missing pieces are left out, never invented', () => {
  const v = buildReportView({ session: { id: 's', created_at: 'x' }, language: 'xx' });
  expect(v.language).toBe('en');
  expect(v.header).toEqual({ name: '', meta: '', date: '', pct: null, marks: null, max: null });
  expect(v.wells).toEqual([]);
  expect(v.sections).toEqual([]);
  expect(v.journey).toBeNull();
  expect(v.quizMessage).toBeNull();
});
