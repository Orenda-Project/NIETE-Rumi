/**
 * A topic paper keeps its "by topic" key summary and its header (no marks row)
 * when the teacher edits it. A chapter paper's re-render passes neither.
 * Covers the in-place path (rerender), the versions path (createVersion) and the
 * lazy key build for a version stored without one (resendVersion).
 */
jest.mock('../../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { makeFakeDb } = require('../helpers/fake-postgrest');
let mockDb;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));
jest.mock('../../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async ({ userId, examId, filename }) => `exams/${userId}/${examId}/${filename}`),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: jest.fn(async (u) => `${u}?signed`),
}));
jest.mock('../../../bot/shared/services/assessment/assessment-format', () => ({
  rendererFor: () => ({ ext: 'pdf', render: async () => Buffer.from('pdf') }),
}));
jest.mock('../../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(async () => [{ chapterNumber: 2, title: 'The Thirsty Crow' }]),
}));

const axios = require('axios');
const Revision = require('../../../bot/shared/services/assessment/assessment-revision.service');
const Renderer = require('../../../bot/shared/services/assessment/assessment-paper.renderer');

const U = 'u1';
const REQ = {
  id: 'r1', user_id: U, grade_code: 'grade_3', subject_code: 'maths', chapter_number: 2,
  page_ranges: null, output_format: 'pdf', has_answer_lines: false, textbook_id: 't1',
};
const TOPICS = [
  { topicId: 't1', name: 'Counting', sloCodes: ['S1'] },
  { topicId: 't2', name: 'Adding', sloCodes: ['S2'] },
];
const TOPIC_REQ = { ...REQ, paper_kind: 'topic' };
const TREE = {
  seen: { objective: { MCQs: [
    { question: 'Q one', options: ['A) 1', 'B) 2'], answer: 'A) 1', marks: 1 },
    { question: 'Q two', options: ['A) 3', 'B) 4'], answer: 'B) 4', marks: 2 },
  ] } },
};
const TOPIC_TREE = { ...TREE, _topics: TOPICS };
const paper = (over = {}) => ({
  id: 'v1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: TREE,
  created_at: '2026-09-30T09:00:00.000Z', file_r2_key: `exams/${U}/v1/Grade3_Maths.pdf`,
  answer_key_r2_key: `exams/${U}/v1/Grade3_Maths_AnswerKey.pdf`, question_count: 2, total_marks: 3,
  selected_question_ids: null, ...over,
});
const seed = (req, paperOver) => {
  mockDb = makeFakeDb({
    assessment_requests: [req],
    assessment_papers: [paper(paperOver)],
    users: [{ id: U, phone_number: '923000000000', school_name: 'School', preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_editing_enabled', value: true }],
  });
};

let paperSpy;
let keySpy;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ASSESSMENT_REVIEW_FLOW_ID = 'REVIEW_FLOW';
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.x' }] } });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.t' }] }) }));
  paperSpy = jest.spyOn(Renderer, 'renderPaper');
  keySpy = jest.spyOn(Renderer, 'renderAnswerKey');
});
afterEach(() => jest.restoreAllMocks());

const firstArg = (spy) => spy.mock.calls[0][0];

describe('topic paper edited in place (rerender)', () => {
  test('key carries the scope topics and the paper is a topic paper', async () => {
    seed(TOPIC_REQ, { exam_json: TOPIC_TREE });
    const res = await Revision.rerender({ paperId: 'v1', userId: U, selectedIds: ['seen.objective.MCQs.0'] });
    expect(res.status).toBe('ready');
    expect(firstArg(paperSpy).paperKind).toBe('topic');
    expect(firstArg(keySpy).topics).toEqual(TOPICS);
  });

  test('a chapter paper passes neither', async () => {
    seed(REQ);
    await Revision.rerender({ paperId: 'v1', userId: U, selectedIds: ['seen.objective.MCQs.0'] });
    expect(firstArg(paperSpy)).not.toHaveProperty('paperKind');
    expect(firstArg(paperSpy)).not.toHaveProperty('topics');
    expect(firstArg(keySpy)).not.toHaveProperty('topics');
    expect(firstArg(keySpy)).not.toHaveProperty('paperKind');
  });
});

describe('a topic row whose tree carries no _topics (made before this)', () => {
  test('keeps the topic header and sends no topics, rather than failing', async () => {
    seed(TOPIC_REQ);
    const res = await Revision.rerender({ paperId: 'v1', userId: U, selectedIds: ['seen.objective.MCQs.0'] });
    expect(res.status).toBe('ready');
    expect(firstArg(paperSpy).paperKind).toBe('topic');
    expect(firstArg(keySpy)).not.toHaveProperty('topics');
  });

  test('the selects never ask for a scope column that does not exist', () => {
    const src = require('fs').readFileSync(require.resolve(
      '../../../bot/shared/services/assessment/assessment-revision.service'), 'utf8');
    expect(src).not.toMatch(/has_answer_lines[^']*\bscope\b/);
    expect(src).not.toMatch(/req\.scope/);
  });
});

describe('topic paper edited as a new version (createVersion)', () => {
  test('paper is a topic paper and the key carries the topics', async () => {
    seed(TOPIC_REQ, { exam_json: TOPIC_TREE });
    const out = await Revision.createVersion({ parentId: 'v1', userId: U, tree: TOPIC_TREE, user: { id: U, preferred_language: 'en' } });
    expect(out.status).toBe('ready');
    expect(firstArg(paperSpy).paperKind).toBe('topic');
    expect(firstArg(keySpy).topics).toEqual(TOPICS);
  });

  test('a chapter paper passes neither', async () => {
    seed(REQ);
    await Revision.createVersion({ parentId: 'v1', userId: U, tree: TREE, user: { id: U, preferred_language: 'en' } });
    for (const spy of [paperSpy, keySpy]) {
      expect(firstArg(spy)).not.toHaveProperty('topics');
      expect(firstArg(spy)).not.toHaveProperty('paperKind');
    }
  });
});

describe('lazy key for a version stored without one (resendVersion)', () => {
  test('a topic paper gets its topics', async () => {
    seed(TOPIC_REQ, { exam_json: TOPIC_TREE, answer_key_r2_key: null });
    await Revision.resendVersion({ paperId: 'v1', userId: U, user: { id: U, preferred_language: 'en' } });
    expect(keySpy).toHaveBeenCalledTimes(1);
    expect(firstArg(keySpy).topics).toEqual(TOPICS);
  });

  test('a chapter paper passes no topics', async () => {
    seed(REQ, { answer_key_r2_key: null });
    await Revision.resendVersion({ paperId: 'v1', userId: U, user: { id: U, preferred_language: 'en' } });
    expect(keySpy).toHaveBeenCalledTimes(1);
    expect(firstArg(keySpy)).not.toHaveProperty('topics');
    expect(firstArg(keySpy)).not.toHaveProperty('paperKind');
  });
});

describe('_topics rides in the tree through every edit', () => {
  const Selection = require('../../../bot/shared/services/assessment/assessment-selection');
  const user = { id: U, preferred_language: 'en' };

  test('applySelection, activeTree, setRemoved and replaceAt keep it', () => {
    expect(Selection.applySelection(TOPIC_TREE, ['seen.objective.MCQs.0'])._topics).toEqual(TOPICS);
    expect(Selection.activeTree(TOPIC_TREE)._topics).toEqual(TOPICS);
    expect(Selection.setRemoved(TOPIC_TREE, 'seen.objective.MCQs.0', true)._topics).toEqual(TOPICS);
  });

  test('it is not a question: collectQuestions and the printed paper ignore it', () => {
    expect(Renderer.collectQuestions(TOPIC_TREE)).toHaveLength(2);
    const html = Renderer.renderPaper({ examJson: TOPIC_TREE, grade: 3, subject: 'maths', paperKind: 'topic' });
    expect(html).not.toContain('Counting');
    expect(html).not.toContain('_topics');
  });

  test('a second edit (version of a version) still has the topics', async () => {
    seed(TOPIC_REQ, { exam_json: TOPIC_TREE });
    const first = await Revision.createVersion({
      parentId: 'v1', userId: U, user,
      tree: Selection.setRemoved(TOPIC_TREE, 'seen.objective.MCQs.0', true),
    });
    expect(first.status).toBe('ready');
    const child = mockDb.tables.assessment_papers.find((p) => p.id === first.paperId);
    expect(child.exam_json._topics).toEqual(TOPICS);
    keySpy.mockClear();
    paperSpy.mockClear();
    const second = await Revision.createVersion({
      parentId: first.paperId, userId: U, user, tree: child.exam_json,
    });
    expect(second.status).toBe('ready');
    expect(firstArg(paperSpy).paperKind).toBe('topic');
    expect(firstArg(keySpy).topics).toEqual(TOPICS);
  });

  test('in-place: edit one question then re-render still has the topics', async () => {
    seed(TOPIC_REQ, { exam_json: TOPIC_TREE });
    const saved = await Revision.saveEdit({
      paperId: 'v1', userId: U, questionId: 'seen.objective.MCQs.0',
      edit: { question: 'Q one, reworded' },
    });
    expect(saved.status).not.toBe('rejected');
    expect(mockDb.tables.assessment_papers[0].exam_json._topics).toEqual(TOPICS);
    await Revision.rerender({ paperId: 'v1', userId: U, selectedIds: ['seen.objective.MCQs.0'] });
    expect(firstArg(keySpy).topics).toEqual(TOPICS);
  });
});
