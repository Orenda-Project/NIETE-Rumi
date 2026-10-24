'use strict';
/**
 * bd-8hhqhf R7o-b (COS 20261024T194233 §3; panel v10 Z020 Z135: 71-s2, paragraph writing, sent on «model» / a board
 * prompt). ped-scale's route gate for module 71 (ped/vetoes.json, 210438; probes from gate_71_route_gate.json, unchanged):
 * 71 never serves the card_text route unless the card's own indicator is F10/F2/C2/C4 (37 scheme) AND the card is a
 * writing task. Carried into the shipped catalogue as build-catalog.js carries a route_gate (as 128/122/75, R7l).
 */
const SHIPPED = require('../../../bot/shared/data/video-catalog.v1.json');

let SH;
let C;
let E;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  SH = require('../../../bot/shared/services/coaching/video-reco/shortlist');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
});
const m71 = () => SHIPPED.modules.find((m) => m.module_id === 71);
const MUST = [
    "model a paragraph on the board with a topic sentence and three details",
    "have each child write a short paragraph about my school",
    "ask students to write a letter to a friend",
    "teach the leave application to the principal",
    "make an outline, then model the paragraph",
    "complete three sentences using the sentence starters on the board",
    "paragraph writing in pairs: first, next, finally",
    "پیراگراف لکھوائیں",
    "بچوں سے ایک خط لکھوائیں",
    "درخواست لکھنا سکھائیں",
    "مضمون 'میرا اسکول' لکھیں",
    "sentence starters کے ساتھ جملے لکھ",
    "پیراگراف کا خاکہ بورڈ پر بنائیں"
  ];
const MUST_NOT = [
    "write two 'why/how' prompts (e.g., 'Why is this adjective a good choice?'), give 10 seconds wait time, and model one answer",
    "name the mix-up in one sentence, then hold up the leaf chart or seed picture while giving a clear one-line correct model",
    "model one answer",
    "write the goal on the board",
    "write two open-ended questions on the board and wait 5 seconds",
    "ask one student to write the answer on the board",
    "read the paragraph aloud and ask why the boy was sad",
    "after each paragraph ask one open-ended question",
    "ہر پیراگراف کے بعد ایک open-ended سوال پوچھیں",
    "ایک sentence میں بتائیں",
    "اس لفظ سے ایک جملہ بناؤ",
    "جملے بولیں",
    "write the date and day on the board",
    "letter sounds ت اور س کی pair practice",
    "model think-pair-share for one minute",
    "tell a story about the market, then ask why",
    "کہانی سنائیں اور پوچھیں",
    "write 12574 + 3 on the board and ask one reason it is correct",
    "ask them to write one sentence: today's two key points",
    "have the speaker report one full sentence"
  ];

test('module 71 carries a card_text route gate in the shipped catalogue', () => {
  expect(m71().route_gate).toMatchObject({ deny_routes: ['card_text'] });
});
test.each(MUST)('a writing task on an F2 card passes: %s', (text) => {
  expect(SH.routeGateOk(m71(), { indicator: 'F2', scheme: 'fico_main_37', text })).toBe(true);
});
test.each(MUST_NOT)('not a writing task: refused even on an F2 card: %s', (text) => {
  expect(SH.routeGateOk(m71(), { indicator: 'F2', scheme: 'fico_main_37', text })).toBe(false);
});
test('a writing task on a card whose own indicator is not allowed (C1) is refused', () => {
  expect(SH.routeGateOk(m71(), { indicator: 'C1', scheme: 'fico_main_37', text: MUST[0] })).toBe(false);
});

describe('engine, card mode: Z020\'s shape never reaches 71', () => {
  const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
  const LINES = [T('01:00', 'Teacher', 'Noun aur adjective kya hota hai? Batao.'), T('01:04', 'Student', 'Naming word'), T('01:08', 'Teacher', 'Good. Big apple, big kya hai?'), T('01:12', 'Student', 'Adjective'),
    T('01:16', 'Teacher', 'Sab likho copy mein.'), T('01:20', 'Student', 'Jee'), T('01:24', 'Teacher', 'Red car, red kya hai?'), T('01:28', 'Student', 'Adjective')];
  test('control (not red on the previous head: this synthetic lesson does not reach 71 there either): F2 card, why prompts + wait + «model one answer» → not 71-s2', async () => {
    const row = await E.recommendForReport({
      session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'en' }, diarization_data: { segments: LINES } },
      analysis: { framework: 'fico', indicator_scheme: 'fico_main_37', domains: {}, subject_resolution: { code: 'english', grade: '3', confidence: 'high' } },
      nextStep: null, card: { indicator: 'F2', action: MUST_NOT[0].replace(/^write/, 'Next class, when launching the noun-adjective pairs activity on the board, write') }, coachingSessionId: 's1',
      deps: { env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_REASON: 'card' }, catalog: C.fromData(SHIPPED), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 4, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null,
        completeJson: async () => { throw new Error('card mode makes no model call'); } },
    });
    expect(row.seg_id).not.toBe('71-s2');
  });
});
