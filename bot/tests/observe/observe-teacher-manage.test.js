/**
 * FEAT-053 bd-45 — the manage flow (attendance-parity add/remove).
 *
 * Picker gains a 🛠 manage row → officer taps a teacher → remove/back
 * buttons → removal persists to the roster and the picker is re-shown so the
 * send continues. Add stays the existing "new teacher" path; rename is
 * re-adding with the same number (upsert semantics, pinned in roster tests).
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
jest.mock('../../shared/services/observe/observe-roster', () => ({
  getRoster: jest.fn(),
  upsertTeacher: jest.fn().mockResolvedValue([]),
  removeTeacher: jest.fn().mockResolvedValue([]),
  ROSTER_CAP: 25,
}));

const mockDb = { row: null };
const mockSingle = jest.fn(() => Promise.resolve(
  mockDb.row ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } }));
function mockMakeChain() {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'not', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  chain.update = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }));
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(() => mockMakeChain()) }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const Roster = require('../../shared/services/observe/observe-roster');
const {
  buildTeacherPickPayload,
  startSendFlow,
  handleTeacherPick,
  handleTeacherManage,
  handleTeacherManageButton,
} = require('../../shared/services/observe/observe-send.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');
const SID = 'sess-91';
const FO = { id: 'fo-1', role: 'school_leader', preferred_language: 'sw', first_name: 'Elisha', preferences: {} };
const FROM = '255700000001';
const TEACHERS = [
  { name: 'Bi. Zainabu', phone: '255712345678' },
  { name: 'Mw. Neema', phone: '255755000111' },
];

const sessionRow = () => ({
  id: SID,
  observer_user_id: 'fo-1',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'done',
  analysis_data: { framework: 'mewaka', observer_debrief: { transcript: 'x'.repeat(200) } },
});

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
  Roster.getRoster.mockResolvedValue(TEACHERS);
  mockDb.row = sessionRow();
});

describe('picker payload (roster-era)', () => {
  test('rows = teachers + new-teacher + manage, all ids under the registered prefixes', () => {
    const p = buildTeacherPickPayload(TEACHERS, S);
    const rows = p.action.sections[0].rows;
    expect(rows.map((r) => r.id)).toEqual([
      'observe_pickt_0', 'observe_pickt_1', 'observe_pickt_new', 'observe_pickt_manage',
    ]);
    for (const r of rows) expect(r.title.length).toBeLessThanOrEqual(24);
  });

  test('empty roster → picker is skipped entirely (straight to type-details)', async () => {
    Roster.getRoster.mockResolvedValue([]);
    await startSendFlow(SID, FROM, FO);
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_teacher_details', expect.objectContaining({ sessionId: SID }));
  });
});

describe('manage flow', () => {
  const pickState = { state: 'awaiting_teacher_pick', sessionId: SID, teachers: TEACHERS };

  test('🛠 row → manage list sent, awaiting_teacher_manage armed with the roster snapshot', async () => {
    ObserveState.getState.mockResolvedValue(pickState);
    const handled = await handleTeacherPick(FO, FROM, 'observe_pickt_manage');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalled();
    const rows = WhatsAppService.sendInteractiveMessage.mock.calls[0][1].action.sections[0].rows;
    expect(rows[0].id).toBe('observe_tmg_0');
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_teacher_manage',
      expect.objectContaining({ sessionId: SID, teachers: TEACHERS }));
  });

  test('tapping a teacher → remove/back buttons naming the teacher, confirm state armed', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_teacher_manage', sessionId: SID, teachers: TEACHERS });
    const handled = await handleTeacherManage(FO, FROM, 'observe_tmg_1');
    expect(handled).toBe(true);
    const call = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    expect(call.body).toContain('Mw. Neema');
    expect(call.buttons.map((b) => b.id)).toEqual(['observe_tmg_rm_1', 'observe_tmg_back']);
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'fo-1', 'awaiting_teacher_manage_confirm',
      expect.objectContaining({ sessionId: SID, teachers: TEACHERS }));
  });

  test('remove → roster removal persisted for THAT phone, picker re-shown so the send continues', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_teacher_manage_confirm', sessionId: SID, teachers: TEACHERS });
    const handled = await handleTeacherManageButton(FO, FROM, 'observe_tmg_rm_1');
    expect(handled).toBe(true);
    expect(Roster.removeTeacher).toHaveBeenCalledWith(FO, '255755000111');
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalled();   // picker again
  });

  test('back → no removal, picker re-shown', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_teacher_manage_confirm', sessionId: SID, teachers: TEACHERS });
    const handled = await handleTeacherManageButton(FO, FROM, 'observe_tmg_back');
    expect(handled).toBe(true);
    expect(Roster.removeTeacher).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalled();
  });

  test('stale taps with no armed state are ignored — nothing removed, nothing sent', async () => {
    ObserveState.getState.mockResolvedValue(null);
    expect(await handleTeacherManage(FO, FROM, 'observe_tmg_0')).toBe(false);
    expect(await handleTeacherManageButton(FO, FROM, 'observe_tmg_rm_0')).toBe(false);
    expect(Roster.removeTeacher).not.toHaveBeenCalled();
  });
});

describe('roster upsert on every send', () => {
  test('picking a teacher upserts them (move-to-front) so the roster tracks usage', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_teacher_pick', sessionId: SID, teachers: TEACHERS });
    await handleTeacherPick(FO, FROM, 'observe_pickt_0');
    expect(Roster.upsertTeacher).toHaveBeenCalledWith(FO, TEACHERS[0]);
  });
});
