/**
 * Live moves (bd-v0toag.31): the bot's /api/internal/coaching/live/* routes and the service behind them.
 * The service is tested with its deps injected; the routes are pinned for the shared secret and the wiring.
 */
const { createStreamCap } = require('../../../bot/shared/services/coaching/live-moves/stream-cap');

const SERVICE = '../../../bot/shared/services/coaching/live-moves/live-moves.service';

const card = {
  lessonId: 'L1', stamp: 's1',
  sections: [{ sec: 'open', minutes: 5, moves: [
    { idx: 0, covers: [], chip: '', do: 'Show the picture', say: 'What do you see?' },
    { idx: 1, covers: [], chip: '', do: 'Ask two children', say: 'Tell me one thing.' },
  ] }],
};

/** coaching_sessions double: select → maybeSingle, update → eq → is, recording what was written. */
function sessionsDb(row) {
  const writes = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      update: (patch) => ({ eq: () => ({ is: async () => { writes.push(patch); return { error: null }; } }) }),
    }),
  };
  return { db, writes };
}

function deps(over = {}) {
  return {
    liveMovesOn: jest.fn().mockResolvedValue(true),
    loadCardMoves: jest.fn().mockResolvedValue(card),
    mintLessonKey: jest.fn().mockResolvedValue({ ok: true, api_key: 'tmp' }),
    detectMoves: jest.fn().mockResolvedValue([1]),
    cap: createStreamCap(),
    log: jest.fn(),
    now: () => 1_000,
    ...over,
  };
}

const tap = { idx: 1, choice: 'did', at: '2026-10-19T08:00:00Z', live_state: 'unticked' };

describe('live-moves.service', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('eligible false for non-D', async () => {
    const d = deps({ liveMovesOn: jest.fn().mockResolvedValue(false) });
    expect(await Svc.eligible({ userId: 'u-b' }, d)).toEqual({ status: 'ok', on: false });
    expect(d.liveMovesOn).toHaveBeenCalledWith('u-b');
  });

  test('card is off when the lesson has no card', async () => {
    const d = deps({ loadCardMoves: jest.fn().mockResolvedValue(null) });
    expect(await Svc.card({ userId: 'u', lessonId: 'L9' }, d)).toEqual({ status: 'ok', on: false });
  });

  test('key refused when switch off', async () => {
    const d = deps({ liveMovesOn: jest.fn().mockResolvedValue(false) });
    expect(await Svc.key({ userId: 'u', liveId: 'live-1' }, d)).toEqual({ status: 'ok', ok: false, reason: 'off' });
    expect(d.mintLessonKey).not.toHaveBeenCalled();
  });

  test('detect touches cap and returns ticked', async () => {
    const d = deps();
    d.cap.acquire('live-1', 0);
    const touch = jest.spyOn(d.cap, 'touch');
    const out = await Svc.detect({ userId: 'u', liveId: 'live-1', lessonId: 'L1', window: 'x'.repeat(7000) + 'end', unticked: [1] }, d);
    expect(out).toEqual({ status: 'ok', ticked: [1] });
    expect(touch).toHaveBeenCalledWith('live-1', 1_000);
    const sent = d.detectMoves.mock.calls[0][0];
    expect(sent.window.length).toBe(6000);
    expect(sent.window.endsWith('end')).toBe(true);
    expect(sent.moves.map((m) => m.idx)).toEqual([1]);
  });

  test('end releases the slot and logs the stream', async () => {
    const d = deps();
    d.cap.acquire('live-1', 0);
    expect(await Svc.end({ userId: 'u', liveId: 'live-1', drops: 2, bytesSent: 900 }, d)).toEqual({ status: 'ok', ok: true });
    expect(d.cap.size(1_000)).toBe(0);
    expect(d.log).toHaveBeenCalledWith('live_moves.stream.ended', { userId: 'u', liveId: 'live-1', drops: 2, bytesSent: 900 });
  });

  test('taps append to analysis_data.live_moves.taps', async () => {
    const { db, writes } = sessionsDb({ id: 'cs-1', user_id: 'u', analysis_data: { live_moves: { taps: [tap] }, other: 1 } });
    const out = await Svc.taps({ userId: 'u', coachingSessionId: 'cs-1', taps: [{ ...tap, idx: 0 }, { idx: 'x' }] }, deps({ supabase: db }));
    expect(out).toEqual({ status: 'ok', ok: true });
    expect(writes[0].analysis_data.other).toBe(1);
    expect(writes[0].analysis_data.live_moves.taps).toEqual([tap, { ...tap, idx: 0 }]);
  });

  test('taps refused after lp_fidelity written', async () => {
    const { db, writes } = sessionsDb({ id: 'cs-1', user_id: 'u', analysis_data: { lp_fidelity: {} } });
    const out = await Svc.taps({ userId: 'u', coachingSessionId: 'cs-1', taps: [tap] }, deps({ supabase: db }));
    expect(out).toMatchObject({ ok: false, reason: 'graded' });
    expect(writes).toHaveLength(0);
  });

  test("taps refused for another teacher's session", async () => {
    const { db, writes } = sessionsDb({ id: 'cs-1', user_id: 'someone-else', analysis_data: {} });
    const out = await Svc.taps({ userId: 'u', coachingSessionId: 'cs-1', taps: [tap] }, deps({ supabase: db }));
    expect(out).toMatchObject({ ok: false, reason: 'not_owner' });
    expect(writes).toHaveLength(0);
  });
});

describe('/api/internal/coaching/live/* routes', () => {
  const OLD = process.env.INTERNAL_API_KEY;
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  function invoke(router, path, { body = {}, key = 'secret' } = {}) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    if (!layer) throw new Error(`no POST ${path}`);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body, headers: key ? { 'x-api-key': key } : {}, path, ip: '127.0.0.1' };
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      };
      const run = (i) => (i >= handlers.length ? resolve({ status: 404 }) : handlers[i](req, res, () => run(i + 1)));
      run(0);
    });
  }

  test.each(['eligible', 'card', 'key', 'detect', 'end', 'taps'])('live/%s needs the secret and reaches the service', async (name) => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    const svc = { [name]: jest.fn().mockResolvedValue({ status: 'ok', on: false }) };
    jest.doMock(SERVICE, () => svc);
    const router = require('../../../bot/shared/routes/internal-api.routes');
    expect((await invoke(router, `/coaching/live/${name}`, { body: { userId: 'u' }, key: 'wrong' })).status).toBe(401);
    const out = await invoke(router, `/coaching/live/${name}`, { body: { userId: 'u', extra: 1 } });
    expect(out).toMatchObject({ status: 200, body: { success: true, status: 'ok' } });
    expect(svc[name]).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u' }));
  });
});
