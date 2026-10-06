'use strict';
/**
 * WhatsAppService.sendCtaUrl — the one link-button message the kid hub sends.
 * Driven for real with only the network (axios) mocked: the payload Meta gets.
 */
jest.mock('axios');
const axios = require('axios');
jest.mock('../../../shared/storage/r2', () => ({
  downloadFromR2: jest.fn(), extractKeyFromUrl: (u) => String(u), uploadToR2: jest.fn(), getPresignedUrl: jest.fn(),
}));
const WA = require('../../../shared/services/whatsapp.service');

beforeEach(() => { jest.clearAllMocks(); });

test('posts an interactive cta_url: body, a button cut to 20 code points, the url', async () => {
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  const label = 'کھولیں '.repeat(5); // 30 code points
  expect(await WA.sendCtaUrl('923001112223', { body: 'Your quizzes are here.', buttonText: label, url: 'https://p.example/h/abc.def' })).toBe(true);
  const [, payload] = axios.post.mock.calls[0];
  expect(payload).toMatchObject({ to: '923001112223', type: 'interactive', interactive: { type: 'cta_url', body: { text: 'Your quizzes are here.' } } });
  expect(payload.interactive.action).toEqual({ name: 'cta_url', parameters: { display_text: [...label].slice(0, 20).join(''), url: 'https://p.example/h/abc.def' } });
});

test('refuses a non-https url or a missing button without calling Meta', async () => {
  expect(await WA.sendCtaUrl('9230', { body: 'b', buttonText: 'Open', url: 'http://x' })).toBe(false);
  expect(await WA.sendCtaUrl('9230', { body: 'b', url: 'https://x' })).toBe(false);
  expect(axios.post).not.toHaveBeenCalled();
});

test('a rejected send is false, not a throw', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('400'), { response: { data: { error: { code: 131009 } } } }));
  expect(await WA.sendCtaUrl('9230', { body: 'b', buttonText: 'Open', url: 'https://x/h/t' })).toBe(false);
});
