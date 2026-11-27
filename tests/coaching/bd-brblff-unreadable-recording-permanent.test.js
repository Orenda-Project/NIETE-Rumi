'use strict';
/**
 * bd-brblff — a recording no transcriber can read is a PERMANENT failure of the transcription job.
 *
 * Production, 27 Nov 2026 08:19–09:55 PKT: one teacher sent the same classroom recording from the app three times
 * (identical bytes, 16,391,822 B). It is an Android m4a that was never finished: no `moov` box and the mdat length
 * still the placeholder `????????`. Soniox v3, Soniox v2 and Whisper each refused it as undecodable. The job threw,
 * the worker left the message to SQS, and SQS delivered it again 20 minutes later, three times per upload: 8 failed
 * jobs in 95 minutes, the same three paid uploads to the transcribers each time, and a WhatsApp "please try again"
 * to the teacher on every delivery. On 25 Nov a 0-byte upload from another teacher went round the same loop.
 *
 * A retry cannot make these bytes readable. Contract under test (the REAL processTranscription; only the
 * infrastructure is mocked, the harness of bd-c5reix-portal-duplicate-quiet.test.js):
 *   1. every transcriber saying "this file cannot be decoded" → the job rejects with `permanent: true`
 *      (reason 'unreadable_audio'), so the worker removes the message instead of letting SQS deliver it again;
 *   2. anything short of that (one provider timing out, a network error) is NOT permanent: retried as before;
 *   3. the session is still marked failed, and the teacher is still told once, on this delivery.
 *      bd-8sr958 (queue #320): that failure is now failed_step 'damaged_audio' and the ONE message is the catalog's
 *      "damaged, we're trying to recover it" (never "try again"); the team gets one Slack post.
 */

const mockSendMessage = jest.fn(async () => true);
const mockMarkAsFailed = jest.fn(async () => ({}));
const mockTranscribe = jest.fn();

const KEY = 'classroom_audio/teacher-uuid/2026-11/portal_f5696265-dd92-4d46-aa8f-ca01f66f3d22.m4a';
const mockSessionRow = {
  id: 'current-session',
  user_id: 'teacher-uuid',
  observation_type: null,
  audio_url: `https://r2.example/digital-coach-audio/${KEY}`,
  audio_duration_seconds: null,
  users: { phone_number: '+92300FIXTURE3', name: 'Ayesha Qadeer', preferred_language: 'ur' },
};

jest.mock('../../bot/shared/config/supabase', () => ({
  from() {
    const q = {
      select() { return q; }, update() { return q; }, eq() { return q; }, is() { return q; }, gte() { return q; },
      neq() { return q; }, not() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; },
      single: async () => ({ data: mockSessionRow, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
    };
    return q;
  },
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSendMessage(...a),
  sendDocumentFromUrl: jest.fn(async () => true),
  sendImageFromUrl: jest.fn(async () => true),
  sendImage: jest.fn(async () => true),
  sendSticker: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  downloadMedia: jest.fn(),
}));
jest.mock('../../bot/shared/services/audio.service', () => ({
  transcribe: (...a) => mockTranscribe(...a),
  getAudioDuration: jest.fn(async () => null),
}));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadClassroomAudio: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/portal-short-recording', () => ({
  isPortalDc: () => true,
  refuseShortPortalRecording: async () => ({ refused: false }),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(async () => ({})),
  updateConversationState: jest.fn(async () => ({})),
  markAsFailed: (...a) => mockMarkAsFailed(...a),
}));
jest.mock('../../bot/shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'ur'),
  setUserLanguage: jest.fn(async () => ({})),
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn(),
  generateCorrelationId: () => 'test', runWithCorrelation: (_id, fn) => fn(),
}));

const TranscriptionProcessor = require('../../bot/shared/services/coaching/transcription-processor.service');

const SONIOX_V3_UNREADABLE = 'Soniox transcription error (stt-async-v5): invalid_audio_file - Invalid audio file: Error analyzing the file. The file may be corrupted or uses an unsupported format.';
const SONIOX_V2_UNREADABLE = 'Soniox transcription error (stt-async-v4): invalid_audio_file - Invalid audio file: Error analyzing the file. The file may be corrupted or uses an unsupported format.';
const allFailed = (v3, v2, whisper) => new Error(
  'All transcription methods failed:\n'
  + `- Soniox V3: ${v3}\n`
  + `- Soniox V2: ${v2}\n`
  + `- OpenAI Whisper: ${whisper}`,
);

// The exact prod texts (niete-logs, 27 Nov 03:20 UTC and 25 Nov 05:31 UTC).
const UNFINISHED_M4A_27NOV = () => allFailed(SONIOX_V3_UNREADABLE, SONIOX_V2_UNREADABLE,
  'Whisper: Invalid request - 400 The audio file could not be decoded or its format is not supported.');
const ZERO_BYTES_25NOV = () => allFailed(SONIOX_V3_UNREADABLE, SONIOX_V2_UNREADABLE,
  "Whisper: Invalid request - 400 Invalid file format. Supported formats: ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']");

async function runWith(error) {
  mockTranscribe.mockImplementationOnce(() => Promise.reject(error));
  return TranscriptionProcessor.processTranscription('current-session', { from: '+92300FIXTURE3' })
    .then(() => { throw new Error('processTranscription resolved; expected it to reject'); }, (e) => e);
}

describe('bd-brblff — a recording no transcriber can decode fails permanently', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(TranscriptionProcessor, 'fetchAudioForSession').mockResolvedValue(Buffer.from('unfinished m4a bytes'));
  });

  test('27 Nov: the unfinished Android m4a (all three say undecodable) rejects as permanent', async () => {
    const err = await runWith(UNFINISHED_M4A_27NOV());
    expect(err.message).toMatch(/^All transcription methods failed/);
    expect(err.permanent).toBe(true);
    expect(err.permanentReason).toBe('unreadable_audio');
  });

  test('25 Nov: the 0-byte upload (Whisper: "Invalid file format") rejects as permanent too', async () => {
    const err = await runWith(ZERO_BYTES_25NOV());
    expect(err.permanent).toBe(true);
  });

  test('the session is still marked failed and the teacher is told once on this delivery', async () => {
    await runWith(UNFINISHED_M4A_27NOV());
    expect(mockMarkAsFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkAsFailed.mock.calls[0][1]).toBe('damaged_audio');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(String(mockSendMessage.mock.calls[0][1])).not.toMatch(/try again|record again|دوبارہ/i);
  });
});

describe('bd-brblff — anything short of "undecodable by all" is retried as before', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(TranscriptionProcessor, 'fetchAudioForSession').mockResolvedValue(Buffer.from('classroom bytes'));
  });

  test('one provider timed out: not permanent', async () => {
    const err = await runWith(allFailed('Soniox transcription timeout after 180 seconds', SONIOX_V2_UNREADABLE,
      'Whisper: Invalid request - 400 The audio file could not be decoded or its format is not supported.'));
    expect(err.permanent).toBeFalsy();
  });

  test('Whisper failed for another reason (rate limit): not permanent', async () => {
    const err = await runWith(allFailed(SONIOX_V3_UNREADABLE, SONIOX_V2_UNREADABLE, 'Whisper: Rate limit exceeded'));
    expect(err.permanent).toBeFalsy();
  });

  test('a network error (24 Nov: ENETUNREACH): not permanent', async () => {
    const err = await runWith(new Error('connect ENETUNREACH 2a03:2880:f34c:8d:face:b00c:0:2:443 - Local (:::0)'));
    expect(err.permanent).toBeFalsy();
  });
});
