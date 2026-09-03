/**
 * The 6-12 lane inside the Pakistan LP Flow.
 *
 * This lane shares a Flow, a grade picker and an endpoint with two corpora that
 * are already live — the K-5 v8 catalogue and the Oxbridge 6-10 picker. So the
 * first and most important thing asserted here is what happens when
 * LP_612_ENABLED is off: the answer must be "exactly what happened yesterday",
 * because that is the condition this code merged under.
 *
 * After that: the lane routes grade -> subject -> chapter -> subtopic off the
 * segments table, falls back to Oxbridge for any 6-10 grade the corpus has not
 * reached yet, and hands a tapped subtopic to serving without waiting for it
 * (data_exchange has roughly a ten-second budget; authoring takes minutes).
 */

const mockBuildSubjectItems = jest.fn();
const mockBuildChapterItems = jest.fn();
const mockBuildSegmentItems = jest.fn();
const mockBuildGradeItems = jest.fn();
const mockRequestLesson = jest.fn();
const mockFetchOxbridge = jest.fn();

jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  buildGradeItems: mockBuildGradeItems,
  buildSubjectItems: mockBuildSubjectItems,
  buildChapterItems: mockBuildChapterItems,
  buildSegmentItems: mockBuildSegmentItems,
}));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({
  requestLesson: mockRequestLesson,
}));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({
  gradeWord: (g) => `Grade ${g}`,
  deliverOxbridgeLp: jest.fn(),
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

let oxbridgeRows = [];
function mockBuilder(table) {
  const state = { table, filters: [] };
  const settle = () => {
    if (table === 'lesson_plan_catalog') return Promise.resolve({ data: oxbridgeRows, error: null });
    if (table === 'users') {
      return Promise.resolve({
        data: { phone_number: '923001234567', preferred_language: 'en' }, error: null,
      });
    }
    return Promise.resolve({ data: [], error: null });
  };
  const b = {
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');

const NAV_ROW = {
  id: 'Chemistry',
  'main-content': { title: 'Chemistry' },
  'on-click-action': { name: 'data_exchange', payload: { step: 'lp612_subject' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  oxbridgeRows = [];
  delete process.env.LP_612_ENABLED;
  mockBuildGradeItems.mockResolvedValue([]);
  mockBuildSubjectItems.mockResolvedValue([]);
  mockBuildChapterItems.mockResolvedValue([]);
  mockBuildSegmentItems.mockResolvedValue({ items: [], hasMore: false, total: 0 });
  mockRequestLesson.mockResolvedValue({ outcome: 'queued' });
});

// ── inert while the flag is off ─────────────────────────────────────────────

describe('with LP_612_ENABLED off, nothing about today changes', () => {
  test('grade 9 still goes to Oxbridge and the 6-12 catalogue is never consulted', async () => {
    oxbridgeRows = [{ id: 1, subject: 'Physics', chapter_title: 'Motion' }];

    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_GRADE', {
      step: 'grade', grade: '9',
    });

    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items[0].id).toBe('Physics');
    expect(mockBuildSubjectItems).not.toHaveBeenCalled();
  });

  test('the grade picker stops at 10 — 11 and 12 do not exist yet for a teacher', async () => {
    const res = await Endpoint.handlePakistanLpInit('u1:tok');
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(mockBuildGradeItems).not.toHaveBeenCalled();
  });

  test('a 6-12 step arriving out of nowhere is refused, not served', async () => {
    // Old rows live forever in a teacher's scrollback. A tap on a row from a
    // flagged-on window must not serve once the flag goes back off.
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_SUBJECT', {
      step: 'lp612_segment', segment_id: 'grade_9_chemistry.c01.p007-008',
    });
    expect(mockRequestLesson).not.toHaveBeenCalled();
    expect(res.data.error).toBeTruthy();
  });

  test('the chapter More step is refused while the flag is off, like every other step', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_CHAPTER', {
      step: 'lp612_chapter_page', grade: '9', subject: 'Islamiat', page: '2',
    });
    expect(mockBuildChapterItems).not.toHaveBeenCalled();
    expect(res.data.error).toBeTruthy();
  });
});

// ── the lane, once it is on ─────────────────────────────────────────────────

describe('with LP_612_ENABLED on', () => {
  beforeEach(() => { process.env.LP_612_ENABLED = 'true'; });

  test('grade 9 serves the 6-12 corpus when it has one', async () => {
    mockBuildSubjectItems.mockResolvedValue([NAV_ROW]);

    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_GRADE', {
      step: 'grade', grade: '9',
    });

    expect(mockBuildSubjectItems).toHaveBeenCalledWith(9);
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items).toEqual([NAV_ROW]);
  });

  test('a 6-10 grade the corpus has not reached still falls back to Oxbridge', async () => {
    // 70 Oxbridge LPs are live. Shipping this lane must not take them away from
    // a grade whose books the segmentation fleet has not finished.
    mockBuildSubjectItems.mockResolvedValue([]);
    oxbridgeRows = [{ id: 1, subject: 'Physics', chapter_title: 'Motion' }];

    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_GRADE', {
      step: 'grade', grade: '9',
    });

    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items[0].id).toBe('Physics');
  });

  test('grades 11 and 12 appear only when the corpus actually has them', async () => {
    mockBuildGradeItems.mockResolvedValue([
      { id: '11', 'main-content': { title: 'Grade 11' }, 'on-click-action': {} },
    ]);
    const res = await Endpoint.handlePakistanLpInit('u1:tok');
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  });

  test('subject -> chapter routes on the 6-12 step', async () => {
    mockBuildChapterItems.mockResolvedValue({ items: [NAV_ROW], hasMore: false, total: 1 });
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_SUBJECT', {
      step: 'lp612_subject', grade: '9', subject: 'Chemistry',
    });
    expect(mockBuildChapterItems).toHaveBeenCalledWith(9, 'Chemistry');
    expect(res.screen).toBe('SELECT_CHAPTER');
    expect(res.data.items).toEqual([NAV_ROW]);
  });

  test('the chapter More row opens a SECOND screen — chapter 21 of 27 must exist', async () => {
    // 53 chapters across 13 books were unreachable when the chapter list
    // silently sliced at 20 with no More row (bd-3r01z).
    mockBuildChapterItems.mockResolvedValue({ items: [NAV_ROW], hasMore: false, total: 27 });
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_CHAPTER', {
      step: 'lp612_chapter_page', grade: '9', subject: 'Islamiat', page: '2',
    });
    expect(mockBuildChapterItems).toHaveBeenCalledWith(9, 'Islamiat', 2);
    expect(res.screen).toBe('SELECT_CHAPTER_MORE');
  });

  test('chapter -> subtopic routes on the 6-12 step', async () => {
    mockBuildSegmentItems.mockResolvedValue({ items: [NAV_ROW], hasMore: false, total: 1 });
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_CHAPTER', {
      step: 'lp612_chapter', grade: '9', subject: 'Chemistry', chapter_key: 'c01',
    });
    expect(mockBuildSegmentItems).toHaveBeenCalledWith(9, 'Chemistry', 'c01', 1);
    expect(res.screen).toBe('SELECT_LESSON');
  });

  test('the More row opens a SECOND screen — Meta rejects a self-route', async () => {
    mockBuildSegmentItems.mockResolvedValue({ items: [NAV_ROW], hasMore: false, total: 1 });
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment_page', grade: '9', subject: 'Chemistry', chapter_key: 'c01', page: '2',
    });
    expect(mockBuildSegmentItems).toHaveBeenCalledWith(9, 'Chemistry', 'c01', 2);
    expect(res.screen).toBe('SELECT_LESSON_MORE');
  });

  test('an empty chapter says so instead of rendering a dead screen', async () => {
    mockBuildSegmentItems.mockResolvedValue({ items: [], hasMore: false, total: 0 });
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_CHAPTER', {
      step: 'lp612_chapter', grade: '9', subject: 'Chemistry', chapter_key: 'c01',
    });
    expect(res.data.error).toBeTruthy();
  });
});

// ── the tap that authors a lesson ───────────────────────────────────────────

describe('tapping a subtopic', () => {
  beforeEach(() => { process.env.LP_612_ENABLED = 'true'; });

  test('returns SUCCESS immediately and does not wait for serving', async () => {
    // data_exchange has roughly a ten-second budget; a first hit takes minutes.
    // Blocking on it would fail the Flow AND still author the lesson.
    let resolveServing;
    mockRequestLesson.mockReturnValue(new Promise((r) => { resolveServing = r; }));

    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: 'grade_9_chemistry.c01.p007-008',
    });

    expect(res.screen).toBe('SUCCESS');
    expect(mockRequestLesson).toHaveBeenCalledTimes(1);
    resolveServing({ outcome: 'queued' });
  });

  test('serving is handed the teacher, her phone and her language', async () => {
    await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: 'grade_9_chemistry.c01.p007-008',
    });
    expect(mockRequestLesson).toHaveBeenCalledWith(expect.objectContaining({
      segmentId: 'grade_9_chemistry.c01.p007-008',
      userId: 'user-1',
      phone: '923001234567',
      lang: 'en',
    }));
  });

  test('a tap with no segment id is refused rather than queued', async () => {
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment',
    });
    expect(mockRequestLesson).not.toHaveBeenCalled();
    expect(res.data.error).toBeTruthy();
  });

  test('a serving failure after the SUCCESS screen is logged, not thrown into the Flow', async () => {
    mockRequestLesson.mockRejectedValue(new Error('db down'));
    const res = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: 'seg',
    });
    expect(res.screen).toBe('SUCCESS');
    await new Promise((r) => setImmediate(r));   // let the fire-and-forget settle
  });
});
