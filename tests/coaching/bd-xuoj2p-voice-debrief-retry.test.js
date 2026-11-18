'use strict';
/**
 * bd-xuoj2p — one storage hiccup no longer loses a teacher's voice debrief.
 *
 * Live, 18 Nov 2026 11:11Z (corr-1795000132474-nc7vidgb7): uploadVoiceDebrief got R2 `InternalError`
 * ("We encountered an internal error. Please try again."). The SDK's own retry was in the stack, and the
 * whole failure took under 2 s after the audio was ready, so its quick back-to-back attempts all landed in
 * the same blip. The teacher got her report but no voice note. The upload now tries again after a pause,
 * for transient (5xx / InternalError / network) errors only.
 * Driven through the real r2.js with the S3 client's `send` scripted.
 */
process.env.R2_ENDPOINT = 'https://r2.example';
process.env.R2_ACCESS_KEY_ID = 'r2-key';
process.env.R2_SECRET_ACCESS_KEY = 'r2-secret';
process.env.R2_BUCKET_NAME = 'coach-bucket';

const mockSend = jest.fn();
const s3 = require('@aws-sdk/client-s3');
const Original = s3.S3Client;
s3.S3Client = class extends Original {
  constructor(config) { super(config); this.send = mockSend; }
};
const r2 = require('../../bot/shared/storage/r2');

const internalError = () => Object.assign(new Error('We encountered an internal error. Please try again.'), {
  name: 'InternalError', $metadata: { httpStatusCode: 500, attempts: 3 },
});
const accessDenied = () => Object.assign(new Error('Access Denied'), {
  name: 'AccessDenied', $metadata: { httpStatusCode: 403, attempts: 1 },
});
const upload = () => r2.uploadVoiceDebrief(Buffer.from('mp3'), 'u1', 's1', 'ur');

beforeEach(() => {
  mockSend.mockReset();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => jest.useRealTimers());

test('the live case: an InternalError, then success after a pause — the voice note is uploaded', async () => {
  mockSend.mockRejectedValueOnce(internalError()).mockResolvedValueOnce({});
  const p = upload();
  await jest.advanceTimersByTimeAsync(10_000);
  await expect(p).resolves.toBe('https://r2.example/coach-bucket/voice_debriefs/u1/s1_debrief.mp3');
  expect(mockSend).toHaveBeenCalledTimes(2);
});

test('the second try waits (a back-to-back retry lands in the same blip)', async () => {
  mockSend.mockRejectedValueOnce(internalError()).mockResolvedValueOnce({});
  const p = upload();
  await jest.advanceTimersByTimeAsync(500);
  expect(mockSend).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(10_000);
  await p;
  expect(mockSend).toHaveBeenCalledTimes(2);
});

test('an outage that does not clear still fails, after a bounded number of tries', async () => {
  mockSend.mockRejectedValue(internalError());
  const p = upload();
  const settled = expect(p).rejects.toThrow(/internal error/);
  await jest.advanceTimersByTimeAsync(60_000);
  await settled;
  expect(mockSend).toHaveBeenCalledTimes(3);
});

test('a permanent error (403) is not retried', async () => {
  mockSend.mockRejectedValue(accessDenied());
  const p = upload();
  const settled = expect(p).rejects.toThrow(/Access Denied/);
  await jest.advanceTimersByTimeAsync(60_000);
  await settled;
  expect(mockSend).toHaveBeenCalledTimes(1);
});
