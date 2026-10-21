/**
 * Task 7 — the plain branch hands a topic job's ticked topics to the key and its paperKind to the student copy;
 * a chapter job passes neither.
 */
const mockLoadChapterContent = jest.fn();
const mockLoadPageRangeContent = jest.fn();
const mockGenerateExam = jest.fn();

jest.mock('../../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: mockLoadChapterContent, loadPageRangeContent: mockLoadPageRangeContent,
}));
jest.mock('../../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam }));
const mockRenderPaper = jest.fn(() => '<html/>');
const mockRenderKey = jest.fn(() => '<html/>');
jest.mock('../../../bot/shared/services/assessment/assessment-paper.renderer', () => ({
  renderPaper: mockRenderPaper, renderAnswerKey: mockRenderKey, totalMarks: () => 1, collectQuestions: () => [],
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
function mockBuilder() {
  const b = {
    insert: () => b, update: () => b, select: () => b, eq: () => b,
    single: () => Promise.resolve({ data: { id: 'paper-1' }, error: null }),
    maybeSingle: () => Promise.resolve({ data: global.__user || null, error: null }),
    then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
  };
  return b;
}
jest.mock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));

const Orchestrator = require('../../../bot/shared/services/assessment/assessment-orchestrator.service');

const SLOS = [
  { code: 'E-2', description: 'd', topicId: 't2', topicName: 'Sentences' },
  { code: 'E-1', description: 'd', topicId: 't1', topicName: 'Rhyming words' },
];
const JOB = {
  userId: 'user-1', requestId: 'req-1', grade: 3, subject: 'english', chapterNumber: null, pageRanges: '58-59',
  questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }], contentSource: 'unseen', outputFormat: 'pdf',
};

beforeEach(() => {
  jest.clearAllMocks();
  global.__user = null;
  mockLoadPageRangeContent.mockResolvedValue({ content: 'text', pageReference: '58-59' });
  mockLoadChapterContent.mockResolvedValue({ content: 'text', pageReference: '4-14', chapterTitle: 'T', pageCount: 11 });
  mockGenerateExam.mockResolvedValue({
    examJson: { unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } }, questionCount: 4,
    tokenData: { inputTokens: 1, outputTokens: 1, model: 'm' },
  });
});

test('a topic job renders a topic student copy and returns the ticked topics in order', async () => {
  const built = await Orchestrator.buildPaper({ ...JOB, scope: { kind: 'topics', topicIds: ['t1', 't2'], slos: SLOS } });
  expect(mockRenderPaper.mock.calls[0][0].paperKind).toBe('topic');
  expect(built.topics).toEqual([
    { topicId: 't1', name: 'Rhyming words', sloCodes: ['E-1'] },
    { topicId: 't2', name: 'Sentences', sloCodes: ['E-2'] },
  ]);
});

test('a chapter job passes no paperKind and returns no topics', async () => {
  const built = await Orchestrator.buildPaper({ ...JOB, chapterNumber: 4 });
  expect(mockRenderPaper.mock.calls[0][0]).not.toHaveProperty('paperKind');
  expect(built).not.toHaveProperty('topics');
});

describe('the key gets the topics', () => {
  const SCOPE = { kind: 'topics', topicIds: ['t1', 't2'], slos: SLOS, topics: [{ topicId: 't1', name: 'Rhyming words' }, { topicId: 't2', name: 'Sentences' }] };
  const TOPICS = [
    { topicId: 't1', name: 'Rhyming words', sloCodes: ['E-1'] },
    { topicId: 't2', name: 'Sentences', sloCodes: ['E-2'] },
  ];

  test('portal delivery (none): renderAnswerKey receives the topics', async () => {
    await Orchestrator.process({ ...JOB, deliver: 'none', scope: SCOPE });
    expect(mockRenderKey).toHaveBeenCalledTimes(1);
    expect(mockRenderKey.mock.calls[0][0].topics).toEqual(TOPICS);
  });

  test('WhatsApp delivery: renderAnswerKey receives the topics', async () => {
    require('../../../bot/shared/services/whatsapp.service').sendDocumentByLink.mockResolvedValue(true);
    global.__user = { phone_number: '923001234567', preferred_language: 'en', school_name: 'S' };
    await Orchestrator.process({ ...JOB, scope: SCOPE });
    expect(mockRenderKey).toHaveBeenCalledTimes(1);
    expect(mockRenderKey.mock.calls[0][0].topics).toEqual(TOPICS);
  });

  test('a chapter job: the key gets no topics', async () => {
    await Orchestrator.process({ ...JOB, chapterNumber: 4, deliver: 'none' });
    expect(mockRenderKey.mock.calls[0][0]).not.toHaveProperty('topics');
  });

  test('a topic scope with no topics is not a topic paper', async () => {
    await Orchestrator.buildPaper({ ...JOB, scope: { kind: 'topics', topicIds: [], slos: [] } });
    expect(mockRenderPaper.mock.calls[0][0]).not.toHaveProperty('paperKind');
  });
});

describe('the ticked topics are stored in the paper so an edit can find them', () => {
  test('a topic job saves examJson._topics (same list the key gets)', async () => {
    const built = await Orchestrator.buildPaper({ ...JOB, scope: { kind: 'topics', topicIds: ['t1', 't2'], slos: SLOS } });
    expect(built.examJson._topics).toEqual(built.topics);
  });

  test('a chapter job gains no _topics key', async () => {
    const built = await Orchestrator.buildPaper({ ...JOB, chapterNumber: 4 });
    expect(built.examJson).not.toHaveProperty('_topics');
  });

  test('an empty topic scope gains no _topics key', async () => {
    const built = await Orchestrator.buildPaper({ ...JOB, scope: { kind: 'topics', topicIds: [], slos: [] } });
    expect(built.examJson).not.toHaveProperty('_topics');
  });
});
