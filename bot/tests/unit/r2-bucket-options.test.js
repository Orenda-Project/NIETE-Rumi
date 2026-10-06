'use strict';
/**
 * r2.js: a presigned PUT, a download and a delete can each name their bucket (additive option; the default is
 * R2_BUCKET_NAME as before). The AWS SDK is the faked network boundary.
 */
const sent = [];
jest.mock('@aws-sdk/client-s3', () => {
  const cmd = (name) => class { constructor(input) { this.name = name; this.input = input; } };
  return {
    S3Client: class { send(c) { sent.push(c); return Promise.resolve(c.name === 'Get' ? { Body: [Buffer.from('ab')] } : {}); } },
    PutObjectCommand: cmd('Put'), DeleteObjectCommand: cmd('Delete'), GetObjectCommand: cmd('Get'),
    HeadObjectCommand: cmd('Head'), ListObjectsV2Command: cmd('List'),
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn(async (client, c) => `https://signed/${c.input.Bucket}/${c.input.Key}`) }));

process.env.R2_BUCKET_NAME = 'default-bucket';
process.env.R2_ENDPOINT = 'https://r2.test';
process.env.R2_ACCESS_KEY_ID = 'x';
process.env.R2_SECRET_ACCESS_KEY = 'y';
const r2 = require('../../shared/storage/r2');

beforeEach(() => { sent.length = 0; });

test('getPresignedUploadUrl signs for the named bucket, and the default when none is named', async () => {
  expect(await r2.getPresignedUploadUrl('k1', 'audio/webm', 900, { bucket: 'kid-voice' })).toBe('https://signed/kid-voice/k1');
  expect(await r2.getPresignedUploadUrl('k1', 'audio/webm', 900)).toBe('https://signed/default-bucket/k1');
});

test('downloadFromR2 reads the named bucket', async () => {
  const buf = await r2.downloadFromR2('k2', { bucket: 'kid-voice' });
  expect(buf.toString()).toBe('ab');
  expect(sent[0].input).toEqual({ Bucket: 'kid-voice', Key: 'k2' });
  await r2.downloadFromR2('k2');
  expect(sent[1].input.Bucket).toBe('default-bucket');
});

test('deleteKey deletes one key in the named bucket and answers true; a failure answers false', async () => {
  expect(await r2.deleteKey('k3', { bucket: 'kid-voice' })).toBe(true);
  expect(sent[0]).toMatchObject({ name: 'Delete', input: { Bucket: 'kid-voice', Key: 'k3' } });
  expect(await r2.deleteKey('')).toBe(false);
});
