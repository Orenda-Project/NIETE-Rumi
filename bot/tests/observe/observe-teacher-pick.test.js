/**
 * FEAT-053 bd-43 — the teacher picker. When an officer starts a send, offer
 * the teachers they have sent to before (name + phone from past deliveries)
 * as a tap-to-pick list, with "new teacher" as the escape hatch. Picking one
 * skips the type-the-details step entirely. Over time this maps teachers to
 * their school leaders so numbers are never re-typed.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn().mockResolvedValue('msg-1'),
}));

// Stateful supabase mock: one current-session row + a list of PAST sessions
const mockDb = { row: null, past: [] };
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
  chain.limit = jest.fn().mockResolvedValue({ data: mockDb.past, error: null });
  chain.update = mockUpdate;
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(() => mockMakeChain()) }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const CoachingJobQueueService = require('../../shared/services/coaching/coaching-job-queue.service');
const {
  listKnownTeachers,
  buildTeacherPickPayload,
  startSendFlow,
  handleTeacherPick,
} = require('../../shared/services/observe/observe-send.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');
const SID = 'sess-90';
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
const pastRow = (name, phone, at) => ({
  analysis_data: { teacher_delivery: { teacher_name: name, teacher_phone: phone } },
  created_at: at,
});

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
  mockDb.row = sessionRow();
  mockDb.past = [];
  delete FO.preferences;   // bd-45: getRoster caches onto the user object — reset the shared fixture
});

describe('listKnownTeachers', () => {
  test('dedupes by phone, keeps most recent name, caps at 9', async () => {
    mockDb.past = [
      pastRow('Bi. Zainabu', '255712345678', '2026-07-14'),
      pastRow('Zainabu M.', '255712345678', '2026-07-10'),   // older duplicate
      pastRow('Mw. Neema', '255755000111', '2026-07-12'),
    ];
    const t = await listKnownTeachers('fo-1');
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({ name: 'Bi. Zainabu', phone: '255712345678' });
    expect(t[1]).toEqual({ name: 'Mw. Neema', phone: '255755000111' });
  });

  test('caps the list at 9 (list row limit incl. the new-teacher row)', async () => {
    mockDb.past = Array.from({ length: 14 }, (_, i) =>
      pastRow(`T${i}`, `2557000000${String(10 + i)}`, `2026-07-${String(14 - (i % 9)).padStart(2, '0')}`));
    const t = await listKnownTeachers('fo-1');
    expect(t.length).toBeLessThanOrEqual(9);
  });
});

describe('buildTeacherPickPayload', () => {
  test('one row per teacher + new-teacher + manage rows, WhatsApp caps respected', () => {
    const p = buildTeacherPickPayload([{ name: 'Bi. Zainabu', phone: '255712345678' }], S);
    const rows = p.action.sections[0].rows;
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe('observe_pickt_0');
    expect(rows[0].title.length).toBeLessThanOrEqual(24);
    expect(rows[0].description).toContain('255712345678');
    expect(rows[1].id).toBe('observe_pickt_new');
    expect(rows[2].id).toBe('observe_pickt_manage');
    for (const r of rows) expect(r.title.length).toBeLessThanOrEqual(24);
  });
});

describe('startSendFlow with known teachers', () => {
  test('offers the pick list and arms awaiting_teacher_pick with the teachers snapshot', async () => {
    mockDb.past = [pastRow('Bi. Zainabu', '255712345678', '2026-07-14')];
    await startSendFlow(SID, FROM, FO);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalled();
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_teacher_pick',
      expect.objectContaining({ sessionId: SID, teachers: [{ name: 'Bi. Zainabu', phone: '255712345678' }] }));
  });

  test('no known teachers → the original ask-for-details flow, unchanged', async () => {
    mockDb.past = [];
    await startSendFlow(SID, FROM, FO);
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_teacher_details', expect.objectContaining({ sessionId: SID }));
  });
});

describe('handleTeacherPick', () => {
  const state = {
    state: 'awaiting_teacher_pick',
    sessionId: SID,
    teachers: [{ name: 'Bi. Zainabu', phone: '255712345678' }],
  };

  test('picking a teacher stores details, queues the preview, arms awaiting_send_confirm', async () => {
    ObserveState.getState.mockResolvedValue(state);
    const handled = await handleTeacherPick(FO, FROM, 'observe_pickt_0');
    expect(handled).toBe(true);
    expect(mockDb.row.analysis_data.teacher_delivery).toMatchObject({
      teacher_name: 'Bi. Zainabu', teacher_phone: '255712345678',
    });
    expect(mockDb.row.analysis_data.observer_debrief).toBeTruthy();   // merge, not clobber
    expect(CoachingJobQueueService.queueObserveTeacherReport).toHaveBeenCalledWith(
      SID, expect.objectContaining({ phase: 'preview', from: FROM }));
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_send_confirm', expect.objectContaining({ sessionId: SID }));
  });

  test('"new teacher" row falls through to the type-the-details flow', async () => {
    ObserveState.getState.mockResolvedValue(state);
    const handled = await handleTeacherPick(FO, FROM, 'observe_pickt_new');
    expect(handled).toBe(true);
    expect(CoachingJobQueueService.queueObserveTeacherReport).not.toHaveBeenCalled();
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_teacher_details', expect.objectContaining({ sessionId: SID }));
  });

  test('stale tap with no armed state → not handled, nothing sent to anyone', async () => {
    ObserveState.getState.mockResolvedValue(null);
    const handled = await handleTeacherPick(FO, FROM, 'observe_pickt_0');
    expect(handled).toBe(false);
    expect(CoachingJobQueueService.queueObserveTeacherReport).not.toHaveBeenCalled();
  });

  test('out-of-range index → re-ask safely, never a crash or misdirected send', async () => {
    ObserveState.getState.mockResolvedValue(state);
    const handled = await handleTeacherPick(FO, FROM, 'observe_pickt_7');
    expect(handled).toBe(true);
    expect(CoachingJobQueueService.queueObserveTeacherReport).not.toHaveBeenCalled();
  });
});
