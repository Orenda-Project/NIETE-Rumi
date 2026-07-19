/**
 * FEAT-053 bd-22 — startDebrief orchestration: authz, status guard, guide
 * build (LLM → validate → fallback), two-message delivery, state arm.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn(),
}));

// Two query shapes: session load (.eq('id').single()) and previous-session
// lookup (.eq×3 .neq .order .limit). Route by table+select args.
const mockSingle = jest.fn();
const mockPrevLimit = jest.fn().mockResolvedValue({ data: [], error: null });
function mockMakeChain() {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'order']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.single = mockSingle;
  chain.limit = mockPrevLimit;
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => mockMakeChain()),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const { startDebrief, clearStateAfterSubmit, armDebriefAudio } = require('../../shared/services/observe/observe-debrief.service');

const SID = 'sess-42';
const FO = { id: 'fo-uuid-1', preferred_language: 'sw' };
const FROM = '255785150099';

const sessionRow = (over = {}) => ({
  id: SID,
  observer_user_id: 'fo-uuid-1',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  analysis_data: {
    framework: 'mewaka',
    strengths: [{ title_sw: 'Zana halisi', evidence_sw: 'Alitumia vijiti kufundisha' }],
    focus_area_sw: {
      indicator: 'C3.7', title_sw: 'Maswali ya kufikirisha',
      rationale_sw: 'Wanafunzi hawakueleza mawazo yao',
      try_this_tomorrow_sw: 'Uliza "Umejuaje?" na usubiri',
      lever_question_sw: 'Ungejuaje kama wameelewa?',
    },
    notable_moments: [{ timestamp: '12:40', quote: 'Kwa nini?', significance_sw: 'x' }],
    scores: { overall_marks: 40, overall_max_marks: 75, overall_percentage: 53.3 },
  },
  ...over,
});

const llmGuide = () => ({
  intro: 'Mwongozo wako.',
  steps: [
    { n: 1, title: 'Fungua kwa nia', body: 'b', say_this: 'Asante kwa kunikaribisha.' },
    { n: 2, title: 'Sifa yenye ushahidi', body: 'b', say_this: 'Nilipenda vijiti vyako.' },
    { n: 3, title: 'Swali, kisha subira', body: 'b', say_this: 'Unaonaje somo lilikwendaje?' },
    { n: 4, title: 'Jambo MOJA', body: 'b', say_this: 'Vipi ukiuliza "Umejuaje?" kesho?' },
    { n: 5, title: 'Ahadi ya kama–basi', body: 'b', say_this: 'Lini utajaribu?' },
    { n: 6, title: 'Panga kurejea', body: 'b', say_this: 'Nirudi Alhamisi?' },
  ],
  outro: 'Sifa moja na jaribio moja tu.',
});

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does not reset mockResolvedValue — restore a clean default
  // so a per-test getState override never bleeds into the next test.
  ObserveState.getState.mockResolvedValue(null);
  mockSingle.mockResolvedValue({ data: sessionRow(), error: null });
  mockPrevLimit.mockResolvedValue({ data: [], error: null });
  GPT5MiniService.completeJson.mockResolvedValue({ result: llmGuide(), usage: {} });
});

describe('startDebrief', () => {
  test('happy path: guide message + recording instruction, state armed with sessionId', async () => {
    await startDebrief(SID, FROM, FO);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    const [guideMsg, recordMsg] = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(guideMsg).toContain('1️⃣');
    expect(guideMsg).toContain('Asante kwa kunikaribisha');
    expect(recordMsg).toMatch(/rekodi|🎙/i);
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-uuid-1', 'awaiting_debrief_audio', expect.objectContaining({ sessionId: SID }));
  });

  test('authz: another observer\'s session → denial, no guide, no state', async () => {
    mockSingle.mockResolvedValue({ data: sessionRow({ observer_user_id: 'other-fo' }), error: null });
    await startDebrief(SID, FROM, FO);
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(ObserveState.setState).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1); // the denial only
  });

  test('debrief already done → already-done ack, no state', async () => {
    mockSingle.mockResolvedValue({ data: sessionRow({ debrief_status: 'done' }), error: null });
    await startDebrief(SID, FROM, FO);
    expect(ObserveState.setState).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('LLM failure → deterministic fallback guide still delivered + state armed', async () => {
    GPT5MiniService.completeJson.mockRejectedValue(new Error('llm down'));
    await startDebrief(SID, FROM, FO);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    const guideMsg = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(guideMsg).toContain('vijiti');           // v2 evidence survives into fallback
    expect(guideMsg).not.toMatch(/40\s*\/\s*75|53/); // still score-free
    expect(ObserveState.setState).toHaveBeenCalled();
  });

  test('LLM output violating gates (score leak) → fallback used', async () => {
    const bad = llmGuide();
    bad.steps[3].say_this = 'Ulipata alama 40/75 — hebu tuboreshe.';
    GPT5MiniService.completeJson.mockResolvedValue({ result: bad, usage: {} });
    await startDebrief(SID, FROM, FO);
    const guideMsg = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(guideMsg).not.toMatch(/40\s*\/\s*75/);
    expect(ObserveState.setState).toHaveBeenCalled();
  });

  test('cross-session closure DEFERRED to P3 (D28): older sessions never seed the prompt — teacher identity does not exist yet', async () => {
    mockPrevLimit.mockResolvedValue({
      data: [{
        id: 'sess-old',
        analysis_data: { focus_area_sw: { title_sw: 'Ushirikishwaji wa wanafunzi', try_this_tomorrow_sw: 'Kazi za vikundi' } },
      }],
      error: null,
    });
    await startDebrief(SID, FROM, FO);
    const prompt = GPT5MiniService.completeJson.mock.calls[0][0];
    // Another observation = (usually) another TEACHER — "last time you said…"
    // would attribute someone else's commitment. Ships with P3 teacher linkage.
    expect(prompt).not.toContain('Ushirikishwaji wa wanafunzi');
    expect(prompt).not.toContain('ZIARA ILIYOPITA');
  });

  test('session load failure → graceful error message, nothing else', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await startDebrief(SID, FROM, FO);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(ObserveState.setState).not.toHaveBeenCalled();
  });

  test('double-tap idempotency: already armed for THIS session → re-send guide+nudge from snapshot, no new LLM call', async () => {
    ObserveState.getState.mockResolvedValue({
      state: 'awaiting_debrief_audio', sessionId: SID, guide_snapshot: llmGuide(),
    });
    await startDebrief(SID, FROM, FO);
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(ObserveState.setState).not.toHaveBeenCalled();  // no re-arm churn
    // re-verify fix: re-send the GUIDE (from snapshot) + the nudge, so a
    // silently-failed first send is repaired, not just re-nudged
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(2);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toContain('1️⃣');
  });

  test('armed for a DIFFERENT session → still builds this one (not blocked)', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: 'other' });
    await startDebrief(SID, FROM, FO);
    expect(GPT5MiniService.completeJson).toHaveBeenCalled();
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-uuid-1', 'awaiting_debrief_audio', expect.objectContaining({ sessionId: SID }));
  });
});

describe('clearStateAfterSubmit (review fix — never wipe a live debrief)', () => {
  test('no live debrief state → clears normally', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_form', sessionId: SID });
    const cleared = await clearStateAfterSubmit('fo-uuid-1', SID);
    expect(cleared).toBe(true);
    expect(ObserveState.clearState).toHaveBeenCalledWith('fo-uuid-1');
  });

  test('awaiting_debrief_audio for a DIFFERENT session → state left armed, NOT cleared', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: 'other-session' });
    const cleared = await clearStateAfterSubmit('fo-uuid-1', SID);
    expect(cleared).toBe(false);
    expect(ObserveState.clearState).not.toHaveBeenCalled();
  });

  test('awaiting_debrief_audio for the SAME session → safe to clear', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: SID });
    const cleared = await clearStateAfterSubmit('fo-uuid-1', SID);
    expect(cleared).toBe(true);
    expect(ObserveState.clearState).toHaveBeenCalledWith('fo-uuid-1');
  });

  test('no state at all → clears (no-op)', async () => {
    ObserveState.getState.mockResolvedValue(null);
    const cleared = await clearStateAfterSubmit('fo-uuid-1', SID);
    expect(cleared).toBe(true);
    expect(ObserveState.clearState).toHaveBeenCalled();
  });
});

describe('armDebriefAudio (re-verify fix — guarded re-arm)', () => {
  test('no live debrief → arms this session', async () => {
    ObserveState.getState.mockResolvedValue(null);
    const armed = await armDebriefAudio('fo-uuid-1', SID, { snap: 1 });
    expect(armed).toBe(true);
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-uuid-1', 'awaiting_debrief_audio', expect.objectContaining({ sessionId: SID, guide_snapshot: { snap: 1 } }));
  });

  test('live debrief armed for a DIFFERENT session → refuses to arm (no clobber)', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: 'other-session' });
    const armed = await armDebriefAudio('fo-uuid-1', SID, null);
    expect(armed).toBe(false);
    expect(ObserveState.setState).not.toHaveBeenCalled();
  });

  test('live debrief armed for the SAME session → re-arms (idempotent)', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: SID });
    const armed = await armDebriefAudio('fo-uuid-1', SID, null);
    expect(armed).toBe(true);
    expect(ObserveState.setState).toHaveBeenCalled();
  });
});
