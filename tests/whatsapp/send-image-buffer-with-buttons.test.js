/**
 * WhatsAppService.sendImageBufferWithButtons — a picture rendered in memory as
 * the HEADER of a buttons message: one billed message where a picture followed
 * by a buttons question was two (the child's quiz scorecard + "invite a friend").
 *
 * Exercised through the real WhatsAppService; only the Graph API is faked.
 */

jest.mock('../../bot/shared/utils/constants', () => ({
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const axios = require('axios'); // mapped stub
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const PNG = Buffer.from('\x89PNG fake scorecard');
const BUTTONS = [{ id: 'vq_invite_yes', title: 'Invite a friend' }, { id: 'vq_invite_no', title: 'No thanks' }];

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockImplementation(async (url) => (/\/media$/.test(url)
    ? { data: { id: 'media-scorecard-1' } }
    : { data: { messages: [{ id: 'wamid.CARD1' }] } }));
});

test('uploads the bytes, then sends ONE interactive buttons message with the image as its header', async () => {
  const ids = [];
  const ok = await WhatsAppService.sendImageBufferWithButtons(
    '923001110001', PNG, '🎉 All done!\n\nWant to send this quiz to a friend?', BUTTONS,
    { onMessageId: (id) => ids.push(id) },
  );

  expect(ok).toBe(true);
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(axios.post.mock.calls[0][0]).toMatch(/\/test-phone-id\/media$/);
  const [url, payload] = axios.post.mock.calls[1];
  expect(url).toMatch(/\/test-phone-id\/messages$/);
  expect(payload).toEqual({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '923001110001',
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'image', image: { id: 'media-scorecard-1' } },
      body: { text: '🎉 All done!\n\nWant to send this quiz to a friend?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'vq_invite_yes', title: 'Invite a friend' } },
          { type: 'reply', reply: { id: 'vq_invite_no', title: 'No thanks' } },
        ],
      },
    },
  });
  expect(ids).toEqual(['wamid.CARD1']);
});

test('a button title is clipped to 20 CODE POINTS, never mid-surrogate', async () => {
  await WhatsAppService.sendImageBufferWithButtons('923001110001', PNG, 'body',
    [{ id: 'b1', title: '🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉' }]);
  const title = axios.post.mock.calls[1][1].interactive.action.buttons[0].reply.title;
  expect([...title]).toHaveLength(20);
});

test('returns false — never throws — when Meta refuses, so the caller can send the two separately', async () => {
  axios.post.mockImplementation(async (url) => {
    if (/\/media$/.test(url)) return { data: { id: 'media-scorecard-2' } };
    throw Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { error: { code: 131009, message: 'Parameter value is not valid' } } },
    });
  });
  await expect(WhatsAppService.sendImageBufferWithButtons('923001110001', PNG, 'body', BUTTONS)).resolves.toBe(false);
});

test('refuses an empty picture or more than three buttons without calling Meta', async () => {
  await expect(WhatsAppService.sendImageBufferWithButtons('923001110001', Buffer.alloc(0), 'b', BUTTONS)).resolves.toBe(false);
  await expect(WhatsAppService.sendImageBufferWithButtons('923001110001', PNG, 'b',
    [...BUTTONS, { id: 'c', title: 'c' }, { id: 'd', title: 'd' }])).resolves.toBe(false);
  expect(axios.post).not.toHaveBeenCalled();
});
