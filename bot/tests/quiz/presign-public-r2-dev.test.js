'use strict';
/**
 * bd-k7hex (residue). Quiz audio and pictures live in a separate, PUBLIC bucket on Cloudflare's
 * `pub-<hash>.r2.dev` alias. The web quiz hands those URLs to getPresignedUrl, which cannot sign
 * for a bucket it is not bound to, so it returns the URL unchanged — correct, because the object
 * is public. But it got there through the "bucket pattern not found" branch and warned on every
 * call: 3,449 warns in 24 h on NIETE prod (11 Nov), all `quiz-audio-opus/*.ogg`, burying real
 * R2 problems in the sweep.
 *
 * These tests drive the real getPresignedUrl with the signer mocked.
 */
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://signed.example/key?X-Amz-Signature=abc'),
}));
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const r2 = require('../../shared/storage/r2');

const PUB = 'https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/quiz-audio-opus/Grade4Q1.ogg';

describe('getPresignedUrl on a public pub-*.r2.dev URL', () => {
  let warn;
  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('returns the public URL unchanged', async () => {
    await expect(r2.getPresignedUrl(PUB, 3600)).resolves.toBe(PUB);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  test('does not warn "bucket pattern not found" — the URL is public on purpose', async () => {
    await r2.getPresignedUrl(PUB, 3600);
    const bucketWarns = warn.mock.calls.filter(c => String(c[0]).includes('Could not extract key'));
    expect(bucketWarns).toHaveLength(0);
  });

  test('a public URL with a query string is still left alone', async () => {
    const withQs = `${PUB}?v=2`;
    await expect(r2.getPresignedUrl(withQs, 3600)).resolves.toBe(withQs);
    expect(warn.mock.calls.filter(c => String(c[0]).includes('Could not extract key'))).toHaveLength(0);
  });

  test('an r2.dev host that is not pub-<hex> keeps the old warning (not silently swallowed)', async () => {
    const odd = 'https://something-else.r2.dev/quiz-audio-opus/a.ogg';
    await expect(r2.getPresignedUrl(odd, 3600)).resolves.toBe(odd);
    expect(warn.mock.calls.filter(c => String(c[0]).includes('Could not extract key'))).toHaveLength(1);
  });
});
