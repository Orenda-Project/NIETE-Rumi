/**
 * bd-v0toag.1.5 — the horizon, the try box and the stored focus come from ONE selected step.
 *
 * Live 7 Oct report: horizon "Structured Peer Discussion", try box B6 (_source 'fallback'),
 * stored focus_area C1 — three next steps in one report. This drives the report pipeline with
 * the scorer's focus_area unresolvable (the case that splits them) and checks that the card, the
 * hero's horizon target and the stored focus all name the same indicator, and that the fallback
 * is logged with the session id.
 */
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendImageFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true),
}));
const mockLog = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-ns' }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn(async () => 'https://r2.example/report.png'), uploadReportPDF: jest.fn(async () => 'https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/card.png'), uploadVoiceDebrief: jest.fn(async () => 'https://r2.example/voice.mp3'),
}));
const mockCard = jest.fn(async (analysis, cs, lang, opts) => ({
  _source: 'fallback', commitment: 'c', action: 'a', language: 'ur',
  indicator: opts.target ? `${opts.target.name} (${opts.target.indicator})` : 'Something else (X9)',
}));
jest.mock('../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({ generateCommitmentCard: (...a) => mockCard(...a) }));
jest.mock('../../bot/shared/config/coaching-card.config', () => ({ getCoachingCardCopy: jest.fn(() => ({ commitPrompt: 'Will you try this?', commitButtons: { yes: 'Yes', later: 'Later', no: 'No' }, cardFooter: 'Human Coach' })) }));
jest.mock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: jest.fn(async () => null), loadTrendData: jest.fn(async () => []), loadRecentSectionBModes: jest.fn(async () => []) }));

// The one next step is the new report: groups C and D only, while ab_v10_enabled is on (Amena, 16 Oct).
const mockGroup = jest.fn(async () => ({ group: 'C', plan: 'v9', report: 'new' }));
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: (...a) => mockGroup(...a) }));
jest.mock('../../bot/shared/services/coaching/slim-report', () => ({ slimReportFor: jest.fn(async () => null) }));

const updates = [];
const ok = (id, name, score) => ({ id, name, score, applicable: true });
const ANALYSIS = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 'Instructional Clarity & Learning Objectives', 2), ok('B6', 'Differentiation / Catering to Learning Levels', 0)] },
    high_leverage_practices: { indicators: [{ id: 'C1', name: 'Quality Questioning (Bloom\'s Aligned)', score: null, applicable: false }, ok('C3', 'Effective Feedback', 1)] },
  },
  focus_area: { domain: 'high_leverage_practices', indicator: 'C1', title: 'کھلے سوالات کی مشق', try_this_tomorrow: 'سبق سے ایک open-ended سوال تیار کیا جائے' },
};
const mockSessionRow = {
  id: 'sess-1', user_id: 'user-1', status: 'analysis_complete', created_at: '2026-10-07T00:00:00Z',
  conversation_state: { questions: [] }, analysis_data: ANALYSIS, transcript_language: 'ur',
  users: { phone_number: '+92300FIXTURE1', name: 'Teacher B', region: 'ICT', preferred_language: 'ur' },
};
jest.mock('../../bot/shared/config/supabase', () => {
  const makeChain = () => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.single = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.maybeSingle = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.update = jest.fn((payload) => { updates.push(payload); return chain; });
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn(() => makeChain()) };
});

const RG = require('../../bot/shared/services/coaching/report-generator.service');

beforeEach(() => {
  updates.length = 0; jest.clearAllMocks();
  mockGroup.mockResolvedValue({ group: 'C', plan: 'v9', report: 'new' });
  jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue(JSON.parse(JSON.stringify(ANALYSIS)));
  jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
  jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(true);
  jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
});
afterEach(() => { jest.restoreAllMocks(); });

describe('one next step across the report', () => {
  test('the card, the horizon target and the stored focus name the same indicator', async () => {
    await RG.generateReport('sess-1', { from: '+92300FIXTURE1' });

    const cardTarget = mockCard.mock.calls[0][3].target;
    expect(cardTarget && cardTarget.indicator).toBe('B6');

    const pdfArgs = RG.generatePDFReport.mock.calls[0];
    // staging: no uptake-loop param, so nextStep is the 5th argument (sandbox: 6th, after loop).
    const step = pdfArgs[4];
    expect(step && step.target && step.target.indicator).toBe('B6');

    const stored = updates.map((u) => u.analysis_data).filter((a) => a && a.focus_area_scorer).pop();
    expect(stored).toBeDefined();
    expect(stored.focus_area.indicator).toBe('B6');
    expect(stored.focus_area_scorer.indicator).toBe('C1');
    // The analysis the hero renders is the aligned one too.
    expect(pdfArgs[2].focus_area.indicator).toBe('B6');

    const written = updates.map((u) => u.prioritized_action).filter(Boolean).pop();
    expect(written.indicator).toContain('(B6)');
  });

  test('the fallback is logged with the session id and why', async () => {
    await RG.generateReport('sess-1', { from: '+92300FIXTURE1' });
    const hit = mockLog.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes('[next-step]') && msg.includes('fallback —'));
    expect(hit).toBeDefined();
    expect(hit[1]).toMatchObject({ coachingSessionId: 'sess-1', reason: 'focus_area_invalid', scorer_indicator: 'C1', indicator: 'B6' });
  });

  test('the rule-based card is logged as a fallback with the session id', async () => {
    await RG.generateReport('sess-1', { from: '+92300FIXTURE1' });
    const hit = mockLog.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes('[next-step]') && msg.includes('rule-based'));
    expect(hit).toBeDefined();
    expect(hit[1]).toMatchObject({ coachingSessionId: 'sess-1', indicator: 'B6' });
  });

  test('a valid focus_area: no rewrite, no fallback log, the card still gets the target', async () => {
    const good = JSON.parse(JSON.stringify(ANALYSIS));
    good.focus_area = { domain: 'high_leverage_practices', indicator: 'C3', try_this_tomorrow: 'ہر غلط جواب کے بعد اگلا قدم بتائیں۔' };
    RG.enhanceAnalysisWithReflections.mockResolvedValue(good);
    await RG.generateReport('sess-1', { from: '+92300FIXTURE1' });
    expect(mockCard.mock.calls[0][3].target.indicator).toBe('C3');
    expect(RG.generatePDFReport.mock.calls[0][4].target.indicator).toBe('C3');
    expect(updates.some((u) => u.analysis_data && u.analysis_data.focus_area_scorer)).toBe(false);
    expect(mockLog.mock.calls.some(([m]) => typeof m === 'string' && m.includes('[next-step]') && m.includes('fallback —'))).toBe(false);
  });
});

describe('only groups C and D get the one next step', () => {
  const todays = async (group) => {
    mockGroup.mockResolvedValue(group);
    await RG.generateReport('sess-1', { from: '+92300FIXTURE1' });
    expect(mockGroup).toHaveBeenCalledWith('user-1');
    // Today's report: the card chooses as before, the horizon has no pinned step, the scorer's focus stays.
    expect(mockCard.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockCard.mock.calls) expect(call[3].target).toBeNull();
    const step = RG.generatePDFReport.mock.calls[0][4];
    expect(step && step.target).toBeFalsy();
    expect(updates.some((u) => u.analysis_data && u.analysis_data.focus_area_scorer)).toBe(false);
    expect(RG.generatePDFReport.mock.calls[0][2].focus_area.indicator).toBe('C1');
    expect(mockLog.mock.calls.some(([m]) => typeof m === 'string' && m.includes('[next-step]'))).toBe(false);
  };

  test('group A: today\'s report', () => todays({ group: 'A', plan: 'v9', report: 'today' }));
  test('group B: today\'s report', () => todays({ group: 'B', plan: 'v10', report: 'today' }));
  test('switch off or school not drawn (null): today\'s report', () => todays(null));

  test('group D gets it too', async () => {
    mockGroup.mockResolvedValue({ group: 'D', plan: 'v10', report: 'new' });
    await RG.generateReport('sess-1', { from: '+92300FIXTURE1' });
    expect(mockCard.mock.calls[0][3].target.indicator).toBe('B6');
  });
});

describe('generatePDFReport puts the selected step on the hero input', () => {
  const SRC = require('fs').readFileSync(require.resolve('../../bot/shared/services/coaching/report-generator.service'), 'utf8');
  test('the hero target reads the passed step first', () => {
    const body = SRC.slice(SRC.indexOf('static async generatePDFReport'));
    expect(body).toMatch(/static async generatePDFReport\([^)]*nextStep/);
    expect(body).toMatch(/target:\s*\(nextStep && nextStep\.target\)/);
  });
});
