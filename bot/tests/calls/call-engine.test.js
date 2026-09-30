/**
 * P0.1/P0.3/P0.4 (bd-1hae7.1/.3/.4) — the call engine state machine.
 *
 * Every wrtc/WebSocket touch lives behind the session + callsApi interfaces, so
 * the whole lifecycle is exercised here with fakes: connect → answer → accept →
 * terminate, every failure branch, the concurrency line, the admission gate, and
 * the SIGTERM drain. If this suite is green the engine is correct even though no
 * native module has been loaded.
 */

const CallEngine = require('../../shared/calls/call-engine');

const OFFER = { sdp_type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' };

function makeFakeSession(overrides = {}) {
  const session = {
    closed: false,
    createAnswer: jest.fn(async () => 'ANSWER_SDP'),
    close: jest.fn(function close() { this.closed = true; if (this.onClose) this.onClose(); }),
    getTranscript: jest.fn(() => [{ role: 'caller', text: 'hi' }]),
    onClose: null,
    ...overrides,
  };
  return session;
}

function makeHarness(opts = {}) {
  const sessions = [];
  const callsApi = {
    preAccept: jest.fn(async () => ({})),
    accept: jest.fn(async () => ({})),
    reject: jest.fn(async () => ({})),
    terminate: jest.fn(async () => ({})),
  };
  const onBusy = jest.fn(async () => {});
  const createSession = jest.fn((ctx) => {
    const s = (opts.sessionFactory ? opts.sessionFactory(ctx) : makeFakeSession());
    s.ctx = ctx;
    sessions.push(s);
    return s;
  });
  const engine = new CallEngine({
    createSession,
    callsApi,
    onBusy,
    gate: opts.gate,
    onCallEnd: opts.onCallEnd,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    config: { maxConcurrent: opts.maxConcurrent ?? 2, drainGraceMs: opts.drainGraceMs ?? 50 },
  });
  return { engine, callsApi, createSession, onBusy, sessions };
}

const connectEvent = (id, from = '923001234567') => ({
  id, from, event: 'connect', session: OFFER,
});

describe('CallEngine — the happy path', () => {
  test('connect builds an answer, pre-accepts, then accepts with that answer', async () => {
    const h = makeHarness();
    const res = await h.engine.handleEvent(connectEvent('CALL1'));

    expect(res.action).toBe('accepted');
    expect(h.sessions[0].createAnswer).toHaveBeenCalledWith(OFFER.sdp);
    expect(h.callsApi.preAccept).toHaveBeenCalledWith('CALL1', 'ANSWER_SDP');
    expect(h.callsApi.accept).toHaveBeenCalledWith('CALL1', 'ANSWER_SDP');
    expect(h.engine.activeCount).toBe(1);
  });

  test('pre_accept precedes accept (it warms the media path — order matters)', async () => {
    const h = makeHarness();
    const order = [];
    h.callsApi.preAccept.mockImplementation(async () => { order.push('pre'); });
    h.callsApi.accept.mockImplementation(async () => { order.push('accept'); });
    await h.engine.handleEvent(connectEvent('CALL1'));
    expect(order).toEqual(['pre', 'accept']);
  });

  test('the caller number and name reach the session that is created', async () => {
    const h = makeHarness();
    await h.engine.handleEvent({ ...connectEvent('CALL1', '923339876543'), }, { callerName: 'Ayesha' });
    expect(h.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'CALL1', from: '923339876543', callerName: 'Ayesha' }),
    );
  });

  test('a failing pre_accept does not stop the call (it is only an optimisation)', async () => {
    const h = makeHarness();
    h.callsApi.preAccept.mockRejectedValue(new Error('graph 500'));
    const res = await h.engine.handleEvent(connectEvent('CALL1'));
    expect(res.action).toBe('accepted');
    expect(h.callsApi.accept).toHaveBeenCalled();
    expect(h.engine.activeCount).toBe(1);
  });
});

describe('CallEngine — failure branches free the line', () => {
  test('createAnswer throwing closes the session, frees the slot, terminates the call', async () => {
    const h = makeHarness({
      sessionFactory: () => makeFakeSession({
        createAnswer: jest.fn(async () => { throw new Error('wrtc exploded'); }),
      }),
    });
    const res = await h.engine.handleEvent(connectEvent('CALL1'));

    expect(res.action).toBe('failed');
    expect(h.sessions[0].close).toHaveBeenCalled();
    expect(h.callsApi.terminate).toHaveBeenCalledWith('CALL1');
    expect(h.engine.activeCount).toBe(0);
  });

  test('accept failing closes the session, frees the slot, terminates the call', async () => {
    const h = makeHarness();
    h.callsApi.accept.mockRejectedValue(new Error('accept refused'));
    const res = await h.engine.handleEvent(connectEvent('CALL1'));

    expect(res.action).toBe('failed');
    expect(h.sessions[0].close).toHaveBeenCalled();
    expect(h.callsApi.terminate).toHaveBeenCalledWith('CALL1');
    expect(h.engine.activeCount).toBe(0);
  });

  test('a connect with no SDP offer is ignored — no session is ever spun up', async () => {
    const h = makeHarness();
    const res = await h.engine.handleEvent({ id: 'CALL1', from: '92300', event: 'connect' });
    expect(res.action).toBe('ignored');
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.engine.activeCount).toBe(0);
  });

  test('a duplicate connect for a live call id does not open a second session', async () => {
    const h = makeHarness();
    await h.engine.handleEvent(connectEvent('CALL1'));
    const res = await h.engine.handleEvent(connectEvent('CALL1'));
    expect(res.action).toBe('ignored');
    expect(h.engine.activeCount).toBe(1);
    expect(h.createSession).toHaveBeenCalledTimes(1);
  });

  test('a session closing itself (media drop) frees the slot without a webhook', async () => {
    const h = makeHarness();
    await h.engine.handleEvent(connectEvent('CALL1'));
    expect(h.engine.activeCount).toBe(1);
    h.sessions[0].close(); // simulates the watchdog / ICE failure path
    expect(h.engine.activeCount).toBe(0);
  });
});

describe('CallEngine — terminate', () => {
  test('terminate closes the owning session and frees the slot', async () => {
    const h = makeHarness();
    await h.engine.handleEvent(connectEvent('CALL1'));
    const res = await h.engine.handleEvent({ id: 'CALL1', event: 'terminate', status: 'COMPLETED', duration: 42 });

    expect(res.action).toBe('terminated');
    expect(h.sessions[0].close).toHaveBeenCalled();
    expect(h.engine.activeCount).toBe(0);
  });

  test('terminate for an unknown call id is harmless', async () => {
    const h = makeHarness();
    await expect(h.engine.handleEvent({ id: 'GHOST', event: 'terminate' })).resolves.toEqual(
      expect.objectContaining({ action: 'terminated' }),
    );
  });

  test('terminate routes to the OWNING session, leaving other calls untouched', async () => {
    const h = makeHarness({ maxConcurrent: 3 });
    await h.engine.handleEvent(connectEvent('CALL1'));
    await h.engine.handleEvent(connectEvent('CALL2'));
    await h.engine.handleEvent({ id: 'CALL1', event: 'terminate' });

    expect(h.sessions[0].close).toHaveBeenCalled();
    expect(h.sessions[1].close).not.toHaveBeenCalled();
    expect(h.engine.activeCount).toBe(1);
  });

  test('the end hook receives the transcript and duration before teardown', async () => {
    const onCallEnd = jest.fn(async () => {});
    const h = makeHarness({ onCallEnd });
    await h.engine.handleEvent(connectEvent('CALL1'));
    await h.engine.handleEvent({ id: 'CALL1', event: 'terminate', status: 'COMPLETED', duration: 42 });

    expect(onCallEnd).toHaveBeenCalledWith(expect.objectContaining({
      waCallId: 'CALL1',
      status: 'COMPLETED',
      durationSeconds: 42,
      transcript: [{ role: 'caller', text: 'hi' }],
    }));
  });

  test('an unrecognised lifecycle event is logged and ignored, never crashes', async () => {
    const h = makeHarness();
    const res = await h.engine.handleEvent({ id: 'CALL1', event: 'ringing', status: 'RINGING' });
    expect(res.action).toBe('ignored');
  });
});

describe('CallEngine — concurrency line (P0.3)', () => {
  test('the N+1th call is rejected and the busy hook fires with the caller', async () => {
    const h = makeHarness({ maxConcurrent: 2 });
    await h.engine.handleEvent(connectEvent('C1', '92300000001'));
    await h.engine.handleEvent(connectEvent('C2', '92300000002'));
    const res = await h.engine.handleEvent(connectEvent('C3', '92300000003'));

    expect(res.action).toBe('rejected');
    expect(res.reason).toBe('busy');
    expect(h.callsApi.reject).toHaveBeenCalledWith('C3');
    expect(h.onBusy).toHaveBeenCalledWith(expect.objectContaining({ from: '92300000003' }));
    expect(h.engine.activeCount).toBe(2); // the live calls are untouched
  });

  test('a rejected overflow call never creates a session', async () => {
    const h = makeHarness({ maxConcurrent: 1 });
    await h.engine.handleEvent(connectEvent('C1'));
    await h.engine.handleEvent(connectEvent('C2'));
    expect(h.createSession).toHaveBeenCalledTimes(1);
  });

  test('a slot freed by a hangup admits the next caller', async () => {
    const h = makeHarness({ maxConcurrent: 1 });
    await h.engine.handleEvent(connectEvent('C1'));
    await h.engine.handleEvent({ id: 'C1', event: 'terminate' });
    const res = await h.engine.handleEvent(connectEvent('C2'));
    expect(res.action).toBe('accepted');
  });

  test('an overflow-text failure never blocks the reject', async () => {
    const h = makeHarness({ maxConcurrent: 1 });
    h.onBusy.mockRejectedValue(new Error('whatsapp down'));
    await h.engine.handleEvent(connectEvent('C1'));
    const res = await h.engine.handleEvent(connectEvent('C2'));
    expect(res.action).toBe('rejected');
    expect(h.callsApi.reject).toHaveBeenCalledWith('C2');
  });
});

describe('CallEngine — admission gate (budget/caps, bd-1hae7.16)', () => {
  test('a gate denial rejects the call and spins up nothing', async () => {
    const gate = jest.fn(async () => ({ allowed: false, reason: 'weekly_budget' }));
    const h = makeHarness({ gate });
    const res = await h.engine.handleEvent(connectEvent('C1', '92300000009'));

    expect(res.action).toBe('rejected');
    expect(res.reason).toBe('weekly_budget');
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.callsApi.reject).toHaveBeenCalledWith('C1');
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({ from: '92300000009' }));
  });

  test('the busy hook is told WHY so it can send the right text', async () => {
    const gate = jest.fn(async () => ({ allowed: false, reason: 'per_caller_daily' }));
    const h = makeHarness({ gate });
    await h.engine.handleEvent(connectEvent('C1'));
    expect(h.onBusy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'per_caller_daily' }));
  });

  test('a gate that throws fails CLOSED — we never take an ungoverned call', async () => {
    const gate = jest.fn(async () => { throw new Error('ledger unreachable'); });
    const h = makeHarness({ gate });
    const res = await h.engine.handleEvent(connectEvent('C1'));
    expect(res.action).toBe('rejected');
    expect(h.createSession).not.toHaveBeenCalled();
  });

  test('an allowing gate lets the call through', async () => {
    const h = makeHarness({ gate: jest.fn(async () => ({ allowed: true })) });
    expect((await h.engine.handleEvent(connectEvent('C1'))).action).toBe('accepted');
  });
});

describe('CallEngine — SIGTERM drain (deploys must not cut live calls dead)', () => {
  test('draining rejects new calls immediately', async () => {
    const h = makeHarness();
    const draining = h.engine.drain();
    const res = await h.engine.handleEvent(connectEvent('C9'));
    expect(res.action).toBe('rejected');
    expect(res.reason).toBe('draining');
    expect(h.createSession).not.toHaveBeenCalled();
    await draining;
  });

  test('drain resolves immediately when nothing is live', async () => {
    const h = makeHarness();
    await expect(h.engine.drain()).resolves.toBeUndefined();
  });

  test('drain waits for a live call, then resolves as soon as it ends', async () => {
    const h = makeHarness({ drainGraceMs: 5000 });
    await h.engine.handleEvent(connectEvent('C1'));
    let settled = false;
    const draining = h.engine.drain().then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false); // still waiting on the live call
    await h.engine.handleEvent({ id: 'C1', event: 'terminate' });
    await draining;
    expect(settled).toBe(true);
  });

  test('drain gives up after the grace window and closes what is left', async () => {
    const h = makeHarness({ drainGraceMs: 30 });
    await h.engine.handleEvent(connectEvent('C1'));
    await h.engine.drain();
    expect(h.sessions[0].close).toHaveBeenCalled();
    expect(h.engine.activeCount).toBe(0);
  });
});

/**
 * Found by the first synthetic call: a call that fails at `accept` freed its
 * concurrency slot correctly, but its `calls` row was left `in_progress`
 * FOREVER — no terminate webhook ever arrives for a call Meta never connected.
 * The audit trail showed a call that simply never resolved, and the cost ledger
 * never counted it.
 */
describe('CallEngine — a failed setup closes its audit row', () => {
  test('accept failure reports the end so the row can be closed', async () => {
    const onCallEnd = jest.fn(async () => {});
    const h = makeHarness({ onCallEnd });
    h.callsApi.accept.mockRejectedValue(new Error('accept refused'));

    await h.engine.handleEvent(connectEvent('CALL1', '923001234567'));

    expect(onCallEnd).toHaveBeenCalledWith(expect.objectContaining({
      waCallId: 'CALL1', status: 'failed',
    }));
  });

  test('createAnswer failure closes the row too', async () => {
    const onCallEnd = jest.fn(async () => {});
    const h = makeHarness({
      onCallEnd,
      sessionFactory: () => makeFakeSession({
        createAnswer: jest.fn(async () => { throw new Error('wrtc exploded'); }),
      }),
    });
    await h.engine.handleEvent(connectEvent('CALL1'));
    expect(onCallEnd).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  test('a later terminate for the same call does not double-close it', async () => {
    const onCallEnd = jest.fn(async () => {});
    const h = makeHarness({ onCallEnd });
    h.callsApi.accept.mockRejectedValue(new Error('nope'));
    await h.engine.handleEvent(connectEvent('CALL1'));
    await h.engine.handleEvent({ id: 'CALL1', event: 'terminate', status: 'FAILED' });
    expect(onCallEnd).toHaveBeenCalledTimes(1);
  });

  test('an end-hook failure never changes the outcome of the failure path', async () => {
    const onCallEnd = jest.fn(async () => { throw new Error('db down'); });
    const h = makeHarness({ onCallEnd });
    h.callsApi.accept.mockRejectedValue(new Error('nope'));
    const res = await h.engine.handleEvent(connectEvent('CALL1'));
    expect(res.action).toBe('failed');
    expect(h.engine.activeCount).toBe(0);
  });
});
