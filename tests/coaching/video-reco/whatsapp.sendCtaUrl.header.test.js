'use strict';
/**
 * bd-gzfdu9 (VIDREC): sendCtaUrl gains an optional image header (the video card). Without one, the payload
 * every existing caller sends is byte for byte what it was; with one, the PNG is uploaded to the Media API
 * (as sendImageBufferWithButtons does) and rides as interactive.header {type:'image', image:{id}}.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const axios = require('axios');
const WA = require('../../../bot/shared/services/whatsapp.service');

const TO = '923000000001';
const OPTS = { body: 'Body', buttonText: 'Open my report', url: 'https://portal.example.pk/cr/x' };

beforeEach(() => {
  axios.post.mockReset();
});

const messageCalls = () => axios.post.mock.calls.filter(([u]) => /\/messages$/.test(u));
const mediaCalls = () => axios.post.mock.calls.filter(([u]) => /\/media$/.test(u));

test('no headerImage: exactly today\'s payload, no upload', async () => {
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  const ok = await WA.sendCtaUrl(TO, OPTS);
  expect(ok).toBe(true);
  expect(mediaCalls()).toHaveLength(0);
  const [, payload] = messageCalls()[0];
  expect(JSON.stringify(payload)).toBe(JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: TO,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: 'Body' },
      action: { name: 'cta_url', parameters: { display_text: 'Open my report', url: OPTS.url } },
    },
  }));
});

test('headerImage: uploaded first, then sent by media id as the header', async () => {
  axios.post.mockImplementation((url) => Promise.resolve(/\/media$/.test(url)
    ? { data: { id: 'media-77' } }
    : { data: { messages: [{ id: 'wamid.2' }] } }));
  const seen = [];
  const ok = await WA.sendCtaUrl(TO, { ...OPTS, headerImage: Buffer.from('png-bytes') }, { onMessageId: (id) => seen.push(id) });
  expect(ok).toBe(true);
  expect(mediaCalls()).toHaveLength(1);
  const [, payload] = messageCalls()[0];
  expect(payload.interactive.header).toEqual({ type: 'image', image: { id: 'media-77' } });
  expect(payload.interactive.type).toBe('cta_url');
  expect(Object.keys(payload.interactive)).toEqual(['type', 'header', 'body', 'action']);
  expect(seen).toEqual(['wamid.2']);
});

test('a failed upload is a failed send (false), so the caller can drop to the plain button', async () => {
  axios.post.mockImplementation((url) => (/\/media$/.test(url)
    ? Promise.reject(new Error('upload 500'))
    : Promise.resolve({ data: { messages: [{ id: 'wamid.3' }] } })));
  const ok = await WA.sendCtaUrl(TO, { ...OPTS, headerImage: Buffer.from('png') });
  expect(ok).toBe(false);
  expect(messageCalls()).toHaveLength(0);
});

test('an empty buffer is ignored: today\'s payload', async () => {
  axios.post.mockResolvedValue({ data: {} });
  await WA.sendCtaUrl(TO, { ...OPTS, headerImage: Buffer.alloc(0) });
  expect(mediaCalls()).toHaveLength(0);
  expect(messageCalls()[0][1].interactive.header).toBeUndefined();
});
