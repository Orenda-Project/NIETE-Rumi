/**
 * bd-tju8f T1.1 — the wall + duration truth.
 *
 * THE BUG (Abdul Waheed, prod 2026-08-24): the WhatsApp webhook NEVER carries an
 * audio duration (1,000 webhooks sampled on niete-logs: zero had one; `voice` is
 * a boolean on message.audio). voice-message.handler computed
 * `isLongAudio = (message.voice?.duration || message.audio?.duration || 0) >= 900`
 * — always false — so the router's no-state wall was inert for voice notes and a
 * coach's SECOND recording of the day (slot busy at 'analyzing') fell into the
 * TEACHER coaching flow. Four coaches leaked on 24 Aug alone.
 *
 * The contract under test:
 *   1. an unbound classroom-length voice note is PARKED and the coach is ASKED
 *      (never teacher coaching, never a dead-end nudge)
 *   2. duration comes from getMediaInfo + the ffprobe fallback, not the webhook
 *   3. resolved-short + small file stays chat (voice Q&A untouched)
 *   4. a state-lookup failure on classroom-length audio still parks (fail safe)
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  getMediaInfo: jest.fn(),
  downloadMedia: jest.fn().mockResolvedValue(Buffer.alloc(10)),
}));
jest.mock('../../shared/services/audio.service', () => ({
  getAudioDuration: jest.fn().mockResolvedValue(1198),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-capture.service', () => ({
  startFromAudio: jest.fn().mockResolvedValue({ id: 'sess-new' }),
}));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  startDebriefFromAudio: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-binding.service', () => ({
  parkAndAsk: jest.fn().mockResolvedValue({ action: 'asked' }),
}));

process.env.OBSERVE_MEWAKA_FLOW_ID = process.env.OBSERVE_MEWAKA_FLOW_ID || 'test-observe-flow-id';

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const ObserveBinding = require('../../shared/services/observe/observe-binding.service');
const { routeLeaderAudio } = require('../../shared/services/observe/observe-audio-router');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'ur' };
const FROM = '923260000001';

beforeEach(() => {
  jest.clearAllMocks();
  ObserveState.getState.mockResolvedValue(null);
  // Prod truth: the webhook object carries NO duration. getMediaInfo returns
  // file_size but (for voice notes) often no duration either — the ffprobe
  // fallback is what actually resolves it.
  WhatsAppService.getMediaInfo.mockResolvedValue({ audio: {}, file_size: 2_400_000 });
});

test('unbound classroom-length voice note is parked and asked — handled, never falls through', async () => {
  const handled = await routeLeaderAudio({ user: COACH, from: FROM, audioId: 'a1', sessionId: 's1' });
  expect(handled).toBe(true);
  expect(ObserveBinding.parkAndAsk).toHaveBeenCalledTimes(1);
});

test('duration is resolved via getMediaInfo + ffprobe, not the webhook zeros', async () => {
  await routeLeaderAudio({ user: COACH, from: FROM, audioId: 'a1', sessionId: 's1', durationSeconds: null });
  expect(WhatsAppService.getMediaInfo).toHaveBeenCalledWith('a1');
  const parked = ObserveBinding.parkAndAsk.mock.calls[0][2];
  expect(parked.durationSeconds).toBe(1198);
});

test('resolved-short SMALL audio stays chat (handled=false, no park)', async () => {
  WhatsAppService.getMediaInfo.mockResolvedValue({ audio: { duration: 24 }, file_size: 80_000 });
  const handled = await routeLeaderAudio({ user: COACH, from: FROM, audioId: 'a2', sessionId: 's1' });
  expect(handled).toBe(false);
  expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
});

test('unresolvable duration but LARGE file is treated as a classroom recording', async () => {
  WhatsAppService.getMediaInfo.mockResolvedValue({ audio: {}, file_size: 900_000 });
  require('../../shared/services/audio.service').getAudioDuration.mockRejectedValueOnce(new Error('ffprobe fail'));
  const handled = await routeLeaderAudio({ user: COACH, from: FROM, audioId: 'a3', sessionId: 's1' });
  expect(handled).toBe(true);
  expect(ObserveBinding.parkAndAsk).toHaveBeenCalled();
});

test('state-lookup FAILURE on classroom-length audio still parks — fail safe', async () => {
  ObserveState.getState.mockRejectedValue(new Error('redis down'));
  const handled = await routeLeaderAudio({ user: COACH, from: FROM, audioId: 'a4', sessionId: 's1' });
  expect(handled).toBe(true);
  expect(ObserveBinding.parkAndAsk).toHaveBeenCalled();
});

test('teacher audio is completely untouched (role gate)', async () => {
  const handled = await routeLeaderAudio({
    user: { id: 't-1', role: 'teacher' }, from: FROM, audioId: 'a5', sessionId: 's1',
  });
  expect(handled).toBe(false);
  expect(WhatsAppService.getMediaInfo).not.toHaveBeenCalled();
  expect(ObserveBinding.parkAndAsk).not.toHaveBeenCalled();
});
