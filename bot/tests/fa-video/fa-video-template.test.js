'use strict';
/** bd-pw1ccr.8.3 — the FA video template: one definition for the registrar and the sender. */
const { TEMPLATE, sendComponents } = require('../../shared/templates/fa-video.template');
const { payloads } = require('../../scripts/register-fa-video-template');

test('one MARKETING template in Urdu, a fresh _v name', () => {
  expect(TEMPLATE.name).toBe('niete_fa_video_ab_v1');
  expect(TEMPLATE.language).toBe('ur');
  expect(TEMPLATE.category).toBe('MARKETING');
});

test('the body has no variables and no gendered address', () => {
  expect(TEMPLATE.body).not.toMatch(/\{\{\d+\}\}/);
  // ٹیچر صاحبہ / صاحب, محترمہ: the bot does not know who reads it
  expect(TEMPLATE.body).not.toMatch(/صاحبہ|محترمہ|بہن|بھائی/);
  expect(TEMPLATE.body.length).toBeLessThan(1024);
});

test('submission payload: a VIDEO header with the upload handle, then the BODY', () => {
  const [p] = payloads('HANDLE_1');
  expect(payloads('HANDLE_1')).toHaveLength(1);
  expect(p).toMatchObject({ name: TEMPLATE.name, language: 'ur', category: 'MARKETING' });
  expect(p.components).toEqual([
    { type: 'HEADER', format: 'VIDEO', example: { header_handle: ['HANDLE_1'] } },
    { type: 'BODY', text: TEMPLATE.body },
  ]);
});

test('submission refuses without a handle (Meta needs a sample video)', () => {
  expect(() => payloads()).toThrow(/handle/);
});

test('send components carry the uploaded media id in the header', () => {
  expect(sendComponents('MEDIA_9')).toEqual([
    { type: 'header', parameters: [{ type: 'video', video: { id: 'MEDIA_9' } }] },
  ]);
  expect(() => sendComponents('')).toThrow(/media id/);
});

test('appIdFor: APP_ID wins; otherwise the token\'s own app from GET /app', async () => {
  const { appIdFor } = require('../../scripts/register-fa-video-template');
  const fetchFn = jest.fn().mockResolvedValue({ json: async () => ({ id: '42' }) });
  expect(await appIdFor({ APP_ID: '7', WHATSAPP_TOKEN: 't' }, fetchFn)).toBe('7');
  expect(fetchFn).not.toHaveBeenCalled();
  expect(await appIdFor({ WHATSAPP_TOKEN: 't' }, fetchFn)).toBe('42');
  expect(fetchFn.mock.calls[0][0]).toMatch(/\/app$/);
  const none = jest.fn().mockResolvedValue({ json: async () => ({ error: { message: 'x' } }) });
  await expect(appIdFor({ WHATSAPP_TOKEN: 't' }, none)).rejects.toThrow(/app id/);
});
