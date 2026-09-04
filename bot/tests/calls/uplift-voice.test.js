/**
 * bd-oxu2q — Uplift as the second voice engine.
 *
 * The claim this file has to defend is the operator's: "it must do the same tool
 * calls / db reads etc that today openai real time does". That holds by
 * construction — Uplift replaces only the MOUTH, and OpenAI realtime keeps STT,
 * reasoning and every tool — but "by construction" is exactly the kind of claim
 * that quietly stops being true, so it is asserted here rather than argued.
 *
 * The other three things worth pinning:
 *   - selection is per CALL, not per deploy: Uplift selected but unreachable
 *     must degrade to the OpenAI voice, not fail the call
 *   - on the text path the assistant's transcript has to be recorded by hand,
 *     because there is no audio-transcript event. Miss it and `call_memory`
 *     silently learns only the caller's half of every conversation
 *   - Uplift is an URDU voice model. An English call must not be handed to it,
 *     and the text directive must not order an Urdu reply to an English speaker
 *     (language-protocol: language is a fact about the teacher, not the feature)
 */

const CallSession = require('../../shared/calls/call-session');

function makeFakePeer() {
  return {
    createAnswer: jest.fn(async () => 'ANSWER_SDP'),
    onCallerAudio: jest.fn(function onCallerAudio(cb) { this._audioCb = cb; }),
    onStateChange: jest.fn(function onStateChange(cb) { this._stateCb = cb; }),
    playAssistantAudio: jest.fn(),
    playAssistantPcm48k: jest.fn(),
    flushPlayout: jest.fn(),
    setTyping: jest.fn(),
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

/** A stand-in for UpliftTtsSession with the same surface the session relies on. */
function makeFakeTts({ ready = true } = {}) {
  return {
    ready: false,
    spoken: [],
    cancelled: 0,
    closed: 0,
    connect: jest.fn(function connect() { this.ready = ready; return Promise.resolve(); }),
    speak: jest.fn(function speak(t) { this.spoken.push(t); }),
    cancel: jest.fn(function cancel() { this.cancelled += 1; }),
    close: jest.fn(function close() { this.closed += 1; }),
  };
}

function makeSession(overrides = {}) {
  const peer = makeFakePeer();
  const realtime = makeFakeRealtime();
  const tts = overrides.tts === undefined ? makeFakeTts() : overrides.tts;
  const hooks = { onTranscriptLine: jest.fn(), onLatency: jest.fn(), onTrace: jest.fn() };

  const session = new CallSession({
    callId: 'CALL1',
    from: '923001234567',
    callerName: 'Ayesha',
    createPeer: () => peer,
    createRealtime: (opts) => { realtime._opts = opts; return realtime; },
    createTts: tts === null ? null : (opts) => { tts._opts = opts; return tts; },
    buildInstructions: overrides.buildInstructions
      || (async () => ({ instructions: 'SYSTEM PROMPT', language: 'ur' })),
    callsApi: { terminate: jest.fn(async () => ({})) },
    hooks,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    config: { maxSeconds: 300, wrapUpSeconds: 270, silenceTimeoutMs: 60000, watchdogTickMs: 5000 },
  });
  return { session, peer, realtime, tts, hooks };
}

describe('voice selection', () => {
  test('with NO tts factory the model speaks — the OpenAI path is untouched', async () => {
    const { session, realtime } = makeSession({ tts: null });
    await session.createAnswer('OFFER');
    expect(realtime._opts.outputMode).toBeUndefined();
  });

  test('with Uplift connected on an Urdu call, the model runs in TEXT mode', async () => {
    const { session, realtime, tts } = makeSession();
    await session.createAnswer('OFFER');
    expect(tts.connect).toHaveBeenCalled();
    expect(realtime._opts.outputMode).toBe('text');
  });

  test('Uplift that fails to connect degrades THIS CALL to the OpenAI voice', async () => {
    const tts = makeFakeTts({ ready: false });
    const { session, realtime } = makeSession({ tts });
    await session.createAnswer('OFFER');
    expect(realtime._opts.outputMode).toBe('audio');
    expect(tts.close).toHaveBeenCalled(); // and the dead socket is not left open
  });

  test('an ENGLISH call is never handed to the Urdu voice model', async () => {
    // Uplift speaks Urdu/Sindhi/Balochi. Handing it an English reply produces an
    // Urdu-accented mangling of English, and the text directive would additionally
    // order an Urdu reply to a teacher who chose English.
    const { session, realtime, tts } = makeSession({
      buildInstructions: async () => ({ instructions: 'SYSTEM PROMPT', language: 'en' }),
    });
    await session.createAnswer('OFFER');
    expect(realtime._opts.outputMode).toBe('audio');
    expect(tts.close).toHaveBeenCalled();
  });

  test('the text directive is added ONLY on the Uplift path', async () => {
    const { session: urdu, realtime: r1 } = makeSession();
    await urdu.createAnswer('OFFER');
    expect(r1._opts.instructions).toMatch(/اردو|Urdu script/);

    const { session: plain, realtime: r2 } = makeSession({ tts: null });
    await plain.createAnswer('OFFER');
    expect(r2._opts.instructions).toBe('SYSTEM PROMPT');
  });
});

describe('the assistant can DO exactly the same things on both voice paths', () => {
  test('tools are handed to the model identically whether Uplift speaks or not', async () => {
    const { session: withUplift, realtime: rUplift } = makeSession();
    await withUplift.createAnswer('OFFER');

    const { session: withoutUplift, realtime: rPlain } = makeSession({ tts: null });
    await withoutUplift.createAnswer('OFFER');

    // The session does not filter or re-shape tools per voice path — the tool
    // layer belongs to the realtime client on BOTH paths.
    expect(rUplift._opts.tools).toEqual(rPlain._opts.tools);
  });

  test('caller audio still reaches the model on the Uplift path (STT is unchanged)', async () => {
    const { session, peer, realtime } = makeSession();
    await session.createAnswer('OFFER');
    const chunk = new Int16Array([1, 2, 3]);
    peer._audioCb(chunk);
    expect(realtime.appendAudio).toHaveBeenCalledWith(chunk);
  });
});

describe('speaking, in order, and stopping when interrupted', () => {
  test('text deltas are spoken sentence by sentence, not character by character', async () => {
    const { session, realtime, tts } = makeSession();
    await session.createAnswer('OFFER');
    realtime._opts.callbacks.onTextDelta('السلام علیکم۔ ');
    realtime._opts.callbacks.onTextDelta('آپ کیسی ہیں؟ باقی');
    // Two complete sentences flushed; the incomplete tail is held back.
    expect(tts.spoken).toEqual(['السلام علیکم۔', 'آپ کیسی ہیں؟']);
  });

  test('the trailing fragment is spoken when the reply finishes', async () => {
    const { session, realtime, tts } = makeSession();
    await session.createAnswer('OFFER');
    realtime._opts.callbacks.onTextDelta('ٹھیک ہے');
    expect(tts.spoken).toEqual([]);
    realtime._opts.callbacks.onTextDone('ٹھیک ہے');
    expect(tts.spoken).toEqual(['ٹھیک ہے']);
  });

  test('the assistant line IS recorded in the transcript on the text path', async () => {
    // There is no audio-transcript event here. Without an explicit record, every
    // call on this path would persist only the caller's half — and call_memory,
    // three hops downstream, would summarise a one-sided conversation.
    const { session, realtime } = makeSession();
    await session.createAnswer('OFFER');
    realtime._opts.callbacks.onTextDelta('جی بالکل۔');
    realtime._opts.callbacks.onTextDone('جی بالکل۔');
    const roles = session.getTranscript().map((l) => l.role);
    expect(roles).toContain('assistant');
    expect(session.getTranscript().find((l) => l.role === 'assistant').text).toBe('جی بالکل۔');
  });

  test('barge-in drops queued Uplift audio and half-written text', async () => {
    const { session, realtime, peer, tts } = makeSession();
    await session.createAnswer('OFFER');
    realtime._opts.callbacks.onTextDelta('پہلا جملہ۔ ادھورا');
    realtime._opts.callbacks.onBargeIn();
    expect(peer.flushPlayout).toHaveBeenCalled();
    expect(tts.cancel).toHaveBeenCalled();
    // The half-sentence must not surface later as a stray utterance.
    realtime._opts.callbacks.onTextDone('');
    expect(tts.spoken).toEqual(['پہلا جملہ۔']);
  });

  test('Uplift PCM goes out at the wire rate, not through the 24 kHz path', async () => {
    const { session, realtime, peer } = makeSession();
    await session.createAnswer('OFFER');
    realtime._opts.callbacks.onTextDelta('ہاں۔');
    const pcm22k = new Int16Array(220);
    session._onTtsPcm(pcm22k);
    expect(peer.playAssistantPcm48k).toHaveBeenCalled();
    expect(peer.playAssistantAudio).not.toHaveBeenCalled();
    // 22.05k → 48k is roughly a 2.18x expansion; assert it actually resampled.
    const out = peer.playAssistantPcm48k.mock.calls[0][0];
    expect(out.length).toBeGreaterThan(pcm22k.length * 2);
  });

  test('the TTS socket is closed when the call ends', async () => {
    const { session, tts } = makeSession();
    await session.createAnswer('OFFER');
    await session.close();
    expect(tts.close).toHaveBeenCalled();
  });
});

describe('UpliftTtsSession — protocol handling', () => {
  const { UpliftTtsSession } = require('../../shared/calls/uplift-tts');

  function makeSocket() {
    const handlers = {};
    return {
      emitted: [],
      on: (ev, fn) => { handlers[ev] = fn; },
      emit: function emit(ev, payload) { this.emitted.push({ ev, payload }); },
      close: jest.fn(),
      _fire: (ev, payload) => handlers[ev] && handlers[ev](payload),
    };
  }

  async function connected(cb = {}) {
    const socket = makeSocket();
    const s = new UpliftTtsSession({ apiKey: 'k', callbacks: cb, ioFactory: () => socket });
    const p = s.connect();
    socket._fire('message', { type: 'ready', sessionId: 'S1' });
    await p;
    return { s, socket };
  }

  test('connect resolves on ready and reports ready', async () => {
    const { s } = await connected();
    expect(s.ready).toBe(true);
  });

  test('a barge-in tells the SERVER to stop, not just the client', async () => {
    // Dropping audio locally still pays for every sentence already queued, and a
    // teacher interrupting mid-answer is the common case on a coaching call.
    const { s, socket } = await connected();
    s.speak('ایک۔');
    s.speak('دو۔');
    s.cancel();
    const cancels = socket.emitted.filter((e) => e.ev === 'cancel');
    expect(cancels).toHaveLength(2);
    expect(cancels[0].payload.requestId).toBeDefined();
  });

  test('a protocol error surfaces instead of becoming silence', async () => {
    // A rejected voiceId or an over-length text returns {type:'error'}. Danish's
    // original swallowed it: the sentence never arrives and the caller hears a
    // dead line, which gets diagnosed as a network fault.
    const onError = jest.fn();
    const { s, socket } = await connected({ onError });
    s.speak('ٹیسٹ۔');
    socket._fire('message', {
      type: 'error', code: 'invalid_voice', message: 'unknown voiceId', requestId: 'g0_0',
    });
    expect(onError).toHaveBeenCalled();
    expect(String(onError.mock.calls[0][0].message)).toMatch(/invalid_voice/);
  });

  test('an errored sentence does not stall the ones behind it', async () => {
    const chunks = [];
    const { s, socket } = await connected({ onPcm: (p) => chunks.push(p) });
    s.speak('پہلا۔');
    s.speak('دوسرا۔');
    // Sentence 2's audio arrives first and is buffered behind sentence 1.
    const audio = Buffer.from(new Int16Array([5, 6]).buffer).toString('base64');
    socket._fire('message', { type: 'audio', requestId: 'g0_1', audio });
    expect(chunks).toHaveLength(0);
    // Sentence 1 errors — playout must advance rather than wait forever.
    socket._fire('message', { type: 'error', code: 'synth_failed', message: 'x', requestId: 'g0_0' });
    expect(chunks).toHaveLength(1);
  });
});
