/**
 * bd-oxu2q — the audit row must record which voice actually SPOKE.
 *
 * `calls.voice` is written at logCallStart as `config.voice` — the OpenAI voice
 * name — and logCallStart runs during buildInstructions, BEFORE the engine is
 * settled. So every row says 'marin' whatever happened. Proven on the live
 * staging call at 12:20:27Z: the service logged "uplift ready — voice via
 * Uplift" and the persisted row still read voice: marin.
 *
 * That matters right now rather than eventually. We are running two voice
 * engines side by side on purpose, and the one table that records calls cannot
 * distinguish them — so "how many calls used Uplift", "was Uplift slower", "did
 * anyone get the silent-voice bug" are all unanswerable from the data we are
 * currently collecting. A column that always says the same thing is not
 * telemetry, it is decoration.
 */

const CallSession = require('../../shared/calls/call-session');

function harness({ language = 'ur', ttsReady = true, withTts = true } = {}) {
  const peer = {
    createAnswer: jest.fn(async () => 'ANSWER'),
    onCallerAudio: jest.fn(), onStateChange: jest.fn(),
    playAssistantAudio: jest.fn(), playAssistantPcm48k: jest.fn(),
    flushPlayout: jest.fn(), setTyping: jest.fn(), close: jest.fn(),
  };
  const realtime = {
    connect: jest.fn(), appendAudio: jest.fn(), appendInstructions: jest.fn(),
    getInstructions: jest.fn(() => 'I'), close: jest.fn(),
  };
  const tts = {
    ready: false,
    connect: jest.fn(function c() { this.ready = ttsReady; return Promise.resolve(); }),
    speak: jest.fn(), cancel: jest.fn(), close: jest.fn(),
  };
  const session = new CallSession({
    callId: 'C1', from: '923365709413', callerName: 'A',
    createPeer: () => peer,
    createRealtime: (o) => { realtime._opts = o; return realtime; },
    createTts: withTts ? () => tts : null,
    buildInstructions: async () => ({ instructions: 'P', language }),
    callsApi: { terminate: jest.fn(async () => ({})) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    config: { maxSeconds: 300, wrapUpSeconds: 270, silenceTimeoutMs: 60000, watchdogTickMs: 5000 },
  });
  return { session };
}

describe('the session reports which voice spoke', () => {
  test('uplift, when Uplift actually took the call', async () => {
    const { session } = harness({ language: 'ur' });
    await session.createAnswer('OFFER');
    expect(session.getVoiceUsed()).toBe('uplift');
  });

  test('the OpenAI voice name, when Uplift was never in play', async () => {
    const { session } = harness({ withTts: false });
    await session.createAnswer('OFFER');
    expect(session.getVoiceUsed()).toBeNull(); // caller substitutes config.voice
  });

  test('the OpenAI voice, when Uplift was selected but could not connect', async () => {
    const { session } = harness({ language: 'ur', ttsReady: false });
    await session.createAnswer('OFFER');
    expect(session.getVoiceUsed()).toBeNull();
  });

  test('the OpenAI voice, when the caller language excluded Uplift', async () => {
    const { session } = harness({ language: 'en' });
    await session.createAnswer('OFFER');
    expect(session.getVoiceUsed()).toBeNull();
  });

  test('before the call is answered it reports nothing rather than guessing', () => {
    const { session } = harness();
    expect(session.getVoiceUsed()).toBeNull();
  });
});

describe('logCallEnd persists the voice that spoke', () => {
  test('a voice passed at end overwrites the placeholder written at start', async () => {
    jest.resetModules();
    const updates = [];
    jest.doMock('../../shared/config/supabase', () => ({
      from() { return this; },
      update(patch) { updates.push(patch); return this; },
      eq() { return Promise.resolve({ error: null }); },
      insert() { return Promise.resolve({ error: null }); },
    }));
    const log = require('../../shared/calls/call-log.service');
    await log.logCallEnd({
      waCallId: 'C1', durationSeconds: 39, status: 'completed',
      model: 'gpt-realtime-2.1-mini', voice: 'uplift',
    });
    expect(updates[0].voice).toBe('uplift');
  });

  test('omitting it leaves the existing value alone rather than nulling it', async () => {
    jest.resetModules();
    const updates = [];
    jest.doMock('../../shared/config/supabase', () => ({
      from() { return this; },
      update(patch) { updates.push(patch); return this; },
      eq() { return Promise.resolve({ error: null }); },
    }));
    const log = require('../../shared/calls/call-log.service');
    await log.logCallEnd({ waCallId: 'C1', durationSeconds: 10, status: 'completed' });
    expect(Object.prototype.hasOwnProperty.call(updates[0], 'voice')).toBe(false);
  });
});

describe('the engine carries the voice out to the audit hook', () => {
  const CallEngine = require('../../shared/calls/call-engine');

  test('voiceUsed rides the onCallEnd payload, read before teardown', async () => {
    // The audit row is closed from OUTSIDE the session's closure — which is why
    // reaching for `session` in calls-server's onCallEnd would be a
    // ReferenceError, not a nullish fallback. The engine reads it off the
    // session in the same window it reads the transcript.
    const ended = [];
    const session = {
      ctx: { from: '923365709413' },
      getTranscript: () => [{ role: 'caller', text: 'hi' }],
      getVoiceUsed: () => 'uplift',
      close: jest.fn(),
    };
    const engine = new CallEngine({
      createSession: () => session,
      callsApi: { preAccept: jest.fn(), accept: jest.fn(), reject: jest.fn(), terminate: jest.fn(async () => ({})) },
      onCallEnd: async (payload) => { ended.push(payload); },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    engine._sessions.set('CALL1', session);

    await engine._onTerminate({ id: 'CALL1', from: '923365709413', duration: 39, status: 'COMPLETED' });

    expect(ended).toHaveLength(1);
    expect(ended[0].voiceUsed).toBe('uplift');
    expect(ended[0].transcript).toHaveLength(1);
  });

  test('a session that never settled a voice yields undefined, not a crash', async () => {
    const ended = [];
    const engine = new CallEngine({
      createSession: () => ({}),
      callsApi: { terminate: jest.fn(async () => ({})) },
      onCallEnd: async (p) => { ended.push(p); },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    // No session registered at all — the setup-failure shape.
    await engine._onTerminate({ id: 'CALL2', from: '92300', duration: 0, status: 'FAILED' });
    expect(ended[0].voiceUsed).toBeUndefined();
  });
});
