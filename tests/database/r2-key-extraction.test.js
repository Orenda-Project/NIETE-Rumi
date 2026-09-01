/**
 * extractKeyFromUrl must survive a presigned url in EITHER addressing style.
 *
 * A presign does not just append a query string — it re-addresses the object
 * from path style (host/bucket/key) to virtual-hosted style (bucket.host/key).
 * The extractor looked for "/bucket/" in the path, which a virtual-hosted url
 * does not have, so it threw; and the only caller that catches that throw
 * turns it into a `false` return. A document went missing on the strength of
 * those two behaviours meeting.
 */

const ORIG = process.env.R2_BUCKET_NAME;

describe('extractKeyFromUrl', () => {
  let extractKeyFromUrl;

  beforeAll(() => {
    process.env.R2_BUCKET_NAME = 'digital-coach-audio';
    jest.resetModules();
    ({ extractKeyFromUrl } = require('../../bot/shared/storage/r2'));
  });

  afterAll(() => { process.env.R2_BUCKET_NAME = ORIG; });

  const KEY = 'exams/user-1/paper-2/Grade1_English_GreenDreams.pdf';
  const ACCT = '58a6fb2a86d61397895d6b97b73a3ebe.r2.cloudflarestorage.com';
  const SIG = '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc&x-id=GetObject';

  test('path-style url', () => {
    expect(extractKeyFromUrl(`https://${ACCT}/digital-coach-audio/${KEY}`)).toBe(KEY);
  });

  test('path-style presigned url', () => {
    expect(extractKeyFromUrl(`https://${ACCT}/digital-coach-audio/${KEY}${SIG}`)).toBe(KEY);
  });

  test('virtual-hosted url — the bucket is in the host, not the path', () => {
    expect(extractKeyFromUrl(`https://digital-coach-audio.${ACCT}/${KEY}`)).toBe(KEY);
  });

  test('virtual-hosted PRESIGNED url — what getPresignedUrl actually returns', () => {
    expect(extractKeyFromUrl(`https://digital-coach-audio.${ACCT}/${KEY}${SIG}`)).toBe(KEY);
  });

  test('a bare key is returned as-is', () => {
    expect(extractKeyFromUrl(KEY)).toBe(KEY);
  });

  test('a url from somewhere else is still refused', () => {
    expect(() => extractKeyFromUrl('https://example.com/some/file.pdf')).toThrow(/Could not extract/);
  });
});

/**
 * An object must be stored as the type it actually is.
 *
 * uploadExamBuffer hardcoded `.docx` — correct for the feature it was written
 * for, wrong the moment a PDF went through it. Nothing local notices: the bytes
 * are intact and a server-side download ignores the header. It only matters
 * when something FETCHES the url and believes it, which is exactly what
 * WhatsApp does for a document sent by link.
 */
describe('uploadExamBuffer stores the type the file actually is', () => {
  const sent = [];

  beforeAll(() => {
    jest.resetModules();
    process.env.R2_BUCKET_NAME = 'digital-coach-audio';
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    jest.doMock('@aws-sdk/client-s3', () => {
      const actual = jest.requireActual('@aws-sdk/client-s3');
      return {
        ...actual,
        S3Client: class { async send(cmd) { sent.push(cmd.input); return {}; } },
      };
    });
  });

  afterAll(() => { jest.dontMock('@aws-sdk/client-s3'); });

  test.each([
    ['Grade1_English.pdf', 'application/pdf'],
    ['Grade1_English.docx',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('%s is stored as %s', async (filename, expected) => {
    const r2 = require('../../bot/shared/storage/r2');
    sent.length = 0;
    await r2.uploadExamBuffer({
      buffer: Buffer.from('x'), userId: 'u1', examId: 'e1', filename,
    });
    expect(sent[0].ContentType).toBe(expected);
  });
});
