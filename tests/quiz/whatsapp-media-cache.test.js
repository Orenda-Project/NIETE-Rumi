'use strict';
/**
 * The WhatsApp media-id cache on sendImageWithButtons.
 *
 * An R2 URL cannot be handed to Meta as a link, so every send downloads the
 * object and re-uploads it to the Media API. One picture question sent to a
 * class of forty children was forty downloads and forty uploads of the same
 * bytes. Meta keeps an uploaded media id for 30 days, so the id is cached in
 * Redis for 25 and reused.
 *
 * Redis is a convenience here, never a dependency: with it unavailable the
 * function does exactly what it did before.
 */

jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
  extractKeyFromUrl: jest.fn((u) => u.split('/bucket/')[1] || u),
}));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: jest.fn(() => true),
  get: jest.fn(),
  set: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const crypto = require('crypto');
const axios = require('axios');
const r2 = require('../../bot/shared/storage/r2');
const redis = require('../../bot/shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const KEY = 'transcript_quizzes/u-1/q-1/q0.png';
const URL = `https://acct.r2.cloudflarestorage.com/bucket/${KEY}`;
const CACHE_KEY = `wa:media:${crypto.createHash('sha1').update(KEY).digest('hex')}`;
const BUTTONS = [{ id: 'a0', title: 'one half' }, { id: 'a1', title: 'three quarters' }, { id: 'a2', title: 'two thirds' }];

const postsTo = (needle) => axios.post.mock.calls.filter((c) => String(c[0]).includes(needle));
const messagePayload = () => postsTo('/messages')[0][1];

beforeEach(() => {
  jest.clearAllMocks();
  redis.isAvailable.mockReturnValue(true);
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue(true);
  axios.post.mockImplementation(async (url) => (String(url).includes('/media')
    ? { data: { id: 'fresh-media-id' } }
    : { data: { messages: [{ id: 'wamid.1' }] } }));
});

describe('cache miss', () => {
  test('downloads, uploads once, sends by media id, and remembers the id for 25 days', async () => {
    const ok = await WhatsAppService.sendImageWithButtons('923001234567', URL, 'Which one?', BUTTONS);
    expect(ok).toBe(true);

    expect(r2.downloadFromR2).toHaveBeenCalledTimes(1);
    expect(postsTo('/media')).toHaveLength(1);
    expect(messagePayload().interactive.header.image).toEqual({ id: 'fresh-media-id' });

    expect(redis.get).toHaveBeenCalledWith(CACHE_KEY);
    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, 'fresh-media-id', 25 * 24 * 60 * 60);
  });
});

describe('cache hit', () => {
  test('performs zero R2 downloads and zero media uploads', async () => {
    redis.get.mockResolvedValue('cached-media-id');
    const ok = await WhatsAppService.sendImageWithButtons('923001234567', URL, 'Which one?', BUTTONS);
    expect(ok).toBe(true);

    expect(r2.downloadFromR2).not.toHaveBeenCalled();
    expect(postsTo('/media')).toHaveLength(0);
    expect(redis.set).not.toHaveBeenCalled();
    expect(messagePayload().interactive.header.image).toEqual({ id: 'cached-media-id' });
    expect(postsTo('/messages')).toHaveLength(1);
  });

  test('a second send for the same picture costs one message and nothing else', async () => {
    const store = {};
    redis.get.mockImplementation(async (k) => store[k] || null);
    redis.set.mockImplementation(async (k, v) => { store[k] = v; return true; });

    await WhatsAppService.sendImageWithButtons('923001111111', URL, 'Which one?', BUTTONS);
    await WhatsAppService.sendImageWithButtons('923002222222', URL, 'Which one?', BUTTONS);

    expect(r2.downloadFromR2).toHaveBeenCalledTimes(1);
    expect(postsTo('/media')).toHaveLength(1);
    expect(postsTo('/messages')).toHaveLength(2);
  });
});

describe('Redis unavailable', () => {
  test('falls back silently to the download-and-upload path', async () => {
    redis.isAvailable.mockReturnValue(false);
    redis.get.mockResolvedValue(null);
    const ok = await WhatsAppService.sendImageWithButtons('923001234567', URL, 'Which one?', BUTTONS);
    expect(ok).toBe(true);
    expect(r2.downloadFromR2).toHaveBeenCalledTimes(1);
    expect(postsTo('/media')).toHaveLength(1);
    expect(messagePayload().interactive.header.image).toEqual({ id: 'fresh-media-id' });
  });

  test('a throwing Redis never costs the send', async () => {
    redis.get.mockRejectedValue(new Error('connection reset'));
    redis.set.mockRejectedValue(new Error('connection reset'));
    const ok = await WhatsAppService.sendImageWithButtons('923001234567', URL, 'Which one?', BUTTONS);
    expect(ok).toBe(true);
    expect(postsTo('/messages')).toHaveLength(1);
  });
});

describe('a public URL is unaffected', () => {
  test('it goes as a link, and nothing is cached', async () => {
    const ok = await WhatsAppService.sendImageWithButtons('923001234567', 'https://cdn.example/pic.png', 'Which one?', BUTTONS);
    expect(ok).toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(messagePayload().interactive.header.image).toEqual({ link: 'https://cdn.example/pic.png' });
  });
});
