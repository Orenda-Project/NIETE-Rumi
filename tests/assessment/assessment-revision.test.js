/**
 * Re-rendering a paper after she unticks questions.
 *
 * This is the step where an edit becomes a document. It reuses the delivery path
 * that already works — render, upload, send BY LINK — because the alternative was
 * tried and lost a paper: `sendDocumentFromUrl` re-downloads server-side and
 * cannot dereference a presigned url, so a failed send was recorded as `ready`.
 *
 * What is asserted here is mostly what must NOT happen:
 *   · the original tree is never overwritten — it is the only signal we have on
 *     whether the prompts are any good;
 *   · an empty selection is refused, not rendered;
 *   · a failed send is never written down as success.
 */

const mockSupabase = { from: jest.fn() };
const mockHtmlToPdf = jest.fn();
const mockSendDocumentByLink = jest.fn();
const mockSendMessage = jest.fn();
const mockUpload = jest.fn();
const mockPresign = jest.fn();

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: (...a) => mockHtmlToPdf(...a) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: (...a) => mockUpload(...a),
  getPresignedUrl: (...a) => mockPresign(...a),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocumentByLink: (...a) => mockSendDocumentByLink(...a),
  sendMessage: (...a) => mockSendMessage(...a),
}));

const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');

const EXAM = {
  seen: { objective: { MCQs: [
    { question: 'Which is a living thing?', marks: 1 },
    { question: 'Plants make food using ____.', marks: 1 },
  ] } },
  unseen: { objective: { 'True / False': [{ question: 'The sun is a plant.', marks: 1 }] } },
};

const PAPER = {
  id: 'paper-1',
  status: 'ready',
  exam_json: EXAM,
  original_exam_json: EXAM,
  selected_question_ids: null,
  request_id: 'req-1',
  assessment_requests: {
    id: 'req-1', user_id: 'user-1', grade: 4, subject: 'science',
    chapter_number: 3, page_ranges: '34-41', output_format: 'pdf',
  },
};

let patched;

function wireDb({ paper = PAPER, user = { phone_number: '923001234567', school_name: 'Test School' } } = {}) {
  patched = [];
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'assessment_papers') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: paper, error: null }) }) }),
        update: (row) => { patched.push(row); return { eq: () => Promise.resolve({ error: null }) }; },
      };
    }
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: user, error: null }) }) }) };
    }
    if (table === 'textbook_pages') {
      return { select: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }) };
    }
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
  mockHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockUpload.mockResolvedValue('exams/user-1/paper-1/Grade4_Science.pdf');
  mockPresign.mockResolvedValue('https://signed.example/paper.pdf');
  mockSendDocumentByLink.mockResolvedValue(true);
});

describe('rerender — an edit becomes a document', () => {
  test('renders only the ticked questions', async () => {
    const res = await Revision.rerender({
      paperId: 'paper-1', userId: 'user-1',
      selectedIds: ['seen.objective.MCQs.0'],
    });
    expect(res.status).toBe('ready');
    expect(res.questionCount).toBe(1);
    const html = mockHtmlToPdf.mock.calls[0][0];
    expect(html).toContain('Which is a living thing?');
    expect(html).not.toContain('The sun is a plant.');
  });

  test('sends BY LINK — the sender that dereferences a signed url itself', async () => {
    await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: ['seen.objective.MCQs.0'] });
    expect(mockSendDocumentByLink).toHaveBeenCalledTimes(1);
    expect(mockSendDocumentByLink.mock.calls[0][1]).toBe('https://signed.example/paper.pdf');
  });

  test('writes her ticks and the edited tree, and stamps edited_at', async () => {
    await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: ['seen.objective.MCQs.0'] });
    const row = patched.find((p) => p.selected_question_ids);
    expect(row.selected_question_ids).toEqual(['seen.objective.MCQs.0']);
    expect(row.edited_at).toBeTruthy();
    expect(row.total_marks).toBe(1);
  });

  test('NEVER overwrites original_exam_json — it is the only prompt-quality signal we get', async () => {
    await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: ['seen.objective.MCQs.0'] });
    expect(patched.every((p) => p.original_exam_json === undefined)).toBe(true);
  });

  test('refuses an empty selection rather than sending a blank paper', async () => {
    const res = await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: [] });
    expect(res.status).toBe('failed');
    expect(res.code).toBe('EMPTY_SELECTION');
    expect(mockSendDocumentByLink).not.toHaveBeenCalled();
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  test('a failed send is recorded as failed, never as ready', async () => {
    mockSendDocumentByLink.mockResolvedValue(false);
    const res = await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: ['seen.objective.MCQs.0'] });
    expect(res.status).toBe('failed');
    expect(res.code).toBe('SEND_FAILED');
    expect(patched.some((p) => p.status === 'ready')).toBe(false);
  });

  test('refuses a paper belonging to someone else', async () => {
    const res = await Revision.rerender({ paperId: 'paper-1', userId: 'someone-else', selectedIds: ['seen.objective.MCQs.0'] });
    expect(res.status).toBe('failed');
    expect(res.code).toBe('NOT_FOUND');
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  test('refuses a paper that is not ready', async () => {
    wireDb({ paper: { ...PAPER, status: 'generating' } });
    const res = await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: ['seen.objective.MCQs.0'] });
    expect(res.status).toBe('failed');
    expect(res.code).toBe('NOT_READY');
  });

  test('an unchanged selection still delivers — she asked for the paper', async () => {
    const all = ['seen.objective.MCQs.0', 'seen.objective.MCQs.1', 'unseen.objective.True / False.0'];
    const res = await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: all });
    expect(res.status).toBe('ready');
    expect(res.questionCount).toBe(3);
  });

  test('a render failure tells her, and does not claim a paper', async () => {
    mockHtmlToPdf.mockRejectedValue(new Error('chromium died'));
    const res = await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: ['seen.objective.MCQs.0'] });
    expect(res.status).toBe('failed');
    expect(res.code).toBe('RENDER_FAILED');
    expect(mockSendMessage).toHaveBeenCalled();
  });
});
