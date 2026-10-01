/**
 * "Make my paper" — after the review Flow closes (DONE is terminal).
 *
 * The chat order is the confirmation: a short ack FIRST, then the new version
 * with its Edit button, then its key. (Until now the "a few seconds" message
 * arrived AFTER the rebuilt paper.) A retried completion webhook must not make
 * a second version, a draft that timed out says so, "no changes" re-sends the
 * same paper with its own sentence, and a failure is apologised for ONCE — by
 * the service that failed, not again by the handler.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: async (k) => (mockStore.has(k) ? JSON.parse(mockStore.get(k)) : null),
  set: async (k, v) => { mockStore.set(k, JSON.stringify(v)); return true; },
  setNX: async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, JSON.stringify(v)); return true; },
  delete: async (k) => { mockStore.delete(k); return true; },
}));
const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));
const mockOrder = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockOrder.push(['text', text]); return true; }),
  sendDocumentByLink: jest.fn(async () => true),
  sendFlow: jest.fn(async () => true),
}));

const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const { handleAssessmentFlowCompletion: complete } = require('../../bot/shared/handlers/flow-response.handler');

const U = 'user-1';
const TOKEN = `${U}:assessment-review:v2`;
const TREE = { seen: { objective: { MCQs: [
  { question: 'پانی کس حالت میں ہوتا ہے؟', options: ['الف) ٹھوس', 'ب) مائع'], answer: 'ب) مائع', marks: 1 },
  { question: 'Q2', options: ['A) 1', 'B) 2'], answer: 'A) 1', marks: 1 },
] } } };
const USER = { id: U, preferred_language: 'en' };

let createSpy;
let resendSpy;
beforeEach(() => {
  mockStore.clear();
  mockOrder.length = 0;
  mockDb = makeFakeDb({
    assessment_requests: [{ id: 'r1', user_id: U, grade_code: 'grade_2', subject_code: 'urdu', has_answer_lines: true, output_format: 'pdf' }],
    assessment_papers: [
      { id: 'v1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: TREE, created_at: '2026-09-30T09:00:00.000Z' },
      { id: 'v2', request_id: 'r1', attempt: 1, status: 'ready', edited_from: 'v1', exam_json: TREE, created_at: '2026-09-30T09:05:00.000Z' },
    ],
    users: [{ id: U, preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_versions_enabled', value: true }, { key: 'assessment_editing_enabled', value: true }],
  });
  createSpy = jest.spyOn(Revision, 'createVersion').mockImplementation(async () => {
    mockOrder.push(['build']);
    return { status: 'ready', paperId: 'v3', version: 3, parentVersion: 2, questionCount: 1, marks: 1 };
  });
  resendSpy = jest.spyOn(Revision, 'resendVersion').mockImplementation(async () => {
    mockOrder.push(['resend']);
    return { status: 'resent' };
  });
});
afterEach(() => jest.restoreAllMocks());

async function openAndRemoveOne() {
  const list = await Endpoint.handleAssessmentGenInit(U, TOKEN);
  const row = list.data.rows.find((r) => /Q2/.test(r['main-content'].title));
  await Endpoint.handleAssessmentGenDataExchange(U, 'LIST', row['on-click-action'].payload, TOKEN);
  await Endpoint.handleAssessmentGenDataExchange(U, 'EDIT_OPTIONS', {
    _action: 'save', remove: true, correct: '0', slot_0: 'A) 1', slot_1: 'B) 2', slot_2: '', slot_3: '', slot_4: '', slot_5: '',
  }, TOKEN);
}

test('the draft becomes a version of the paper the token names, and the ack comes FIRST', async () => {
  await openAndRemoveOne();
  await complete({ flow_token: TOKEN }, '923000000000', USER);
  expect(createSpy).toHaveBeenCalledTimes(1);
  const args = createSpy.mock.calls[0][0];
  expect(args.parentId).toBe('v2');
  expect(Selection.indexQuestions(args.tree).find((q) => q.text === 'Q2').removed).toBe(true);
  expect(mockOrder[0]).toEqual(['text', '📝 Making your new version — a few seconds.']);
  expect(mockOrder[1]).toEqual(['build']);
  expect(mockOrder).toHaveLength(2); // nothing after: the documents are the confirmation
});

test('a duplicate completion webhook makes no second version and says nothing', async () => {
  await openAndRemoveOne();
  await complete({ flow_token: TOKEN }, '923000000000', USER);
  mockOrder.length = 0;
  await complete({ flow_token: TOKEN }, '923000000000', USER);
  expect(createSpy).toHaveBeenCalledTimes(1);
  expect(mockOrder).toEqual([]);
});

test('no session (timed out) → she is told how to start again, and nothing is built', async () => {
  await complete({ flow_token: TOKEN }, '923000000000', USER);
  expect(createSpy).not.toHaveBeenCalled();
  expect(mockOrder).toHaveLength(1);
  expect(mockOrder[0][1]).toMatch(/timed out/);
});

test('no changes → the same paper again, with its own sentence first, and no new row', async () => {
  await Endpoint.handleAssessmentGenInit(U, TOKEN);
  await complete({ flow_token: TOKEN }, '923000000000', USER);
  expect(createSpy).not.toHaveBeenCalled();
  expect(resendSpy).toHaveBeenCalledWith(expect.objectContaining({ paperId: 'v2', userId: U }));
  expect(mockOrder[0][1]).toMatch(/didn't change anything/);
  expect(mockOrder[1]).toEqual(['resend']);
});

test('a failed build is apologised for once — by the service, not again here', async () => {
  createSpy.mockImplementation(async () => { mockOrder.push(['build']); return { status: 'failed', code: 'RENDER_FAILED' }; });
  await openAndRemoveOne();
  await complete({ flow_token: TOKEN }, '923000000000', USER);
  expect(mockOrder.map((o) => o[0])).toEqual(['text', 'build']);
});

test('with the versions flag OFF the old rebuild path runs, untouched', async () => {
  mockDb.tables.app_settings[0].value = false;
  const rerender = jest.spyOn(Revision, 'rerender').mockResolvedValue({ status: 'ready', questionCount: 2, marks: 2 });
  jest.spyOn(Revision, 'listQuestions').mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }] });
  await complete({ flow_token: TOKEN }, '923000000000', USER);
  expect(rerender).toHaveBeenCalledTimes(1);
  expect(createSpy).not.toHaveBeenCalled();
});
