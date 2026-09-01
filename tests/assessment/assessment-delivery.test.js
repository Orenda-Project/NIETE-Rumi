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
const mockGetPresignedUrl = jest.fn()
  .mockResolvedValue('https://bucket.acct.r2.cloudflarestorage.com/exams/u/p/f.pdf?X-Amz-Signature=x');

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: mockSendMessage,
  sendDocumentByLink: mockSendDocumentByLink,
  sendDocumentFromUrl: jest.fn().mockResolvedValue(true),
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
