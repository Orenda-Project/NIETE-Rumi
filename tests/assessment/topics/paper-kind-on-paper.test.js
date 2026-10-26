/**
 * bd-6clakk.8 — a topic paper's assessment_papers row says paper_kind 'topic', as its request does. Before this the
 * insert set only request_id + status, so the column default ('chapter') stood on every topic paper. Any other job
 * inserts exactly what it did before: no paper_kind key, the default holds.
 */
const mockInserts = [];

jest.mock('../../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: jest.fn(async () => ({ content: 'text', pageReference: '4-14', chapterTitle: 'T', pageCount: 11 })),
  loadPageRangeContent: jest.fn(async () => ({ content: 'text', pageReference: '58-59' })),
}));
jest.mock('../../../bot/shared/services/assessment/assessment-generation.service', () => ({
  generateExam: jest.fn(async () => ({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } }, questionCount: 4,
    tokenData: { inputTokens: 1, outputTokens: 1, model: 'm' },
  })),
}));
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
jest.mock('../../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const b = {
      insert: (row) => { mockInserts.push({ table, row }); return b; },
      update: () => b, select: () => b, eq: () => b,
      single: () => Promise.resolve({ data: { id: 'paper-1' }, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return b;
  }),
}));

const Orchestrator = require('../../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = {
  userId: 'user-1', requestId: 'req-1', grade: 3, subject: 'english', chapterNumber: null, pageRanges: '58-59',
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};
const paperRow = () => mockInserts.find((i) => i.table === 'assessment_papers').row;

beforeEach(() => { mockInserts.length = 0; });

test('a topic job opens its paper row as a topic paper', async () => {
  await Orchestrator.buildPaper({ ...JOB, scope: { kind: 'topics', topicIds: ['t1'], slos: [] } });
  expect(paperRow()).toEqual({ request_id: 'req-1', status: 'generating', paper_kind: 'topic' });
});

test('a chapter job opens the same row it always did, with no paper_kind', async () => {
  await Orchestrator.buildPaper({ ...JOB, chapterNumber: 4 });
  expect(paperRow()).toEqual({ request_id: 'req-1', status: 'generating' });
});
