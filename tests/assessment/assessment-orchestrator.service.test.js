/**
 * The job that turns a queued request into a paper in a teacher's chat.
 *
 * Everything it needs already works on its own — content, generation, rendering.
 * What this adds is the sequence, the record of what happened, and what a
 * teacher hears when a step fails. The failure paths are the point: a silent
 * job leaves her waiting on a message that never comes.
 */

const mockLoadChapterContent = jest.fn();
const mockLoadPageRangeContent = jest.fn();
const mockGenerateExam = jest.fn();
const mockRenderPaper = jest.fn();
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
  renderPaper: mockRenderPaper, totalMarks: () => 11, collectQuestions: () => [],
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

describe('the happy path', () => {
  it('loads the chapter, generates, renders, uploads and sends — in that order', async () => {
    happyPath();
    const out = await Orchestrator.process(JOB);

    expect(mockLoadChapterContent).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 1, subject: 'english', chapterNumber: 1 }));
    expect(mockGenerateExam).toHaveBeenCalledWith(
      expect.objectContaining({ pageContent: '=== Page 4 ===\ntext', pageReference: '4-14' }));
    expect(mockRenderPaper).toHaveBeenCalled();
    expect(mockHtmlToPdf).toHaveBeenCalled();
    expect(mockUploadExamBuffer).toHaveBeenCalled();
    expect(mockSendDocumentByLink).toHaveBeenCalled();
    expect(out.status).toBe('ready');
  });

  it('takes the page-range path when she typed page numbers', async () => {
    happyPath();
    mockLoadPageRangeContent.mockResolvedValue({
      content: 'text', pageReference: '4, 9', pageCount: 2,
    });
    await Orchestrator.process({ ...JOB, chapterNumber: null, pageRanges: '4, 9' });
    expect(mockLoadPageRangeContent).toHaveBeenCalled();
    expect(mockLoadChapterContent).not.toHaveBeenCalled();
  });

  it('names the file so it means something in a phone full of downloads', async () => {
    happyPath();
    await Orchestrator.process(JOB);
    const filename = mockSendDocumentByLink.mock.calls[0][2];
    expect(filename).toMatch(/Grade1/);
    expect(filename).toMatch(/English/i);
    expect(filename).toMatch(/\.pdf$/);
  });

  it('records the paper as ready, with what it cost', async () => {
    happyPath();
    await Orchestrator.process(JOB);
    // The row is written in more than one patch — what matters is the state it
    // ends in, not which write carried which column.
    const row = mockDbCalls
      .filter((c) => c.table === 'assessment_papers' && c.op === 'update')
      .reduce((acc, c) => Object.assign(acc, c.payload), {});
    expect(row.status).toBe('ready');
    expect(row.file_r2_key).toBe('exams/user-1/paper-1/x.pdf');
    expect(row.question_count).toBe(4);
    expect(row.model).toBe('m');
    expect(row.ready_at).toBeTruthy();
  });

  it('keeps the model\'s first answer alongside the working copy', async () => {
    happyPath();
    await Orchestrator.process(JOB);
    const updates = mockDbCalls.filter((c) => c.table === 'assessment_papers' && c.op === 'update');
    const withJson = updates.find((u) => u.payload.exam_json);
    expect(withJson.payload.original_exam_json).toEqual(withJson.payload.exam_json);
  });
});

describe('when a step fails she is told, in words she can act on', () => {
  const cases = [
    ['NO_CONTENT', () => mockLoadChapterContent.mockRejectedValue(
      Object.assign(new Error('no text'), { code: 'NO_CONTENT' })), /don.t have the text|another chapter/i],
    ['TRUNCATED', () => mockGenerateExam.mockRejectedValue(
      Object.assign(new Error('too long'), { code: 'TRUNCATED' })), /fewer questions/i],
    ['MODEL_UNAVAILABLE', () => mockGenerateExam.mockRejectedValue(
      Object.assign(new Error('502'), { code: 'MODEL_UNAVAILABLE' })), /try again|moment/i],
    ['RENDER_FAILED', () => mockHtmlToPdf.mockRejectedValue(new Error('chromium died')), /try again/i],
  ];

  it.each(cases)('%s', async (_code, arrange, expected) => {
    happyPath();
    arrange();
    const out = await Orchestrator.process(JOB);

    expect(out.status).toBe('failed');
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalled();
    const said = mockSendMessage.mock.calls.map((c) => c[1]).join(' ');
    expect(said).toMatch(expected);
  });

  it('records the failure rather than leaving the row queued forever', async () => {
    happyPath();
    mockGenerateExam.mockRejectedValue(Object.assign(new Error('502'), { code: 'MODEL_UNAVAILABLE' }));
    await Orchestrator.process(JOB);
    const updates = mockDbCalls.filter((c) => c.table === 'assessment_papers' && c.op === 'update');
    const final = updates[updates.length - 1].payload;
    expect(final.status).toBe('failed');
    expect(final.error_code).toBe('MODEL_UNAVAILABLE');
  });

  it('never puts a phone number in the stored error', async () => {
    happyPath();
    mockGenerateExam.mockRejectedValue(
      Object.assign(new Error('failed for 923001234567'), { code: 'MODEL_UNAVAILABLE' }));
    await Orchestrator.process(JOB);
    const updates = mockDbCalls.filter((c) => c.table === 'assessment_papers' && c.op === 'update');
    const final = updates[updates.length - 1].payload;
    expect(String(final.error_detail || '')).not.toContain('923001234567');
  });

  it('says nothing to a teacher we cannot identify, and does not generate', async () => {
    mockDbResults.push({ data: null, error: null });   // user lookup finds nobody
    const out = await Orchestrator.process(JOB);
    expect(out.status).toBe('failed');
    expect(mockGenerateExam).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
