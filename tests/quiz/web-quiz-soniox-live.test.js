/**
 * The Soniox temporary-key mint. Read-aloud callers keep a 90 s single-use key; live moves (bd-v0toag.31) asks
 * for a longer session through the optional third argument.
 */
const { mintTempKey } = require('../../bot/shared/services/quiz/web-quiz-soniox-live');

const env = { SONIOX_API_KEY: 'server-key' };
let fetchSpy;

beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, status: 200, json: async () => ({ api_key: 'tmp', expires_at: 'x' }),
  });
});
afterEach(() => fetchSpy.mockRestore());

const sentBody = () => JSON.parse(fetchSpy.mock.calls[0][1].body);

test('mintTempKey default body unchanged', async () => {
  expect(await mintTempKey('run-1', { env })).toEqual({ ok: true, api_key: 'tmp', expires_at: 'x' });
  expect(sentBody()).toEqual({ usage_type: 'transcribe_websocket', expires_in_seconds: 30, single_use: true,
    max_session_duration_seconds: 90, client_reference_id: 'run-1' });
});

test('mintTempKey sessionSeconds override', async () => {
  await mintTempKey('live-1', { env }, { singleUse: true, sessionSeconds: 3600 });
  expect(sentBody()).toMatchObject({ single_use: true, max_session_duration_seconds: 3600, client_reference_id: 'live-1' });
});
