/**
 * A board-pattern request names its pattern on the two reads a reopened page starts from.
 *
 * The teacher closes WhatsApp's browser mid-wait and opens the link again: the app has no local
 * job any more, only the request id. `POST /assessment/status` is then the only thing that can say
 * "this is a board-pattern paper, started at …", so it carries `pattern` and `created_at`. The
 * versions list carries `pattern` for the same reason. A plain request answers exactly today's body.
 *
 * Driven through the real routes and the real browse / revision services; only the database is
 * the in-memory PostgREST fake.
 */

const KEY = 'fde-status-key';
const { makeFakeDb } = require('./helpers/fake-postgrest');

let mockDb;
let apiRouter;
let editRouter;

function handlersOf(r, p) {
  const layer = r.stack.find((l) => l.route && l.route.path === p && l.route.methods.post);
  return layer.route.stack.map((s) => s.handle);
}

async function invoke(r, p, body) {
  const stack = handlersOf(r, p);
  const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: p };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
      else if (!advanced) resolve();
    });
    if (!advanced) break;
  }
  return { statusCode, payload };
}

const U = 'teacher-1';
const CREATED = '2026-10-16T04:30:00.000Z';
const SLOTTED = [
  { id: 'mcq', count: 20, category: 'objective', slot: 'maths.A.Q1' },
  { id: 'short_answer', count: 12, category: 'subjective', slot: 'maths.B.Q2' },
];
const PLAIN_TYPES = [{ id: 'mcq', count: 10, category: 'objective' }];
const req = (id, over = {}) => ({
  id, user_id: U, grade_code: 'grade_5', subject_code: 'maths', chapter_number: null,
  page_ranges: '1-12', question_types: SLOTTED, created_at: CREATED, ...over,
});
const paper = (id, requestId, over = {}) => ({
  id, request_id: requestId, attempt: 1, status: 'ready', error_code: null, edited_from: null,
  exam_json: { _layout: { preset_id: 'fde_g5_2027', subject: 'maths' }, unseen: {} },
  created_at: '2026-10-16T04:32:00.000Z', question_count: 48, total_marks: 100, ...over,
});

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));
  mockDb = makeFakeDb({
    assessment_requests: [
      req('r-gen'),
      req('r-ready'),
      req('r-plain', { question_types: PLAIN_TYPES, chapter_number: 3, page_ranges: null }),
    ],
    assessment_papers: [
      paper('p-gen', 'r-gen', { status: 'generating', exam_json: null, question_count: null, total_marks: null }),
      paper('p-ready', 'r-ready'),
      paper('p-ready-v2', 'r-ready', { edited_from: 'p-ready', created_at: '2026-10-16T04:40:00.000Z' }),
      paper('p-plain', 'r-plain', { exam_json: { unseen: {} }, question_count: 10, total_marks: 20 }),
    ],
    app_settings: [{ key: 'assessment_editing_enabled', value: true }],
  });
  apiRouter = require('../../bot/shared/routes/internal-api.routes');
  editRouter = require('../../bot/shared/routes/internal-assessment-edit.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('POST /assessment/status', () => {
  test('status of a pattern request carries pattern and created_at', async () => {
    const out = await invoke(apiRouter, '/assessment/status', { requestId: 'r-gen', userId: U });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toEqual({
      success: true, status: 'generating', pattern: 'fde_g5_2027', created_at: CREATED,
    });
  });

  test('a pattern request still queued (no paper row yet) carries them too', async () => {
    mockDb.tables.assessment_papers = mockDb.tables.assessment_papers.filter((p) => p.request_id !== 'r-gen');
    const out = await invoke(apiRouter, '/assessment/status', { requestId: 'r-gen', userId: U });
    expect(out.payload).toEqual({ success: true, status: 'queued', pattern: 'fde_g5_2027', created_at: CREATED });
  });

  test('a ready pattern paper names the pattern its own layout was made from', async () => {
    const out = await invoke(apiRouter, '/assessment/status', { requestId: 'r-ready', userId: U });
    expect(out.payload).toMatchObject({ success: true, status: 'ready', paperId: 'p-ready', pattern: 'fde_g5_2027', created_at: CREATED });
  });

  test("status of a plain request is today's body", async () => {
    const out = await invoke(apiRouter, '/assessment/status', { requestId: 'r-plain', userId: U });
    // Deep-equal through JSON: the two new keys are ABSENT, not null.
    expect(JSON.parse(JSON.stringify(out.payload))).toEqual({ success: true, status: 'ready', paperId: 'p-plain' });
    expect(Object.keys(out.payload)).not.toContain('pattern');
    expect(Object.keys(out.payload)).not.toContain('created_at');
  });

  test("someone else's pattern request is still not_found, with nothing about it", async () => {
    const out = await invoke(apiRouter, '/assessment/status', { requestId: 'r-gen', userId: 'someone-else' });
    expect(out.payload).toEqual({ success: true, status: 'not_found' });
  });
});

describe('POST /assessment/edit/versions', () => {
  test('versions carry pattern', async () => {
    const out = await invoke(editRouter, '/assessment/edit/versions', { userId: U, paperId: 'p-ready' });
    expect(out.statusCode).toBe(200);
    expect(out.payload.versions).toHaveLength(2);
    out.payload.versions.forEach((v) => expect(v.pattern).toBe('fde_g5_2027'));
  });

  test("versions of a plain paper are today's rows", async () => {
    const out = await invoke(editRouter, '/assessment/edit/versions', { userId: U, paperId: 'p-plain' });
    expect(JSON.parse(JSON.stringify(out.payload.versions))).toEqual([{
      paperId: 'p-plain', version: 1, status: 'ready', createdAt: '2026-10-16T04:32:00.000Z',
      questionCount: 10, marks: 20, editedFrom: null, latest: true,
    }]);
  });
});
