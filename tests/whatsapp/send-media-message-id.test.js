/**
 * bd-v0toag.12: the image and voice senders hand Meta's message id (the wamid) to a caller that
 * asks for it via opts.onMessageId, as sendInteractiveButtons already does. The coaching report
 * records them so delivered/read can be joined back. Callers that pass nothing are unaffected.
 *
 * Exercised through the real WhatsAppService; only the Graph API (and the R2 download) is faked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/utils/constants', () => ({
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(), downloadMedia: jest.fn(), extractKeyFromUrl: jest.fn(),
}));

const axios = require('axios'); // mapped stub
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);
let tempDir;

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-media-id-'));
  jest.spyOn(fs, 'createReadStream').mockReturnValue({ on() { return this; }, pipe() {} });
  axios.post.mockReset();
  axios.post.mockImplementation(async (url) => (/\/media$/.test(url)
    ? { data: { id: 'media-1' } }
    : { data: { messages: [{ id: 'wamid.SENT1' }] } }));
});

function imageFile() {
  const p = path.join(tempDir, 'report.png');
  fs.writeFileSync(p, Buffer.from('PNG'));
  return p;
}

test('sendImage hands the wamid to onMessageId', async () => {
  const onMessageId = jest.fn();
  const ok = await WhatsAppService.sendImage('923001110001', imageFile(), 'cap', { onMessageId });
  expect(ok).toBe(true);
  expect(onMessageId).toHaveBeenCalledWith('wamid.SENT1');
});

test('sendImage without opts still returns true', async () => {
  expect(await WhatsAppService.sendImage('923001110001', imageFile(), 'cap')).toBe(true);
});

test('sendImage: a refused send does not call onMessageId', async () => {
  axios.post.mockImplementation(async (url) => {
    if (/\/media$/.test(url)) return { data: { id: 'media-1' } };
    throw new Error('400');
  });
  const onMessageId = jest.fn();
  expect(await WhatsAppService.sendImage('923001110001', imageFile(), 'cap', { onMessageId })).toBe(false);
  expect(onMessageId).not.toHaveBeenCalled();
});

test('sendAudio hands the wamid to onMessageId', async () => {
  const onMessageId = jest.fn();
  const ok = await WhatsAppService.sendAudio('923001110001', OGG, tempDir, { onMessageId });
  expect(ok).toBe(true);
  expect(onMessageId).toHaveBeenCalledWith('wamid.SENT1');
});

test('sendAudio without opts still returns true', async () => {
  expect(await WhatsAppService.sendAudio('923001110001', OGG, tempDir)).toBe(true);
});

test('sendAudioFromUrl passes onMessageId through to sendAudio', async () => {
  require('../../bot/shared/storage/r2').downloadMedia.mockResolvedValue(OGG);
  const spy = jest.spyOn(WhatsAppService, 'sendAudio').mockResolvedValue(true);
  const opts = { onMessageId: jest.fn() };
  await WhatsAppService.sendAudioFromUrl('923001110001', 'https://r2.example/v.ogg', opts);
  expect(spy).toHaveBeenCalledWith('923001110001', OGG, expect.any(String), opts);
});
