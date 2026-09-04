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
    // Real column names, real value shape: the live row stores 'grade_4',
    // not 4. A fixture using `grade` kept 10 tests green through an outage.
    id: 'req-1', user_id: 'user-1', grade_code: 'grade_4', subject_code: 'science',
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

describe('the columns it asks the database for must exist (bd-60024)', () => {
  // The review screen opened EMPTY on staging and the client refused it:
  //   "CheckboxGroup 'keep' dataSource array must contain at least 1 options."
  // The select named `grade` and `subject`. The live table has `grade_code`
  // ('grade_4') and `subject_code`. PostgREST rejects the whole query for one
  // unknown column, so listQuestions returned NOT_FOUND and the screen rendered
  // with nothing on it — the paper was fine the entire time.
  //
  // Asserted against the migration rather than a mock, because a mock answers
  // whatever it is asked and would have stayed green through this.
  const fs = require('fs');
  const path = require('path');

  /** The select is written as concatenated string literals; join them first. */
  function selectText(src) {
    const m = src.match(/\.select\(([\s\S]*?)\)\s*\n\s*\.eq\(/);
    if (!m) throw new Error('could not find the .select( ... ) call');
    return (m[1].match(/'([^']*)'/g) || []).map((q) => q.slice(1, -1)).join('');
  }

  const migration = fs.readFileSync(path.join(__dirname, '../..',
    'infrastructure/supabase/migrations/V1.2.6__assessment_generator.sql'), 'utf8');

  function columnsOf(table) {
    const m = migration.match(
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\n\\);`));
    if (!m) throw new Error(`no CREATE TABLE for ${table}`);
    return new Set(m[1].split('\n')
      .map((l) => (l.trim().match(/^([a-z_][a-z0-9_]*)\s+[A-Z]/) || [])[1])
      .filter(Boolean));
  }

  test('every column the revision service selects from assessment_requests is real', () => {
    const src = fs.readFileSync(path.join(__dirname, '../..',
      'bot/shared/services/assessment/assessment-revision.service.js'), 'utf8');
    const embed = selectText(src).match(/assessment_requests!inner\(([^)]*)\)/);
    expect(embed).toBeTruthy();

    const asked = embed[1].split(',').map((s) => s.trim()).filter(Boolean);
    const real = columnsOf('assessment_requests');
    expect([...asked].filter((c) => !real.has(c))).toEqual([]);
  });

  test('and from assessment_papers', () => {
    const src = fs.readFileSync(path.join(__dirname, '../..',
      'bot/shared/services/assessment/assessment-revision.service.js'), 'utf8');
    const top = selectText(src).replace(/assessment_requests!inner\([^)]*\)/, '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const real = columnsOf('assessment_papers');
    expect(top.filter((c) => !real.has(c))).toEqual([]);
  });
});

describe('grade_code is decoded before it reaches a teacher (bd-60024)', () => {
  test("'grade_4' becomes 4 on the paper, the filename and the caption", async () => {
    await Revision.rerender({ paperId: 'paper-1', userId: 'user-1', selectedIds: ['seen.objective.MCQs.0'] });
    const [, , filename, caption] = mockSendDocumentByLink.mock.calls[0];
    expect(filename).toBe('Grade4_Science_Edited.pdf');
    expect(caption).toContain('Grade 4 Science');
    // The literal code must never reach her.
    expect(filename).not.toContain('grade_4');
    expect(caption).not.toContain('grade_4');
  });
});

describe('saveEdit — writing one question back into the tree (bd-60025)', () => {
  test('writes at the path and stamps edited_at', async () => {
    const res = await Revision.saveEdit({
      paperId: 'paper-1', userId: 'user-1',
      questionId: 'seen.objective.MCQs.0',
      edit: { question: 'Which of these is alive?' },
    });
    expect(res.status).toBe('ok');
    const row = patched.find((p) => p.exam_json);
    expect(row.exam_json.seen.objective.MCQs[0].question).toBe('Which of these is alive?');
    expect(row.edited_at).toBeTruthy();
  });

  test('leaves every OTHER question untouched', async () => {
    await Revision.saveEdit({
      paperId: 'paper-1', userId: 'user-1',
      questionId: 'seen.objective.MCQs.0',
      edit: { question: 'changed' },
    });
    const row = patched.find((p) => p.exam_json);
    expect(row.exam_json.seen.objective.MCQs[1].question).toBe('Plants make food using ____.');
    expect(row.exam_json.unseen['objective']['True / False'][0].question).toBe('The sun is a plant.');
  });

  test('NEVER touches original_exam_json — the prompt-quality signal survives editing', async () => {
    await Revision.saveEdit({
      paperId: 'paper-1', userId: 'user-1',
      questionId: 'seen.objective.MCQs.0', edit: { question: 'changed' },
    });
    expect(patched.every((p) => p.original_exam_json === undefined)).toBe(true);
  });

  test('a rejected edit is reported, not written', async () => {
    const res = await Revision.saveEdit({
      paperId: 'paper-1', userId: 'user-1',
      questionId: 'seen.objective.MCQs.0', edit: { question: '   ' },
    });
    expect(res.status).toBe('rejected');
    expect(res.message).toMatch(/cannot be empty/i);
    expect(patched.find((p) => p.exam_json)).toBeUndefined();
  });

  test('refuses a paper that is not hers', async () => {
    const res = await Revision.saveEdit({
      paperId: 'paper-1', userId: 'someone-else',
      questionId: 'seen.objective.MCQs.0', edit: { question: 'x' },
    });
    expect(res.status).toBe('rejected');
    expect(patched.find((p) => p.exam_json)).toBeUndefined();
  });

  test('an id that no longer resolves is refused rather than creating a question', async () => {
    const res = await Revision.saveEdit({
      paperId: 'paper-1', userId: 'user-1',
      questionId: 'seen.objective.MCQs.99', edit: { question: 'x' },
    });
    expect(res.status).toBe('rejected');
    expect(patched.find((p) => p.exam_json)).toBeUndefined();
  });

  test('recomputes the stored question count and marks from the edited tree', async () => {
    await Revision.saveEdit({
      paperId: 'paper-1', userId: 'user-1',
      questionId: 'seen.objective.MCQs.0', edit: { marks: '5' },
    });
    const row = patched.find((p) => p.exam_json);
    expect(row.total_marks).toBe(5 + 1 + 1);
  });
});
