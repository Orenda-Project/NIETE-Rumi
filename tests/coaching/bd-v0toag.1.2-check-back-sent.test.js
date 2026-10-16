'use strict';
/**
 * bd-v0toag.1.2 — coaching.report.check_back_sent: on her next recording, a teacher who said Yes last time gets
 * her prior commitment back (priorActionReminder) — merged into the photo offer, or on its own when too long.
 * Driven through the real processTranscription; only the network edges are faked.
 */
const os = require('os');
const path = require('path');

const SID = '22222222-3333-4444-8555-666666666666';
const UID = '0b9c3f1e-1111-4222-8333-444444444444';
const PRIOR_SID = '99999999-3333-4444-8555-666666666666';
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../bot/shared/utils/structured-logger'), logEvent: (...a) => mockLogEvent(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({
  TEMP_DIR: require('path').join(require('os').tmpdir(), 'rumi-test-check-back'),
  LISTENING_ANIMATION_MEDIA_ID: undefined,
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true),
  sendSticker: jest.fn(async () => true), downloadMedia: jest.fn(async () => Buffer.from('OGG')),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({ getAudioDuration: jest.fn(async () => 1800) }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadClassroomAudio: jest.fn(async () => 'https://r2.example/a.ogg') }));
jest.mock('../../bot/shared/services/coaching/audio-hash-cache', () => ({
  computeAudioHash: () => 'hash-1',
  findRecentDuplicateSession: jest.fn(async () => null),
  resolveDuplicateSubmission: jest.fn(async () => false),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'en'), setUserLanguage: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(async () => ({})), updateConversationState: jest.fn(async () => ({})), markAsFailed: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    const b = {};
    ['select', 'eq', 'order', 'limit', 'not', 'in', 'is', 'neq', 'update'].forEach((m) => { b[m] = () => b; });
    const row = {
      id: '22222222-3333-4444-8555-666666666666', user_id: '0b9c3f1e-1111-4222-8333-444444444444', status: 'transcribing',
      observation_type: null, audio_duration_seconds: 1800, users: { phone_number: '923001234567', name: 'T', preferred_language: 'en' },
    };
    b.single = async () => ({ data: row, error: null });
    b.maybeSingle = async () => ({ data: row, error: null });
    b.then = (ok, ko) => Promise.resolve({
      data: [{ id: '99999999-3333-4444-8555-666666666666', prioritized_action: global.__cbPriorAction }], error: null,
    }).then(ok, ko);
    return b;
  },
}));

const TP = require('../../bot/shared/services/coaching/transcription-processor.service');
const checkBacks = () => mockLogEvent.mock.calls.filter((c) => c[0] === 'coaching.report.check_back_sent').map((c) => c[1]);

beforeEach(() => {
  mockLogEvent.mockClear();
  jest.spyOn(TP, 'transcribeWithDiarization').mockResolvedValue({
    transcript: 'Teacher: today we learn fractions.', diarization: { speakers: ['Teacher'], confidence: 0.9, segments: [] },
    tokens: [], silences: [],
  });
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { try { require('fs').rmSync(path.join(os.tmpdir(), 'rumi-test-check-back'), { recursive: true, force: true }); } catch (_) { /* best effort */ } });

const run = () => TP.processTranscription(SID, { from: '923001234567', audioId: 'aud-1', step1Announced: true });

test('reminder merged into the photo offer: one check_back_sent naming the prior session', async () => {
  global.__cbPriorAction = { teacher_response: 'yes', action: 'Ask one open question per activity' };
  await run();
  expect(checkBacks()).toEqual([{ userId: UID, sessionId: SID, priorSessionId: PRIOR_SID, merged: true }]);
});

test('reminder too long for the offer: still one check_back_sent, merged false', async () => {
  global.__cbPriorAction = { teacher_response: 'yes', action: 'y'.repeat(1100) };
  await run();
  expect(checkBacks()).toEqual([{ userId: UID, sessionId: SID, priorSessionId: PRIOR_SID, merged: false }]);
});

test('CONTROL — no Yes last time: no check-back, nothing logged', async () => {
  global.__cbPriorAction = { teacher_response: 'later', action: 'x' };
  await run();
  expect(checkBacks()).toEqual([]);
});
