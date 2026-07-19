/**
 * FEAT-053 bd-12 — /observe Redis capture-state machine
 */

jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  setexWithCeiling: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  delete: jest.fn().mockResolvedValue(1),
}));

const redisService = require('../../shared/services/cache/railway-redis.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');

describe('observe-state.service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('setState writes JSON under observe:state:<userId> with 2h TTL', async () => {
    await ObserveState.setState('u-1', 'awaiting_audio', { arm: 'why_coaching' });
    expect(redisService.setexWithCeiling).toHaveBeenCalledTimes(1);
    const [key, ttl, json] = redisService.setexWithCeiling.mock.calls[0];
    expect(key).toBe('observe:state:u-1');
    expect(ttl).toBe(7200);
    const parsed = JSON.parse(json);
    expect(parsed.state).toBe('awaiting_audio');
    expect(parsed.arm).toBe('why_coaching');
    expect(typeof parsed.updatedAt).toBe('string');
  });

  test('getState handles the REAL railway-redis contract: get() returns a parsed OBJECT', async () => {
    // railway-redis get() auto-parses JSON — it returns the object, not the
    // string. Mocking a string here is what let the staging bug through
    // (2026-07-12): the service double-parsed and dropped the state.
    redisService.get.mockResolvedValueOnce({ state: 'awaiting_audio', arm: 'why_coaching' });
    const s = await ObserveState.getState('u-1');
    expect(redisService.get).toHaveBeenCalledWith('observe:state:u-1');
    expect(s).toEqual({ state: 'awaiting_audio', arm: 'why_coaching' });
  });

  test('getState also tolerates a raw JSON string (redis fallback shape)', async () => {
    redisService.get.mockResolvedValueOnce(JSON.stringify({ state: 'awaiting_audio' }));
    expect(await ObserveState.getState('u-1')).toEqual({ state: 'awaiting_audio' });
  });

  test('getState returns null on missing key and on corrupt string', async () => {
    redisService.get.mockResolvedValueOnce(null);
    expect(await ObserveState.getState('u-1')).toBeNull();
    redisService.get.mockResolvedValueOnce('{not-json');
    expect(await ObserveState.getState('u-1')).toBeNull();
  });

  test('clearState deletes the key', async () => {
    await ObserveState.clearState('u-1');
    expect(redisService.delete).toHaveBeenCalledWith('observe:state:u-1');
  });
});
