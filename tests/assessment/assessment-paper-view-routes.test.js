const mockView = { view: jest.fn() };
jest.mock('../../bot/shared/services/assessment/assessment-paper-view.service', () => mockView);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const router = require('../../bot/shared/routes/internal-assessment-view.routes');

async function call(body) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/assessment/paper/view' && l.route.methods.post);
  if (!layer) throw new Error('no POST /assessment/paper/view');
  const handlers = layer.route.stack.map((s) => s.handle);
  let statusCode = 200; let payload;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  await handlers[handlers.length - 1]({ body, headers: {} }, res);
  return { statusCode, payload };
}
beforeEach(() => jest.clearAllMocks());

test('guarded by the internal key', () => {
  const layer = router.stack.find((l) => l.route && l.route.path === '/assessment/paper/view');
  expect(layer.route.stack[0].handle.name).toBe('requireInternalKey');
});
test('userId and paperId are required', async () => {
  expect((await call({ paperId: 'p' })).statusCode).toBe(400);
  expect((await call({ userId: 'u' })).statusCode).toBe(400);
  expect(mockView.view).not.toHaveBeenCalled();
});
test('200 with the paper and its sections', async () => {
  mockView.view.mockResolvedValue({ paper: { paperId: 'p' }, sections: [] });
  const out = await call({ userId: 'u', paperId: 'p' });
  expect(out).toEqual({ statusCode: 200, payload: { success: true, paper: { paperId: 'p' }, sections: [] } });
  expect(mockView.view).toHaveBeenCalledWith({ userId: 'u', paperId: 'p' });
});
test.each([['NOT_FOUND', 404], ['NOT_READY', 409]])('%s -> %i', async (code, status) => {
  mockView.view.mockResolvedValue({ code });
  const out = await call({ userId: 'u', paperId: 'p' });
  expect(out.statusCode).toBe(status);
  expect(out.payload).toMatchObject({ success: false, code });
});
test('a thrown error is a 500', async () => {
  mockView.view.mockRejectedValue(new Error('db'));
  expect((await call({ userId: 'u', paperId: 'p' })).statusCode).toBe(500);
});
test('internal-api.routes mounts it', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../bot/shared/routes/internal-api.routes.js'), 'utf8');
  expect(src).toMatch(/require\('\.\/internal-assessment-view\.routes'\)/);
});
