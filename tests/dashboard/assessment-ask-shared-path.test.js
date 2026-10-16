/**
 * The coded 400/409 passthrough belongs to the create path only.
 *
 * `ask()` is shared by options, chapters, status, download and papers. The passthrough that lets the
 * app say ALREADY_GENERATING or PATTERN_OFF was added for create; on every other path a bot answer
 * must keep its old shape: a 400 is the two-key body, and a 409 (which no other bot route sends) is
 * ours, a 502. Otherwise a future bot change on, say, status would start reaching the app as a 409
 * with a code no screen knows how to draw.
 *
 * Chain: the REAL portal router handler -> the REAL assessment.service -> axios (the only mock).
 */

const { setup, invoke, BOT } = require('./portal-proxy-harness');

const FDE_BODY = { grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0,
  contentSource: 'unseen', seenCount: null, questionTypes: [], answerLines: true, outputFormat: 'pdf' };

let edges;
beforeEach(() => {
  jest.resetModules();
  edges = setup();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

describe('ask(): the coded passthrough runs only for create', () => {
  test('a coded 409 on the SHARED ask() path (status) stays ours: 502, no code reaches the app', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 409, data: { success: false, errorCode: 'SOMETHING', error: 'x' } });
    const { statusCode, payload } = await invoke('get', '/assessment/status/:request_id', { params: { request_id: 'r-1' } });
    expect(edges.axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/status`);
    expect(statusCode).toBe(502);
    expect(payload.errorCode).toBeUndefined();
    expect(payload.success).toBe(false);
  });

  test('a coded 400 on a shared path answers the old two-key body', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 400, data: { success: false, errorCode: 'SOMETHING', error: 'nope', requestId: 'r-9' } });
    const { statusCode, payload } = await invoke('get', '/assessment/chapters', { query: { grade: '5', subject: 'maths' } });
    expect(statusCode).toBe(400);
    expect(JSON.stringify(payload)).toBe('{"success":false,"error":"nope"}');
  });

  test('the shared path tells axios a 409 is not an answer (validateStatus is the old one)', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, status: 'generating' } });
    await invoke('get', '/assessment/status/:request_id', { params: { request_id: 'r-1' } });
    const { validateStatus } = edges.axios.post.mock.calls[0][2];
    expect(validateStatus(400)).toBe(true);
    expect(validateStatus(409)).toBe(false);
  });

  test('create still passes a coded 409 through with its code and request id', async () => {
    edges.axios.post.mockResolvedValueOnce({ status: 409, data: { success: false, errorCode: 'ALREADY_GENERATING', error: 'A paper for this class is being made.', requestId: 'req-first' } });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: FDE_BODY });
    expect(statusCode).toBe(409);
    expect(payload).toEqual({ success: false, error: 'A paper for this class is being made.', errorCode: 'ALREADY_GENERATING', requestId: 'req-first' });
    const { validateStatus } = edges.axios.post.mock.calls[0][2];
    expect(validateStatus(409)).toBe(true);
  });
});
