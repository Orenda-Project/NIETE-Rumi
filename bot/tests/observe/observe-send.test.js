/**
 * FEAT-053 bd-24 — teacher identity capture: TZ phone normalizer, one-message
 * name+phone parser, send-flow states and button ids, pending-list extension.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn().mockResolvedValue('msg-1'),
}));

// Stateful row mock (read-merge-write contract, same as the capture tests)
const mockDb = { row: null };
const mockSingle = jest.fn(() => Promise.resolve(
  mockDb.row ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } }));
const mockUpdate = jest.fn((patch) => {
  if (mockDb.row) mockDb.row = { ...mockDb.row, ...patch };
  return { eq: jest.fn().mockResolvedValue({ error: null }) };
});
function mockMakeChain() {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'not', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  chain.update = mockUpdate;
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(() => mockMakeChain()) }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const CoachingJobQueueService = require('../../shared/services/coaching/coaching-job-queue.service');
const {
  normalizeTzPhone,
  parseTeacherDetails,
  parseSendButtonId,
  buildSendChoiceButtons,
  startSendFlow,
  handleTeacherDetailsText,
} = require('../../shared/services/observe/observe-send.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');
const SID = 'sess-77';
const FO = { id: 'fo-1', role: 'school_leader', preferred_language: 'sw', first_name: 'Elisha' };
const FROM = '255700000001';

const sessionRow = (over = {}) => ({
  id: SID,
  observer_user_id: 'fo-1',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'done',
  analysis_data: { framework: 'mewaka', observer_debrief: { transcript: 'x'.repeat(200) } },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
  mockDb.row = sessionRow();
});

describe('normalizeTzPhone (D34 table)', () => {
  const T = [
    ['0755 123 456', '255755123456'],
    ['0655-123-456', '255655123456'],
    ['+255 755 123 456', '255755123456'],
    ['255755123456', '255755123456'],
    ['755123456', '255755123456'],
    ['612345678', '255612345678'],
    ['92 332 4886442', null],      // PK number — normalizeTzPhone stays TZ-only
    ['0812345678', null],          // TZ mobiles are 06/07
    ['12345', null],
    ['hello', null],
    ['', null],
  ];
  for (const [input, want] of T) {
    test(`${JSON.stringify(input)} → ${want}`, () => {
      expect(normalizeTzPhone(input)).toBe(want);
    });
  }
});

describe('parseTeacherDetails', () => {
  test('comma form', () => {
    expect(parseTeacherDetails('Bi. Zainabu, 0712 345 678'))
      .toEqual({ name: 'Bi. Zainabu', phone: '255712345678' });
  });
  test('newline form', () => {
    expect(parseTeacherDetails('Zainabu Mushi\n0712345678'))
      .toEqual({ name: 'Zainabu Mushi', phone: '255712345678' });
  });
  test('no separator, phone at end', () => {
    expect(parseTeacherDetails('Zainabu 0712345678'))
      .toEqual({ name: 'Zainabu', phone: '255712345678' });
  });
  test('phone first also works', () => {
    expect(parseTeacherDetails('0712345678 Bi. Zainabu'))
      .toEqual({ name: 'Bi. Zainabu', phone: '255712345678' });
  });
  test('missing phone → null', () => {
    expect(parseTeacherDetails('Bi. Zainabu')).toBeNull();
  });
  test('missing name → null (a bare number is not enough)', () => {
    expect(parseTeacherDetails('0712345678')).toBeNull();
  });
  // bd-36 (Rida): the PK-numbered test team could not run the send leg at
  // all — parseTeacherDetails ALSO accepts PK mobiles, normalized to 92….
  // TZ stays primary; the preview + explicit confirm + pilot review gate are
  // the misdelivery guards. Garbage still rejected.
  test('PK mobile accepted at the parse level (testing/ops affordance)', () => {
    expect(parseTeacherDetails('Rida, 0332 4886442'))
      .toEqual({ name: 'Rida', phone: '923324886442' });
    expect(parseTeacherDetails('Rida, +92 332 4886442'))
      .toEqual({ name: 'Rida', phone: '923324886442' });
  });
  test('non-mobile garbage still rejected', () => {
    expect(parseTeacherDetails('Zainabu, 12345')).toBeNull();
    expect(parseTeacherDetails('Zainabu, 0812345678')).toBeNull();
  });
});

describe('button ids', () => {
  test('round-trip: start / later / confirm / cancel', () => {
    expect(parseSendButtonId(`observe_send_start_${SID}`)).toEqual({ action: 'start', sessionId: SID });
    expect(parseSendButtonId(`observe_send_later_${SID}`)).toEqual({ action: 'later', sessionId: SID });
    expect(parseSendButtonId(`observe_send_confirm_${SID}`)).toEqual({ action: 'confirm', sessionId: SID });
    expect(parseSendButtonId(`observe_send_cancel_${SID}`)).toEqual({ action: 'cancel', sessionId: SID });
    expect(parseSendButtonId('observe_debrief_now_x')).toBeNull();   // not ours
    expect(parseSendButtonId(null)).toBeNull();
  });
  test('choice buttons fit WhatsApp caps', () => {
    const p = buildSendChoiceButtons(SID, S);
    expect(p.buttons).toHaveLength(2);
    for (const b of p.buttons) expect(b.title.length).toBeLessThanOrEqual(20);
    expect(p.buttons[0].id).toBe(`observe_send_start_${SID}`);
  });
});

describe('startSendFlow', () => {
  test('authz + arms awaiting_teacher_details + asks for name/number', async () => {
    await startSendFlow(SID, FROM, FO);
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_teacher_details', expect.objectContaining({ sessionId: SID }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/jina.*namba|namba.*jina/i);
  });

  test("someone else's session → denial, no state", async () => {
    mockDb.row = sessionRow({ observer_user_id: 'other' });
    await startSendFlow(SID, FROM, FO);
    expect(ObserveState.setState).not.toHaveBeenCalled();
  });

  test('already sent → already-sent ack, no state', async () => {
    mockDb.row = sessionRow({ analysis_data: { teacher_delivery: { status: 'sent' } } });
    await startSendFlow(SID, FROM, FO);
    expect(ObserveState.setState).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/imeshatumwa|already/i);
  });
});

describe('handleTeacherDetailsText', () => {
  const state = { state: 'awaiting_teacher_details', sessionId: SID };

  test('valid details → stored via merge, preview job queued, state advanced', async () => {
    const handled = await handleTeacherDetailsText(FO, FROM, 'Bi. Zainabu, 0712 345 678', state);
    expect(handled).toBe(true);
    expect(mockDb.row.analysis_data.teacher_delivery).toMatchObject({
      teacher_name: 'Bi. Zainabu', teacher_phone: '255712345678',
    });
    expect(mockDb.row.analysis_data.observer_debrief).toBeTruthy();   // merge, not replace
    expect(CoachingJobQueueService.queueObserveTeacherReport).toHaveBeenCalledWith(
      SID, expect.objectContaining({ phase: 'preview', from: FROM }));
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_send_confirm', expect.objectContaining({ sessionId: SID }));
  });

  test('unparseable → re-ask with example, state kept, nothing queued', async () => {
    const handled = await handleTeacherDetailsText(FO, FROM, 'hmm what', state);
    expect(handled).toBe(true);   // consumed — do not fall through to chat
    expect(CoachingJobQueueService.queueObserveTeacherReport).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/mfano|example/i);
  });

  test('not in the state → not handled (normal chat unaffected)', async () => {
    expect(await handleTeacherDetailsText(FO, FROM, 'Zainabu, 0712345678', null)).toBe(false);
    expect(await handleTeacherDetailsText(FO, FROM, 'x', { state: 'awaiting_audio' })).toBe(false);
  });
});
