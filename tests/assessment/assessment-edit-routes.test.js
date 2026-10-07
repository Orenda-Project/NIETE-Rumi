const mockEditor = {
  versions: jest.fn(), questions: jest.fn(), addKinds: jest.fn(), validateEdit: jest.fn(), saveVersion: jest.fn(),
};
jest.mock('../../bot/shared/services/assessment/assessment-editor.service', () => mockEditor);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const router = require('../../bot/shared/routes/internal-assessment-edit.routes');

async function call(path, body) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`no POST ${path}`);
  const handlers = layer.route.stack.map((s) => s.handle);
  const handler = handlers[handlers.length - 1]; // skip the key middleware; tested separately
  let statusCode = 200; let payload;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await handler({ body, headers: {} }, res);
  return { statusCode, payload };
}

beforeEach(() => jest.clearAllMocks());

test.each(['/assessment/edit/versions', '/assessment/edit/questions', '/assessment/edit/add-kinds', '/assessment/edit/validate', '/assessment/edit/save'])(
  '%s is guarded by the internal key', (path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path);
    expect(layer.route.stack.length).toBe(2);
    expect(layer.route.stack[0].handle.name).toBe('requireInternalKey');
  });

test('userId is required', async () => {
  const out = await call('/assessment/edit/questions', { paperId: 'p' });
  expect(out.statusCode).toBe(400);
  expect(mockEditor.questions).not.toHaveBeenCalled();
});

test('versions → 200 with the list', async () => {
  mockEditor.versions.mockResolvedValue({ versions: [{ paperId: 'p', version: 1 }] });
  const out = await call('/assessment/edit/versions', { userId: 'u', paperId: 'p' });
  expect(out).toEqual({ statusCode: 200, payload: { success: true, versions: [{ paperId: 'p', version: 1 }] } });
  expect(mockEditor.versions).toHaveBeenCalledWith({ userId: 'u', paperId: 'p' });
});

test.each([['EDITING_DISABLED', 403], ['NOT_FOUND', 404], ['NOT_READY', 409]])('%s → %i', async (code, status) => {
  mockEditor.questions.mockResolvedValue({ code });
  const out = await call('/assessment/edit/questions', { userId: 'u', paperId: 'p' });
  expect(out.statusCode).toBe(status);
  expect(out.payload).toMatchObject({ success: false, code });
});

test('validate ok:false → 400 with the bot message', async () => {
  mockEditor.validateEdit.mockResolvedValue({ ok: false, message: 'The question cannot be empty.' });
  const out = await call('/assessment/edit/validate', { userId: 'u', paperId: 'p', id: 'a.b.c.0', edit: {} });
  expect(out.statusCode).toBe(400);
  expect(out.payload).toEqual({ success: false, code: 'EDIT_REJECTED', error: 'The question cannot be empty.' });
});

test.each([[null], [[]], ['text'], [undefined]])('validate with a non-object edit (%p) → 400 without calling the service', async (edit) => {
  const out = await call('/assessment/edit/validate', { userId: 'u', paperId: 'p', id: 'a.b.c.0', edit });
  expect(out.statusCode).toBe(400);
  expect(out.payload).toEqual({ success: false, code: 'EDIT_REJECTED', error: 'That change could not be read.' });
  expect(mockEditor.validateEdit).not.toHaveBeenCalled();
});

test('save INVALID_CHANGES → 400 carrying every error', async () => {
  mockEditor.saveVersion.mockResolvedValue({ status: 'failed', code: 'INVALID_CHANGES', errors: [{ id: 'x', message: 'm' }] });
  const out = await call('/assessment/edit/save', { userId: 'u', parentId: 'p', changes: { removed: ['x'] } });
  expect(out.statusCode).toBe(400);
  expect(out.payload).toMatchObject({ success: false, code: 'INVALID_CHANGES', errors: [{ id: 'x', message: 'm' }] });
});

test('save RENDER_FAILED → 502 with the code', async () => {
  mockEditor.saveVersion.mockResolvedValue({ status: 'failed', code: 'RENDER_FAILED' });
  const out = await call('/assessment/edit/save', { userId: 'u', parentId: 'p', changes: { removed: ['x'] } });
  expect(out.statusCode).toBe(502);
  expect(out.payload).toMatchObject({ success: false, code: 'RENDER_FAILED' });
});

test('save ready → 200', async () => {
  mockEditor.saveVersion.mockResolvedValue({ status: 'ready', paperId: 'p2', version: 2, questionCount: 3, marks: 6 });
  const out = await call('/assessment/edit/save', { userId: 'u', parentId: 'p', changes: { removed: ['x'] } });
  expect(out).toEqual({ statusCode: 200, payload: { success: true, status: 'ready', paperId: 'p2', version: 2, questionCount: 3, marks: 6 } });
});

test('a thrown error is a 500, logged, not a crash', async () => {
  mockEditor.versions.mockRejectedValue(new Error('db down'));
  const out = await call('/assessment/edit/versions', { userId: 'u', paperId: 'p' });
  expect(out.statusCode).toBe(500);
});

test('internal-api.routes mounts the edit router', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../bot/shared/routes/internal-api.routes.js'), 'utf8');
  expect(src).toMatch(/require\('\.\/internal-assessment-edit\.routes'\)/);
});
