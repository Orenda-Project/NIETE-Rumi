/**
 * The orchestrator asks "was this paper useful?" once the paper and its key are in her chat.
 * Executes the real orchestrator (network boundary mocked, harness as in
 * assessment-orchestrator.service.test.js) and pins that the survey is scheduled on a delivered
 * WhatsApp paper — and never on a failed one or a portal build, where nobody is in a chat to ask.
 */

const mockSchedule = jest.fn();
jest.mock('../../bot/shared/services/assessment/assessment-feedback.service', () => ({
  scheduleAssessmentFeedback: mockSchedule,
}));

const mockLoadChapterContent = jest.fn();
const mockLoadPageRangeContent = jest.fn();
const mockGenerateExam = jest.fn();
const mockRenderPaper = jest.fn();
const mockRenderAnswerKey = jest.fn();
const mockHtmlToPdf = jest.fn();
const mockUploadExamBuffer = jest.fn();
const mockBuildR2PublicUrl = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent,
  loadPageRangeContent: mockLoadPageRangeContent,
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam }));
jest.mock('../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: mockRenderPaper, renderAnswerKey: mockRenderAnswerKey, totalMarks: () => 11, collectQuestions: () => [],
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: mockHtmlToPdf }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: mockUploadExamBuffer,
  buildR2PublicUrl: mockBuildR2PublicUrl,
  getPresignedUrl: mockGetPresignedUrl,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocumentByLink: mockSendDocumentByLink,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { (state.eq ||= []).push([c, v]); return b; },
    single: () => { mockDbCalls.push({ ...state }); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }); },
    maybeSingle: () => { mockDbCalls.push({ ...state }); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }); },
    then: (res, rej) => { mockDbCalls.push({ ...state }); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }).then(res, rej); },
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = {
  userId: 'user-1',
  requestId: 'req-1',
  grade: 1,
  subject: 'english',
  chapterNumber: 1,
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }],
  contentSource: 'unseen',
  outputFormat: 'pdf',
};

const USER = { phone_number: '923001234567', preferred_language: 'en', school_name: 'GGPS G-9' };

function happyPath() {
  mockDbResults.push({ data: USER, error: null });                 // user lookup
  mockDbResults.push({ data: { id: 'paper-1' }, error: null });    // paper insert
  mockLoadChapterContent.mockResolvedValue({
    content: '=== Page 4 ===\ntext', pageReference: '4-14',
    chapterTitle: 'Hello World!', pageCount: 11,
  });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } },
    questionCount: 4,
    tokenData: { inputTokens: 10, outputTokens: 5, model: 'm' },
  });
  mockRenderPaper.mockReturnValue('<html>paper</html>');
  mockHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockUploadExamBuffer.mockResolvedValue('exams/user-1/paper-1/x.pdf');
  mockBuildR2PublicUrl.mockReturnValue('https://r2/exams/x.pdf');
  mockGetPresignedUrl.mockResolvedValue('https://r2/exams/x.pdf?signed');
  mockSendMessage.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue(true);
}

beforeEach(() => {
  mockDbCalls.length = 0; mockDbResults.length = 0;
  jest.clearAllMocks();
});

describe('the assessment survey is scheduled after delivery', () => {
  it('a delivered WhatsApp paper schedules the survey for that paper and teacher', async () => {
    happyPath();
    const out = await Orchestrator.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledWith({ paperId: 'paper-1', userId: 'user-1', phone: '923001234567' });
  });

  it('a paper that failed to send schedules nothing', async () => {
    happyPath();
    mockSendDocumentByLink.mockResolvedValue(false);
    const out = await Orchestrator.process(JOB);
    expect(out.status).not.toBe('ready');
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('a portal build schedules nothing', async () => {
    happyPath();
    await Orchestrator.process({ ...JOB, deliver: 'none' });
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('a survey that cannot be scheduled never turns a delivered paper into a failure', async () => {
    happyPath();
    mockSchedule.mockImplementation(() => { throw new Error('boom'); });
    const out = await Orchestrator.process(JOB);
    expect(out.status).toBe('ready');
  });
});
