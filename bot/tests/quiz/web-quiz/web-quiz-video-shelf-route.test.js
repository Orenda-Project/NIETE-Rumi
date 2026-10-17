'use strict';
/**
 * app_settings web_quiz_video_shelf over HTTP: GET /api/internal/wq/vt/<lesson id>.webp answers the lesson's small
 * thumbnail as WebP bytes the edge may keep, and a 404 nobody keeps when there is none (switch off, unknown lesson).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockThumb = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-video-thumb', () => ({ thumb: (...a) => mockThumb(...a) }));

const express = require('express');

const VID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WEBP = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 tiny', 'binary');
let server; let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key';
  const app = express();
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => mockThumb.mockReset());
const KEY = { 'x-api-key': 'route-key' };

test('a drawn thumbnail: WebP bytes, a year\'s immutable cache (the URL carries its version)', async () => {
  mockThumb.mockResolvedValue({ bytes: WEBP, contentType: 'image/webp' });
  const r = await fetch(`${base}/vt/${VID}.webp`, { headers: KEY });
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('image/webp');
  expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(Buffer.from(await r.arrayBuffer()).equals(WEBP)).toBe(true);
  expect(mockThumb).toHaveBeenCalledWith(VID);
});
test('none (switch off, unknown lesson, no poster): 404 no-store; a failure: 500 no-store', async () => {
  mockThumb.mockResolvedValue(null);
  const r = await fetch(`${base}/vt/${VID}.webp`, { headers: KEY });
  expect(r.status).toBe(404);
  expect(r.headers.get('cache-control')).toBe('no-store');
  mockThumb.mockRejectedValue(new Error('boom'));
  const f = await fetch(`${base}/vt/${VID}.webp`, { headers: KEY });
  expect(f.status).toBe(500);
  expect(f.headers.get('cache-control')).toBe('no-store');
});
test('no key: 401, nothing drawn', async () => {
  expect((await fetch(`${base}/vt/${VID}.webp`)).status).toBe(401);
  expect(mockThumb).not.toHaveBeenCalled();
});
