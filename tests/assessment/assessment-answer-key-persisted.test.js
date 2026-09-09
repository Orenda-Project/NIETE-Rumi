/**
 * bd-60068 — the answer key had nowhere to live.
 *
 * The bot has been generating answer keys, uploading them to R2, presigning
 * them, sending them, and then writing the storage key into a LOG LINE. Not a
 * column — a log line. The paper's location is persisted; the key's was not,
 * because until V1.4.2 there was no column to put it in.
 *
 * What that costs on WhatsApp, with no portal in the picture: a teacher who
 * deletes the chat has lost the answer key for good. The paper can be handed to
 * her again from file_r2_key; the key cannot. Regenerating is not a way back —
 * it runs the model again and produces DIFFERENT questions, so the key would no
 * longer match the paper she printed.
 *
 * These tests pin the column being written, and pin the two absences that must
 * stay absent so "no key" is never confused with "key we lost".
 */

const mockLoadChapterContent = jest.fn();
const mockGenerateExam = jest.fn();
const mockRenderPaper = jest.fn();
const mockRenderAnswerKey = jest.fn();
const mockHtmlToPdf = jest.fn();
const mockUploadExamBuffer = jest.fn();
const mockBuildR2PublicUrl = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockSendMessage = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockSendFlow = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent,
  loadPageRangeContent: jest.fn(),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam }));
jest.mock('../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: mockRenderPaper, renderAnswerKey: mockRenderAnswerKey,
  totalMarks: () => 11, collectQuestions: () => [],
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
  sendFlow: mockSendFlow,
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null };
  const rec = () => { mockDbCalls.push({ ...state }); };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { (state.eq ||= []).push([c, v]); return b; },
    single: () => { rec(); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }); },
    maybeSingle: () => { rec(); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }); },
    then: (r, j) => { rec(); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }).then(r, j); },
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = {
  userId: 'user-1', requestId: 'req-1', grade: 1, subject: 'english',
  chapterNumber: 1, questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }],
  contentSource: 'unseen', outputFormat: 'pdf',
};
const USER = { phone_number: '923001234567', preferred_language: 'en', school_name: 'GGPS G-9' };

function happyPath() {
  mockDbResults.push({ data: USER, error: null });
  mockDbResults.push({ data: { id: 'paper-1' }, error: null });
  mockLoadChapterContent.mockResolvedValue({
    content: 'text', pageReference: '4-14', chapterTitle: 'Hello World!', pageCount: 11,
  });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } },
    questionCount: 4, tokenData: { inputTokens: 10, outputTokens: 5, model: 'm' },
  });
  mockRenderPaper.mockReturnValue('<html>paper</html>');
  mockRenderAnswerKey.mockReturnValue('<html>key</html>');
  mockHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockUploadExamBuffer
    .mockResolvedValueOnce('exams/user-1/paper-1/paper.pdf')
    .mockResolvedValueOnce('exams/user-1/paper-1/paper_AnswerKey.pdf');
  mockBuildR2PublicUrl.mockImplementation((k) => `https://r2/${k}`);
  mockGetPresignedUrl.mockImplementation((u) => Promise.resolve(`${u}?signed`));
  mockSendMessage.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue(true);
  mockSendFlow.mockResolvedValue(true);
}

const rowAfterRun = () => mockDbCalls
  .filter((c) => c.table === 'assessment_papers' && c.op === 'update')
  .reduce((acc, c) => Object.assign(acc, c.payload), {});

beforeEach(() => {
  mockDbCalls.length = 0; mockDbResults.length = 0;
  jest.clearAllMocks();
});

describe('the answer key is findable again afterwards', () => {
  it('stores where the key went, not just where the paper went', async () => {
    happyPath();
    await Orchestrator.process({ ...JOB, includeAnswerKey: true });

    const row = rowAfterRun();
    expect(row.file_r2_key).toBe('exams/user-1/paper-1/paper.pdf');
    expect(row.answer_key_r2_key).toBe('exams/user-1/paper-1/paper_AnswerKey.pdf');
  });

  it('leaves the column alone when she did not ask for a key', async () => {
    happyPath();
    await Orchestrator.process({ ...JOB, includeAnswerKey: false });

    const row = rowAfterRun();
    expect(row.file_r2_key).toBeTruthy();
    // Not null-written, not empty-stringed: never mentioned.
    expect(row).not.toHaveProperty('answer_key_r2_key');
    expect(mockRenderAnswerKey).not.toHaveBeenCalled();
  });

  it('does not record a key that was never uploaded', async () => {
    happyPath();
    // The render succeeds and the UPLOAD fails — the branch where a naive
    // implementation would persist an undefined key and make the download
    // button lie.
    mockUploadExamBuffer
      .mockReset()
      .mockResolvedValueOnce('exams/user-1/paper-1/paper.pdf')
      .mockRejectedValueOnce(new Error('r2 down'));

    const out = await Orchestrator.process({ ...JOB, includeAnswerKey: true });

    // The paper still arrived — a key failure has never been allowed to turn a
    // delivered paper into a failure, and that does not change.
    expect(out.status).toBe('ready');
    const row = rowAfterRun();
    expect(row.answer_key_r2_key).toBeUndefined();
  });

  it('records the key even if SENDING it fails — it is stored, so it can be handed over later', async () => {
    happyPath();
    // Paper sends, key does not. Before this column that key was simply lost;
    // now it is exactly the case the column exists for.
    mockSendDocumentByLink.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const out = await Orchestrator.process({ ...JOB, includeAnswerKey: true });

    expect(out.status).toBe('ready');
    expect(out.answerKeySent).toBe(false);
    expect(rowAfterRun().answer_key_r2_key).toBe('exams/user-1/paper-1/paper_AnswerKey.pdf');
  });
});
