'use strict';
// bd-qyi45h.12: prod G9 CS paper 43440d3b (12 Nov) failed MODEL_UNAVAILABLE, the worker logged it and acked, but the
// row still reads `generating`. supabase-js does not throw on a failed write — it resolves { error } — and
// _patchPaper only caught throws, so the lost write left no trace and was never tried again.

const mockGenerateExam = jest.fn();
const mockLog = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: jest.fn(async () => ({ content: 'text', pageReference: '4-14', chapterTitle: 'T', pageCount: 11 })),
  loadPageRangeContent: jest.fn(),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam }));
jest.mock('../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: jest.fn(), renderAnswerKey: jest.fn(), totalMarks: () => 0, collectQuestions: () => [],
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadExamBuffer: jest.fn(), buildR2PublicUrl: jest.fn(), getPresignedUrl: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a) }));

const mockUpdates = [];
let mockFailedWriteErrors = 0;
function mockBuilder(table) {
  const s = { table, op: null, payload: null };
  const result = () => {
    if (s.op === 'update' && table === 'assessment_papers') {
      mockUpdates.push(s.payload);
      if (s.payload.status === 'failed' && mockFailedWriteErrors > 0) {
        mockFailedWriteErrors -= 1;
        return { data: null, error: { message: 'TypeError: fetch failed' } };
      }
    }
    if (table === 'users') return { data: { phone_number: '923001234567', preferred_language: 'en' }, error: null };
    if (s.op === 'insert') return { data: { id: 'paper-1' }, error: null };
    return { data: null, error: null };
  };
  const b = {
    insert: (p) => { s.op = 'insert'; s.payload = p; return b; },
    update: (p) => { s.op = 'update'; s.payload = p; return b; },
    select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
    single: () => Promise.resolve(result()),
    maybeSingle: () => Promise.resolve(result()),
    then: (res, rej) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = { userId: 'user-1', requestId: 'req-1', grade: 1, subject: 'english', chapterNumber: 1,
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf' };

beforeEach(() => {
  mockUpdates.length = 0; mockLog.mockReset(); mockFailedWriteErrors = 0;
  mockGenerateExam.mockRejectedValue(Object.assign(new Error('terminated'), { code: 'MODEL_UNAVAILABLE' }));
});

const failedWrites = () => mockUpdates.filter((p) => p.status === 'failed');
const loggedWriteError = () => mockLog.mock.calls.some(([msg, data]) => /could not update paper row/.test(msg)
  && /fetch failed/.test(String(data && data.error)));

describe('a failed paper is recorded failed even when the first write errors', () => {
  test('the write that resolves { error } is logged and tried once more', async () => {
    mockFailedWriteErrors = 1;
    const out = await Orchestrator.process(JOB);
    expect(out.status).toBe('failed');
    expect(failedWrites()).toHaveLength(2);
    expect(failedWrites()[1].error_code).toBe('MODEL_UNAVAILABLE');
    expect(loggedWriteError()).toBe(true);
  });

  test('a write that keeps erroring is logged, tried twice in all, and the job still ends', async () => {
    mockFailedWriteErrors = 5;
    const out = await Orchestrator.process(JOB);
    expect(out.status).toBe('failed');
    expect(failedWrites()).toHaveLength(2);
    expect(loggedWriteError()).toBe(true);
  });

  test('a write that succeeds is made once and logs nothing', async () => {
    await Orchestrator.process(JOB);
    expect(failedWrites()).toHaveLength(1);
    expect(loggedWriteError()).toBe(false);
  });
});
