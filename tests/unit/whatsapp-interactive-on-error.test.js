'use strict';
/**
 * The interactive senders hand a refused send's error to a caller that asks, and log it at error.
 *
 * `sendInteractiveMessage` and `sendInteractiveButtons` catch a Graph refusal, log it and answer false.
 * Meta's code (131000 "Something went wrong", 131047 the closed window, …) was logged and thrown away one
 * frame below the only code that could act on it, and the log landed at info, where an error monitor
 * never looks. They now take the same `onError` seam as `sendMessage` and `sendImageFromBuffer`: a caller
 * that does not pass it is byte-for-byte unaffected (still a boolean), and the callback can never change
 * what the send did.
 *
 * Only the network boundary (axios) is mocked; the real service runs.
 */

jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(), downloadMedia: jest.fn(), extractKeyFromUrl: jest.fn((u) => String(u)),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const axios = require('axios');
const { logToFile } = require('../../bot/shared/utils/logger');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const TO = '923001234567';
const BUTTONS = [{ id: 'yes_1', title: 'Send now' }, { id: 'no_1', title: 'Cancel' }];
const LIST = {
  body: { text: 'Who is this report for?' },
  action: { button: 'Choose', sections: [{ rows: [{ id: 'r1', title: 'Teacher One' }] }] },
};
const REFUSAL = Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500, data: { error: { message: 'Something went wrong', code: 131000 } } },
});

beforeEach(() => {
  jest.clearAllMocks();
  axios.post.mockReset();
});

describe.each([
  ['sendInteractiveMessage', LIST, 'interactive list'],
  ['sendInteractiveButtons', { body: 'Send it?', buttons: BUTTONS }, 'interactive button'],
])('%s', (method, payload, what) => {
  test('a refused send answers false, hands the error to onError, and logs it at error', async () => {
    axios.post.mockRejectedValue(REFUSAL);
    const onError = jest.fn();
    await expect(WhatsAppService[method](TO, payload, { onError })).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(REFUSAL);
    const line = logToFile.mock.calls.find(([msg]) => String(msg).includes(`Error sending ${what}`));
    expect(line).toBeDefined();
    expect(line[2]).toBe('error');
  });

  test('without opts a refusal is still just false', async () => {
    axios.post.mockRejectedValue(REFUSAL);
    await expect(WhatsAppService[method](TO, payload)).resolves.toBe(false);
  });

  test('a throwing onError cannot change the answer', async () => {
    axios.post.mockRejectedValue(REFUSAL);
    await expect(WhatsAppService[method](TO, payload, { onError: () => { throw new Error('boom'); } })).resolves.toBe(false);
  });

  test('a sent message never calls onError', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.X' }] } });
    const onError = jest.fn();
    await expect(WhatsAppService[method](TO, payload, { onError })).resolves.toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
});
