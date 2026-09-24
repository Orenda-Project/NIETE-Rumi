'use strict';
/**
 * The interactive senders report Meta's message id to a caller that asks.
 *
 * `sendInteractiveButtons`, `sendInteractiveMessage` and `sendVideoWithButtons`
 * answer a boolean — the delivery verdict every caller branches on. A caller that
 * also needs the wamid (a scheduled nudge that records it, so a delivery question
 * can be matched to a status webhook) passes `onMessageId` in a trailing `opts`,
 * the same shape as `sendMessage`'s `onError`: a caller that does not pass it is
 * byte-for-byte unaffected, and the callback can never change what the send did.
 *
 * `sendVideoWithButtons` also takes an optional `footer` — the label under a
 * video header (the coaching ask's how-to clip). Absent, the payload is exactly
 * what the transcript-quiz offer has always sent.
 *
 * Only the network boundary (axios, R2) is mocked; the real service runs.
 */

jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('mp4-bytes')),
  downloadMedia: jest.fn(),
  extractKeyFromUrl: jest.fn((u) => String(u)),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const axios = require('axios');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const TO = '923001234567';
const BUTTONS = [{ id: 'yes_1', title: 'Record my lesson' }, { id: 'no_1', title: 'Not today' }];
const LIST = {
  body: { text: 'Pick a class' },
  action: { button: 'Choose', sections: [{ rows: [{ id: 'r1', title: 'Grade 4 · Maths' }] }] },
};
const CLIP = 'https://pub.example.org/howto_en.mp4';
const payloadOf = () => axios.post.mock.calls.filter((c) => String(c[0]).includes('/messages'))[0][1];
const ok = (id) => async () => ({ data: { messaging_product: 'whatsapp', messages: [{ id }] } });

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockReset();
});

describe('sendInteractiveButtons', () => {
  test('reports the message id to onMessageId and still answers true', async () => {
    axios.post.mockImplementation(ok('wamid.B1'));
    const onMessageId = jest.fn();
    await expect(WhatsAppService.sendInteractiveButtons(TO, { body: 'Hi', buttons: BUTTONS }, { onMessageId })).resolves.toBe(true);
    expect(onMessageId).toHaveBeenCalledWith('wamid.B1');
  });

  test('without opts nothing changes: true, and the payload carries no new key', async () => {
    axios.post.mockImplementation(ok('wamid.B2'));
    await expect(WhatsAppService.sendInteractiveButtons(TO, { body: 'Hi', buttons: BUTTONS })).resolves.toBe(true);
    expect(Object.keys(payloadOf().interactive).sort()).toEqual(['action', 'body', 'type']);
  });

  test('a refused send answers false and reports no id', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('400'), { response: { data: { error: { code: 131009 } } } }));
    const onMessageId = jest.fn();
    await expect(WhatsAppService.sendInteractiveButtons(TO, { body: 'Hi', buttons: BUTTONS }, { onMessageId })).resolves.toBe(false);
    expect(onMessageId).not.toHaveBeenCalled();
  });

  test('a callback that throws never turns a delivered message into a failure', async () => {
    axios.post.mockImplementation(ok('wamid.B3'));
    const onMessageId = () => { throw new Error('caller bug'); };
    await expect(WhatsAppService.sendInteractiveButtons(TO, { body: 'Hi', buttons: BUTTONS }, { onMessageId })).resolves.toBe(true);
  });
});

describe('sendInteractiveMessage (list)', () => {
  test('reports the message id to onMessageId and still answers true', async () => {
    axios.post.mockImplementation(ok('wamid.L1'));
    const onMessageId = jest.fn();
    await expect(WhatsAppService.sendInteractiveMessage(TO, LIST, { onMessageId })).resolves.toBe(true);
    expect(onMessageId).toHaveBeenCalledWith('wamid.L1');
  });
});

describe('sendVideoWithButtons', () => {
  test('one message: the clip as the header, the label as the footer, the id reported', async () => {
    axios.post.mockImplementation(ok('wamid.V1'));
    const onMessageId = jest.fn();
    const sent = await WhatsAppService.sendVideoWithButtons(TO, CLIP, 'Would you like to record it?', BUTTONS, {
      footer: 'How to record a lesson with the WhatsApp mic', onMessageId,
    });
    expect(sent).toBe(true);
    const p = payloadOf();
    expect(p.type).toBe('interactive');
    expect(p.interactive.type).toBe('button');
    expect(p.interactive.header).toEqual({ type: 'video', video: { link: CLIP } });
    expect(p.interactive.body).toEqual({ text: 'Would you like to record it?' });
    expect(p.interactive.footer).toEqual({ text: 'How to record a lesson with the WhatsApp mic' });
    expect(p.interactive.action.buttons.map((b) => b.reply.id)).toEqual(['yes_1', 'no_1']);
    expect(onMessageId).toHaveBeenCalledWith('wamid.V1');
  });

  test('without opts the payload is exactly the offer’s: no footer key at all', async () => {
    axios.post.mockImplementation(ok('wamid.V2'));
    await WhatsAppService.sendVideoWithButtons(TO, CLIP, 'Body', BUTTONS);
    expect(Object.keys(payloadOf().interactive).sort()).toEqual(['action', 'body', 'header', 'type']);
  });

  test('a footer over WhatsApp’s 60-code-point cap is clipped, not sent to be refused', async () => {
    axios.post.mockImplementation(ok('wamid.V3'));
    const long = 'ریکارڈ '.repeat(20);
    await WhatsAppService.sendVideoWithButtons(TO, CLIP, 'Body', BUTTONS, { footer: long });
    expect([...payloadOf().interactive.footer.text].length).toBeLessThanOrEqual(60);
  });
});
