/**
 * Live moves (bd-v0toag.31): an hour-long single-use Soniox key per lesson, behind the 5-stream cap.
 * A full cap answers 'cap' without calling Soniox.
 */
const { mintLessonKey } = require('../../../bot/shared/services/coaching/live-moves/live-key');
const { createStreamCap } = require('../../../bot/shared/services/coaching/live-moves/stream-cap');

function deps(over = {}) {
  return {
    cap: createStreamCap({ limit: 1 }),
    mint: jest.fn(async () => ({ ok: true, api_key: 'tmp', expires_at: 'x' })),
    log: jest.fn(),
    now: () => 0,
    ...over,
  };
}

describe('mintLessonKey', () => {
  test('mints an hour-long single-use key and logs it', async () => {
    const d = deps();
    const r = await mintLessonKey({ liveId: 'l1', userId: 'u1' }, d);
    expect(r).toMatchObject({ ok: true, api_key: 'tmp', expires_at: 'x' });
    expect(r.ws).toMatch(/^wss:/);
    expect(r.model).toBe('stt-rt-v5');
    expect(d.mint).toHaveBeenCalledWith('l1', {}, { singleUse: true, sessionSeconds: 3600 });
    expect(d.log).toHaveBeenCalledWith('live_moves.key.minted', { userId: 'u1', liveId: 'l1', reason: null, live: 1 });
  });

  test('mintLessonKey returns cap without calling Soniox when full', async () => {
    const d = deps();
    d.cap.acquire('other', 0);
    const r = await mintLessonKey({ liveId: 'l1', userId: 'u1' }, d);
    expect(r).toEqual({ ok: false, reason: 'cap' });
    expect(d.mint).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith('live_moves.key.refused', { userId: 'u1', liveId: 'l1', reason: 'cap', live: 1 });
  });

  test('a failed mint frees the slot and answers mint', async () => {
    const d = deps({ mint: jest.fn(async () => ({ ok: false, status: 500, reason: 'refused' })) });
    const r = await mintLessonKey({ liveId: 'l1', userId: 'u1' }, d);
    expect(r).toEqual({ ok: false, reason: 'mint' });
    expect(d.cap.size(0)).toBe(0);
    expect(d.log).toHaveBeenCalledWith('live_moves.key.refused', { userId: 'u1', liveId: 'l1', reason: 'mint', live: 0 });
  });
});
