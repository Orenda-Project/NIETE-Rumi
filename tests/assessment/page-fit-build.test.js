/**
 * bd-nr8mrm.2 — FEAT-209 (Ramisha Riaz): buildPaper fits a paper to the pages she asked for.
 * With the setting on and a page target, the PDF is printed, its pages counted, and the print
 * tightened one step at a time until it fits. The step that printed is stored on the paper, so every
 * re-render prints the same. Off, or with no target, the paper is built exactly as before.
 */

const mockLoadChapterContent = jest.fn();
const mockGenerateExam = jest.fn();
const mockRenderPaper = jest.fn();
const mockHtmlToPdf = jest.fn();
const mockUploadExamBuffer = jest.fn();
const mockIsFlagEnabled = jest.fn();

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent, loadPageRangeContent: jest.fn(),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam }));
jest.mock('../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: mockRenderPaper, renderAnswerKey: jest.fn(), totalMarks: () => 4, collectQuestions: () => [],
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: mockHtmlToPdf }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: mockUploadExamBuffer, buildR2PublicUrl: jest.fn(), getPresignedUrl: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(), sendFlow: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  ...jest.requireActual('../../bot/shared/config/feature-flags'),
  isFlagEnabled: mockIsFlagEnabled,
  isAssessmentVersionsEnabled: async () => true,
}));

const mockUpdates = [];
const mockResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null };
  const done = () => {
    if (state.op === 'update' && table === 'assessment_papers') mockUpdates.push(state.payload);
    return Promise.resolve(mockResults.shift() || { data: null, error: null });
  };
  const b = {
    insert: (p) => { state.op = 'insert'; state.payload = p; return b; },
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, neq: () => b,
    single: done, maybeSingle: done,
    then: (res, rej) => done().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = {
  userId: 'user-1', requestId: 'req-1', grade: 3, subject: 'english', chapterNumber: 1,
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};
const pdf = (n) => Buffer.from(`%PDF-1.4\n${'<< /Type /Page >>\n'.repeat(n)}`);
let printed; // the _print each render saw

function setup({ pagesPerRender, flag = true }) {
  mockResults.push({ data: { id: 'paper-1' }, error: null }); // paper insert
  mockIsFlagEnabled.mockImplementation(async (key) => (key === 'assessment_page_fit' ? flag : false));
  mockLoadChapterContent.mockResolvedValue({ content: 'text', pageReference: '4-14', chapterTitle: 'Hello', pageCount: 11 });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q', options: ['a', 'b'], marks: 1 }] } } },
    questionCount: 4, tokenData: { model: 'm' },
  });
  printed = [];
  mockRenderPaper.mockImplementation(({ examJson }) => {
    printed.push(examJson._print ? JSON.parse(JSON.stringify(examJson._print)) : null);
    return `<html>${printed.length}</html>`;
  });
  let i = 0;
  mockHtmlToPdf.mockImplementation(async () => pdf(pagesPerRender[Math.min(i++, pagesPerRender.length - 1)]));
  mockUploadExamBuffer.mockResolvedValue('exams/x.pdf');
}
const readyRow = () => mockUpdates.find((u) => u.status === 'ready');

beforeEach(() => { mockUpdates.length = 0; mockResults.length = 0; jest.clearAllMocks(); });

test('tightens step by step until the paper fits, and prints the step that fit', async () => {
  setup({ pagesPerRender: [3, 2, 1, 1] });
  const out = await Orchestrator.buildPaper({ ...JOB, pages: 1 });
  expect(out.status).toBe('ready');
  expect(mockHtmlToPdf).toHaveBeenCalledTimes(3);
  expect(printed.map((p) => p.fit)).toEqual([
    { twoCol: false, trimLines: false }, { twoCol: false, trimLines: false }, { twoCol: true, trimLines: false },
  ]);
  expect(printed.map((p) => p.compact)).toEqual([false, true, true]);
  expect(mockUploadExamBuffer.mock.calls[0][0].buffer).toEqual(pdf(1));
  expect(out.pageFit).toEqual({ target: 1, pages: 1, fits: true, needs: null });
});

test('the step is stored on the paper so a re-render prints the same', async () => {
  setup({ pagesPerRender: [3, 2, 1] });
  await Orchestrator.buildPaper({ ...JOB, pages: 1 });
  expect(readyRow().exam_json._print).toEqual({ compact: true, fit: { twoCol: true, trimLines: false }, pages: 1 });
  expect(readyRow().exam_json._reuse).toBeTruthy(); // the reuse stamp is kept
});

test('when nothing fits she gets the tightest print and how many pages it needs', async () => {
  setup({ pagesPerRender: [5, 4, 3, 3] });
  const out = await Orchestrator.buildPaper({ ...JOB, pages: 2 });
  expect(out.status).toBe('ready');
  expect(mockHtmlToPdf).toHaveBeenCalledTimes(4);
  expect(printed[3]).toMatchObject({ compact: true, fit: { twoCol: true, trimLines: true } });
  expect(out.pageFit).toEqual({ target: 2, pages: 3, fits: false, needs: 3 });
});

test('a Save paper job never prints looser than Save paper', async () => {
  setup({ pagesPerRender: [1] });
  await Orchestrator.buildPaper({ ...JOB, compact: true, pages: 2 });
  expect(mockHtmlToPdf).toHaveBeenCalledTimes(1);
  expect(printed[0]).toMatchObject({ compact: true });
});

test('setting off: one print, nothing stored, no page result', async () => {
  setup({ pagesPerRender: [3], flag: false });
  const out = await Orchestrator.buildPaper({ ...JOB, pages: 1 });
  expect(mockHtmlToPdf).toHaveBeenCalledTimes(1);
  expect(printed[0]).toBeNull();
  expect(readyRow().exam_json).toBeUndefined();
  expect(out.pageFit).toBeUndefined();
});

test.each([[undefined], [0], [9], ['two']])('no usable target (%p): built exactly as before', async (pages) => {
  setup({ pagesPerRender: [3] });
  const out = await Orchestrator.buildPaper({ ...JOB, pages });
  expect(mockHtmlToPdf).toHaveBeenCalledTimes(1);
  expect(printed[0]).toBeNull();
  expect(out.pageFit).toBeUndefined();
});

test('a print that fails mid-fit fails the paper as RENDER_FAILED', async () => {
  setup({ pagesPerRender: [3] });
  mockHtmlToPdf.mockResolvedValueOnce(pdf(3)).mockRejectedValueOnce(new Error('chromium died'));
  const out = await Orchestrator.buildPaper({ ...JOB, pages: 1 });
  expect(out).toMatchObject({ status: 'failed', code: 'RENDER_FAILED' });
});
