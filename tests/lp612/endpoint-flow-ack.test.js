/**
 * bd-2ym0h — the Flow's own closing line, exercised through the real dispatch.
 *
 * A catalog assertion alone would not have caught this. Root CLAUDE.md rule 6:
 * the red test has to EXECUTE the changed line, or a green suite ships a
 * guaranteed ReferenceError on a path no test ever entered. So this drives
 * `handlePakistanLpDataExchange` end to end with only the network boundary
 * mocked, and reads what the endpoint actually puts on the wire.
 *
 * What it pins:
 *  - the SUCCESS screen no longer tells her "in a moment" about a five-minute job
 *  - the sentence comes from the catalog, in HER language, not hardcoded English
 *  - serving is still fire-and-forget (data_exchange has ~10s; authoring has minutes)
 */

const mockRequestLesson = jest.fn();

jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  buildGradeItems: jest.fn(), buildSubjectItems: jest.fn(),
  buildChapterItems: jest.fn(), buildSegmentItems: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({
  requestLesson: mockRequestLesson,
}));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({
  gradeWord: (g) => `Grade ${g}`, deliverOxbridgeLp: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn().mockResolvedValue(new Set()),
  downloadedLessonIds: jest.fn().mockResolvedValue(new Set()),
  deliverV8Lesson: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => k, getPresignedUrl: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

// The one thing this suite varies: the language on her user row.
let mockUserLanguage = 'en';
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const settle = () => (table === 'users'
      ? Promise.resolve({ data: { phone_number: '923001234567', preferred_language: mockUserLanguage }, error: null })
      : Promise.resolve({ data: [], error: null }));
    const b = {
      select: () => b, eq: () => b, single: settle, maybeSingle: settle,
      then: (res, rej) => settle().then(res, rej),
    };
    return b;
  }),
}));

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const tapSubtopic = () => Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
  step: 'lp612_segment', segment_id: 'grade_9_physics.c01.p007-008',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserLanguage = 'en';
  process.env.LP_612_ENABLED = 'true';
  mockRequestLesson.mockResolvedValue({ outcome: 'queued' });
});

afterEach(() => { delete process.env.LP_612_ENABLED; });

describe('the SUCCESS screen the teacher reads first', () => {
  test('does not promise a moment for a job that takes minutes', async () => {
    const res = await tapSubtopic();
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).not.toMatch(/in a moment/i);
  });

  test('points her at the chat, which is where the lesson actually lands', async () => {
    const res = await tapSubtopic();
    expect(res.data.message).toMatch(/chat/i);
  });

  test('is the catalog string, not a sentence written into the route', async () => {
    const res = await tapSubtopic();
    expect(res.data.message).toBe(UX_STRINGS.lp612FlowAck.en);
  });

  test('an Urdu teacher is answered in Urdu', async () => {
    mockUserLanguage = 'ur';
    const res = await tapSubtopic();
    expect(res.data.message).toBe(UX_STRINGS.lp612FlowAck.ur);
    // Guards against a floor-to-English regression that a truthiness check misses.
    expect(res.data.message).not.toBe(UX_STRINGS.lp612FlowAck.en);
  });

  test('a language we do not offer falls to the emergency floor, not to a crash', async () => {
    mockUserLanguage = 'sw';
    const res = await tapSubtopic();
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).toBe(UX_STRINGS.lp612FlowAck.en);
  });

  test('a user row with no language set still gets a sentence', async () => {
    mockUserLanguage = null;
    const res = await tapSubtopic();
    expect(res.data.message).toBeTruthy();
  });
});

describe('the screen still returns before authoring does', () => {
  test('SUCCESS comes back without waiting for the lesson to be written', async () => {
    let release;
    mockRequestLesson.mockReturnValue(new Promise((r) => { release = r; }));
    const res = await tapSubtopic();
    expect(res.screen).toBe('SUCCESS');
    expect(mockRequestLesson).toHaveBeenCalledTimes(1);
    release({ outcome: 'queued' });
  });

  test('her language is the one handed to serving, so the ack matches this screen', async () => {
    mockUserLanguage = 'ur';
    await tapSubtopic();
    expect(mockRequestLesson).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ur' }));
  });
});
