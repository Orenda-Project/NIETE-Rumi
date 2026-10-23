'use strict';
/**
 * bd-gzfdu9 — hook A2 in observe-send.service.js: the recommended clip for a coach /observe report is computed in
 * the deliver/teacher_tap branch AFTER the teacher's report is sent and marked sent — never on the coach preview,
 * never on operator review, never on the window-closed template path. Harness:
 * tests/child-test/L4/observe-classic-offer.test.js (the real processTeacherReport).
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



const mockReco = jest.fn(() => Promise.resolve(null));

describe('hook A2', () => {
  let ObserveSend;
  const SAVED = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.doMock('../../../bot/shared/services/coaching/video-reco/engine', () => ({ recommendForReport: (...a) => mockReco(...a) }));
    process.env.OBSERVE_FRAMEWORK = 'fico';
    process.env.OBSERVE_REVIEW_MODE = 'off';
    mockUpdates = [];
    mockRow = {
      id: SESSION_ID, observation_type: 'leader_observation', observer_user_id: 'coach-uuid-1', user_id: 'teacher-uuid-1',
      users: { phone_number: COACH, name: 'Coach', preferred_language: 'en' },
      prioritized_action: { action: 'Ask two why questions', indicator: 'C1' },
      analysis_data: { framework: 'fico', domains: {}, teacher_delivery: { status: 'awaiting_confirm', report_key: 'observe-reports/x.png', teacher_phone: TEACHER, teacher_name: 'Teacher' } },
    };
    global.__mockCoachRow = { id: 'coach-uuid-1', phone_number: COACH, name: 'Coach', role: 'coach', region: 'niete', preferred_language: 'en' };
    ObserveSend = require('../../../bot/shared/services/observe/observe-send.service');
  });
  afterEach(() => { process.env = { ...SAVED }; });

  it('deliver: started once, after the report image went to the teacher and the delivery was marked sent', async () => {
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockReco).toHaveBeenCalledTimes(1);
    const a = mockReco.mock.calls[0][0];
    expect(a).toMatchObject({ coachingSessionId: SESSION_ID, observationType: 'leader_observation', card: { action: 'Ask two why questions', indicator: 'C1' } });
    expect(a.analysis.framework).toBe('fico');
    expect(a.session.user_id).toBe('teacher-uuid-1');
    expect(a.nextStep).toBeUndefined(); // the engine derives it from the coach-edited analysis
    const imageOrder = mockSend.sendImageFromBuffer.mock.invocationCallOrder[0];
    expect(imageOrder).toBeLessThan(mockReco.mock.invocationCallOrder[0]);
    expect(mockUpdates.some((u) => u.analysis_data && u.analysis_data.teacher_delivery && u.analysis_data.teacher_delivery.status === 'sent')).toBe(true);
  });

  it('a recommendation that never finishes does not hold up the coach\'s confirmation', async () => {
    mockReco.mockReturnValueOnce(new Promise(() => {}));
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockSend.sendMessage.mock.calls.some((c) => c[0] === COACH)).toBe(true);
  });

  it('operator review mode: not started', async () => {
    process.env.OBSERVE_REVIEW_MODE = 'operator';
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockReco).not.toHaveBeenCalled();
  });

  it('window closed (template path): not started', async () => {
    require('../../../bot/shared/services/quiz/quiz-delivery.service')._hasOpenMessageWindow.mockResolvedValueOnce(false);
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH }).catch(() => {});
    expect(mockReco).not.toHaveBeenCalled();
  });

  it('already sent: not started again', async () => {
    mockRow.analysis_data.teacher_delivery.status = 'sent';
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockReco).not.toHaveBeenCalled();
  });
});
