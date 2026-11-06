/**
 * The repeat guard reaches the writer: buildPaper hands generateExam the teacher's earlier
 * questions on these pages, and generateExam puts them in the writer's prompt. A job with
 * nothing to avoid calls generateExam exactly as before (no avoidQuestions key), so every
 * other paper is unchanged.
 */
const mockLoadChapterContent = jest.fn();
const mockLoadPageRangeContent = jest.fn();
const mockGenerateExam = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent, loadPageRangeContent: mockLoadPageRangeContent,
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam, generateTopicOral: jest.fn(async () => null) }));
jest.mock('../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: () => '<html/>', renderAnswerKey: () => '<html/>', totalMarks: () => 1, collectQuestions: () => [],
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async () => 'exams/x.pdf'), buildR2PublicUrl: () => 'https://r2/x.pdf',
  getPresignedUrl: jest.fn(async () => 'https://r2/x.pdf?s'),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(), sendFlow: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
function mockBuilder() {
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: () => Promise.resolve({ data: { id: 'paper-1' }, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
  };
  return b;
}
const mockPrevious = jest.fn();
jest.mock('../../bot/shared/services/assessment/repeat-guard', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/repeat-guard'),
  previousQuestions: (...a) => mockPrevious(...a),
}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = {
  userId: 'user-1', requestId: 'req-1', grade: 3, subject: 'english', chapterNumber: null, pageRanges: '71-84',
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadPageRangeContent.mockResolvedValue({ content: 'text', pageReference: '71-84' });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } }, questionCount: 4,
    tokenData: { inputTokens: 1, outputTokens: 1, model: 'm' },
  });
});

describe('buildPaper', () => {
  test('her earlier questions go to the writer', async () => {
    mockPrevious.mockResolvedValue(['What is a rocket?']);
    await Orchestrator.buildPaper(JOB);
    expect(mockPrevious).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', grade: 3 }));
    expect(mockGenerateExam.mock.calls[0][0].avoidQuestions).toEqual(['What is a rocket?']);
  });

  test('nothing to avoid: generateExam is called exactly as before', async () => {
    mockPrevious.mockResolvedValue([]);
    await Orchestrator.buildPaper(JOB);
    expect(mockGenerateExam.mock.calls[0][0]).not.toHaveProperty('avoidQuestions');
  });
});

describe('generateExam', () => {
  const mockCreate = jest.fn();
  let Gen;
  beforeAll(() => {
    jest.isolateModules(() => {
      jest.doMock('../../bot/shared/services/llm-client', () => ({
        getClient: () => ({ chat: { completions: { create: mockCreate } } }),
      }));
      Gen = jest.requireActual('../../bot/shared/services/assessment/assessment-generation.service');
    });
  });
  const userMsg = async (extra) => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', options: ['a) 1'], answer: 'a', marks: 1, blooms: 'Remember' }] } } }) } }], usage: {} });
    await Gen.generateExam({
      grade: 3, subject: 'Eng', pageContent: 'x', pageReference: '71-84', contentSource: 'unseen',
      questionTypes: [{ id: 'MCQs', count: 1, category: 'objective' }], includeAnswerKey: true, ...extra,
    });
    return mockCreate.mock.calls[0][0].messages[1].content;
  };

  test('the writer is told what she already has', async () => {
    const msg = await userMsg({ avoidQuestions: ['What is a rocket?'] });
    expect(msg).toMatch(/already has a paper on these pages/);
    expect(msg).toContain('- What is a rocket?');
  });

  test('no list, no note: the prompt is unchanged', async () => {
    const plain = await userMsg({});
    expect(await userMsg({ avoidQuestions: [] })).toBe(plain);
    expect(plain).not.toMatch(/already has a paper/);
  });
});
