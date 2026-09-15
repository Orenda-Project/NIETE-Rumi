'use strict';
/**
 * Row 122 (DC review sheet, Saaim, 14 Sep 2026) — Asifa Ayub, role='principal'.
 *
 * She tapped /menu -> Classroom Coaching, was told "send your classroom
 * recording, 15+ minutes", sent it, and was answered with the HITL binding list
 * ("Whose observation is this? Pick the teacher"). Her recording was parked in
 * Redis and never analysed — no coaching_sessions row exists for her.
 *
 * routeLeaderAudio decides from role + duration + observe state ALONE. There is
 * no input for "what did this person just ask for", so a principal's DC tap is
 * invisible to the one function that owns the decision.
 *
 * Dated regression: 88ae87fc (2026-08-24, bd-tju8f) made the duration probe
 * work, correctly closing the leak where a coach's observation fell into
 * teacher coaching. That leak WAS the only door a leader had to their own DC.
 * Production: 65 leader-owned self-DC sessions since 1 Aug, all >=900s, all
 * stopping 2026-08-24. Zero since.
 *
 * The fix adds ONE branch, placed after the armed-state checks and immediately
 * before park(). The bd-tju8f invariant is preserved exactly:
 *   an UNDECLARED school-leader classroom recording never starts teacher coaching.
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  getMediaInfo: jest.fn().mockResolvedValue({}),
  downloadMedia: jest.fn().mockResolvedValue(Buffer.alloc(0)),
}));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/observe/observe-capture.service', () => ({
  startFromAudio: jest.fn().mockResolvedValue({ id: 'sess-1' }),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({
  startDebriefFromAudio: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/observe/observe-binding.service', () => ({
  parkAndAsk: jest.fn().mockResolvedValue({ action: 'asked' }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'test-observe-flow-id';

const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
const ObserveCapture = require('../../bot/shared/services/observe/observe-capture.service');
const ObserveBinding = require('../../bot/shared/services/observe/observe-binding.service');
const { routeLeaderAudio } = require('../../bot/shared/services/observe/observe-audio-router');

const FROM = '923455201162';
const CLASSROOM_SECONDS = 1200;          // a real 20-minute lesson

const future = () => new Date(Date.now() + 3600e3).toISOString();
const past = () => new Date(Date.now() - 3600e3).toISOString();

/** A user who tapped "Classroom Coaching" — exactly what menu.service writes. */
const withDcIntent = (role, expiresAt = future()) => ({
  id: `u-${role}`,
  role,
  preferred_language: 'ur',
  conversation_state: { flow: 'coaching', step: 'AWAITING_CLASSROOM_AUDIO', payload: {} },
  conversation_state_expires_at: expiresAt,
});

const plain = (role) => ({ id: `u-${role}`, role, preferred_language: 'ur' });

const send = (user, over = {}) => routeLeaderAudio({
  user, from: FROM, audioId: 'audio-122', sessionId: 'sess-abc',
  durationSeconds: CLASSROOM_SECONDS, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
});

describe('row 122 — a principal who asked for her own lesson to be coached', () => {
  test('THE BUG: declared DC intent falls through to teacher coaching, not the binding list', async () => {
    expect(await send(withDcIntent('principal'))).toBe(false);
    expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
    expect(ObserveCapture.startFromAudio).not.toHaveBeenCalled();
  });

  test('and the recording is never parked, so nothing is lost', async () => {
    await send(withDcIntent('principal'));
    expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
  });
});

describe('the bd-tju8f invariant is preserved exactly', () => {
  test('principal with NO declared intent still parks (undeclared = observe)', async () => {
    expect(await send(plain('principal'))).toBe(true);
    expect(ObserveBinding.parkAndAsk).toHaveBeenCalledTimes(1);
  });

  test('principal whose intent EXPIRED still parks', async () => {
    expect(await send(withDcIntent('principal', past()))).toBe(true);
    expect(ObserveBinding.parkAndAsk).toHaveBeenCalledTimes(1);
  });

  test('a COACH with DC intent still parks — coaches never self-coach', async () => {
    expect(await send(withDcIntent('coach'))).toBe(true);
    expect(ObserveBinding.parkAndAsk).toHaveBeenCalledTimes(1);
  });

  test('an armed observation WINS over a stale DC intent (the more specific declaration)', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_audio' });
    expect(await send(withDcIntent('principal'))).toBe(true);
    expect(ObserveCapture.startFromAudio).toHaveBeenCalledTimes(1);
    expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
  });

  test('an armed debrief also wins over a DC intent', async () => {
    ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio' });
    expect(await send(withDcIntent('principal'))).toBe(true);
    expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
  });

  test('intent for a DIFFERENT flow is not DC intent', async () => {
    const u = withDcIntent('principal');
    u.conversation_state = { flow: 'menu', step: 'AWAITING_MENU_CHOICE' };
    expect(await send(u)).toBe(true);
    expect(ObserveBinding.parkAndAsk).toHaveBeenCalledTimes(1);
  });

  test('a malformed conversation_state is not intent (and must not throw)', async () => {
    for (const bad of ['garbage', 42, [], { flow: 'coaching' }, {}]) {
      jest.clearAllMocks();
      const u = withDcIntent('principal');
      u.conversation_state = bad;
      expect(await send(u)).toBe(true);
      expect(ObserveBinding.parkAndAsk).toHaveBeenCalledTimes(1);
    }
  });

  test('a null expiry is treated as live (the column is nullable)', async () => {
    expect(await send(withDcIntent('principal', null))).toBe(false);
  });
});

describe('everyone else is untouched', () => {
  test('a teacher never reaches the intent branch — she leaves at the role gate', async () => {
    expect(await send(withDcIntent('teacher'))).toBe(false);
    expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
  });

  test('a short chat clip from a principal with intent stays chat', async () => {
    expect(await send(withDcIntent('principal'), { durationSeconds: 30 })).toBe(false);
    expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
  });

  test('observe disabled for the market → router is inert regardless of intent', async () => {
    const saved = process.env.OBSERVE_MEWAKA_FLOW_ID;
    delete process.env.OBSERVE_MEWAKA_FLOW_ID;
    try {
      expect(await send(withDcIntent('principal'))).toBe(false);
      expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
    } finally { process.env.OBSERVE_MEWAKA_FLOW_ID = saved; }
  });
});
