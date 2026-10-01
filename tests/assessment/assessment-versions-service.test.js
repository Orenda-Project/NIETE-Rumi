/**
 * Every "Make my paper" is a NEW version — a new row that names the row it was
 * edited from — and no code path rewrites a version that is ready.
 *
 * The family is every row with the same request_id: a version copies its
 * parent's request_id AND attempt (the unique index covers generated rows only).
 * The version number is worked out, never stored: the generated row is 1, any
 * other is 1 + the ready non-generated rows in the family created no later.
 *
 * The REAL renderer and WhatsApp service run; the network (axios), storage (R2)
 * and the database (an in-memory PostgREST) are faked.
 */
jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));
const mockUploads = [];
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async ({ userId, examId, filename }) => {
    const key = `exams/${userId}/${examId}/${filename}`;
    mockUploads.push(key);
    return key;
  }),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: jest.fn(async (u) => `${u}?signed`),
}));
const mockRenders = [];
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: () => ({ ext: 'pdf', render: async (html) => { mockRenders.push(html); return Buffer.from('pdf'); } }),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(async () => [{ chapterNumber: 2, title: 'The Thirsty Crow' }]),
}));

const axios = require('axios');
const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');

const U = 'u1';
const REQ = {
  id: 'r1', user_id: U, grade_code: 'grade_3', subject_code: 'maths', chapter_number: 2,
  page_ranges: null, output_format: 'pdf', has_answer_lines: false, textbook_id: 't1',
};
const TREE = {
  seen: { objective: { MCQs: [
    { question: 'Q one', options: ['A) 1', 'B) 2'], answer: 'A) 1', marks: 1 },
    { question: 'Q two', options: ['A) 3', 'B) 4'], answer: 'B) 4', marks: 2 },
  ] }, subjective: { 'Short Questions': [{ question: 'Why?', answer: 'Because.', marks: 3, lines: 4 }] } },
};
const paper = (id, over = {}) => ({
  id, request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: TREE,
  created_at: '2026-09-30T09:00:00.000Z', file_r2_key: `exams/${U}/${id}/Grade3_Maths.pdf`,
  answer_key_r2_key: `exams/${U}/${id}/Grade3_Maths_AnswerKey.pdf`, question_count: 3, total_marks: 6, ...over,
});

function seed(extra = []) {
  mockDb = makeFakeDb({
    assessment_requests: [REQ],
    assessment_papers: [paper('v1'), ...extra],
    users: [{ id: U, phone_number: '923000000000', school_name: 'School', preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_editing_enabled', value: true }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploads.length = 0;
  mockRenders.length = 0;
  process.env.ASSESSMENT_REVIEW_FLOW_ID = 'REVIEW_FLOW';
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.x' }] } });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.t' }] }) }));
  seed();
});

// Documents and Flow messages go through axios; plain text through fetch.
const sends = () => axios.post.mock.calls.map((c) => c[1]);
const texts = () => global.fetch.mock.calls.map((c) => JSON.parse(c[1].body)).filter((m) => m.type === 'text');
const edited = () => {
  let t = Selection.replaceAt(TREE, 'seen.objective.MCQs.1', { ...TREE.seen.objective.MCQs[1], marks: 5 });
  t = Selection.setRemoved(t, 'seen.objective.MCQs.0', true);
  return t;
};
const user = { id: U, preferred_language: 'en' };

describe('createVersion', () => {
  test('INSERTS a child that names its parent and inherits request_id and attempt — and never updates the parent', async () => {
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: edited(), user });
    expect(out.status).toBe('ready');
    const ins = mockDb.writes.filter((w) => w.op === 'insert' && w.table === 'assessment_papers');
    expect(ins).toHaveLength(1);
    expect(ins[0].rows[0]).toMatchObject({ request_id: 'r1', attempt: 1, edited_from: 'v1', status: 'generating' });
    const touchedParent = mockDb.writes.filter((w) => w.op === 'update' && (w.ids || []).includes('v1'));
    expect(touchedParent).toEqual([]);
    const child = mockDb.tables.assessment_papers.find((p) => p.id === out.paperId);
    expect(child).toMatchObject({ status: 'ready', question_count: 2, total_marks: 8 });
    expect(child.exam_json.seen.objective.MCQs[0].removed).toBe(true); // removed stays in the tree
    expect(out).toMatchObject({ version: 2, parentVersion: 1, questionCount: 2, marks: 8 });
  });

  test('renders the ACTIVE tree, and answer lines follow the request (has_answer_lines = false)', async () => {
    await Revision.createVersion({ parentId: 'v1', userId: U, tree: edited(), user });
    const [paperHtml, keyHtml] = mockRenders;
    expect(paperHtml).not.toContain('Q one');
    expect(paperHtml).toContain('Q two');
    expect(paperHtml).not.toContain('<div class="answer-line">');
    expect(paperHtml).toContain('The Thirsty Crow');
    expect(keyHtml).toContain('Answer Key');
    expect(keyHtml).not.toContain('Q one');
  });

  test('uploads the paper and its key under the NEW row, named for the version', async () => {
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: edited(), user });
    expect(mockUploads).toEqual([
      `exams/${U}/${out.paperId}/Grade3_Maths_TheThirstyCrow_v2.pdf`,
      `exams/${U}/${out.paperId}/Grade3_Maths_TheThirstyCrow_v2_AnswerKey.pdf`,
    ]);
    const child = mockDb.tables.assessment_papers.find((p) => p.id === out.paperId);
    expect(child.file_r2_key).toBe(mockUploads[0]);
    expect(child.answer_key_r2_key).toBe(mockUploads[1]);
  });

  test('sends the paper WITH its Edit button (token naming the new row), THEN the key', async () => {
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: edited(), user });
    const [first, second] = sends();
    expect(first.interactive.header.type).toBe('document');
    expect(first.interactive.action.parameters.flow_token).toBe(`${U}:assessment-review:${out.paperId}`);
    expect(first.interactive.body.text).toMatch(/Version 2 \(from version 1\)/);
    expect(second.type).toBe('document');
    expect(second.document.filename).toMatch(/_v2_AnswerKey\.pdf$/);
    expect(sends()).toHaveLength(2);
  });

  test('editing v1 after v3 exists branches from v1 and is version 4', async () => {
    seed([
      paper('v2', { edited_from: 'v1', created_at: '2026-09-30T09:10:00.000Z' }),
      paper('v3', { edited_from: 'v2', created_at: '2026-09-30T09:20:00.000Z' }),
    ]);
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: edited(), user });
    expect(mockDb.tables.assessment_papers.find((p) => p.id === out.paperId).edited_from).toBe('v1');
    expect(out).toMatchObject({ version: 4, parentVersion: 1 });
  });

  test('0 active questions: EMPTY_SELECTION, one apology, and NO row inserted', async () => {
    let t = TREE;
    for (const q of Selection.indexQuestions(TREE)) t = Selection.setRemoved(t, q.id, true);
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: t, user });
    expect(out).toMatchObject({ status: 'failed', code: 'EMPTY_SELECTION' });
    expect(mockDb.writes.filter((w) => w.op === 'insert')).toEqual([]);
    expect(sends()).toEqual([]);
    expect(texts()).toHaveLength(1);
  });

  test('a paper that cannot be sent marks the new row failed and apologises once', async () => {
    axios.post.mockRejectedValueOnce(new Error('refused')).mockRejectedValueOnce(new Error('refused'));
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: edited(), user });
    expect(out).toMatchObject({ status: 'failed', code: 'SEND_FAILED' });
    expect(mockDb.tables.assessment_papers.find((p) => p.id === out.paperId)).toMatchObject({ status: 'failed', error_code: 'SEND_FAILED' });
    expect(texts()).toHaveLength(1);
  });

  test('someone else\'s paper is not found, and nothing is written', async () => {
    const out = await Revision.createVersion({ parentId: 'v1', userId: 'intruder', tree: edited(), user });
    expect(out).toMatchObject({ status: 'failed', code: 'NOT_FOUND' });
    expect(mockDb.writes).toEqual([]);
  });
});

describe('versionNumberOf', () => {
  test('generated is 1; others count the ready non-generated rows created no later; failed ones do not count', async () => {
    seed([
      paper('v2', { edited_from: 'v1', created_at: '2026-09-30T09:10:00.000Z' }),
      paper('vx', { edited_from: 'v1', created_at: '2026-09-30T09:15:00.000Z', status: 'failed' }),
      paper('v3', { edited_from: 'v1', created_at: '2026-09-30T09:20:00.000Z' }),
    ]);
    const rows = mockDb.tables.assessment_papers;
    const n = (id) => Revision.versionNumberOf(rows.find((r) => r.id === id));
    await expect(n('v1')).resolves.toBe(1);
    await expect(n('v2')).resolves.toBe(2);
    await expect(n('v3')).resolves.toBe(3);
  });
});

describe('resendVersion — "Make my paper" with no changes', () => {
  test('re-sends the SAME version with its key and Edit button, and inserts nothing', async () => {
    const out = await Revision.resendVersion({ paperId: 'v1', userId: U, user });
    expect(out.status).toBe('resent');
    expect(mockDb.writes.filter((w) => w.op === 'insert')).toEqual([]);
    const [first, second] = sends();
    expect(first.interactive.header.document.link).toContain('exams/u1/v1/Grade3_Maths.pdf');
    expect(first.interactive.action.parameters.flow_token).toBe(`${U}:assessment-review:v1`);
    expect(second.document.link).toContain('Grade3_Maths_AnswerKey.pdf');
  });
});

describe('listVersionItems', () => {
  test('the version, its number, and its questions — removed ones included and flagged', async () => {
    seed([paper('v2', { edited_from: 'v1', created_at: '2026-09-30T09:10:00.000Z', exam_json: edited() })]);
    const out = await Revision.listVersionItems({ paperId: 'v2', userId: U });
    expect(out.version).toBe(2);
    expect(out.items.map((i) => i.removed)).toEqual([true, false, false]);
    await expect(Revision.listVersionItems({ paperId: 'v2', userId: 'intruder' })).resolves.toEqual({ code: 'NOT_FOUND' });
  });
});

describe('an Urdu teacher and an Urdu paper', () => {
  test('the version arrives with Urdu copy and an Urdu button that fits', async () => {
    const URDU_TREE = { unseen: { objective: { MCQs: [
      { question: 'پانی کس حالت میں ہوتا ہے؟', options: ['الف) ٹھوس', 'ب) مائع'], answer: 'ب) مائع', marks: 1 },
      { question: 'سورج کیا ہے؟', options: ['الف) ستارہ', 'ب) سیارہ'], answer: 'الف) ستارہ', marks: 1 },
    ] } } };
    mockDb.tables.assessment_papers[0].exam_json = URDU_TREE;
    const t = Selection.setRemoved(URDU_TREE, 'unseen.objective.MCQs.1', true);
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: t, user: { id: U, preferred_language: 'ur' } });
    expect(out.status).toBe('ready');
    const [first] = sends();
    expect(first.interactive.body.text).toMatch(/ورژن 2/);
    const cta = first.interactive.action.parameters.flow_cta;
    expect(cta).toMatch(/[؀-ۿ]/);
    expect([...cta].length).toBeLessThanOrEqual(20);
    expect(mockRenders[0]).toContain('پانی کس حالت میں ہوتا ہے؟');
    expect(mockRenders[0]).not.toContain('سورج کیا ہے؟');
  });
});
