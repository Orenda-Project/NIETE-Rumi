/**
 * A bot voice note must arrive as a WhatsApp VOICE message — waveform and the
 * playback-speed button — not as an audio file (red first).
 *
 * Meta's audio object: "voice — set to true if sending a voice message; to send a
 * basic audio message, set to false or omit entirely." sendAudio omitted it, so
 * every spoken reply, coaching question, closing note, report note and reading
 * feedback reached teachers as an audio file they could not speed up. Seen on a
 * real WhatsApp client: the same Ogg Opus bytes rendered as a file without the
 * flag and as a voice message, speed button included, with it.
 *
 * Exercised through the real WhatsAppService; only the Graph API, the multipart
 * body and the R2 download are faked.
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
  downloadMedia: jest.fn(),
  downloadFromR2: jest.fn(),
  extractKeyFromUrl: jest.fn((u) => u),
}));

const axios = require('axios'); // mapped stub
const FormData = require('form-data'); // mapped stub
const { downloadMedia } = require('../../bot/shared/storage/r2');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]);

let appended;

beforeEach(() => {
  // The form-data stub never reads the file stream; a real one would open the
  // temp file after sendAudio deleted it.
  jest.spyOn(fs, 'createReadStream').mockReturnValue({ on() { return this; }, pipe() {} });
  appended = [];
  jest.spyOn(FormData.prototype, 'append').mockImplementation((name, value) => {
    appended.push([name, typeof value === 'string' ? value : '<file>']);
  });
  axios.post.mockReset();
  axios.post.mockImplementation(async (url) => (/\/media$/.test(url)
    ? { data: { id: 'media-voice-7' } }
    : { data: { messages: [{ id: 'wamid.VOICE7' }] } }));
});

afterEach(() => jest.restoreAllMocks());

const sentMessage = () => axios.post.mock.calls.find(([url]) => /\/messages$/.test(url))[1];
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'voice-flag-'));

test('an Ogg Opus voice note is sent as a voice message (audio.voice = true)', async () => {
  expect(await WhatsAppService.sendAudio('923001110001', OGG, tempDir())).toBe(true);
  expect(sentMessage()).toMatchObject({ type: 'audio', audio: { id: 'media-voice-7', voice: true } });
});

test('the upload names its media type, as Meta requires', async () => {
  await WhatsAppService.sendAudio('923001110001', OGG, tempDir());
  expect(appended).toEqual(expect.arrayContaining([['messaging_product', 'whatsapp'], ['type', 'audio/ogg']]));
});

test('an MP3 is sent as plain audio: Meta plays only Ogg Opus as a voice message', async () => {
  await WhatsAppService.sendAudio('923001110001', MP3, tempDir());
  expect(sentMessage().audio).toEqual({ id: 'media-voice-7' });
});

test('the coaching report note and reading feedback, sent from R2, arrive as voice messages too', async () => {
  downloadMedia.mockResolvedValue(OGG);
  expect(await WhatsAppService.sendAudioFromUrl('923001110001', 'voice_debriefs/user/session_debrief.mp3')).toBe(true);
  expect(sentMessage()).toMatchObject({ type: 'audio', audio: { voice: true } });
});
