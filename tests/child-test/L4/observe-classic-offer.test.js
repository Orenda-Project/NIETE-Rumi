/**
 * The child-test offer after classic /observe (bd-s1oo0.4): prod ICT coaches run /observe, so when
 * the teacher's report is delivered the coach is also offered "Test 5 children now?", carrying the
 * coaching session id — only when the child test is gated on. Drives the real
 * processTeacherReport(deliver) (harness from bot/tests/observe/deliver-131047-template-fallback.test.js).
 */


const SESSION_ID = 'sess-window-closed-1';
const COACH = '923333000000';
const TEACHER = '923001234567';

let mockRow;
let mockUpdates;

// Table-aware ON PURPOSE. A flat double that answered every read with the
// session row left the coach with no resolvable preference, so the language of
// her message fell to the market floor — and that floor is exactly the kind of
// thing another branch changes underneath you. The coach's preference is stated
// here, so this suite asserts the FALLBACK and never accidentally asserts
// whichever way the language resolver happens to lean in the tree it runs on.
jest.mock('../../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      or: jest.fn(() => chain),
      is: jest.fn(() => chain),
      in: jest.fn(() => chain),
      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
      single: jest.fn(async () => (table === 'users'
        ? { data: global.__mockCoachRow, error: null }
        : { data: mockRow, error: null })),
      maybeSingle: jest.fn(async () => (table === 'users'
        ? { data: global.__mockCoachRow, error: null }
        : { data: mockRow, error: null })),
      update: jest.fn((payload) => {
        mockUpdates.push(payload);
        if (payload.analysis_data) mockRow = { ...mockRow, analysis_data: payload.analysis_data };
        return { eq: jest.fn(async () => ({ error: null })) };
      }),
    };
    return chain;
  }),
}));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const mockSend = {
  sendMessage: jest.fn(async () => true),
  sendTemplate: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => {}),
  sendImageFromBuffer: jest.fn(async () => true),
};
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockSend);
jest.mock('../../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('png-bytes')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
// The window looks OPEN, so delivery takes the DIRECT path. That is the whole
// point: Meta accepts the POST and then refuses it, and 23-24h is exactly the
// band where our check and Meta's disagree.
jest.mock('../../../bot/shared/services/quiz/quiz-delivery.service', () => ({
  _hasOpenMessageWindow: jest.fn(async () => true),
}));
const mockMarkWindowClosed = jest.fn(async () => {});
jest.mock('../../../bot/shared/services/quiz/meta-window-cache.service', () => ({
  markWindowClosed: (...a) => mockMarkWindowClosed(...a),
  isWindowClosed: jest.fn(async () => false),
}));


describe('the offer after the report is delivered', () => {
  let ObserveSend;
  const SAVED = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.OBSERVE_FRAMEWORK = 'fico';
    process.env.OBSERVE_REVIEW_MODE = 'off';
    mockUpdates = [];
    mockRow = {
      id: SESSION_ID, observation_type: 'leader_observation', observer_user_id: 'coach-uuid-1', user_id: 'teacher-uuid-1',
      users: { phone_number: COACH, name: 'Coach', preferred_language: 'en' },
      analysis_data: { teacher_delivery: { status: 'awaiting_confirm', report_key: 'observe-reports/x.png', teacher_phone: TEACHER, teacher_name: 'Ms Khadija' } },
    };
    global.__mockCoachRow = { id: 'coach-uuid-1', phone_number: COACH, name: 'Coach', role: 'coach', region: 'niete', preferred_language: 'en' };
    ObserveSend = require('../../../bot/shared/services/observe/observe-send.service');
  });
  afterEach(() => { process.env = { ...SAVED }; });

  it('gated on: after "sent", the offer carries the coaching session', async () => {
    process.env.CHILD_TEST_ENABLED = 'true';
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    const offer = mockSend.sendInteractiveButtons.mock.calls.find((c) => c[1].buttons.some((b) => b.id.startsWith('ctst_offer:')));
    expect(offer).toBeTruthy();
    expect(offer[0]).toBe(COACH);
    expect(offer[1].buttons.map((b) => b.id)).toEqual([`ctst_offer:s:${SESSION_ID}`, `ctst_later:s:${SESSION_ID}`]);
  });

  it('gated off: no offer', async () => {
    delete process.env.CHILD_TEST_ENABLED;
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockSend.sendInteractiveButtons.mock.calls.some((c) => c[1].buttons.some((b) => b.id.startsWith('ctst_')))).toBe(false);
  });
});
