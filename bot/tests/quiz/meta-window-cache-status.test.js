'use strict';
// bd-v0toag.108: Meta refuses a free-form send past the 24h window asynchronously (status receipt, 131047).
// That receipt must flag the window closed so the next report/quiz goes as a template; her next message clears it.

const mockSet = jest.fn(async () => true);
const mockDelete = jest.fn(async () => true);
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  set: (...a) => mockSet(...a),
  get: jest.fn(async () => null),
  delete: (...a) => mockDelete(...a),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const cache = require('../../shared/services/quiz/meta-window-cache.service');

const failed = (code, recipient = '923001234567') => ({
  id: 'wamid.x', status: 'failed', recipient_id: recipient, errors: [{ code, title: 't' }],
});

beforeEach(() => { mockSet.mockClear(); mockDelete.mockClear(); });

describe('onFailedStatus', () => {
  test('a 131047 receipt flags that phone closed', async () => {
    await cache.onFailedStatus(failed(131047));
    expect(mockSet).toHaveBeenCalledWith('meta_window_closed:923001234567', '1', expect.any(Number));
  });

  test('the code arriving as a string still counts', async () => {
    await cache.onFailedStatus(failed('131047'));
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  test('other failure codes do not flag', async () => {
    await cache.onFailedStatus(failed(131026));
    await cache.onFailedStatus(failed(131049));
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('no recipient or no errors: nothing flagged', async () => {
    await cache.onFailedStatus(failed(131047, null));
    await cache.onFailedStatus({ status: 'failed', recipient_id: '923001234567' });
    await cache.onFailedStatus(null);
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('a Redis failure never throws', async () => {
    mockSet.mockRejectedValueOnce(new Error('down'));
    await expect(cache.onFailedStatus(failed(131047))).resolves.toBeUndefined();
  });
});

describe('clearWindowClosed', () => {
  test('her message clears the flag, + or no +', async () => {
    await cache.clearWindowClosed('+923001234567');
    expect(mockDelete).toHaveBeenCalledWith('meta_window_closed:923001234567');
  });

  test('no phone: no call', async () => {
    await cache.clearWindowClosed('');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('a Redis failure never throws', async () => {
    mockDelete.mockRejectedValueOnce(new Error('down'));
    await expect(cache.clearWindowClosed('923001234567')).resolves.toBeUndefined();
  });
});

describe('wired into the webhook', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'whatsapp-bot.js'), 'utf8');

  test('a failed status receipt goes to onFailedStatus', () => {
    const failedBranch = src.slice(src.indexOf("if (newStatus === 'failed')"), src.indexOf('Only track delivered and read'));
    expect(failedBranch).toMatch(/meta-window-cache\.service'\)\.onFailedStatus\(status\)/);
  });

  test('an inbound message clears the flag once it passes the 24h check', () => {
    const at = src.indexOf('isWithin24Hours(messageTimestamp, from)');
    const clear = src.indexOf("meta-window-cache.service').clearWindowClosed(from)");
    expect(at).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(at);
    expect(clear - at).toBeLessThan(400);
  });
});
