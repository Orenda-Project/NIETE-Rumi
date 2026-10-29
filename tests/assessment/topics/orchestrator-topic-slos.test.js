/**
 * Task 6 — the plain branch of buildPaper hands a topic job's SLOs to generateExam, and nothing else changes:
 * a job without a topic scope calls generateExam with no `slos` key at all.
 */
const mockLoadChapterContent = jest.fn();
const mockLoadPageRangeContent = jest.fn();
const mockGenerateExam = jest.fn();

jest.mock('../../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent, loadPageRangeContent: mockLoadPageRangeContent,
}));
jest.mock('../../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam, generateTopicOral: jest.fn(async () => null) }));
jest.mock('../../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: () => '<html/>', renderAnswerKey: () => '<html/>', totalMarks: () => 1, collectQuestions: () => [],
}));
jest.mock('../../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF')) }));
jest.mock('../../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async () => 'exams/x.pdf'), buildR2PublicUrl: () => 'https://r2/x.pdf',
  getPresignedUrl: jest.fn(async () => 'https://r2/x.pdf?s'),
}));
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(), sendFlow: jest.fn(),
}));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
function mockBuilder() {
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: () => Promise.resolve({ data: { id: 'paper-1' }, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
  };
  return b;
}
jest.mock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));

const Orchestrator = require('../../../bot/shared/services/assessment/assessment-orchestrator.service');

const SLOS = [{ code: 'E-1', description: 'Skill 1', topicId: 't1', topicName: 'Topic 1' }];
const JOB = {
  userId: 'user-1', requestId: 'req-1', grade: 3, subject: 'english', chapterNumber: null, pageRanges: '58-59, 90-91',
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadPageRangeContent.mockResolvedValue({ content: 'text', pageReference: '58-59, 90-91' });
  mockLoadChapterContent.mockResolvedValue({ content: 'text', pageReference: '4-14', chapterTitle: 'T', pageCount: 11 });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } }, questionCount: 4,
    tokenData: { inputTokens: 1, outputTokens: 1, model: 'm' },
  });
});

test('a topic job passes its slos to generateExam', async () => {
  await Orchestrator.buildPaper({ ...JOB, scope: { kind: 'topics', topicIds: ['t1'], slos: SLOS } });
  expect(mockLoadPageRangeContent).toHaveBeenCalledWith({ grade: 3, subject: 'english', pageRanges: '58-59, 90-91' });
  expect(mockGenerateExam.mock.calls[0][0].slos).toEqual(SLOS);
});

test('a chapter job passes no slos key', async () => {
  await Orchestrator.buildPaper({ ...JOB, chapterNumber: 4 });
  expect(mockGenerateExam.mock.calls[0][0]).not.toHaveProperty('slos');
});
