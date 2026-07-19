/**
 * FEAT-053 bd-16/bd-19 — draft freeze, flow send, write-back + annotation.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
  clearState: jest.fn().mockResolvedValue(true),
}));

// chainable supabase mock capturing update payloads
const mockUpdates = [];
let mockSessionRow = null;
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    update: jest.fn((fields) => { mockUpdates.push(fields); return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) }; }),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: mockSessionRow, error: null })),
  })),
}));

const mewaka = require('../../shared/services/coaching/frameworks/mewaka-framework');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveDraft = require('../../shared/services/observe/observe-draft.service');

function fixtureAnalysis() {
  // minimal-but-real MEWAKA shape: every indicator score 2, evidence/improve text
  const { domains } = mewaka.getScoringConstants();
  const analysis = { framework: 'mewaka', language: 'sw', domains: {} };
  Object.entries(domains).forEach(([key, d]) => {
    analysis.domains[key] = {
      indicators: d.indicators.map(ind => ({
        id: ind.id, score: 2, evidence_sw: `ushahidi ${ind.id}`, improvement_sw: `boresha ${ind.id}`,
      })),
    };
  });
  return mewaka.computeScores(analysis);
}

beforeEach(() => {
  mockUpdates.length = 0;
  jest.clearAllMocks();
  mockSessionRow = {
    id: 'sess-1', user_id: 'fo-1', observer_user_id: 'fo-1',
    observation_type: 'leader_observation', debrief_status: 'pending',
    analysis_data: fixtureAnalysis(), autofill_analysis_data: null,
    users: { phone_number: '255785150099', first_name: 'Elisha', preferred_language: 'sw' },
  };
  process.env.OBSERVE_MEWAKA_FLOW_ID = '1234567890';
});

describe('onAnalysisReady', () => {
  test('freezes v1, sets review status, arms state, sends the flow', async () => {
    await ObserveDraft.onAnalysisReady('sess-1', '255785150099');
    const merged = Object.assign({}, ...mockUpdates);
    expect(merged.autofill_analysis_data).toBeTruthy();                    // v1 frozen
    expect(merged.autofill_analysis_data.scores.overall_marks).toBe(50);   // 25×2
    expect(merged.status).toBe('awaiting_observer_review');
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const [to, args] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe('255785150099');
    expect(args.flowId).toBe('1234567890');
    expect(args.flowToken).toBe('fo-1:sess-1');
    const ObserveState = require('../../shared/services/observe/observe-state.service');
    expect(ObserveState.setState).toHaveBeenCalledWith('fo-1', 'awaiting_form',
      expect.objectContaining({ sessionId: 'sess-1' }));
  });

  test('does not re-freeze when v1 already exists', async () => {
    mockSessionRow.autofill_analysis_data = { frozen: true };
    await ObserveDraft.onAnalysisReady('sess-1', '255785150099');
    const merged = Object.assign({}, ...mockUpdates);
    expect(merged.autofill_analysis_data).toBeUndefined();
  });

  test('no flow id configured → text fallback, no crash', async () => {
    process.env.OBSERVE_MEWAKA_FLOW_ID = '';
    await ObserveDraft.onAnalysisReady('sess-1', '255785150099');
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalled();
  });
});

describe('buildScreenPrefill', () => {
  test('maps indicator scores + trimmed texts into s_/e_/i_ bindings', () => {
    const data = ObserveDraft.buildScreenPrefill(mockSessionRow.analysis_data, 'introduction');
    expect(data.s_A1_1).toBe('2');
    expect(data.e_A1_1).toBe('ushahidi A1.1');
    expect(data.i_A1_1).toBe('boresha A1.1');
    expect(Array.isArray(data.scale)).toBe(true);
    expect(data.scale).toHaveLength(4);
  });

  test('caps prefill text at 300 chars (D15)', () => {
    mockSessionRow.analysis_data.domains.introduction.indicators[0].evidence_sw = 'x'.repeat(900);
    const data = ObserveDraft.buildScreenPrefill(mockSessionRow.analysis_data, 'introduction');
    expect(data.e_A1_1.length).toBeLessThanOrEqual(300);
  });

  test('missing indicator tolerated → score 0, empty texts', () => {
    mockSessionRow.analysis_data.domains.introduction.indicators = [];
    const data = ObserveDraft.buildScreenPrefill(mockSessionRow.analysis_data, 'introduction');
    expect(data.s_A1_1).toBe('0');
    expect(data.e_A1_1).toBe('');
  });
});

describe('applyObserverEdits (v2 write-back + annotation)', () => {
  test('edited scores recompute totals; v1 untouched; edit summary counted', async () => {
    mockSessionRow.autofill_analysis_data = JSON.parse(JSON.stringify(mockSessionRow.analysis_data));
    const edits = { r_A1_1: '3', ev_A1_1: 'nili-ona mwenyewe', r_B2_6: '0' }; // 2 rescored, 1 text change
    const result = await ObserveDraft.applyObserverEdits('sess-1', edits);
    const merged = Object.assign({}, ...mockUpdates);
    const v2 = merged.analysis_data;
    expect(v2.domains.introduction.indicators[0].score).toBe(3);
    expect(v2.domains.introduction.indicators[0].evidence_sw).toBe('nili-ona mwenyewe');
    expect(v2.scores.overall_marks).toBe(49);            // 50 +1 -2
    expect(merged.autofill_analysis_data).toBeUndefined(); // v1 never rewritten here
    expect(merged.status).toBe('observer_review_complete');
    expect(result.indicators_rescored).toBe(2);
    expect(result.text_fields_changed).toBe(1);
    expect(v2.observer_edit_summary.indicators_rescored).toBe(2);
  });

  test('no edits → v2 equals v1 totals, zero-change summary', async () => {
    mockSessionRow.autofill_analysis_data = JSON.parse(JSON.stringify(mockSessionRow.analysis_data));
    const result = await ObserveDraft.applyObserverEdits('sess-1', {});
    expect(result.indicators_rescored).toBe(0);
    const merged = Object.assign({}, ...mockUpdates);
    expect(merged.analysis_data.scores.overall_marks).toBe(50);
  });
});
