'use strict';
/**
 * bd-8hhqhf R7k (COS 20261024T044233 §1e; panel v8 Z327 Z348 Z197 Z124): the card's HEAD move decides the clip. Pair talk
 * (50-s2) does not serve a card whose head names another move; a why / open-question head on a C1 card puts 51-s1 first; a
 * feedback head on a C3 card puts 23-s2 first. A head that names no move decides nothing (Z025, r7g.test.js).
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const seg = (id, s, e, title, summary, fico, main37, moves = []) => ({
  seg_id: id, start_s: s, end_s: e, title_en: title, title_ur: 'عنوان', summary_en: summary, moves, fico, keywords: [], symptoms: [], fico_main37: main37,
});
const mod = (id, summary, segments) => ({ ...FIXTURE.modules[0], module_id: id, title: `Module ${id}`, format: 'talking_head', summary_en: summary, language: 'ur', segments });
// the real chapters' moves and tags (as r7g.test.js)
const DATA = {
  ...FIXTURE,
  holes: [],
  modules: [
    ...FIXTURE.modules,
    mod(50, 'Think-pair-share.', [seg('50-s2', 60, 115, 'Think-pair-share in three steps', 'Think alone, discuss with a partner, share with the class.', [{ indicator: 'D3', strength: 2 }], ['C9', 'D3', 'D2', 'F4'], ['think_pair_share', 'student_explains_in_own_words'])]),
    mod(51, 'Getting children thinking.', [seg('51-s1', 0, 52, 'Yes/no question vs. a why question', 'A yes/no question against a why question.', [{ indicator: 'C1', strength: 2 }], ['C1', 'D2'], ['open_questions'])]),
    mod(150, 'A mentor debrief.', [seg('150-s4', 200, 260, "From 'good' to specific feedback and 'why?'", 'A mentor asks why do you think after saying good to a wrong answer.', [{ indicator: 'C3', strength: 2 }], ['C3', 'D2', 'C8'], ['specific_feedback', 'ask_for_reasoning', 'professional_growth'])]),
    mod(23, 'Feedback.', [seg('23-s2', 30, 90, 'Two parts: name what went well, then one next step', 'Praise one thing, then give one next step.', [{ indicator: 'C3', strength: 2 }], ['C3'], ['next_step_feedback', 'specific_feedback'])]),
  ],
};

let E;
let C;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
});
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const CLASS = [
  T('01:00', 'Teacher', 'Is this a triangle? Yes or no?'), T('01:03', 'Student', 'Yes'), T('01:06', 'Teacher', 'Is this a square?'),
  T('01:09', 'Student', 'No'), T('01:12', 'Teacher', 'How many sides then?'), T('01:15', 'Student', 'Three'),
  T('01:18', 'Teacher', 'Is it big or small?'), T('01:21', 'Student', 'Big'), T('01:24', 'Teacher', 'Good, next one, is it red?'), T('01:27', 'Student', 'Yes'),
];
async function offered(indicator, action) {
  const prompts = [];
  await E.recommendForReport({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'en' }, diarization_data: { segments: CLASS } },
    analysis: { framework: 'fico', indicator_scheme: 'fico_main_37', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "Is this a triangle? Yes or no"', timestamp: '[01:00]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' }, topic: 'shapes' },
    nextStep: indicator ? { target: { indicator, rung: 1, rationale: 'x', try: action } } : null, card: { indicator, action }, coachingSessionId: 's1',
    deps: { env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(DATA), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null,
      completeJson: async (p) => { prompts.push(p); return { result: { seg_id: null, none_reason: 'test' }, usage: {}, finishReason: 'stop' }; } },
  });
  const p = prompts[0] || '';
  return (p.split('CANDIDATE CLIPS')[1] || '').match(/\b\d{1,3}-s\d+\b/g) || [];
}

test('Z327 shape: a why-probe head that mentions pairs later → 50-s2 not offered, 51-s1 first', async () => {
  const ids = await offered(null, "Next class, after a one-word answer ask 'why do you think so?', then let pairs discuss and share with a partner.");
  expect(ids).not.toContain('50-s2');
  expect(ids[0]).toBe('51-s1');
});
test('Z197/Z124 shape: a feedback head (no indicator, a why later) → 23-s2 first', async () => {
  const ids = await offered(null, "Next class, after each answer name one thing done well and give one next step, then ask 'why do you think so?'.");
  expect(ids[0]).toBe('23-s2');
});
test('a C3 feedback head keeps 23-s2 first', async () => {
  const ids = await offered('C3', 'Next class, when a child answers, name one thing done well and then give one next step.');
  expect(ids[0]).toBe('23-s2');
});
test('control: a pair-talk head keeps 50-s2', async () => {
  const ids = await offered(null, 'Next class, give one minute for pairs to discuss with a partner, then ask two pairs to share.');
  expect(ids).toContain('50-s2');
});
