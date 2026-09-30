/**
 * A sent voice note can be found again (red first).
 *
 * sendAudio uploaded the audio to WhatsApp and logged only the message id, so the
 * exact bytes a teacher heard could not be fetched back: the media id — the one
 * handle Meta's API returns them by — was never written down. It is now logged
 * with the message id, the byte count and the content type.
 *
 * Exercised through the real WhatsAppService; only the Graph API is faked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/utils/constants', () => ({
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const axios = require('axios'); // mapped stub
const { logToFile } = require('../../bot/shared/utils/logger');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  // The form-data stub never reads the file stream, so a real stream would open
  // the temp file after sendAudio has deleted it and crash the worker. The bytes
  // are not what this suite asserts on.
  jest.spyOn(fs, 'createReadStream').mockReturnValue({ on() { return this; }, pipe() {} });
  logToFile.mockClear();
  axios.post.mockReset();
  axios.post.mockImplementation(async (url) => (/\/media$/.test(url)
    ? { data: { id: 'media-voice-42' } }
    : { data: { messages: [{ id: 'wamid.VOICE42' }] } }));
});

test('a send Meta refuses after the upload still names the uploaded media id', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-audio-'));
  axios.post.mockImplementation(async (url) => {
    if (/\/media$/.test(url)) return { data: { id: 'media-voice-43' } };
    throw Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { error: { code: 131026, message: 'Message undeliverable' } } },
    });
  });

  const ok = await WhatsAppService.sendAudio('15550100931', OGG, tempDir);

  expect(ok).toBe(false);
  const line = logToFile.mock.calls.find((c) => c[0] === '❌ Error sending audio message');
  expect(line[1]).toMatchObject({ mediaId: 'media-voice-43', bytes: OGG.length });
});

test('the success log names the media id, the message id, the size and the type', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-audio-'));
  const ok = await WhatsAppService.sendAudio('923001110001', OGG, tempDir);

  expect(ok).toBe(true);
  const line = logToFile.mock.calls.find((c) => c[0] === 'Audio message sent successfully');
  expect(line).toBeDefined();
  expect(line[1]).toMatchObject({
    mediaId: 'media-voice-42',
    messageId: 'wamid.VOICE42',
    bytes: OGG.length,
    contentType: 'audio/ogg',
  });
});
