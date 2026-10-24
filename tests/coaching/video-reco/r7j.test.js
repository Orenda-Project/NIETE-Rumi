'use strict';
/**
 * bd-8hhqhf R7j (COS 20261024T022905 §3; panel v7 ped-scale 022757 §3): the ⛔2 tag-route and word-match picks. Fixture and
 * helpers as r7g.test.js; the real chapters' moves and tags; synthetic lines.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const SID = '7b7b7b7b-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const seg = (id, s, e, title, summary, fico, main37, moves = [], extra = {}) => ({
  seg_id: id, start_s: s, end_s: e, title_en: title, title_ur: 'عنوان', summary_en: summary, moves, fico, keywords: [], symptoms: [], fico_main37: main37, ...extra,
});
const mod = (id, format, summary, language, segments) => ({ ...FIXTURE.modules[0], module_id: id, title: `Module ${id}`, format, summary_en: summary, language, segments, subjects: ['general'] });
const DATA = {
  ...FIXTURE,
  holes: [],
  modules: [
    ...FIXTURE.modules,
    mod(50, 'talking_head', 'x', 'ur', [seg('50-s2', 60, 115, 'Think-pair-share in three steps', 'Think alone, discuss with a partner, share with the class.', [{ indicator: 'D3', strength: 2 }], ['C9', 'D3', 'D2', 'F4'], ['think_pair_share', 'student_explains_in_own_words'])]),
    mod(51, 'mixed', 'x', 'ur', [seg('51-s1', 0, 52, 'Yes/no question vs. a why question', 'A yes/no question against a why question.', [{ indicator: 'C1', strength: 2 }], ['C1', 'D2'], ['open_questions'])]),
    mod(96, 'talking_head', 'x', 'ur', [seg('96-s3', 120, 180, 'Facilitate and keep the noise productive', 'Keep group noise productive while groups work.', [{ indicator: 'D1', strength: 1 }], ['C9', 'D3', 'C12', 'C7', 'C6', 'B9'], ['group_work', 'positive_behaviour', 'routines'], { keywords: ['feedback', 'student', 'talk'] })]),
    mod(148, 'talking_head', 'x', 'ur', [seg('148-s5', 200, 260, 'Build a 4-level rubric with clear descriptors', 'A rubric with four levels and descriptors.', [{ indicator: 'C3', strength: 2 }], ['C3', 'C11'], ['assessment_design', 'specific_feedback', 'next_step_feedback'], { keywords: ['feedback', 'answer', 'detail'] })]),
    mod(11, 'slides', 'x', 'ur', [seg('11-s5', 300, 360, "Closure: exit ticket, quick quiz, 'what did you learn today?'", 'Exit ticket and quick quiz at the end.', [{ indicator: 'B7', strength: 1 }], ['B10', 'C2', 'C3'], ['closure_check', 'check_understanding'], { keywords: ['practice', 'sheets', 'exit', 'ticket'] })]),
    mod(47, 'slides', 'x', 'ur', [
      seg('47-s1', 0, 60, 'Write a clear, measurable SLO', 'Write the learning objective.', [{ indicator: 'B1', strength: 2 }], ['B1', 'B2', 'B3', 'B7'], ['state_objective', 'lesson_planning']),
      seg('47-s3', 120, 180, 'Step 2: explain with a two-column board', 'Explain with a two-column board.', [{ indicator: 'B2', strength: 1 }], ['B1', 'B2', 'B3', 'B7', 'C2', 'B8', 'D6'], ['lesson_planning', 'teaching_aids']),
    ]),
  ],
};

let E;
let C;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
});

const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const CLASS = [
  T('01:00', 'Teacher', 'Is this a triangle? Yes or no?'), T('01:03', 'Student', 'Yes'), T('01:06', 'Teacher', 'Is this a square?'),
  T('01:09', 'Student', 'No'), T('01:12', 'Teacher', 'Spell triangle.'), T('01:15', 'Student', 'T R I'),
];
function args({ lines = CLASS, lang = 'en', action, indicator, subject = 'maths', scheme = 'fico_main_37', row } = {}) {
  return {
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: lines } },
    analysis: { framework: 'fico', indicator_scheme: scheme, domains: { X: { indicators: [row || { id: indicator || 'C1', name: 'x', score: 1, applicable: true, evidence: 'x', timestamp: '[01:00]' }] } }, subject_resolution: { code: subject, grade: '3', confidence: 'high' }, topic: 'shapes' },
    nextStep: indicator ? { target: { indicator, rung: 1, rationale: 'x', try: action } } : null,
    card: { indicator: indicator || null, action },
    coachingSessionId: SID,
  };
}
const answer = (over = {}) => ({ seg_id: '51-s1', moment: { at: '01:00', quote: 'Is this a triangle? Yes or no?' }, reason_en: 'The class only answered yes or no. The clip explains why questions.', reason_ur: 'کلاس نے صرف ہاں یا نہیں کہا؛ یہ کلپ کیوں والے سوال سمجھاتا ہے۔', confidence: 0.7, ...over });
const SHORT = (segId) => (p) => answer({ seg_id: p.includes(segId) ? segId : '51-s1', moment: { at: '01:03', quote: 'Yes' } });
function deps(answers) {
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockImplementationOnce(async (p) => ({ result: typeof a === 'function' ? a(p) : a, usage: {}, finishReason: 'stop' })));
  completeJson.mockResolvedValue({ result: { seg_id: null, none_reason: 'no more answers' }, usage: {}, finishReason: 'stop' });
  return {
    env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(DATA),
    store: { readForSession: jest.fn().mockResolvedValue(null), recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }), ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }), trainingBands: jest.fn().mockResolvedValue([]), write: jest.fn(async (row) => ({ id: 'rec-1', ...row })) },
    v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }), completeJson,
  };
}
const run = (a, d) => E.recommendForReport({ ...a, deps: d });
const listed = (d) => d.completeJson.mock.calls.map((c) => (c[0].split('CANDIDATE CLIPS')[1] || '').split('RULES')[0]).join('\n');

describe('3a · modules 96 (group projects) and 148 (assessment rubrics) need their moment in the excerpt for C/D cards (Z192 Z392 Z235)', () => {
  test('Z192 shape: a D3 label card on a lesson with no group work never meets 96-s3', async () => {
    const d = deps([answer({ seg_id: '50-s2' })]);
    await run(args({ indicator: 'D3', action: 'اگلی کلاس کے 5 منٹ Student-to-Student Interaction بہتر کرنے کے لیے مخصوص کریں۔' }), d);
    expect(d.completeJson).toHaveBeenCalled();
    expect(listed(d)).not.toContain('96-s3');
  });
  test('control: the same card on a lesson where groups work keeps 96-s3', async () => {
    const lines = [...CLASS, T('01:20', 'Teacher', 'Now work in your groups and discuss the shape with your group.'), T('01:24', 'Student', 'Okay teacher')];
    const d = deps([answer({ seg_id: '50-s2' })]);
    await run(args({ indicator: 'D3', action: 'اگلی کلاس کے 5 منٹ Student-to-Student Interaction بہتر کرنے کے لیے مخصوص کریں۔', lines }), d);
    expect(listed(d)).toContain('96-s3');
  });
  test('Z392 shape: a C11 one-sentence feedback card never meets 148-s5 on a lesson with no assessment', async () => {
    const d = deps([answer()]);
    await run(args({ indicator: 'C11', action: "When a student answers, give feedback: 'Good start! Add one more detail to make it better.'" }), d);
    expect(listed(d)).not.toContain('148-s5');
  });
});

describe('3b · the card frame reads the card\'s HEAD move, not any move word in it (Z363)', () => {
  test('Z363 shape: a two-sheets card with «exit ticket» as the assigning detail → no frame on 11-s5', async () => {
    const action = 'Next class, when students move to independent practice on area, hand out two labeled practice sheets (A: guided hints; B: stretch challenge) and assign by table or quick exit ticket.';
    const row = await run(args({ action }), deps([SHORT('11-s5'), SHORT('11-s5')]));
    expect(row.seg_id || null).not.toBe('11-s5');
  });
  test('control: a closing card that leads with the exit ticket keeps 11-s5', async () => {
    const action = 'Next class, end with a quick exit ticket: ask each child to write one thing they learned about area.';
    const row = await run(args({ action }), deps([SHORT('11-s5'), SHORT('11-s5')]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '11-s5', moment_source: 'card' });
  });
  test('unit: headClause drops the when-clause and stops at the first clause break', () => {
    const S = require('../../../bot/shared/services/coaching/video-reco/select');
    expect(S.headClause('Next class, when students move to practice, hand out two sheets (A: hints; B: stretch) and assign by exit ticket.')).toBe('hand out two sheets (A');
    expect(S.headClause('اگلی کلاس میں جب بچہ اٹکے، فوراً جواب بتانے کے بجائے پانچ سیکنڈ رکیں؛ پھر کیوں پوچھیں۔')).toBe('فوراً جواب بتانے کے بجائے پانچ سیکنڈ رکیں');
  });
});

describe('3c · a D6/B1 goal-on-board card goes to 47-s1 (write the objective), not 47-s3 (Z001 Z218)', () => {
  test('Z001 shape: «write the main learning goal on the board» → 47-s1 is offered, 47-s3 is not', async () => {
    const d = deps([answer({ seg_id: '47-s1' })]);
    await run(args({ indicator: 'D6', action: 'Before class, write the main learning goal on the board where all students can see it throughout the lesson.' }), d);
    expect(listed(d)).toContain('47-s1');
    expect(listed(d)).not.toContain('47-s3');
  });
  test('Z218 shape (Urdu)', async () => {
    const d = deps([answer({ seg_id: '47-s1' })]);
    await run(args({ indicator: 'D6', action: 'کلاس سے پہلے بورڈ پر main learning goal لکھیں، تاکہ تمام طلبہ پورے سبق کے دوران اسے دیکھ سکیں۔' }), d);
    expect(listed(d)).not.toContain('47-s3');
  });
});
