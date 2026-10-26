'use strict';
/**
 * bd-8hhqhf R7t (ab-ops 20261026T184555 §4, COS 184646): prod's rule-template card stores `indicator` as the label
 * "Name (ID)" (prioritized-action.service.js generatePrioritizedAction; 2,856 of 8,272 FICO cards over 30 days, never a
 * bare id). target.pick read it raw, so the id lookups missed and 10 of 18 shadow rows went to none:unknown_indicator.
 * The card route must read the id out of the label and store the id, never the label.
 */
const T = require('../../../bot/shared/services/coaching/video-reco/target');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const FIX = require('./fixtures/catalog.fixture.json');
const cat = C.fromData(FIX);

// The seven labels ab-ops read off tonight's prod rows (rubric names; no teacher data).
const LABELS = [
  ['Use of Taleemabad Lesson Plan (B7)', 'B7'],
  ['Differentiation / Catering to Learning Levels (B6)', 'B6'],
  ['Instructional Clarity & Learning Objectives (B1)', 'B1'],
  ["Cognitive Engagement Level (Bloom's) (D2)", 'D2'],
  ['Student-to-Student Interaction (D3)', 'D3'],
  ['Self & Peer Assessment Facilitation (C11)', 'C11'],
  ['Use of Prescribed Resources (B8)', 'B8'],
];

function row(id, score) {
  return { id, name: `Name ${id}`, score, applicable: true, evidence: `Quote: "evidence ${id}"`, evidence_summary: `summary ${id}`, timestamp: '[03:10]' };
}
function a37(ids) {
  const dom = (k) => ({ indicators: ids.filter((id) => id[0] === k).map((id) => row(id, 1)) });
  return { framework: 'fico', indicator_scheme: 'fico_main_37', domains: { B: dom('B'), C: dom('C'), D: dom('D'), F: dom('F') } };
}
const ALL = a37(LABELS.map(([, id]) => id));
const card = (indicator) => ({ indicator, action: 'Try one thing tomorrow.', highlights: [] });

describe.each(LABELS)('card label %s', (label, id) => {
  test('picks exactly what the bare id picks', () => {
    expect(T.pick(ALL, { target: null }, card(label), cat)).toEqual(T.pick(ALL, { target: null }, card(id), cat));
  });

  test('stores the id, never the label', () => {
    const t = T.pick(ALL, { target: null }, card(label), cat);
    expect(t.source).toBe('card');
    expect(t.storedIndicator).toBe(id);
    expect(JSON.stringify(t)).not.toContain(label.slice(0, 12));
  });
});

test('B7 and B8 labels end as hole:no_move on the 37 scheme, not unknown_indicator', () => {
  for (const label of ['Use of Taleemabad Lesson Plan (B7)', 'Use of Prescribed Resources (B8)']) {
    expect(T.pick(ALL, { target: null }, card(label), cat).none).toBe('hole:no_move');
  }
});

test('a label whose id is in the catalogue reaches the tag route (none null, an indicator)', () => {
  const t = T.pick(ALL, { target: null }, card('Student-to-Student Interaction (D3)'), cat);
  const bare = T.pick(ALL, { target: null }, card('D3'), cat);
  expect(t.none).toBe(bare.none);
  expect(t.indicator).toBe(bare.indicator);
});

test('a string with no trailing (ID) is left as it is (the template\'s "General improvement")', () => {
  const t = T.pick(ALL, { target: null }, card('General improvement'), cat);
  expect(t.storedIndicator).toBe('General improvement');
  expect(t.none).toBe('unknown_indicator');
});

test('a bare step id is untouched', () => {
  expect(T.pick(ALL, { target: { indicator: 'D3' } }, card('Use of Taleemabad Lesson Plan (B7)'), cat)).toMatchObject({ source: 'step', storedIndicator: 'D3' });
});

// The engine's own card (cardOf) reads the same id, so the stored row carries the id and the step-text, goal-first and
// head-move readers see it too. Harness as r7e-allowlist.test.js.
describe('engine: the stored row', () => {
  const SID = '7c7c7c7c-2a41-4d8e-9a55-3f1c2d4e5f61';
  const UID = '60530046-7ac3-4ea3-a976-b43c37c23214';
  let E;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
  });
  const LINES = [
    { start_ms: 30000, label: 'Teacher', text: 'Is this a triangle? Yes or no, everyone together!' },
    { start_ms: 33000, label: 'Student', text: 'Yes' },
    { start_ms: 36000, label: 'Teacher', text: 'And this one, is it a square? Tell me quickly' },
    { start_ms: 39000, label: 'Student', text: 'No' },
  ];
  const args = (indicator) => ({
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'en' }, diarization_data: { segments: LINES } },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:30]' }] } },
      subject_resolution: { code: 'maths', grade: '3', confidence: 'high' },
    },
    nextStep: { target: null, fallback: null },
    card: { indicator, action: 'Next class, ask two why questions about shapes and wait five seconds.' },
    coachingSessionId: SID,
  });
  const deps = () => {
    const C2 = require('../../../bot/shared/services/coaching/video-reco/catalog');
    return {
      env: { VIDEO_RECO_ENABLED: 'true' },
      catalog: C2.fromData(FIX),
      store: {
        readForSession: jest.fn().mockResolvedValue(null),
        recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
        ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
        trainingBands: jest.fn().mockResolvedValue([]),
        write: jest.fn(async (row) => ({ id: 'rec-1', ...row })),
      },
      v10GroupFor: jest.fn().mockResolvedValue({ group: 'A' }),
      completeJson: jest.fn().mockResolvedValue({
        result: { seg_id: '10-s1', moment: { at: '00:30', quote: 'Is this a triangle? Yes or no, everyone together' },
          reason_en: 'The class could only answer yes or no. The clip shows a teacher asking why and how instead.',
          reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7 },
        usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }),
    };
  };
  const strip = (row) => { const { engine_ms: _, ...rest } = row; return rest; };

  test('a "Quality Questioning (C1)" card stores C1 and gives the bare-id row, byte for byte', async () => {
    const label = await E.recommendForReport({ ...args('Quality Questioning (C1)'), deps: deps() });
    const bare = await E.recommendForReport({ ...args('C1'), deps: deps() });
    expect(label.target_source).toBe('card');
    expect(label.indicator).toBe('C1');
    expect(label.none_reason).not.toBe('unknown_indicator');
    expect(strip(label)).toEqual(strip(bare));
  });

  test('a "Use of Taleemabad Lesson Plan (B7)" card on the 37 scheme stores B7 and ends hole:no_move', async () => {
    const a = args('Use of Taleemabad Lesson Plan (B7)');
    a.analysis.indicator_scheme = 'fico_main_37';
    const row = await E.recommendForReport({ ...a, deps: deps() });
    expect([row.indicator, row.none_reason]).toEqual(['B7', 'hole:no_move']);
  });
});
