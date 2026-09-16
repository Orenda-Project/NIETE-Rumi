/**
 * bd-2411 — teacher never received the report; it failed silently.
 *
 * Trace (NIETE DB + Axiom, 30-Jul): both morning teacher deliveries (Khadija's
 * and Fakhr's teachers) are frozen at teacher_delivery.status='awaiting_confirm'
 * — the report was NEVER sent. handleSendConfirm optimistically tells the coach
 * "📨 sending now, I'll confirm once it lands", then the WORKER's
 * processTeacherReport phase='deliver' send threw (Meta template 400s were
 * logged in that window) and the exception propagated silently: status stayed
 * frozen, the coach's confirmation never came, the teacher got nothing.
 *
 * Fix: the deliver-phase teacher-send is wrapped — on failure it records
 * status='send_failed' and tells the coach (send_failed_fo) with a retry path.
 *
 * RED-FIRST: asserts the coach is notified + status recorded on a send throw.
 * Fails against current code (the throw is silent).
 * Created: 2026-07-30
 */

const SESSION_ID = 'sess-uuid-1';
let mockRow;
let mockUpdates;

jest.mock('../../shared/config/supabase', () => {
  const chain = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(async () => ({ data: mockRow, error: null })),
    maybeSingle: jest.fn(async () => ({ data: mockRow, error: null })),
    update: jest.fn((payload) => { mockUpdates.push(payload); return { eq: jest.fn(async () => ({ error: null })) }; }),
  };
  return chain;
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockSend = { sendMessage: jest.fn(async () => {}), sendTemplate: jest.fn(), sendInteractiveButtons: jest.fn(async () => {}) };
jest.mock('../../shared/services/whatsapp.service', () => mockSend);
jest.mock('../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(async () => Buffer.from('x')), uploadImageBuffer: jest.fn(async () => 'k') }));
// Window CLOSED → cold-teacher template path (where the 400 happened).
jest.mock('../../shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: jest.fn(async () => false) }));

describe('bd-2411 · teacher delivery failure is visible + recorded (not silent)', () => {
  let ObserveSend;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OBSERVE_FRAMEWORK = 'fico';
    process.env.OBSERVE_REVIEW_MODE = 'off';
    mockUpdates = [];
    mockRow = {
      id: SESSION_ID,
      observation_type: 'leader_observation',
      users: { phone_number: '923333000000', first_name: 'Coach', preferred_language: 'en' },
      analysis_data: {
        teacher_delivery: {
          status: 'awaiting_confirm',
          report_key: 'observe-reports/x.png',
          teacher_phone: '923001234567',
          teacher_name: 'Ms Khadija',
        },
      },
    };
    ObserveSend = require('../../shared/services/observe/observe-send.service');
  });
  afterEach(() => { delete process.env.OBSERVE_FRAMEWORK; delete process.env.OBSERVE_REVIEW_MODE; });

  it('when the cold-teacher template send throws, the coach is notified and status = send_failed (no silent throw)', async () => {
    mockSend.sendTemplate.mockRejectedValueOnce(new Error('Request failed with status code 400'));

    await expect(ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: '923333000000' }))
      .resolves.not.toThrow();

    // status recorded as send_failed (not left frozen at awaiting_confirm)
    const failWrite = mockUpdates.find(u => u.analysis_data && u.analysis_data.teacher_delivery
      && u.analysis_data.teacher_delivery.status === 'send_failed');
    expect(failWrite).toBeTruthy();

    // coach told it failed (send_failed_fo), never left on the optimistic "sending now".
    // Asserted against the catalogue entry rather than an English phrase: this
    // session carries no resolvable observer preference, so the message comes
    // out in the market default, and that floor is allowed to move.
    const { observeStrings } = require('../../shared/services/observe/observe-strings');
    const { marketDefault } = require('../../shared/services/observe/observe-language');
    const expected = observeStrings(marketDefault()).send_failed_fo;
    const coachMsgs = mockSend.sendMessage.mock.calls.map(c => String(c[1]));
    expect(coachMsgs).toContain(expected);
  });
});
