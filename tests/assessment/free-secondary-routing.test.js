/**
 * bd-5jmnfj.38.31 — a free (no board pattern) paper for grade 6 and up is written by the grades 6-12
 * free service; grades 1-5 keep the generation service's generateExam. Fictional fixture data only.
 */
const mockGenerateExam = jest.fn();
const mockSecondaryExam = jest.fn();
const mockLoadChapterContent = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent, loadPageRangeContent: jest.fn(),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam }));
jest.mock('../../bot/shared/services/assessment/free-secondary.service', () => ({ generateExam: mockSecondaryExam }));
jest.mock('../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: () => '<html>paper</html>', renderAnswerKey: () => '<html>key</html>',
  totalMarks: () => 11, collectQuestions: () => [],
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: async () => Buffer.from('%PDF-1.4 fake') }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: async () => 'exams/u/p/x.pdf', buildR2PublicUrl: () => 'https://r2/x.pdf',
  getPresignedUrl: async () => 'https://r2/x.pdf?signed',
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(), sendFlow: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbResults = [];
function mockBuilder() {
  const done = () => Promise.resolve(mockDbResults.shift() || { data: null, error: null });
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: done, maybeSingle: done, then: (res, rej) => done().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const GENERATED = {
  examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } },
  questionCount: 1, tokenData: { inputTokens: 1, outputTokens: 1, model: 'm' },
};
const job = (grade) => ({
  userId: 'user-1', requestId: `req-${grade}`, grade, subject: 'general_science', chapterNumber: 1,
  questionTypes: [{ id: 'mcq', count: 4, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDbResults.length = 0;
  mockDbResults.push({ data: { id: 'paper-1' }, error: null });
  mockLoadChapterContent.mockResolvedValue({ content: '=== Page 2 ===\ntext', pageReference: '2-4', chapterTitle: 'Matter' });
  mockGenerateExam.mockResolvedValue(GENERATED);
  mockSecondaryExam.mockResolvedValue(GENERATED);
});

describe('free paper routing by grade', () => {
  it.each([6, 7, 8, '7'])('grade %p goes to the grades 6-12 free service', async (grade) => {
    const out = await Orchestrator.buildPaper(job(grade));
    expect(out.status).toBe('ready');
    expect(mockSecondaryExam).toHaveBeenCalledTimes(1);
    expect(mockSecondaryExam.mock.calls[0][0]).toMatchObject({ grade, subject: 'general_science', includeAnswerKey: true, chapterTitle: 'Matter', keySeed: 'paper-1' });
    expect(mockGenerateExam).not.toHaveBeenCalled();
  });

  it.each([1, 5, '5'])('grade %p keeps the generation service', async (grade) => {
    const out = await Orchestrator.buildPaper(job(grade));
    expect(out.status).toBe('ready');
    expect(mockGenerateExam).toHaveBeenCalledTimes(1);
    expect(mockGenerateExam.mock.calls[0][0]).not.toHaveProperty('chapterTitle');
    expect(mockGenerateExam.mock.calls[0][0]).not.toHaveProperty('keySeed');
    expect(mockSecondaryExam).not.toHaveBeenCalled();
  });
});
