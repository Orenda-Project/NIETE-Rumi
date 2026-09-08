'use strict';
/**
 * The two send helpers the quiz sender has always called and WhatsAppService
 * has never had.
 *
 * `video-quiz-sender.service.js` calls `sendTextReturningId` for an option
 * label that must arrive as a QUOTED REPLY to the clip it names, and
 * `sendAudioFromUrlReturningId` for the clip itself. Neither is a static member
 * of WhatsAppService on `main` or on `develop`, so a P6a/P6b sound question
 * threw inside the sender's own try/catch and every one of its messages was
 * recorded as failed — a column of identical voice notes with no labels, or
 * nothing at all. The conformance guard
 * tests/setup/no-undefined-whatsapp-methods.test.js has listed both as
 * offenders on both branches for as long as the snapshot has existed.
 *
 * These tests drive the real methods with only the network boundary mocked.
 */
const path = require('path');

jest.mock('axios');
const axios = require('axios');

// whatsapp.service destructures these at module load, so the module has to be
// mocked — a spy on the live export is installed too late to be seen.
jest.mock('../../shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  extractKeyFromUrl: (u) => String(u),
  uploadToR2: jest.fn(),
  getPresignedUrl: jest.fn(),
}));
const r2 = require('../../shared/storage/r2');

const WA = require('../../shared/services/whatsapp.service');

describe('sendTextReturningId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });
  afterEach(() => { delete global.fetch; });

  test('is a static member of WhatsAppService', () => {
    expect(typeof WA.sendTextReturningId).toBe('function');
  });

  test('returns the sent message id, so the next message can quote it', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ messages: [{ id: 'wamid.TEXT1' }] }),
    });
    const id = await WA.sendTextReturningId('923001234567', 'Sound 1');
    expect(id).toBe('wamid.TEXT1');
  });

  test('quotes the message it was anchored to', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ messages: [{ id: 'wamid.TEXT2' }] }),
    });
    await WA.sendTextReturningId('923001234567', 'Sound 2', { contextMessageId: 'wamid.CLIP2' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.context).toEqual({ message_id: 'wamid.CLIP2' });
    expect(body.text.body).toBe('Sound 2');
  });

  test('a Graph error is null, never a throw — the sender treats it as a failed message', async () => {
    global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'nope' } }) });
    await expect(WA.sendTextReturningId('923001234567', 'x')).resolves.toBeNull();
  });
});

describe('sendAudioFromUrlReturningId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('is a static member of WhatsAppService', () => {
    expect(typeof WA.sendAudioFromUrlReturningId).toBe('function');
  });

  test('uploads the clip and returns the message id', async () => {
    r2.downloadFromR2.mockResolvedValue(Buffer.from('OggS-not-really-audio'));
    axios.post
      .mockResolvedValueOnce({ data: { id: 'media-1' } })
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.AUDIO1' }] } });

    const id = await WA.sendAudioFromUrlReturningId('923001234567', 'quiz/audio/opt1.ogg');
    expect(id).toBe('wamid.AUDIO1');
    expect(axios.post.mock.calls[1][1]).toMatchObject({ type: 'audio', audio: { id: 'media-1' } });
  });

  test('a failed download is null, never a throw', async () => {
    r2.downloadFromR2.mockRejectedValue(new Error('gone'));
    await expect(WA.sendAudioFromUrlReturningId('923001234567', 'missing.ogg')).resolves.toBeNull();
  });
});
