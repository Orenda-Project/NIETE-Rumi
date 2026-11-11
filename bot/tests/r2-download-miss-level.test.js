'use strict';
/**
 * bd-ihhkz6. downloadFromR2 logged EVERY failure at error, including a plain NoSuchKey — which is how
 * callers probe for an optional object (the LP Q&A voicenote script, caches). 591 of NIETE prod's
 * ~1,030 error lines on 10-11 Nov were these, and none named the key, so a real outage hid in them.
 *
 * Now: a miss (NoSuchKey / 404) logs at warn with the key's first path segment; any other failure
 * stays at error, also with the segment. Both still throw, so every caller behaves as before.
 * Drives the real downloadFromR2 with the S3 client's send mocked.
 */
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return { ...actual, S3Client: jest.fn(() => ({ send: (...a) => mockSend(...a) })) };
});
const r2 = require('../shared/storage/r2');

const noSuchKey = () => Object.assign(new Error('The specified key does not exist.'),
  { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });

describe('downloadFromR2 log level', () => {
  let err;
  let warn;
  beforeEach(() => {
    mockSend.mockReset();
    err = jest.spyOn(console, 'error').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const r2Errors = () => err.mock.calls.filter(c => String(c[0]).includes('downloading from R2'));
  const r2Warns = () => warn.mock.calls.filter(c => String(c[0]).includes('R2'));

  test('a missing key is a warn, not an error, and names the key prefix', async () => {
    mockSend.mockRejectedValue(noSuchKey());
    await expect(r2.downloadFromR2('voicenotes/abc/script.txt')).rejects.toThrow('does not exist');
    expect(r2Errors()).toHaveLength(0);
    expect(r2Warns()).toHaveLength(1);
    expect(JSON.stringify(r2Warns()[0])).toContain('voicenotes');
  });

  test('a 404 without the NoSuchKey name is still a miss', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }));
    await expect(r2.downloadFromR2('lp-cache/x.json')).rejects.toThrow('NotFound');
    expect(r2Errors()).toHaveLength(0);
  });

  test('any other failure stays an error, with the key prefix', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
    await expect(r2.downloadFromR2('wq-art/a.png')).rejects.toThrow('Access Denied');
    expect(r2Errors()).toHaveLength(1);
    expect(JSON.stringify(r2Errors()[0])).toContain('wq-art');
  });
});
