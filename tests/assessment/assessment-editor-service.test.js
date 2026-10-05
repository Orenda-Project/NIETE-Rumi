/**
 * The portal's editor service: versions, questions, add-kinds, validate, save.
 * It composes the bot's own edit/selection/changes/revision code and sends nothing.
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

const Editor = require('../../bot/shared/services/assessment/assessment-editor.service');

describe('gate', () => {
  test('everything refuses with EDITING_DISABLED when the switch is off', async () => {
    mockDb.tables.app_settings = [{ key: 'assessment_editing_enabled', value: false }];
    for (const call of [
      () => Editor.versions({ userId: U, paperId: 'v1' }),
      () => Editor.questions({ userId: U, paperId: 'v1' }),
      () => Editor.addKinds({ userId: U, paperId: 'v1' }),
      () => Editor.validateEdit({ userId: U, paperId: 'v1', id: 'seen.objective.MCQs.0', edit: {} }),
      () => Editor.saveVersion({ userId: U, parentId: 'v1', changes: { removed: ['seen.objective.MCQs.0'] } }),
    ]) expect(await call()).toMatchObject({ code: 'EDITING_DISABLED' });
  });
});

describe('versions', () => {
  test('lists the family numbered v1..vn, newest ready one is latest; failed is listed but never latest', async () => {
    seed([
      paper('v2', { edited_from: 'v1', created_at: '2026-09-30T10:00:00.000Z' }),
      paper('v3', { edited_from: 'v2', created_at: '2026-09-30T11:00:00.000Z' }),
      paper('vf', { edited_from: 'v3', status: 'failed', created_at: '2026-09-30T12:00:00.000Z' }),
    ]);
    const out = await Editor.versions({ userId: U, paperId: 'v2' });
    expect(out.versions.map((v) => [v.paperId, v.version, v.status, v.latest])).toEqual([
      ['vf', null, 'failed', false],
      ['v3', 3, 'ready', true],
      ['v2', 2, 'ready', false],
      ['v1', 1, 'ready', false],
    ]);
  });

  test("someone else's paper is NOT_FOUND", async () => {
    expect(await Editor.versions({ userId: 'x', paperId: 'v1' })).toEqual({ code: 'NOT_FOUND' });
  });
});

describe('questions', () => {
  test('every question with its shape fields', async () => {
    const out = await Editor.questions({ userId: U, paperId: 'v1' });
    expect(out.paper).toMatchObject({ paperId: 'v1', version: 1, grade: 3, subject: 'maths', rtl: false, questionCount: 3, marks: 6 });
    const first = out.items[0];
    expect(first).toMatchObject({ id: 'seen.objective.MCQs.0', number: 1, section: 'objective', type: 'MCQs', marks: 1, text: 'Q one' });
    expect(first.fields).toMatchObject({ shape: 'options', question: 'Q one', correct: '0' });
    expect(out.items[2]).toMatchObject({ section: 'subjective', fields: { shape: 'standard', answer: 'Because.' } });
  });

  test('an Urdu paper is rtl and its Urdu question text comes back unchanged', async () => {
    const urdu = 'پاکستان کا دارالحکومت کیا ہے؟';
    mockDb.tables.assessment_requests[0].subject_code = 'urdu';
    mockDb.tables.assessment_papers[0].exam_json = {
      seen: { objective: { MCQs: [{ question: urdu, options: ['الف) اسلام آباد', 'ب) لاہور'], answer: 'الف) اسلام آباد', marks: 1 }] } },
    };
    const out = await Editor.questions({ userId: U, paperId: 'v1' });
    expect(out.paper.rtl).toBe(true);
    expect(out.items[0].text).toBe(urdu);
  });
});

describe('addKinds', () => {
  test('offers the four kinds the bot can add, with their defaults', async () => {
    const out = await Editor.addKinds({ userId: U, paperId: 'v1' });
    expect(out.kinds.map((k) => k.kind).sort()).toEqual(['fill', 'long', 'mcq', 'short']);
    expect(out.kinds.find((k) => k.kind === 'mcq')).toMatchObject({ marks: 1, needsOptions: true });
    expect(out.slotCap).toBe(6);
  });
});

describe('validateEdit', () => {
  test('a good edit returns the edited question and writes nothing', async () => {
    const out = await Editor.validateEdit({ userId: U, paperId: 'v1', id: 'seen.objective.MCQs.0', edit: { marks: '4' } });
    expect(out).toMatchObject({ ok: true, marks: 4, text: 'Q one' });
    expect(mockDb.writes).toEqual([]);
  });

  test('a bad edit returns the bot message', async () => {
    const out = await Editor.validateEdit({ userId: U, paperId: 'v1', id: 'seen.objective.MCQs.0', edit: { slots: ['only', '', '', '', '', ''] } });
    expect(out).toEqual({ ok: false, message: 'A multiple-choice question needs at least two options.' });
  });

  test('a new question is validated by kind', async () => {
    const out = await Editor.validateEdit({ userId: U, paperId: 'v1', kind: 'short', edit: { question: 'Why?' } });
    expect(out).toEqual({ ok: false, message: 'Write the answer too — it goes in the answer key.' });
  });
});

describe('saveVersion', () => {
  test('applies the changes and builds a version that is never sent', async () => {
    const out = await Editor.saveVersion({ userId: U, parentId: 'v1', changes: { removed: ['seen.objective.MCQs.0'] } });
    expect(out).toMatchObject({ status: 'ready', version: 2, questionCount: 2 });
    expect(axios.post).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('editing v1 after v3 exists branches from v1 and is v4', async () => {
    // seeded before the fake DB's clock (10:00), so the new row is the newest
    seed([
      paper('v2', { edited_from: 'v1', created_at: '2026-09-30T09:10:00.000Z' }),
      paper('v3', { edited_from: 'v2', created_at: '2026-09-30T09:20:00.000Z' }),
    ]);
    const out = await Editor.saveVersion({ userId: U, parentId: 'v1', changes: { edits: [{ id: 'seen.objective.MCQs.1', edit: { marks: '5' } }] } });
    expect(out.version).toBe(4);
    expect(mockDb.tables.assessment_papers.find((p) => p.id === out.paperId).edited_from).toBe('v1');
  });

  test('bad changes come back with every error and open no row', async () => {
    const out = await Editor.saveVersion({ userId: U, parentId: 'v1', changes: { edits: [{ id: 'seen.objective.MCQs.0', edit: { slots: ['x', '', '', '', '', ''] } }] } });
    expect(out).toMatchObject({ status: 'failed', code: 'INVALID_CHANGES', errors: [{ id: 'seen.objective.MCQs.0' }] });
    expect(mockDb.writes.filter((w) => w.op === 'insert')).toEqual([]);
  });

  test.each([
    ['a null edit entry', { edits: [null] }],
    ['an edit without a string id', { edits: [{ id: 5, edit: {} }] }],
    ['removed not an array', { removed: 'seen.objective.MCQs.0' }],
    ['a non-string removed entry', { removed: [3] }],
    ['a non-object added entry', { added: ['x'] }],
    ['changes not an object', 'nope'],
  ])('a malformed payload (%s) is INVALID_CHANGES and touches nothing', async (_n, changes) => {
    const out = await Editor.saveVersion({ userId: U, parentId: 'v1', changes });
    expect(out).toEqual({ status: 'failed', code: 'INVALID_CHANGES', errors: [{ message: 'That change could not be read.' }] });
    expect(mockDb.writes).toEqual([]);
  });
});
