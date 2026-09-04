/**
 * "Your paper is ready" must not be the last thing she hears.
 *
 * The paper was generated, rendered and stored; the row said `ready`; and no
 * document ever arrived. Two things had to go wrong together:
 *
 *   1. delivery went through `sendDocumentFromUrl`, which does NOT fetch the
 *      URL — it extracts the R2 key from it and re-downloads server-side. It
 *      was handed a PRESIGNED url, and presigning rewrites path-style
 *      (host/bucket/key) into virtual-hosted style (bucket.host/key), so the
 *      `/bucket/` marker the extractor looks for is in the hostname and the
 *      extraction throws.
 *   2. that throw is caught inside the sender, which returns `false` rather
 *      than raising — and the caller ignored the boolean, so the failure was
 *      recorded as `ready`.
 *
 * Either alone is survivable. Together they produce a paper that exists,
 * is marked delivered, and is nowhere.
 */

const mockSupabase = { from: jest.fn() };
const mockSendMessage = jest.fn().mockResolvedValue(true);
const mockSendDocumentByLink = jest.fn().mockResolvedValue(true);
const mockSendFlow = jest.fn().mockResolvedValue(true);
const mockGetPresignedUrl = jest.fn()
  .mockResolvedValue('https://bucket.acct.r2.cloudflarestorage.com/exams/u/p/f.pdf?X-Amz-Signature=x');

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocumentByLink: mockSendDocumentByLink,
  sendDocumentFromUrl: jest.fn().mockResolvedValue(true),
  sendFlow: (...a) => mockSendFlow(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn().mockResolvedValue('exams/u/p/f.pdf'),
  buildR2PublicUrl: (k) => `https://acct.r2.cloudflarestorage.com/bucket/${k}`,
  getPresignedUrl: (...a) => mockGetPresignedUrl(...a),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: jest.fn().mockResolvedValue({
    content: '=== Page 156 ===\ntext', pageReference: '156-166',
    chapterTitle: 'Green Dreams', chapterNumber: 12,
  }),
  loadPageRangeContent: jest.fn(),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({
  generateExam: jest.fn().mockResolvedValue({
    examJson: { objective: {} }, questionCount: 28,
    tokenData: { model: 'm', inputTokens: 1, outputTokens: 2 },
  }),
}));
jest.mock('../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: jest.fn().mockReturnValue('<html></html>'),
  collectQuestions: jest.fn().mockReturnValue([]),
  totalMarks: jest.fn().mockReturnValue(50),
}));

let patches;

function wireDb() {
  patches = [];
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
        data: { phone_number: '923001234567', preferred_language: 'en', school_name: null },
        error: null,
      }) }) }) };
    }
    if (table === 'assessment_papers') {
      return {
        insert: () => ({ select: () => ({ single: () => Promise.resolve({
          data: { id: 'paper-1' }, error: null }) }) }),
        update: (patch) => { patches.push(patch); return { eq: () => Promise.resolve({ error: null }) }; },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

const JOB = {
  userId: 'u1', requestId: 'r1', grade: 1, subject: 'english',
  chapterNumber: 12, pageRanges: '156-166', questionTypes: [],
  outputFormat: 'pdf', includeAnswerKey: false, answerLines: true,
};

describe('a paper is only ready once it has actually been sent', () => {
  beforeEach(() => { jest.clearAllMocks(); wireDb(); });

  test('delivery uses the link sender, which is what a presigned url is for', async () => {
    const orch = require('../../bot/shared/services/assessment/assessment-orchestrator.service');
    await orch.process(JOB);

    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    const [, url] = mockSendDocumentByLink.mock.calls[0];
    expect(url).toContain('X-Amz-Signature');
  });

  test('a send that returns false is recorded as failed, not ready', async () => {
    mockSendDocumentByLink.mockResolvedValueOnce(false);
    const orch = require('../../bot/shared/services/assessment/assessment-orchestrator.service');
    const out = await orch.process(JOB);

    expect(out.status).toBe('failed');
    const final = patches[patches.length - 1];
    expect(final.status).toBe('failed');
    expect(final.error_code).toBe('SEND_FAILED');
  });

  test('she is told when the paper could not be delivered', async () => {
    mockSendDocumentByLink.mockResolvedValueOnce(false);
    const orch = require('../../bot/shared/services/assessment/assessment-orchestrator.service');
    await orch.process(JOB);

    const said = mockSendMessage.mock.calls.map((c) => c[1]).join(' | ');
    expect(said).toMatch(/could not send|couldn't send/i);
  });
});


describe('the offer to trim the paper (bd-60023)', () => {
  // A paper she cannot edit is one she must re-request from scratch to change.
  // The offer rides AFTER the document, never before: a prompt sent ahead of the
  // send is a promise made by a step that has not run yet, which is exactly what
  // left her holding "your paper is ready" and no paper.
  // Set here, not inherited from the shell: without an id the offer is skipped
  // entirely and every assertion below would pass by not running.
  const PREV = process.env.ASSESSMENT_GEN_FLOW_ID;
  beforeEach(() => {
    jest.clearAllMocks(); wireDb();
    process.env.ASSESSMENT_GEN_FLOW_ID = '1789313642053401';
    // clearAllMocks wipes the resolved values set where these were declared.
    mockSendDocumentByLink.mockResolvedValue(true);
    mockSendFlow.mockResolvedValue(true);
  });
  afterAll(() => {
    if (PREV === undefined) delete process.env.ASSESSMENT_GEN_FLOW_ID;
    else process.env.ASSESSMENT_GEN_FLOW_ID = PREV;
  });

  test('no flow id configured means no offer, and still a delivered paper', async () => {
    delete process.env.ASSESSMENT_GEN_FLOW_ID;
    const res = await orch().process(JOB);
    expect(res.status).toBe('ready');
    expect(mockSendFlow).not.toHaveBeenCalled();
  });

  const orch = () => require('../../bot/shared/services/assessment/assessment-orchestrator.service');

  test('is sent after the document, carrying a token that names the paper', async () => {
    const res = await orch().process(JOB);
    expect(res.status).toBe('ready');
    expect(mockSendFlow).toHaveBeenCalledTimes(1);
    const [to, opts] = mockSendFlow.mock.calls[0];
    expect(to).toBe('923001234567');
    expect(opts.flowToken).toBe('u1:assessment-review:paper-1');
    // No `screen`, so sendFlow uses data_exchange and our INIT reads the token.
    expect(opts.screen).toBeUndefined();
  });

  test('is NOT offered when the paper never reached her', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    const res = await orch().process(JOB);
    expect(res.status).toBe('failed');
    expect(mockSendFlow).not.toHaveBeenCalled();
  });

  test('a failed offer never turns a delivered paper into a failure', async () => {
    mockSendFlow.mockRejectedValue(new Error('flow send exploded'));
    const res = await orch().process(JOB);
    expect(res.status).toBe('ready');
  });
});
