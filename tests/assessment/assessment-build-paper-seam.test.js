/**
 * S1 — the seam between making a paper and delivering it.
 *
 * `process()` did load → generate → render → upload → SEND, with the send
 * welded on. That is fine while WhatsApp is the only surface and fatal the
 * moment it is not: a portal request would build a perfectly good paper and
 * then mark it failed, because the row is written `ready` AFTER the send and a
 * falsy send throws SEND_FAILED.
 *
 * So the delivery-free half comes out as `buildPaper()`, and `process()`
 * becomes `buildPaper()` plus its WhatsApp tail.
 *
 * These tests pin the two properties that make the split safe:
 *   1. buildPaper does the work and touches no messaging at all.
 *   2. process() still behaves exactly as it did — that is asserted in full by
 *      assessment-orchestrator.service.test.js, which must stay green
 *      unchanged. This file only adds the seam's own guarantees.
 *
 * The ordering assertions matter more than they look. A refactor that produces
 * the right final state by a different route is not the same refactor: the row
 * has to be openable before the model runs (so a job that dies leaves something
 * the watchdog can find), and the paper has to be marked ready before anything
 * optional is attempted.
 */

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
const mockSendFlow = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent,
  loadPageRangeContent: mockLoadPageRangeContent,
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

// A trace of every DB call in the order it was made, so ordering can be
// asserted against the messaging mocks' invocation order.
const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null };
  const record = () => { mockDbCalls.push({ ...state, at: Date.now() }); };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { (state.eq ||= []).push([c, v]); return b; },
    single: () => { record(); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }); },
    maybeSingle: () => { record(); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }); },
    then: (res, rej) => { record(); return Promise.resolve(mockDbResults.shift() || { data: null, error: null }).then(res, rej); },
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

/**
 * The DB rows `process()` consumes, in order: the user lookup, then the paper
 * insert. `buildPaper` does NOT look the user up — it is handed one — so a test
 * calling it directly queues only the insert. Getting this wrong is silent
 * rather than loud: buildPaper reads the USER row as its insert result, finds
 * no id, and every later patch is skipped because _patchPaper returns early on
 * a null paperId. The row assertions then fail with `undefined` and look like a
 * missing write rather than a mis-seeded fixture.
 */
function happyPath({ forBuildPaper = false } = {}) {
  if (!forBuildPaper) mockDbResults.push({ data: USER, error: null }); // user lookup
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
  mockSendFlow.mockResolvedValue(true);
}

beforeEach(() => {
  mockDbCalls.length = 0; mockDbResults.length = 0;
  jest.clearAllMocks();
});

describe('buildPaper — the half that has nothing to do with WhatsApp', () => {
  it('is exported', () => {
    expect(typeof Orchestrator.buildPaper).toBe('function');
  });

  it('builds a paper and sends NOTHING', async () => {
    happyPath({ forBuildPaper: true });
    const out = await Orchestrator.buildPaper(JOB);

    expect(mockLoadChapterContent).toHaveBeenCalled();
    expect(mockGenerateExam).toHaveBeenCalled();
    expect(mockRenderPaper).toHaveBeenCalled();
    expect(mockUploadExamBuffer).toHaveBeenCalled();

    // The whole point of the seam.
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendFlow).not.toHaveBeenCalled();

    expect(out.status).toBe('ready');
  });

  it('hands back everything the caller needs to deliver it however it likes', async () => {
    happyPath({ forBuildPaper: true });
    const out = await Orchestrator.buildPaper(JOB);

    // toMatchObject, not toEqual: the result deliberately carries more than a
    // caller needs (examJson, the renderer, the chapter title) so the WhatsApp
    // tail does not have to re-derive any of it.
    expect(out).toMatchObject(({
      status: 'ready',
      paperId: 'paper-1',
      key: 'exams/user-1/paper-1/x.pdf',
      questionCount: 4,
      filename: expect.stringMatching(/^Grade1_English.*\.pdf$/),
    }));
    // What the WhatsApp tail needs and would otherwise recompute.
    expect(out.examJson).toBeTruthy();
    expect(out.chapterTitle).toBe('Hello World!');
    // Marks are computed here, not by whoever delivers it.
    expect(out.marks).toBe(11);
  });

  it('marks the row ready WITHOUT a send having happened', async () => {
    happyPath({ forBuildPaper: true });
    await Orchestrator.buildPaper(JOB);

    const row = mockDbCalls
      .filter((c) => c.table === 'assessment_papers' && c.op === 'update')
      .reduce((acc, c) => Object.assign(acc, c.payload), {});

    expect(row.status).toBe('ready');
    expect(row.file_r2_key).toBe('exams/user-1/paper-1/x.pdf');
    expect(row.ready_at).toBeTruthy();
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
  });

  it('records a failure the same way process() does, and still says nothing', async () => {
    happyPath({ forBuildPaper: true });
    mockGenerateExam.mockRejectedValue(
      Object.assign(new Error('502'), { code: 'MODEL_UNAVAILABLE' }));

    const out = await Orchestrator.buildPaper(JOB);

    expect(out.status).toBe('failed');
    expect(out.code).toBe('MODEL_UNAVAILABLE');
    const updates = mockDbCalls.filter((c) => c.table === 'assessment_papers' && c.op === 'update');
    expect(updates[updates.length - 1].payload.status).toBe('failed');

    // A build has no teacher to apologise to — that is the caller's job.
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('opens the paper row BEFORE the model runs, so a job that dies is findable', async () => {
    happyPath({ forBuildPaper: true });
    let insertSeen = false;
    mockGenerateExam.mockImplementation(() => {
      insertSeen = mockDbCalls.some((c) => c.table === 'assessment_papers' && c.op === 'insert');
      return Promise.resolve({
        examJson: { unseen: {} }, questionCount: 4, tokenData: {},
      });
    });
    await Orchestrator.buildPaper(JOB);
    expect(insertSeen).toBe(true);
  });
});

describe('process() is buildPaper plus a WhatsApp tail', () => {
  it('still sends the document, and only after the paper is marked ready', async () => {
    happyPath();

    let readyBeforeSend = null;
    mockSendDocumentByLink.mockImplementation(() => {
      readyBeforeSend = mockDbCalls.some(
        (c) => c.table === 'assessment_papers' && c.op === 'update' && c.payload?.status === 'ready');
      return Promise.resolve(true);
    });

    const out = await Orchestrator.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockSendDocumentByLink).toHaveBeenCalled();
    // The V1 ordering bug this refactor removes: the row used to be written
    // ready only after a successful send, so a good paper whose send failed
    // was recorded as a failure.
    expect(readyBeforeSend).toBe(true);
  });

  it('a paper that built but could not be sent is a delivery failure, not a lost paper', async () => {
    happyPath();
    mockSendDocumentByLink.mockResolvedValue(false);

    const out = await Orchestrator.process(JOB);

    expect(out.status).toBe('failed');
    expect(out.code).toBe('SEND_FAILED');
    // She is told, in the words the code has always used for this.
    const said = mockSendMessage.mock.calls.map((c) => c[1]).join(' ');
    expect(said).toMatch(/made but we couldn.t send it/i);
    // And the paper survives: the key is on the row, so it can be handed out
    // again rather than regenerated.
    const row = mockDbCalls
      .filter((c) => c.table === 'assessment_papers' && c.op === 'update')
      .reduce((acc, c) => Object.assign(acc, c.payload), {});
    expect(row.file_r2_key).toBe('exams/user-1/paper-1/x.pdf');
  });

  it('does not build at all when there is no one to send to', async () => {
    mockDbResults.push({ data: null, error: null });   // user lookup finds nobody
    const out = await Orchestrator.process(JOB);
    expect(out.status).toBe('failed');
    expect(out.code).toBe('NO_RECIPIENT');
    expect(mockGenerateExam).not.toHaveBeenCalled();
  });
});
