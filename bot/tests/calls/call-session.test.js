/**
 * P0.1 + P0.5 (bd-1hae7.1, .16) — one call: peer ⟷ Realtime, and the caps.
 *
 * The session owns the wiring and the clocks. Both the peer and the Realtime
 * client are injected, so this exercises the real orchestration — audio both
 * ways, barge-in, transcript accumulation, the silence watchdog, the 5-minute
 * hard cap with its 4:30 warm wrap-up — with no native module and no sockets.
 */

const CallSession = require('../../shared/calls/call-session');

function makeFakePeer() {
  return {
    createAnswer: jest.fn(async () => 'ANSWER_SDP'),
    onCallerAudio: jest.fn(function onCallerAudio(cb) { this._audioCb = cb; }),
    onStateChange: jest.fn(function onStateChange(cb) { this._stateCb = cb; }),
    playAssistantAudio: jest.fn(),
    flushPlayout: jest.fn(),
    close: jest.fn(),
  };
}

function makeFakeRealtime() {
  return {
    connect: jest.fn(),
    appendAudio: jest.fn(),
    appendInstructions: jest.fn(),
    getInstructions: jest.fn(() => 'COMPOSED INSTRUCTIONS'),
    close: jest.fn(),
  };
}

function makeSession(overrides = {}) {
  const peer = makeFakePeer();
  const realtime = makeFakeRealtime();
  const callsApi = { terminate: jest.fn(async () => ({})) };
  const hooks = { onTranscriptLine: jest.fn(), onLatency: jest.fn(), onTrace: jest.fn() };

  const session = new CallSession({
    callId: 'CALL1',
    from: '923001234567',
    callerName: 'Ayesha',
    createPeer: () => peer,
    createRealtime: (opts) => { realtime._opts = opts; return realtime; },
    buildInstructions: overrides.buildInstructions || (async () => 'SYSTEM PROMPT'),
    callsApi,
    hooks,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    config: {
      maxSeconds: overrides.maxSeconds ?? 300,
      wrapUpSeconds: overrides.wrapUpSeconds ?? 270,
      silenceTimeoutMs: overrides.silenceTimeoutMs ?? 60000,
      watchdogTickMs: overrides.watchdogTickMs ?? 5000,
    },
    ...overrides.extra,
  });
  return { session, peer, realtime, callsApi, hooks };
}

describe('CallSession — setup', () => {
  test('answers the offer through the peer and returns its SDP', async () => {
    const { session, peer } = makeSession();
    const sdp = await session.createAnswer('OFFER_SDP');
    expect(peer.createAnswer).toHaveBeenCalledWith('OFFER_SDP');
    expect(sdp).toBe('ANSWER_SDP');
  });

  test('builds instructions for THIS caller and connects the model with them', async () => {
    const buildInstructions = jest.fn(async () => 'SYSTEM PROMPT FOR AYESHA');
    const { session, realtime } = makeSession({ buildInstructions });
    await session.createAnswer('OFFER_SDP');

    expect(buildInstructions).toHaveBeenCalledWith(
      expect.objectContaining({ from: '923001234567', callerName: 'Ayesha', callId: 'CALL1' }),
    );
    expect(realtime._opts.instructions).toBe('SYSTEM PROMPT FOR AYESHA');
    expect(realtime.connect).toHaveBeenCalled();
  });

  test('a context build failure still yields a working call (fail-open)', async () => {
    const { session, realtime } = makeSession({
      buildInstructions: async () => { throw new Error('supabase down'); },
    });
    await expect(session.createAnswer('OFFER_SDP')).resolves.toBe('ANSWER_SDP');
    expect(realtime.connect).toHaveBeenCalled();
    expect(typeof realtime._opts.instructions).toBe('string');
    expect(realtime._opts.instructions.length).toBeGreaterThan(0);
  });

  test('the composed instructions are exposed for the context snapshot (P3.1)', async () => {
    const { session } = makeSession();
    await session.createAnswer('OFFER_SDP');
    expect(session.getContextSnapshot()).toBe('COMPOSED INSTRUCTIONS');
  });
});

describe('CallSession — audio wiring', () => {
  test('caller audio is forwarded to the model', async () => {
    const { session, peer, realtime } = makeSession();
    await session.createAnswer('OFFER_SDP');
    peer._audioCb(Int16Array.from([1, 2, 3]));
    expect(realtime.appendAudio).toHaveBeenCalledWith(Int16Array.from([1, 2, 3]));
  });

  test('assistant audio is played out to the caller', async () => {
    const { session, peer, realtime } = makeSession();
    await session.createAnswer('OFFER_SDP');
    realtime._opts.callbacks.onAudio(Int16Array.from([4, 5]));
    expect(peer.playAssistantAudio).toHaveBeenCalledWith(Int16Array.from([4, 5]));
  });

  test('barge-in flushes queued playout so she stops talking over the caller', async () => {
    const { session, peer, realtime } = makeSession();
    await session.createAnswer('OFFER_SDP');
    realtime._opts.callbacks.onBargeIn();
    expect(peer.flushPlayout).toHaveBeenCalled();
  });

  test('audio arriving after teardown is dropped, not played', async () => {
    const { session, peer, realtime } = makeSession();
    await session.createAnswer('OFFER_SDP');
    session.close();
    realtime._opts.callbacks.onAudio(Int16Array.from([1]));
    expect(peer.playAssistantAudio).not.toHaveBeenCalled();
  });
});

describe('CallSession — transcript', () => {
  test('accumulates both roles in order with timestamps', async () => {
    const { session, realtime } = makeSession();
    await session.createAnswer('OFFER_SDP');
    realtime._opts.callbacks.onTranscript('caller', 'میرا سبق کیسا تھا');
    realtime._opts.callbacks.onTranscript('assistant', 'آپ کا سبق اچھا تھا');

    const t = session.getTranscript();
    expect(t.map((l) => l.role)).toEqual(['caller', 'assistant']);
    expect(t[0].text).toBe('میرا سبق کیسا تھا');
    expect(t[0].at).toBeTruthy();
  });

  test('blank transcript lines are dropped', async () => {
    const { session, realtime } = makeSession();
    await session.createAnswer('OFFER_SDP');
    realtime._opts.callbacks.onTranscript('caller', '   ');
    expect(session.getTranscript()).toHaveLength(0);
  });

  test('each finalized line is streamed to the hook for live persistence', async () => {
    const { session, realtime, hooks } = makeSession();
    await session.createAnswer('OFFER_SDP');
    realtime._opts.callbacks.onTranscript('caller', 'سلام');
    expect(hooks.onTranscriptLine).toHaveBeenCalledWith(
      expect.objectContaining({ waCallId: 'CALL1', role: 'caller', text: 'سلام' }),
    );
  });

  test('response latency is reported for the p95 dashboard', async () => {
    const { session, realtime, hooks } = makeSession();
    await session.createAnswer('OFFER_SDP');
    realtime._opts.callbacks.onResponseLatency(820);
    expect(hooks.onLatency).toHaveBeenCalledWith(
      expect.objectContaining({ waCallId: 'CALL1', latencyMs: 820 }),
    );
  });
});

describe('CallSession — the 5-minute cap and warm wrap-up (bd-1hae7.16)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('at the wrap-up mark she is told to close warmly — the call is NOT cut', async () => {
    const { session, realtime, callsApi } = makeSession({ maxSeconds: 10, wrapUpSeconds: 6 });
    await session.createAnswer('OFFER_SDP');

    jest.advanceTimersByTime(6000);
    expect(realtime.appendInstructions).toHaveBeenCalledWith(expect.stringMatching(/wrap|WRAP/));
    expect(callsApi.terminate).not.toHaveBeenCalled();
  });

  test('at the hard cap the call is terminated and the session closed', async () => {
    const { session, callsApi, peer } = makeSession({ maxSeconds: 10, wrapUpSeconds: 6 });
    await session.createAnswer('OFFER_SDP');

    jest.advanceTimersByTime(10000);
    await Promise.resolve();
    expect(callsApi.terminate).toHaveBeenCalledWith('CALL1');
    expect(peer.close).toHaveBeenCalled();
  });

  test('closing early cancels both timers (no terminate after hangup)', async () => {
    const { session, callsApi } = makeSession({ maxSeconds: 10, wrapUpSeconds: 6 });
    await session.createAnswer('OFFER_SDP');
    session.close();

    jest.advanceTimersByTime(20000);
    expect(callsApi.terminate).not.toHaveBeenCalled();
  });
});

describe('CallSession — the silence watchdog (caller-drop detection)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('mutual silence past the timeout ends the call', async () => {
    const { session, callsApi } = makeSession({ silenceTimeoutMs: 10000, watchdogTickMs: 1000 });
    await session.createAnswer('OFFER_SDP');

    jest.advanceTimersByTime(11000);
    await Promise.resolve();
    expect(callsApi.terminate).toHaveBeenCalledWith('CALL1');
  });

  test('a caller who is only LISTENING is never cut off (her speech resets it)', async () => {
    const { session, realtime, callsApi } = makeSession({ silenceTimeoutMs: 10000, watchdogTickMs: 1000 });
    await session.createAnswer('OFFER_SDP');

    jest.advanceTimersByTime(8000);
    realtime._opts.callbacks.onAudio(Int16Array.from([1])); // she is speaking
    jest.advanceTimersByTime(8000);
    expect(callsApi.terminate).not.toHaveBeenCalled();
  });

  test('caller speech resets the silence clock too', async () => {
    const { session, realtime, callsApi } = makeSession({ silenceTimeoutMs: 10000, watchdogTickMs: 1000 });
    await session.createAnswer('OFFER_SDP');

    jest.advanceTimersByTime(8000);
    realtime._opts.callbacks.onTranscript('caller', 'جی');
    jest.advanceTimersByTime(8000);
    expect(callsApi.terminate).not.toHaveBeenCalled();
  });
});

describe('CallSession — teardown', () => {
  test('close tears down peer and model, and fires onClose exactly once', async () => {
    const { session, peer, realtime } = makeSession();
    const onClose = jest.fn();
    session.onClose = onClose;
    await session.createAnswer('OFFER_SDP');

    session.close();
    session.close(); // idempotent

    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(realtime.close).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the model socket dropping closes the whole session', async () => {
    const { session, realtime, peer } = makeSession();
    await session.createAnswer('OFFER_SDP');
    realtime._opts.callbacks.onClose();
    expect(peer.close).toHaveBeenCalled();
  });

  test('a peer failure state closes the session', async () => {
    const { session, peer, realtime } = makeSession();
    await session.createAnswer('OFFER_SDP');
    peer._stateCb('failed');
    expect(realtime.close).toHaveBeenCalled();
  });

  test('close survives a peer that throws on teardown', async () => {
    const { session, peer } = makeSession();
    await session.createAnswer('OFFER_SDP');
    peer.close.mockImplementation(() => { throw new Error('already gone'); });
    expect(() => session.close()).not.toThrow();
  });
});

/**
 * The tools are scoped to the caller resolved during buildInstructions, and read
 * when the Realtime client is constructed. That only works if the ORDER holds —
 * a subtle dependency that a refactor could silently invert, leaving every call
 * toolless with no error anywhere.
 */
describe('CallSession — instructions are built BEFORE the model is constructed', () => {
  test('buildInstructions completes before createRealtime is called', async () => {
    const order = [];
    const peer = makeFakePeer();
    const realtime = makeFakeRealtime();

    const session = new CallSession({
      callId: 'CALL1', from: '92300',
      createPeer: () => peer,
      createRealtime: (opts) => { order.push('createRealtime'); realtime._opts = opts; return realtime; },
      buildInstructions: async () => { order.push('buildInstructions'); return 'PROMPT'; },
      callsApi: { terminate: jest.fn(async () => ({})) },
      hooks: {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      config: { maxSeconds: 300, wrapUpSeconds: 270, silenceTimeoutMs: 60000, watchdogTickMs: 5000 },
    });

    await session.createAnswer('OFFER');
    expect(order).toEqual(['buildInstructions', 'createRealtime']);
    session.close();
  });
});
