/**
 * FEAT-053 bd-25 — the combined-report worker: preview → confirm → delivery.
 *
 * Invariants under test:
 *  - The FO ALWAYS sees the exact report before the teacher can (D33).
 *  - The hero report is rendered by the EXISTING generateHeroReport from v2 —
 *    with the FO-entered teacher name and the debrief commitment (D32).
 *  - Missing/failed debrief notes never block the report (companion skipped).
 *  - Review mode reroutes to the operator, never the teacher (D11).
 *  - Window closed → template with payload observe_report_<sid> (quiz arch).
 *  - Idempotent: a sent delivery never re-sends.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn(),
}));
jest.mock('../../shared/services/coaching/report-v2/hero-report.service', () => ({
  generateHeroReport: jest.fn().mockResolvedValue({ png: Buffer.from('png-bytes'), caption: 'caption' }),
}));
jest.mock('../../shared/storage/r2', () => ({
  uploadImageBuffer: jest.fn().mockResolvedValue('https://r2/observe-reports/sess-77.png'),
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
}));
jest.mock('../../shared/services/quiz/quiz-delivery.service', () => ({
  _hasOpenMessageWindow: jest.fn().mockResolvedValue(true),
}));

const mockDb = { row: null };
const mockSingle = jest.fn(() => Promise.resolve(
  mockDb.row ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } }));
const mockUpdate = jest.fn((patch) => {
  if (mockDb.row) mockDb.row = { ...mockDb.row, ...patch };
  return { eq: jest.fn().mockResolvedValue({ error: null }) };
});
function mockMakeChain() {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  chain.update = mockUpdate;
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(() => mockMakeChain()) }));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const { generateHeroReport } = require('../../shared/services/coaching/report-v2/hero-report.service');
const { uploadImageBuffer, downloadFromR2 } = require('../../shared/storage/r2');
const QuizDeliveryService = require('../../shared/services/quiz/quiz-delivery.service');
const { processTeacherReport } = require('../../shared/services/observe/observe-send.service');

const SID = 'sess-77';
const FO_PHONE = '255700000001';
const TEACHER_PHONE = '255712345678';

const sessionRow = (over = {}) => ({
  id: SID,
  user_id: 'fo-1',
  observer_user_id: 'fo-1',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'done',
  transcript_text: 'lesson transcript',
  users: { phone_number: FO_PHONE, first_name: 'Elisha', preferred_language: 'sw' },
  analysis_data: {
    framework: 'mewaka',
    focus_area_sw: { title_sw: 'Maswali ya kufikirisha' },
    observer_debrief: { transcript: 'FO na mwalimu walizungumza. '.repeat(10) },
    teacher_delivery: { teacher_name: 'Bi. Zainabu', teacher_phone: TEACHER_PHONE, status: 'previewing' },
  },
  ...over,
});

const notes = () => ({
  discussed_sw: 'Mlizungumza kuhusu maswali ya kufikirisha.',
  commitment_sw: 'Nitauliza "Umejuaje?" kesho.',
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OBSERVE_REVIEW_MODE;
  mockDb.row = sessionRow();
  GPT5MiniService.completeJson.mockResolvedValue({ result: notes(), usage: {} });
  QuizDeliveryService._hasOpenMessageWindow.mockResolvedValue(true);
});

describe('phase: preview', () => {
  test('renders hero from v2 with teacher name + debrief commitment, uploads, previews to FO with confirm buttons', async () => {
    await processTeacherReport(SID, { from: FO_PHONE, phase: 'preview' });
    // hero called with the FO-entered teacher name and the commitment
    const [sess, analysis, opts] = generateHeroReport.mock.calls[0];
    expect(analysis.framework).toBe('mewaka');
    expect(opts.teacherName).toBe('Bi. Zainabu');
    expect(opts.commitmentAction).toContain('Umejuaje');
    // uploaded for deferred delivery
    expect(uploadImageBuffer).toHaveBeenCalled();
    // preview goes to the FO, not the teacher
    expect(WhatsAppService.sendImageFromBuffer.mock.calls[0][0]).toBe(FO_PHONE);
    // companion text + confirm buttons
    const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(texts).toContain('Umejuaje');
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalled();
    const btns = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons;
    expect(btns[0].id).toBe(`observe_send_confirm_${SID}`);
    // state persisted
    expect(mockDb.row.analysis_data.teacher_delivery.status).toBe('awaiting_confirm');
    expect(mockDb.row.analysis_data.teacher_delivery.notes).toBeTruthy();
    expect(mockDb.row.analysis_data.observer_debrief).toBeTruthy();  // merge, not replace
  });

  test('no debrief transcript → report still previews, no companion, commitment empty', async () => {
    const row = sessionRow();
    delete row.analysis_data.observer_debrief;
    mockDb.row = row;
    await processTeacherReport(SID, { from: FO_PHONE, phase: 'preview' });
    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(generateHeroReport.mock.calls[0][2].commitmentAction).toBe('');
    expect(WhatsAppService.sendImageFromBuffer).toHaveBeenCalled();
  });

  test('notes LLM failure → report still previews without notes (never blocks)', async () => {
    GPT5MiniService.completeJson.mockRejectedValue(new Error('llm down'));
    await processTeacherReport(SID, { from: FO_PHONE, phase: 'preview' });
    expect(WhatsAppService.sendImageFromBuffer).toHaveBeenCalled();
    expect(mockDb.row.analysis_data.teacher_delivery.status).toBe('awaiting_confirm');
  });
});

describe('phase: deliver', () => {
  const readyRow = () => {
    const r = sessionRow();
    r.analysis_data.teacher_delivery = {
      teacher_name: 'Bi. Zainabu', teacher_phone: TEACHER_PHONE, status: 'awaiting_confirm',
      report_key: 'observe-reports/sess-77.png', caption: 'caption',
      companion_text: 'companion', notes: notes(),
    };
    return r;
  };

  test('review mode → operator number, NEVER the teacher; FO told', async () => {
    process.env.OBSERVE_REVIEW_MODE = 'operator';
    mockDb.row = readyRow();
    await processTeacherReport(SID, { from: FO_PHONE, phase: 'deliver' });
    const dests = WhatsAppService.sendImageFromBuffer.mock.calls.map((c) => c[0]);
    expect(dests).not.toContain(TEACHER_PHONE);
    expect(dests[0]).toBe('923333232533');
    expect(mockDb.row.analysis_data.teacher_delivery.status).toBe('operator_review');
  });

  test('window open → direct to teacher (image + companion), status sent, FO told', async () => {
    mockDb.row = readyRow();
    await processTeacherReport(SID, { from: FO_PHONE, phase: 'deliver' });
    expect(downloadFromR2).toHaveBeenCalledWith('observe-reports/sess-77.png');
    expect(WhatsAppService.sendImageFromBuffer.mock.calls[0][0]).toBe(TEACHER_PHONE);
    const teacherTexts = WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === TEACHER_PHONE);
    expect(teacherTexts.length).toBeGreaterThanOrEqual(1);   // companion
    expect(mockDb.row.analysis_data.teacher_delivery.status).toBe('sent');
    const foTexts = WhatsAppService.sendMessage.mock.calls.filter((c) => c[0] === FO_PHONE);
    expect(foTexts.length).toBeGreaterThanOrEqual(1);        // FO confirmation
  });

  test('window closed → template with payload observe_report_<sid>, status awaiting_teacher_tap', async () => {
    QuizDeliveryService._hasOpenMessageWindow.mockResolvedValue(false);
    mockDb.row = readyRow();
    await processTeacherReport(SID, { from: FO_PHONE, phase: 'deliver' });
    expect(WhatsAppService.sendTemplate).toHaveBeenCalled();
    const [to, name, , components] = WhatsAppService.sendTemplate.mock.calls[0];
    expect(to).toBe(TEACHER_PHONE);
    expect(name).toBe('observation_report_sw');
    expect(JSON.stringify(components)).toContain(`observe_report_${SID}`);
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();  // no direct send
    expect(mockDb.row.analysis_data.teacher_delivery.status).toBe('awaiting_teacher_tap');
  });

  test('idempotent: already sent → no-op', async () => {
    const r = readyRow();
    r.analysis_data.teacher_delivery.status = 'sent';
    mockDb.row = r;
    await processTeacherReport(SID, { from: FO_PHONE, phase: 'deliver' });
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('phase: teacher_tap', () => {
  test('tap after template → direct delivery, status sent, FO told', async () => {
    const r = sessionRow();
    r.analysis_data.teacher_delivery = {
      teacher_name: 'Bi. Zainabu', teacher_phone: TEACHER_PHONE, status: 'awaiting_teacher_tap',
      report_key: 'observe-reports/sess-77.png', caption: 'caption', companion_text: 'companion',
    };
    mockDb.row = r;
    await processTeacherReport(SID, { from: TEACHER_PHONE, phase: 'teacher_tap' });
    expect(WhatsAppService.sendImageFromBuffer.mock.calls[0][0]).toBe(TEACHER_PHONE);
    expect(mockDb.row.analysis_data.teacher_delivery.status).toBe('sent');
  });

  test('tap from a DIFFERENT number than the stored teacher → refused', async () => {
    const r = sessionRow();
    r.analysis_data.teacher_delivery = {
      teacher_name: 'Bi. Zainabu', teacher_phone: TEACHER_PHONE, status: 'awaiting_teacher_tap',
      report_key: 'k', caption: 'c',
    };
    mockDb.row = r;
    await processTeacherReport(SID, { from: '255799999999', phase: 'teacher_tap' });
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
    expect(mockDb.row.analysis_data.teacher_delivery.status).toBe('awaiting_teacher_tap');
  });
});
