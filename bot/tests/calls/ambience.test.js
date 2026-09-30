/**
 * bd-1hae7.18 — background call ambience.
 *
 * Two things are pinned here:
 *
 *  1. The MIXER itself — office chatter is continuous, keyboard typing only
 *     while she is looking something up, and neither may ever clip or run off
 *     the end of its buffer on a 5-minute call.
 *  2. The WIRING — the typing layer must come on when a tool call starts and go
 *     off the moment she starts answering. That wiring runs through an OPTIONAL
 *     peer capability, so it is guarded in prod code; without this test the
 *     guard would let the whole feature silently do nothing.
 */

const CallSession = require('../../shared/calls/call-session');

const AMBIENCE = '../../shared/calls/ambience';

function freshAmbience(env = {}) {
  jest.resetModules();
  const prev = { ...process.env };
  Object.assign(process.env, env);
  // eslint-disable-next-line global-require
  const mod = require(AMBIENCE);
  mod.loadAmbience({ info: () => {}, warn: () => {} });
  return { mod, restore: () => { process.env = prev; } };
}

describe('ambience — the mixer', () => {
  test('the shipped PCM assets load', () => {
    const { mod, restore } = freshAmbience();
    expect(mod.ambienceReady()).toBe(true);
    restore();
  });

  test('office chatter is mixed into a frame of pure silence (it is continuous, not voice-gated)', () => {
    const { mod, restore } = freshAmbience({ CALLS_AMBIENCE_OFFICE_VOLUME: '0.5' });
    const mixer = new mod.AmbienceMixer();
    // The asset opens with ~0.11 s of digital silence, so mix past the lead-in.
    let heard = false;
    for (let i = 0; i < 40 && !heard; i += 1) {
      const frame = new Int16Array(480); // silence in, chatter out
      mixer.mixInto(frame);
      heard = frame.some((v) => v !== 0);
    }
    expect(heard).toBe(true);
    mixer.dispose();
    restore();
  });

  test('typing is OFF by default and only sounds while she is looking something up', () => {
    const { mod, restore } = freshAmbience({
      CALLS_AMBIENCE_OFFICE_VOLUME: '0', CALLS_AMBIENCE_KEYBOARD_VOLUME: '0.5',
    });
    const mixer = new mod.AmbienceMixer();

    const quiet = new Int16Array(480);
    mixer.mixInto(quiet);
    expect(quiet.every((v) => v === 0)).toBe(true); // office muted, not typing yet

    mixer.setTyping(true);
    let typed = false;
    for (let i = 0; i < 40 && !typed; i += 1) {
      const typing = new Int16Array(480);
      mixer.mixInto(typing);
      typed = typing.some((v) => v !== 0);
    }
    expect(typed).toBe(true);

    mixer.setTyping(false);
    const after = new Int16Array(480);
    mixer.mixInto(after);
    expect(after.every((v) => v === 0)).toBe(true);

    mixer.dispose();
    restore();
  });

  test('a loud voice frame plus ambience never wraps around (clamped, not overflowed)', () => {
    const { mod, restore } = freshAmbience({
      CALLS_AMBIENCE_OFFICE_VOLUME: '4', CALLS_AMBIENCE_KEYBOARD_VOLUME: '4',
    });
    const mixer = new mod.AmbienceMixer();
    mixer.setTyping(true);
    const hot = new Int16Array(480).fill(32000);
    mixer.mixInto(hot);
    // Wrap-around would show up as a large NEGATIVE sample next to a positive one.
    expect(hot.every((v) => v >= 0 && v <= 32767)).toBe(true);
    mixer.dispose();
    restore();
  });

  test('the loops survive a full 5-minute call without running off the end', () => {
    const { mod, restore } = freshAmbience({ CALLS_AMBIENCE_OFFICE_VOLUME: '0.2' });
    const mixer = new mod.AmbienceMixer();
    mixer.setTyping(true);
    // 300 s at 10 ms frames = 30,000 frames; the office asset is only ~20 s long.
    for (let i = 0; i < 30000; i += 1) {
      const f = new Int16Array(480);
      mixer.mixInto(f);
      expect(Number.isFinite(f[0])).toBe(true);
    }
    mixer.dispose();
    restore();
  });

  test('CALLS_AMBIENCE_ENABLED=false loads nothing at all', () => {
    const { mod, restore } = freshAmbience({ CALLS_AMBIENCE_ENABLED: 'false' });
    expect(mod.ambienceReady()).toBe(false);
    restore();
  });
});

// ---------------------------------------------------------------------------
// The wiring, through CallSession.
// ---------------------------------------------------------------------------

function makePeer({ withTyping = true } = {}) {
  const peer = {
    createAnswer: jest.fn(async () => 'ANSWER_SDP'),
    onCallerAudio: jest.fn(function f(cb) { this._audioCb = cb; }),
    onStateChange: jest.fn(function f(cb) { this._stateCb = cb; }),
    playAssistantAudio: jest.fn(),
    flushPlayout: jest.fn(),
    close: jest.fn(),
  };
  if (withTyping) peer.setTyping = jest.fn();
  return peer;
}

function makeSession(peer) {
  const realtime = {
    connect: jest.fn(), appendAudio: jest.fn(), appendInstructions: jest.fn(),
    getInstructions: jest.fn(() => 'X'), close: jest.fn(),
  };
  const session = new CallSession({
    callId: 'CALL1',
    from: '923001234567',
    callerName: 'Ayesha',
    createPeer: () => peer,
    createRealtime: (opts) => { realtime._opts = opts; return realtime; },
    buildInstructions: async () => 'SYSTEM PROMPT',
    callsApi: { terminate: jest.fn(async () => ({})) },
    hooks: {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    config: { maxSeconds: 300, wrapUpSeconds: 270, silenceTimeoutMs: 60000, watchdogTickMs: 5000 },
  });
  return { session, realtime };
}

describe('ambience — wired to the call', () => {
  test('a tool call starts the typing; her first word stops it', async () => {
    const peer = makePeer();
    const { session, realtime } = makeSession(peer);
    await session.createAnswer('OFFER_SDP');

    realtime._opts.callbacks.onToolStart();
    expect(peer.setTyping).toHaveBeenLastCalledWith(true);

    realtime._opts.callbacks.onAudio(new Int16Array(240));
    expect(peer.setTyping).toHaveBeenLastCalledWith(false);
  });

  test('barge-in stops the typing too — she was cut off mid-lookup', async () => {
    const peer = makePeer();
    const { session, realtime } = makeSession(peer);
    await session.createAnswer('OFFER_SDP');

    realtime._opts.callbacks.onToolStart();
    realtime._opts.callbacks.onBargeIn();
    expect(peer.setTyping).toHaveBeenLastCalledWith(false);
    expect(peer.flushPlayout).toHaveBeenCalled();
  });

  test('a peer with NO ambience support still carries audio — it must not throw on the hot path', async () => {
    const peer = makePeer({ withTyping: false });
    const { session, realtime } = makeSession(peer);
    await session.createAnswer('OFFER_SDP');

    expect(() => realtime._opts.callbacks.onToolStart()).not.toThrow();
    expect(() => realtime._opts.callbacks.onAudio(new Int16Array(240))).not.toThrow();
    expect(peer.playAssistantAudio).toHaveBeenCalled();
  });
});
