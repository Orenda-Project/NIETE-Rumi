/**
 * A report refused because the teacher's 24-hour window has closed must fall
 * back to the invite template, not be filed as a failure.
 *
 * Two defects meeting, and the ORDER of the fix matters.
 *
 * The window check cuts at 23 hours against Meta's 24-hour rule, so a teacher
 * who wrote 23-24 hours ago is classified cold: measured over the 152 template
 * sends since 7 Sep, 5 of them (3.3%) went to a teacher whose last inbound was
 * 23.05-23.92 hours earlier. All five were tapped and delivered, so today's
 * cost is not a lost report -- it is a message to the coach asserting something
 * untrue about her teacher, plus a paid template nobody needed.
 *
 * But widening that margin ALONE makes things worse. _handleDeliverFailure
 * records send_failed and tells the coach; it never inspects the Meta error
 * code and never falls back to the template. So each of those five
 * false-but-delivered invites would become a report marked failed with nothing
 * reaching the teacher. Hence: the fallback first, in this suite, then the
 * margin.
 *
 * Note what the send chain does to the evidence: sendImageFromBuffer catches
 * the Graph error, logs it and returns `false`, and _sendPackage turns that
 * into a generic Error. The error code Meta sent is available and then thrown
 * away before anything can act on it -- which is why this suite asserts the
 * code survives the chain, not merely that a branch exists.
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
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
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
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockSend = {
  sendMessage: jest.fn(async () => true),
  sendTemplate: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => {}),
  sendImageFromBuffer: jest.fn(async () => true),
};
jest.mock('../../shared/services/whatsapp.service', () => mockSend);
jest.mock('../../shared/storage/r2', () => ({
  downloadFromR2: jest.fn(async () => Buffer.from('png-bytes')),
  uploadImageBuffer: jest.fn(async () => 'k'),
}));
// The window looks OPEN, so delivery takes the DIRECT path. That is the whole
// point: Meta accepts the POST and then refuses it, and 23-24h is exactly the
// band where our check and Meta's disagree.
jest.mock('../../shared/services/quiz/quiz-delivery.service', () => ({
  _hasOpenMessageWindow: jest.fn(async () => true),
}));
const mockMarkWindowClosed = jest.fn(async () => {});
jest.mock('../../shared/services/quiz/meta-window-cache.service', () => ({
  markWindowClosed: (...a) => mockMarkWindowClosed(...a),
  isWindowClosed: jest.fn(async () => false),
}));

/** What Meta answers when the free-form window has actually closed. */
const reEngagementError = () => Object.assign(
  new Error('Request failed with status code 400'),
  {
    response: {
      status: 400,
      data: {
        error: {
          message: 'Re-engagement message',
          code: 131047,
          type: 'OAuthException',
          error_data: { details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' },
        },
      },
    },
    isAxiosError: true,
  },
);

const delivery = () => mockRow.analysis_data.teacher_delivery;
const statusesWritten = () => mockUpdates
  .filter((u) => u.analysis_data && u.analysis_data.teacher_delivery)
  .map((u) => u.analysis_data.teacher_delivery.status);

describe('a 131047 on the direct path falls back to the invite template', () => {
  let ObserveSend;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.OBSERVE_FRAMEWORK = 'fico';
    process.env.OBSERVE_REVIEW_MODE = 'off';
    mockUpdates = [];
    mockRow = {
      id: SESSION_ID,
      observation_type: 'leader_observation',
      observer_user_id: 'coach-uuid-1',
      user_id: 'teacher-uuid-1',
      users: { phone_number: COACH, name: 'Coach', preferred_language: 'en' },
      analysis_data: {
        teacher_delivery: {
          status: 'awaiting_confirm',
          report_key: 'observe-reports/x.png',
          teacher_phone: TEACHER,
          teacher_name: 'Ms Khadija',
        },
      },
    };
    global.__mockCoachRow = {
      id: 'coach-uuid-1', phone_number: COACH, name: 'Coach', preferred_language: 'en',
    };
    ObserveSend = require('../../shared/services/observe/observe-send.service');
  });
  afterEach(() => {
    delete process.env.OBSERVE_FRAMEWORK;
    delete process.env.OBSERVE_REVIEW_MODE;
  });

  it('sends the template and lands on awaiting_teacher_tap, NOT send_failed', async () => {
    mockSend.sendImageFromBuffer.mockImplementationOnce(async (to, buf, caption, mime, opts) => {
      if (opts && typeof opts.onError === 'function') opts.onError(reEngagementError());
      return false;
    });

    await expect(ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH }))
      .resolves.not.toThrow();

    expect(mockSend.sendTemplate).toHaveBeenCalledTimes(1);
    expect(mockSend.sendTemplate.mock.calls[0][0]).toBe(TEACHER);

    expect(delivery().status).toBe('awaiting_teacher_tap');
    expect(typeof delivery().template_sent_at).toBe('string');
    expect(Number.isNaN(Date.parse(delivery().template_sent_at))).toBe(false);
    expect(statusesWritten()).not.toContain('send_failed');
  });

  it('records the closed window so the next send for this teacher skips the free path', async () => {
    mockSend.sendImageFromBuffer.mockImplementationOnce(async (to, buf, caption, mime, opts) => {
      if (opts && typeof opts.onError === 'function') opts.onError(reEngagementError());
      return false;
    });

    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockMarkWindowClosed).toHaveBeenCalledWith(TEACHER);
  });

  it('tells the coach an invite went out, not that the send failed', async () => {
    mockSend.sendImageFromBuffer.mockImplementationOnce(async (to, buf, caption, mime, opts) => {
      if (opts && typeof opts.onError === 'function') opts.onError(reEngagementError());
      return false;
    });

    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    const coachTexts = mockSend.sendMessage.mock.calls
      .filter((c) => c[0] === COACH).map((c) => String(c[1]));
    const { observeStrings } = require('../../shared/services/observe/observe-strings');
    expect(coachTexts).toContain(observeStrings('en').send_template_queued_fo);
    expect(coachTexts).not.toContain(observeStrings('en').send_failed_fo);
  });

  it('a failure that is NOT a window problem still becomes send_failed', async () => {
    // The fallback must not swallow every failure into a template send. An R2
    // miss or a genuine 400 on the image is still a failure the coach must see.
    mockSend.sendImageFromBuffer.mockImplementationOnce(async (to, buf, caption, mime, opts) => {
      if (opts && typeof opts.onError === 'function') {
        opts.onError(Object.assign(new Error('Request failed with status code 400'), {
          response: { status: 400, data: { error: { message: 'Invalid parameter', code: 100 } } },
        }));
      }
      return false;
    });

    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockSend.sendTemplate).not.toHaveBeenCalled();
    expect(delivery().status).toBe('send_failed');
  });

  it('a 131047 on the teacher_tap path does NOT re-send the template', async () => {
    // The teacher just tapped, so the window is open by definition. Answering a
    // tap with another invite is a loop, and the tap is the event that is meant
    // to stop every further chase.
    mockRow.analysis_data.teacher_delivery.status = 'awaiting_teacher_tap';
    mockRow.analysis_data.teacher_delivery.template_sent_at = '2026-09-14T09:00:00Z';
    mockSend.sendImageFromBuffer.mockImplementationOnce(async (to, buf, caption, mime, opts) => {
      if (opts && typeof opts.onError === 'function') opts.onError(reEngagementError());
      return false;
    });

    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'teacher_tap', from: TEACHER });
    expect(mockSend.sendTemplate).not.toHaveBeenCalled();
    expect(delivery().status).toBe('send_failed');
  });

  it('the template fallback fires once, not on every retry of the same delivery', async () => {
    mockSend.sendImageFromBuffer.mockImplementation(async (to, buf, caption, mime, opts) => {
      if (opts && typeof opts.onError === 'function') opts.onError(reEngagementError());
      return false;
    });

    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockSend.sendTemplate).toHaveBeenCalledTimes(1);
    // A queue redelivery of the same job: the row now says awaiting_teacher_tap,
    // which the untapped planner owns. Nothing here may invite her again.
    await ObserveSend.processTeacherReport(SESSION_ID, { phase: 'deliver', from: COACH });
    expect(mockSend.sendTemplate).toHaveBeenCalledTimes(1);
  });
});
