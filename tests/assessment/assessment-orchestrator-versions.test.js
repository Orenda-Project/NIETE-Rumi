/**
 * A generated paper, delivered for versioned editing.
 *
 * With assessment_versions_enabled ON the paper arrives WITH its Edit button
 * (one Flow message whose header is the PDF), the answer key follows it, and
 * there is no separate "change this paper" offer. The generated row IS version
 * 1, so `original_exam_json` is no longer written.
 *
 * With the flag OFF nothing changes: document, key, then the review offer — and
 * `original_exam_json` is still written, because the old in-place edit path
 * needs it to keep version 1 recoverable until the flag is flipped.
 */
const mockGenerateExam = jest.fn();
const mockUploadExamBuffer = jest.fn(async ({ examId, filename }) => `exams/user-1/${examId}/${filename}`);
const mockSendDocumentByLink = jest.fn(async () => true);
const mockSendFlow = jest.fn(async () => true);
const mockSendMessage = jest.fn(async () => true);
const mockCalls = [];

jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  loadChapterContent: jest.fn(async () => ({ content: 'text', pageReference: '4-14', chapterTitle: 'Hello World!' })),
  loadPageRangeContent: jest.fn(),
}));
jest.mock('../../bot/shared/services/assessment/assessment-generation.service', () => ({ generateExam: mockGenerateExam }));
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: () => ({ ext: 'pdf', render: async () => Buffer.from('pdf') }),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: mockUploadExamBuffer,
  buildR2PublicUrl: (k) => `https://r2/${k}`,
  getPresignedUrl: async (u) => `${u}?signed`,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => { mockCalls.push(['text', ...a]); return mockSendMessage(...a); },
  sendDocumentByLink: (...a) => { mockCalls.push(['document', ...a]); return mockSendDocumentByLink(...a); },
  sendFlow: (...a) => { mockCalls.push(['flow', ...a]); return mockSendFlow(...a); },
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const mockFlags = {};
const mockWrites = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const st = { table, op: 'select', payload: null, eq: [] };
    const result = () => {
      if (table === 'app_settings') {
        const key = (st.eq.find(([c]) => c === 'key') || [])[1];
        return { data: key in mockFlags ? { value: mockFlags[key] } : null, error: null };
      }
      if (table === 'users') return { data: { phone_number: '923001234567', preferred_language: 'en', school_name: 'S' }, error: null };
      if (st.op === 'insert') return { data: { id: 'paper-1' }, error: null };
      if (st.op === 'update') mockWrites.push(st.payload);
      return { data: null, error: null };
    };
    const b = {
      select: () => b, insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c, v) => { st.eq.push([c, v]); return b; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (res, rej) => Promise.resolve(result()).then(res, rej),
    };
    return b;
  },
}));

const Orchestrator = require('../../bot/shared/services/assessment/assessment-orchestrator.service');

const JOB = {
  userId: 'user-1', requestId: 'req-1', grade: 3, subject: 'maths', chapterNumber: 1,
  questionTypes: [], contentSource: 'unseen', outputFormat: 'pdf',
};
const EXAM = { unseen: { objective: { MCQs: [
  { question: 'q1', options: ['A) 1', 'B) 2'], answer: 'A) 1', marks: 2 },
  { question: 'q2', options: ['A) 1', 'B) 2'], answer: 'B) 2', marks: 3 },
] } } };

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockWrites.length = 0;
  for (const k of Object.keys(mockFlags)) delete mockFlags[k];
  process.env.ASSESSMENT_REVIEW_FLOW_ID = 'REVIEW_FLOW';
  mockGenerateExam.mockResolvedValue({ examJson: EXAM, questionCount: 2, tokenData: { model: 'm' } });
  mockSendFlow.mockResolvedValue(true);
  mockSendDocumentByLink.mockResolvedValue(true);
});

describe('flag ON', () => {
  beforeEach(() => { mockFlags.assessment_versions_enabled = true; mockFlags.assessment_editing_enabled = true; });

  test('the paper goes out WITH its Edit button, then the key — and no separate offer', async () => {
    const out = await Orchestrator.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockCalls.map((c) => c[0])).toEqual(['flow', 'document']);
    const flow = mockCalls[0][2];
    expect(flow.headerDocument).toEqual({ link: expect.stringContaining('exams/user-1/paper-1/'), filename: expect.stringMatching(/\.pdf$/) });
    expect(flow.flowToken).toBe('user-1:assessment-review:paper-1');
    expect(flow.buttonText).toBe('Edit questions/marks');
    expect(flow.body).toMatch(/2 questions · 5 marks/);
    expect(mockCalls[1][3]).toMatch(/AnswerKey\.pdf$/);
  });

  test('original_exam_json is no longer written: the generated row IS version 1', async () => {
    await Orchestrator.process(JOB);
    expect(mockWrites.some((w) => 'exam_json' in w)).toBe(true);
    expect(mockWrites.some((w) => 'original_exam_json' in w)).toBe(false);
  });

  test('a paper that cannot be sent even by the fallback is still SEND_FAILED', async () => {
    mockSendFlow.mockResolvedValue(false);
    mockSendDocumentByLink.mockResolvedValue(false);
    const out = await Orchestrator.process(JOB);
    expect(out).toMatchObject({ status: 'failed', code: 'SEND_FAILED' });
  });
});

describe('flag OFF — exactly today', () => {
  test('document, key, then the review offer; original_exam_json still written', async () => {
    mockFlags.assessment_editing_enabled = true;
    await Orchestrator.process(JOB);
    expect(mockCalls.map((c) => c[0])).toEqual(['document', 'document', 'flow']);
    expect(mockCalls[2][2].headerDocument).toBeUndefined();
    expect(mockWrites.some((w) => 'original_exam_json' in w)).toBe(true);
  });
});
