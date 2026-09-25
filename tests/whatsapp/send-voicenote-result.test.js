/**
 * sendVoicenoteFromR2Key must report a delivered voicenote as delivered.
 *
 * THE BUG. After the send succeeded, the success log line referenced a variable (`key`) that an
 * earlier change had removed from the function. The ReferenceError was thrown AFTER Meta accepted
 * the voice message, landed in the function's own catch, and the function returned `false`. Every
 * voicenote since then was delivered and reported as not sent (production: every call since the
 * change logged "key is not defined"), so the LP survey was told no voicenote went out.
 *
 * Exercised through the real WhatsAppService; only the network (R2 download, Graph API) is faked.
 */

jest.mock('../../bot/shared/utils/constants', () => ({
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  downloadMedia: jest.fn(async () => Buffer.from('OggS fake voice bytes')),
  extractKeyFromUrl: jest.fn(),
}));

const axios = require('axios'); // mapped stub
const { logToFile } = require('../../bot/shared/utils/logger');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

beforeEach(() => {
  logToFile.mockClear();
  axios.post.mockReset();
  axios.post.mockImplementation(async (url) => (/\/media$/.test(url)
    ? { data: { id: 'media-voice-1' } }
    : { data: { messages: [{ id: 'wamid.VOICE' }] } }));
});

test('a voicenote Meta accepted returns true', async () => {
  const result = await WhatsAppService.sendVoicenoteFromR2Key('923001110001', 'lp-cache/v8/g5/abc.ogg');

  expect(axios.post.mock.calls.filter((c) => /\/messages$/.test(c[0]))).toHaveLength(1);
  expect(result).toBe(true);
  expect(logToFile.mock.calls.find((c) => c[0] === '❌ Error sending voicenote from R2 key')).toBeUndefined();
  expect(logToFile.mock.calls.find((c) => c[0] === 'Voicenote (OGG) sent successfully')[1])
    .toMatchObject({ r2KeyOrUrl: 'lp-cache/v8/g5/abc.ogg' });
});

test('a voicenote Meta refused still returns false', async () => {
  axios.post.mockImplementation(async (url) => {
    if (/\/media$/.test(url)) return { data: { id: 'media-voice-1' } };
    throw Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { error: { code: 100, message: 'bad' } } },
    });
  });
  await expect(WhatsAppService.sendVoicenoteFromR2Key('923001110001', 'lp-cache/v8/g5/abc.ogg')).resolves.toBe(false);
});
