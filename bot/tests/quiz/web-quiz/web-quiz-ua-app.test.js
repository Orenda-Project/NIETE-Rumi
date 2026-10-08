'use strict';
/**
 * page_open says which app's browser opened the page: ua_app = whatsapp | webview | samsung | browser.
 *
 * The page's own iab flag was a regex over the user agent that missed WhatsApp's own browser (its UA carries
 * "WA4A/<version>" and no "; wv)") and counted every other app's webview ("; wv)") as WhatsApp. The bot now
 * reads the UA the page_open beacon already carries and logs ua_app, with iab = 1 only for WhatsApp's browser,
 * so a page cached before this change logs the same as a new one.
 *
 * The beacon goes page -> portal edge (a pass-through) -> POST /api/internal/wq/e -> the quiz service -> the log.
 * Supabase and the structured logger are the boundaries and are faked; the route and the service run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');

let server; let base;
const SAVED = process.env.INTERNAL_API_KEY;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key';
  const fake = makeFake({});
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => { process.env.INTERNAL_API_KEY = SAVED; return new Promise((r) => server.close(r)); });
beforeEach(() => jest.clearAllMocks());

const KEY = { 'x-api-key': 'route-key', 'content-type': 'application/json' };
const UA = {
  // WhatsApp's own browser on Android: the WA4A token, no "; wv)"
  wa4a: 'Mozilla/5.0 (Linux; Android 14; Pixel 8a Build/AP4A.250105.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.0.0 Mobile Safari/537.36 WA4A/2.26.38.73',
  // an older WhatsApp in-app browser that names itself
  whatsapp: 'Mozilla/5.0 (Linux; Android 12; SM-A125F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.20.89',
  // another app's Android webview
  wv: 'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36',
  // Facebook's in-app browser on iPhone (no "; wv)")
  fbios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]',
  samsung: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  chrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

async function beacon(events) {
  const r = await fetch(`${base}/e`, { method: 'POST', headers: KEY, body: JSON.stringify({ events }) });
  expect(r.status).toBe(204);
  // the route's own timing line is not a page event
  return logEvent.mock.calls.filter(([name]) => name !== 'web_quiz.timing').map(([name, props]) => [name, props]);
}

test.each([
  // [ua, what the page sent as iab, ua_app, iab logged]
  ['wa4a', 0, 'whatsapp', 1],
  ['whatsapp', 1, 'whatsapp', 1],
  ['wv', 1, 'webview', 0],
  ['fbios', 1, 'webview', 0],
  ['samsung', 0, 'samsung', 0],
  ['chrome', 0, 'browser', 0],
])('page_open from %s (page sent iab=%s) logs ua_app=%s, iab=%s', async (ua, sent, app, iab) => {
  const calls = await beacon([{ n: 'page_open', ua: UA[ua], iab: sent, store: 1, src: 'quiz' }]);
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe('web_quiz.page_open');
  expect(calls[0][1]).toEqual(expect.objectContaining({ ua_app: app, iab, ua: UA[ua], store: 1 }));
});

test('a page_open without a UA keeps the flag the page sent and names no app', async () => {
  const calls = await beacon([{ n: 'page_open', iab: 1 }]);
  expect(calls[0][1]).toEqual({ iab: 1 });
});

test('only page_open is classified: other events carrying a UA log as before', async () => {
  const calls = await beacon([{ n: 'share_done', path: 'wa', ua: UA.wa4a }]);
  expect(calls[0][1]).toEqual({ path: 'wa', ua: UA.wa4a });
});
