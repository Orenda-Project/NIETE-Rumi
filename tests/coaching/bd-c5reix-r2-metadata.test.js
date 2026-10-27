'use strict';
/**
 * bd-c5reix — the R2 seam the WhatsApp-recording service is tested through fakes for (pre-merge Class O): a kept
 * recording's sha256 and length go INTO the object (uploadBuffer's metadata), and come back OUT of a HEAD — which is
 * how the app's waiting list reads them. Driven through the real r2.js with the S3 client recording what it sends.
 */
process.env.R2_ENDPOINT = 'https://r2.example';
process.env.R2_ACCESS_KEY_ID = 'r2-key';
process.env.R2_SECRET_ACCESS_KEY = 'r2-secret';
process.env.R2_BUCKET_NAME = 'coach-bucket';

const sent = [];
const s3 = require('@aws-sdk/client-s3');
const Original = s3.S3Client;
s3.S3Client = class extends Original {
  constructor(config) {
    super(config);
    this.send = jest.fn(async (cmd) => {
      sent.push(cmd);
      return cmd.constructor.name === 'HeadObjectCommand'
        ? { ContentLength: 9_000_000, ContentType: 'audio/ogg', Metadata: { sha256: 'ab'.repeat(32), duration: '1812' } }
        : {};
    });
  }
};
const r2 = require('../../bot/shared/storage/r2');

beforeEach(() => { sent.length = 0; });

test('uploadBuffer stores the caller\'s metadata beside its own upload time', async () => {
  await r2.uploadBuffer(Buffer.from('x'), 'classroom_audio/u/2026-10/portal_wa-ab-1.ogg', 'audio/ogg', {
    metadata: { sha256: 'ab'.repeat(32), duration: '1812', door: 'voice' },
  });
  const put = sent.find((c) => c.constructor.name === 'PutObjectCommand');
  expect(put.input).toMatchObject({ Bucket: 'coach-bucket', Key: 'classroom_audio/u/2026-10/portal_wa-ab-1.ogg', ContentType: 'audio/ogg' });
  expect(put.input.Metadata).toEqual({ sha256: 'ab'.repeat(32), duration: '1812', door: 'voice', uploadedAt: expect.any(String) });
});

test('uploadBuffer without metadata is as before', async () => {
  await r2.uploadBuffer(Buffer.from('x'), 'k', 'text/plain');
  expect(sent[0].input.Metadata).toEqual({ uploadedAt: expect.any(String) });
});

test('headObject returns the object\'s metadata', async () => {
  expect(await r2.headObject('k')).toEqual({
    exists: true, sizeBytes: 9_000_000, contentType: 'audio/ogg', metadata: { sha256: 'ab'.repeat(32), duration: '1812' },
  });
});
