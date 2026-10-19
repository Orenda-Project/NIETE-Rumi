/**
 * The portal's status answer carries what the bot says about a board-pattern request.
 *
 * The bot's /assessment/status adds `pattern` and `created_at` on a board-pattern request (so a
 * reopened request can show its chip and class card), and the engine's tests proved that body. The
 * app's tests mocked the portal call. Nothing drove the middle layer, and assessment.service
 * status() rebuilt a three-key body, so both keys were lost on a live retest.
 *
 * The bodies below have the shape the bot answered on sandbox (ids are made up). Chain: the REAL
 * portal router handler -> the REAL assessment.service -> axios (the only mock).
 */

const { setup, invoke, BOT } = require('./portal-proxy-harness');

const BOT_BODIES = {
  pattern_ready: { success: true, status: 'ready', paperId: 'p-0001', pattern: 'fde_g5_2027', created_at: '2026-10-16T05:45:26.240841+00:00' },
  pattern_failed: { success: true, status: 'failed', errorCode: 'PATTERN_SHORT_SLOT', pattern: 'fde_g5_2027', created_at: '2026-10-16T03:42:32.615499+00:00' },
  pattern_queued: { success: true, status: 'queued', pattern: 'fde_g5_2027', created_at: '2026-10-16T05:50:00.000000+00:00' },
  plain_ready: { success: true, status: 'ready', paperId: 'p-0002' },
  not_found: { success: true, status: 'not_found' },
};

let edges;
beforeEach(() => {
  jest.resetModules();
  edges = setup();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); });

async function statusFor(botBody) {
  edges.axios.post.mockResolvedValueOnce({ status: 200, data: botBody });
  const out = await invoke('get', '/assessment/status/:request_id', { params: { request_id: 'r-1' } });
  expect(edges.axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/status`);
  return out;
}

describe('status(): a board-pattern request keeps pattern and created_at', () => {
  test('ready: pattern and created_at reach the app', async () => {
    const { statusCode, payload } = await statusFor(BOT_BODIES.pattern_ready);
    expect(statusCode).toBe(200);
    expect(payload).toEqual({
      success: true, status: 'ready', paperId: 'p-0001', errorCode: null,
      pattern: 'fde_g5_2027', created_at: '2026-10-16T05:45:26.240841+00:00',
    });
  });

  test('failed: the code, pattern and created_at all reach the app', async () => {
    const { payload } = await statusFor(BOT_BODIES.pattern_failed);
    expect(payload).toEqual({
      success: true, status: 'failed', paperId: null, errorCode: 'PATTERN_SHORT_SLOT',
      pattern: 'fde_g5_2027', created_at: '2026-10-16T03:42:32.615499+00:00',
    });
  });

  test('queued (no paper row yet): pattern and created_at reach the app', async () => {
    const { payload } = await statusFor(BOT_BODIES.pattern_queued);
    expect(payload.pattern).toBe('fde_g5_2027');
    expect(payload.created_at).toBe('2026-10-16T05:50:00.000000+00:00');
  });
});

describe('status(): a plain request answers exactly as before', () => {
  test('plain ready: the body is byte-identical to today (no pattern, no created_at keys)', async () => {
    const { payload } = await statusFor(BOT_BODIES.plain_ready);
    expect(JSON.stringify(payload)).toBe('{"success":true,"status":"ready","paperId":"p-0002","errorCode":null}');
    expect('pattern' in payload).toBe(false);
    expect('created_at' in payload).toBe(false);
  });

  test('not_found: byte-identical to today', async () => {
    const { payload } = await statusFor(BOT_BODIES.not_found);
    expect(JSON.stringify(payload)).toBe('{"success":true,"status":"not_found","paperId":null,"errorCode":null}');
  });

  test('a null pattern from the bot is not passed on (the key stays absent)', async () => {
    const { payload } = await statusFor({ success: true, status: 'ready', paperId: 'p-3', pattern: null, created_at: null });
    expect(JSON.stringify(payload)).toBe('{"success":true,"status":"ready","paperId":"p-3","errorCode":null}');
  });
});
