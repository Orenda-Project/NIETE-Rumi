/**
 * FEAT-053 bd-29 — the shared observe audio router.
 *
 * THE BUG (Sabeena, staging 2026-07-12): /observe interception lived ONLY in
 * the voice-note handler. A classroom recording shared as a FILE (which is how
 * phone recorder apps deliver long audio) went through the audio-DOCUMENT path
 * in the webhook entry point — which had no role gate and no observe-state
 * check — and was routed straight into the TEACHER coaching flow. Even with
 * /observe armed, a file-sent recording was swallowed.
 *
 * The fix: ONE router both handlers call, so they can never drift again.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-capture.service', () => ({
  startFromAudio: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  startDebriefFromAudio: jest.fn().mockResolvedValue(true),
}));

// FEAT-102: routeLeaderAudio is dark-safe — inert unless the market has an
// observe Flow published (OBSERVE_MEWAKA_FLOW_ID). These tests exercise the
// "observe enabled" path, so set it.
process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'test-observe-flow-id';

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const ObserveCapture = require('../../shared/services/observe/observe-capture.service');
const ObserveDebrief = require('../../shared/services/observe/observe-debrief.service');
const { routeLeaderAudio } = require('../../shared/services/observe/observe-audio-router');

const LEADER = { id: 'fo-1', role: 'school_leader', preferred_language: 'sw' };
const TEACHER = { id: 't-1', role: 'teacher', preferred_language: 'ur' };
const FROM = '255700000001';
const AUDIO = 'audio-123';
const SESSION = 'sess-abc';

const call = (over = {}) => routeLeaderAudio({
  user: LEADER, from: FROM, audioId: AUDIO, sessionId: SESSION, isLongAudio: true, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
});

describe('routeLeaderAudio — role gate', () => {
  test('teacher → not handled (teacher coaching flows completely untouched)', async () => {
    expect(await call({ user: TEACHER })).toBe(false);
    expect(ObserveCapture.startFromAudio).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('no user → not handled', async () => {
    expect(await call({ user: null })).toBe(false);
  });
});

describe('routeLeaderAudio — armed states (the bug: these never fired for file-sent audio)', () => {
  test('awaiting_audio → observation capture, handled', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_audio' });
    expect(await call()).toBe(true);
    expect(ObserveCapture.startFromAudio).toHaveBeenCalledWith(LEADER, FROM, AUDIO, SESSION);
  });

  test('awaiting_debrief_audio → debrief capture, handled', async () => {
    const st = { state: 'awaiting_debrief_audio', sessionId: 'obs-9' };
    ObserveState.getState.mockResolvedValue(st);
    expect(await call()).toBe(true);
    expect(ObserveDebrief.startDebriefFromAudio).toHaveBeenCalledWith(LEADER, FROM, AUDIO, st);
  });

  test('armed state is honoured even for SHORT audio (intent was declared by /observe, D14)', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_audio' });
    expect(await call({ isLongAudio: false })).toBe(true);
    expect(ObserveCapture.startFromAudio).toHaveBeenCalled();
  });
});

describe('routeLeaderAudio — no observe state', () => {
  test('LONG audio, no state → nudge to /observe, handled (NEVER teacher coaching)', async () => {
    expect(await call({ isLongAudio: true })).toBe(true);
    expect(ObserveCapture.startFromAudio).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/observe/i);
  });

  test('SHORT audio, no state → not handled (leader can still chat normally)', async () => {
    expect(await call({ isLongAudio: false })).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});

describe('routeLeaderAudio — resilience', () => {
  test('state lookup failure on LONG audio → still blocks teacher coaching (fail safe)', async () => {
    ObserveState.getState.mockRejectedValue(new Error('redis down'));
    expect(await call({ isLongAudio: true })).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalled();
  });

  test('capture failure on LONG audio → handled, never falls into teacher coaching', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_audio' });
    ObserveCapture.startFromAudio.mockRejectedValue(new Error('insert failed'));
    expect(await call({ isLongAudio: true })).toBe(true);
  });
});
