'use strict';
/** bd-pw1ccr.8.4 — the CLI's Graph calls: media upload and the template send (fetch mocked, nothing leaves). */
jest.mock('../../shared/config/supabase', () => ({}));
const { makeDeps } = require('../../scripts/broadcast-fa-video');

const reply = (body, ok = true) => ({ ok, json: async () => body });

test('upload posts the mp4 to /{PHONE_NUMBER_ID}/media and returns the media id', async () => {
  const fetchFn = jest.fn().mockResolvedValue(reply({ id: 'MEDIA_1' }));
  const d = makeDeps({ token: 'T', phoneId: 'P1', fetchFn, readFile: () => Buffer.from('mp4') });
  expect(await d.upload('v.mp4')).toBe('MEDIA_1');
  const [url, init] = fetchFn.mock.calls[0];
  expect(url).toMatch(/\/P1\/media$/);
  expect(init.method).toBe('POST');
  expect(init.body.get('messaging_product')).toBe('whatsapp');
  expect(init.body.get('type')).toBe('video/mp4');
});

test('upload throws when Meta returns no id', async () => {
  const fetchFn = jest.fn().mockResolvedValue(reply({ error: { message: 'bad' } }, false));
  const d = makeDeps({ token: 'T', phoneId: 'P1', fetchFn, readFile: () => Buffer.from('x') });
  await expect(d.upload('v.mp4')).rejects.toThrow(/upload/);
});

test('send posts the template with its components and returns the wamid', async () => {
  const fetchFn = jest.fn().mockResolvedValue(reply({ messages: [{ id: 'wamid.1' }] }));
  const d = makeDeps({ token: 'T', phoneId: 'P1', fetchFn });
  const comps = [{ type: 'header', parameters: [] }];
  expect(await d.send('15550000001', comps)).toEqual({ ok: true, id: 'wamid.1' });
  const body = JSON.parse(fetchFn.mock.calls[0][1].body);
  expect(body).toMatchObject({
    messaging_product: 'whatsapp', to: '15550000001', type: 'template',
    template: { name: 'niete_fa_video_ab_v1', language: { code: 'ur' }, components: comps },
  });
});

test('send reports a Meta refusal or a network error as not ok, never throws', async () => {
  const refused = makeDeps({ token: 'T', phoneId: 'P1', fetchFn: jest.fn().mockResolvedValue(reply({ error: { code: 131049, message: 'limit' } }, false)) });
  expect(await refused.send('9', [])).toEqual({ ok: false, error: '131049 limit' });
  const down = makeDeps({ token: 'T', phoneId: 'P1', fetchFn: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });
  expect(await down.send('9', [])).toEqual({ ok: false, error: 'ECONNRESET' });
});

test('bd-pw1ccr.12: templateStatus reads the approved status and category from the WABA', async () => {
  const fetchFn = jest.fn().mockResolvedValue(reply({ data: [{ name: 'niete_fa_video_ab_v1', status: 'APPROVED', category: 'MARKETING' }] }));
  const d = makeDeps({ token: 'T', phoneId: 'P1', wabaId: 'W1', fetchFn });
  expect(await d.templateStatus()).toEqual({ status: 'APPROVED', category: 'MARKETING' });
  expect(fetchFn.mock.calls[0][0]).toMatch(/\/W1\/message_templates\?name=niete_fa_video_ab_v1/);
});

test('bd-pw1ccr.12: no WABA id, or no such template: status and category unknown', async () => {
  expect(await makeDeps({ token: 'T', phoneId: 'P1', fetchFn: jest.fn() }).templateStatus()).toEqual({ status: null, category: null });
  const none = makeDeps({ token: 'T', phoneId: 'P1', wabaId: 'W1', fetchFn: jest.fn().mockResolvedValue(reply({ data: [] })) });
  expect(await none.templateStatus()).toEqual({ status: null, category: null });
});
