/**
 * r2.listKeys(prefix) — every object key under a prefix.
 *
 * The version backfill has to find the PDF a paper was first delivered as.
 * That file sits under exams/<user>/<paper>/ next to the "_Edited" re-render,
 * and nothing in the row names it (file_r2_key was overwritten by the edit),
 * so the only way to find it is to list the folder. R2 pages at 1,000 keys;
 * the list must follow the continuation token rather than stop at page one.
 */
process.env.R2_ENDPOINT = 'https://r2.example';
process.env.R2_ACCESS_KEY_ID = 'k';
process.env.R2_SECRET_ACCESS_KEY = 's';
process.env.R2_BUCKET_NAME = 'bucket';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const command = (name) => {
    const C = class { constructor(input) { this.input = input; } };
    Object.defineProperty(C, 'name', { value: name });
    return C;
  };
  return {
    S3Client: class { constructor() { this.send = mockSend; } },
    PutObjectCommand: command('PutObjectCommand'),
    GetObjectCommand: command('GetObjectCommand'),
    DeleteObjectCommand: command('DeleteObjectCommand'),
    HeadObjectCommand: command('HeadObjectCommand'),
    ListObjectsV2Command: command('ListObjectsV2Command'),
  };
});

const r2 = require('../../bot/shared/storage/r2');

beforeEach(() => mockSend.mockReset());

test('lists every key under the prefix, following continuation tokens', async () => {
  mockSend
    .mockResolvedValueOnce({ Contents: [{ Key: 'exams/u/p/a.pdf' }], IsTruncated: true, NextContinuationToken: 't1' })
    .mockResolvedValueOnce({ Contents: [{ Key: 'exams/u/p/a_Edited.pdf' }], IsTruncated: false });
  await expect(r2.listKeys('exams/u/p/')).resolves.toEqual(['exams/u/p/a.pdf', 'exams/u/p/a_Edited.pdf']);
  expect(mockSend).toHaveBeenCalledTimes(2);
  const [first, second] = mockSend.mock.calls.map((c) => c[0]);
  expect(first.constructor.name).toBe('ListObjectsV2Command');
  expect(first.input).toEqual({ Bucket: 'bucket', Prefix: 'exams/u/p/' });
  expect(second.input).toEqual({ Bucket: 'bucket', Prefix: 'exams/u/p/', ContinuationToken: 't1' });
});

test('an empty folder is an empty list, not an error', async () => {
  mockSend.mockResolvedValueOnce({ KeyCount: 0 });
  await expect(r2.listKeys('exams/u/none/')).resolves.toEqual([]);
});

test('refuses an empty prefix rather than listing the whole bucket', async () => {
  await expect(r2.listKeys('')).rejects.toThrow(/prefix/);
  expect(mockSend).not.toHaveBeenCalled();
});
