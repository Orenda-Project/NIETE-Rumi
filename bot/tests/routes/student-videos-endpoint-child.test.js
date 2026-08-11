/**
 * bd-2475 — the SAME Student Videos Flow (grade → subject → topic) now also
 * serves an anonymous quiz-taking CHILD, via a `childpick:` flow token
 * (child-flow-token.js) instead of the teacher's `<userId>:...` token.
 *
 * The behavioural fork that matters: a teacher who picks a video gets it
 * delivered, THEN OFFERED a quiz (buttons, opt-in, video_quiz_deliveries
 * tracked). A child must get the SAME video+quiz flow every other share_link
 * child gets — the video sent and the quiz started immediately, no offer
 * step, `source: 'share_link'` so `finish()` fires the invite-a-friend
 * branch, never the teacher's video_solo→offerShare branch (bd-2472/74's
 * whole point was keeping these two paths from leaking into each other).
 */

const {
  handleStudentVideosDataExchange,
} = require('../../shared/routes/student-videos-endpoint');
const ChildFlowToken = require('../../shared/services/quiz/child-flow-token');

let mockQueue = [];
jest.mock('../../shared/config/supabase', () => {
  const makeQuery = () => {
    const result = mockQueue.shift() || { data: null, error: null };
    const q = {
      select: () => q, eq: () => q, is: () => q, not: () => q,
      order: () => q, limit: () => q, insert: () => q, update: () => q,
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then: (resolve) => resolve(result),
    };
    return q;
  };
  return { from: jest.fn(() => makeQuery()) };
});

const WhatsAppService = require('../../shared/services/whatsapp.service');
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendVideoFromUrl: jest.fn().mockResolvedValue(true),
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const VideoQuizService = require('../../shared/services/quiz/video-quiz.service');
jest.mock('../../shared/services/quiz/video-quiz.service', () => ({
  quizForVideo: jest.fn(),
  startSession: jest.fn().mockResolvedValue({}),
  offerAfterVideo: jest.fn().mockResolvedValue(true),
}));

const supabase = require('../../shared/config/supabase');
const flush = () => new Promise((r) => setImmediate(r));

const ROW = {
  id: 'video-1', grade: '3', subject: 'Maths', clean_chapter: 'Numbers',
  clean_title: 'Identifying Even and Odd Numbers', r2_url: 'https://r2/sample.mp4',
  migration_status: 'done',
};

beforeEach(() => {
  mockQueue = [];
  jest.clearAllMocks();
});

describe('SELECT_TOPIC → deliver, child token', () => {
  const childToken = ChildFlowToken.build({
    phone: '923001234567', shareCodeId: 'sc-1', studentId: 'stu-1', language: 'ur',
  });

  test('quiz exists for the video: no direct send, startSession does it (mirrors startForStudent)', async () => {
    mockQueue = [
      { data: ROW, error: null },                    // row lookup
      { data: { student_name: 'Ayesha', self_reported_class: '3-A' }, error: null }, // students lookup
    ];
    VideoQuizService.quizForVideo.mockResolvedValue({ id: 'quiz-1', topic: 'Numbers' });

    const res = await handleStudentVideosDataExchange(childToken, 'SELECT_TOPIC', {
      grade: '3', subject: 'Maths', video: 'video-1',
    });
    expect(res.screen).toBe('SUCCESS');

    // Pre-delivery ack resolves phone straight from the token — no supabase round trip.
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(
      '923001234567', expect.stringContaining('Identifying Even and Odd Numbers'));

    await flush();

    // deliverVideoAsync must NOT send the video itself when a quiz exists —
    // startSession's own sendLessonFirst does, exactly once total.
    expect(WhatsAppService.sendVideoFromUrl).not.toHaveBeenCalled();

    expect(VideoQuizService.startSession).toHaveBeenCalledWith({
      phone: '923001234567', userId: null, quizId: 'quiz-1', videoId: 'video-1',
      language: 'ur', source: 'share_link',
      studentName: 'Ayesha', studentClass: '3-A',
      studentId: 'stu-1', shareCodeId: 'sc-1', invitedByStudentId: null,
    });

    // Never the teacher path.
    expect(VideoQuizService.offerAfterVideo).not.toHaveBeenCalled();
    const deliveryInsertCalls = supabase.from.mock.calls.filter(([t]) => t === 'video_quiz_deliveries');
    expect(deliveryInsertCalls).toHaveLength(0);
  });

  test('no quiz for the video: falls back to a plain send, no session started', async () => {
    mockQueue = [{ data: ROW, error: null }];
    VideoQuizService.quizForVideo.mockResolvedValue(null);

    await handleStudentVideosDataExchange(childToken, 'SELECT_TOPIC', {
      grade: '3', subject: 'Maths', video: 'video-1',
    });
    await flush();

    expect(WhatsAppService.sendVideoFromUrl).toHaveBeenCalledWith(
      '923001234567', 'https://r2/sample.mp4',
      expect.stringContaining('Identifying Even and Odd Numbers'));
    expect(VideoQuizService.startSession).not.toHaveBeenCalled();
    expect(VideoQuizService.offerAfterVideo).not.toHaveBeenCalled();
  });
});

describe('SELECT_TOPIC → deliver, teacher token (regression)', () => {
  test('unaffected by the child-token branch: still tracked + offered, never startSession directly', async () => {
    mockQueue = [
      { data: ROW, error: null },                              // row lookup
      { data: { phone_number: '923009999999' }, error: null }, // ack getPhoneForUser
      { data: { phone_number: '923009999999' }, error: null }, // delivery getPhoneForUser
    ];
    const res = await handleStudentVideosDataExchange('user-uuid-1:student-videos:123', 'SELECT_TOPIC', {
      grade: '3', subject: 'Maths', video: 'video-1',
    });
    expect(res.screen).toBe('SUCCESS');
    await flush();

    expect(WhatsAppService.sendVideoFromUrl).toHaveBeenCalledWith(
      '923009999999', 'https://r2/sample.mp4', expect.any(String));
    expect(VideoQuizService.startSession).not.toHaveBeenCalled();
    // offerAfterVideo IS still the teacher's post-delivery hook.
    expect(VideoQuizService.offerAfterVideo).toHaveBeenCalledTimes(1);
  });
});
