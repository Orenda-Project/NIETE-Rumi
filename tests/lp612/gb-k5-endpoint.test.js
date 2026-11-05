'use strict';
/**
 * bd-rj6w0n.14.4 — the Pakistan LP Flow endpoint, for a Gilgit-Baltistan teacher.
 *
 * Whose books she reads is book-curriculum.service (#4091): 'nbf_snc' for a GB teacher, 'ict' otherwise.
 * LP_GB_K5_ENABLED off: no GB lane, her language is never read, and every catalogue call is #4091's.
 * On: a GB teacher's picker is Grades 1-5 and her 6-12 catalogue reads say nbf_snc; an ICT teacher's
 * calls carry no curriculum (#4091: ICT asks nothing) and her Grades 1-5 stay on the K-5 v8 corpus.
 */
const mockCat = {
  buildGradeItems: jest.fn(), buildSubjectItems: jest.fn(), buildChapterItems: jest.fn(),
  buildSegmentItems: jest.fn(), segmentById: jest.fn(),
};
const mockCurriculum = jest.fn();
const mockLanguage = jest.fn();
jest.mock('../../bot/shared/services/lp612-catalog.service', () => mockCat);
jest.mock('../../bot/shared/services/book-curriculum.service', () => ({
  ...jest.requireActual('../../bot/shared/services/book-curriculum.service'),
  curriculumForUser: (...a) => mockCurriculum(...a),
}));
jest.mock('../../bot/shared/services/lp612-curriculum.service', () => ({
  ...jest.requireActual('../../bot/shared/services/lp612-curriculum.service'),
  languageForUserId: (...a) => mockLanguage(...a),
}));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({ requestLesson: jest.fn() }));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({ gradeWord: (g) => `Grade ${g}`, deliverOxbridgeLp: jest.fn() }));
const mockV8Available = jest.fn();
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: (...a) => mockV8Available(...a), downloadedLessonIds: jest.fn().mockResolvedValue(new Set()), deliverV8Lesson: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ buildR2PublicUrl: (k) => k, getPresignedUrl: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => {
  const b = { select: () => b, eq: () => b, single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }),
    range: () => Promise.resolve({ data: [], error: null }), then: (r) => Promise.resolve({ data: [], error: null }).then(r) };
  return { from: () => b };
});

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');

const SUBJECT_ROW = { id: 'English', 'main-content': { title: 'English' }, 'on-click-action': { name: 'data_exchange', payload: { step: 'lp612_subject' } } };
const GB = { curriculum: 'nbf_snc' };
const saved = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...saved };
  delete process.env.LP_612_ROUTE_K5;
  process.env.LP_612_ENABLED = 'true';
  mockCat.buildGradeItems.mockResolvedValue([{ id: '11' }]);
  mockCat.buildSubjectItems.mockResolvedValue([SUBJECT_ROW]);
  mockCat.buildChapterItems.mockResolvedValue({ items: [SUBJECT_ROW], hasMore: false, total: 1, page: 1 });
  mockCat.buildSegmentItems.mockResolvedValue({ items: [SUBJECT_ROW], hasMore: false, total: 1 });
  mockV8Available.mockResolvedValue(new Set());
  mockLanguage.mockResolvedValue('en');
});
afterAll(() => { process.env = saved; });

const grades = (res) => res.data.items.map((i) => i.id);
const step = (data) => Endpoint.handlePakistanLpDataExchange('u-1:tok', 'X', data);

describe('LP_GB_K5_ENABLED off', () => {
  beforeEach(() => { delete process.env.LP_GB_K5_ENABLED; mockCurriculum.mockResolvedValue('ict'); });

  test('no GB lane: today\'s picker, today\'s catalogue calls', async () => {
    expect(grades(await Endpoint.handlePakistanLpInit('u-1:tok'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    await step({ step: 'grade', grade: '6' });
    await step({ step: 'lp612_subject', grade: '6', subject: 'English' });
    await step({ step: 'lp612_chapter', grade: '6', subject: 'English', chapter_key: 'c01' });
    expect(mockLanguage).not.toHaveBeenCalled();
    expect(mockCat.buildGradeItems.mock.calls[0]).toEqual([]);
    expect(mockCat.buildSubjectItems.mock.calls[0]).toEqual([6]);
    expect(mockCat.buildChapterItems.mock.calls[0]).toEqual([6, 'English', 1]);
    expect(mockCat.buildSegmentItems.mock.calls[0]).toEqual([6, 'English', 'c01', 1, null]);
  });
});

describe('LP_GB_K5_ENABLED on', () => {
  beforeEach(() => { process.env.LP_GB_K5_ENABLED = 'true'; });

  test('a GB teacher (book-curriculum says nbf_snc) gets Grades 1-5 and catalogue reads that say nbf_snc', async () => {
    mockCurriculum.mockResolvedValue('nbf_snc');
    expect(grades(await Endpoint.handlePakistanLpInit('u-1:tok'))).toEqual(['1', '2', '3', '4', '5']);
    expect(mockCurriculum).toHaveBeenCalledWith('u-1');
    expect(mockLanguage).toHaveBeenCalledWith('u-1');

    const res = await step({ step: 'grade', grade: '2' });
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(mockCat.buildSubjectItems).toHaveBeenCalledWith(2, GB);
    expect(mockV8Available).not.toHaveBeenCalled();

    await step({ step: 'lp612_subject', grade: '2', subject: 'English' });
    await step({ step: 'lp612_chapter_page', grade: '2', subject: 'English', page: '2' });
    await step({ step: 'lp612_chapter', grade: '2', subject: 'English', chapter_key: 'c01', book_stem: 'nbf_snc_grade_2_english' });
    await step({ step: 'lp612_segment_page', grade: '2', subject: 'English', chapter_key: 'c01', page: '2' });
    expect(mockCat.buildChapterItems.mock.calls).toEqual([[2, 'English', 1, GB], [2, 'English', 2, GB]]);
    expect(mockCat.buildSegmentItems.mock.calls).toEqual([[2, 'English', 'c01', 1, 'nbf_snc_grade_2_english', GB], [2, 'English', 'c01', 2, null, GB]]);
  });

  test('a GB teacher cannot open a grade above 5', async () => {
    mockCurriculum.mockResolvedValue('nbf_snc');
    const res = await step({ step: 'grade', grade: '9' });
    expect(res.data.error).toBeTruthy();
    expect(mockCat.buildSubjectItems).not.toHaveBeenCalled();
  });

  test('an ICT teacher keeps her picker and K-5 corpus; her 6-12 calls are #4091\'s ICT calls', async () => {
    mockCurriculum.mockResolvedValue('ict');
    expect(grades(await Endpoint.handlePakistanLpInit('u-1:tok'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    expect(mockCat.buildGradeItems.mock.calls[0]).toEqual([]);
    expect(mockLanguage).not.toHaveBeenCalled();
    await step({ step: 'grade', grade: '2' });
    expect(mockV8Available).toHaveBeenCalled();
    expect(mockCat.buildSubjectItems).not.toHaveBeenCalled();
    await step({ step: 'grade', grade: '6' });
    expect(mockCat.buildSubjectItems.mock.calls[0]).toEqual([6]);
  });
});
