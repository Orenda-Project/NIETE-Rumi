/**
 * The storage read behind /s/ (r2.service getObjectBytes): the whole object as bytes from the named bucket, null when
 * storage has no such object, any other failure thrown. And the switch read behind it fails closed: no database
 * client, a failed read or a non-true value is OFF. The AWS SDK is the faked network boundary.
 */
const mockSent = [];
let mockReply;
jest.mock('@aws-sdk/client-s3', () => {
  const cmd = (name) => class { constructor(input) { this.name = name; this.input = input; } };
  return { S3Client: class { send(c) { mockSent.push(c); return mockReply(c); } }, GetObjectCommand: cmd('Get') };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));
process.env.R2_BUCKET_NAME = 'default-bucket';
const R2 = require('../services/r2.service');

beforeEach(() => { mockSent.length = 0; });

test('a hit: bytes and type, from the named bucket', async () => {
  mockReply = async () => ({ Body: [Buffer.from('ab'), Buffer.from('cd')], ContentType: 'image/webp' });
  expect(await R2.getObjectBytes('story/sandbox/b/p01-0a1b2c3d.webp', { bucket: 'quiz-audio' })).toEqual({ bytes: Buffer.from('abcd'), contentType: 'image/webp' });
  expect(mockSent[0].input).toEqual({ Bucket: 'quiz-audio', Key: 'story/sandbox/b/p01-0a1b2c3d.webp' });
  await R2.getObjectBytes('k');
  expect(mockSent[1].input.Bucket).toBe('default-bucket');
});

test('no such object → null; any other failure throws', async () => {
  mockReply = async () => { const e = new Error('nope'); e.name = 'NoSuchKey'; e.$metadata = { httpStatusCode: 404 }; throw e; };
  expect(await R2.getObjectBytes('k')).toBeNull();
  mockReply = async () => { const e = new Error('denied'); e.name = 'AccessDenied'; e.$metadata = { httpStatusCode: 403 }; throw e; };
  await expect(R2.getObjectBytes('k')).rejects.toThrow('denied');
});

describe('the switch read', () => {
  afterEach(() => { jest.resetModules(); jest.dontMock('../config/supabase'); });
  const reader = (client, now) => {
    jest.resetModules();
    jest.doMock('../config/supabase', () => client);
    return require('../routes/web-quiz-story-assets').flagReader({ now });
  };
  const db = (value, calls) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { calls.n += 1; return value instanceof Error ? { error: value } : { data: value === undefined ? null : { value } }; } }) }) }) });

  test('no client, no row, an error or a non-true value → off', async () => {
    const calls = { n: 0 };
    expect(await reader(null, () => 0)()).toBe(false);
    expect(await reader(db(undefined, calls), () => 0)()).toBe(false);
    expect(await reader(db(new Error('x'), calls), () => 0)()).toBe(false);
    expect(await reader(db('yes', calls), () => 0)()).toBe(false);
    expect(await reader(db(true, calls), () => 0)()).toBe(true);
  });

  test('read at most every 30 s', async () => {
    const calls = { n: 0 };
    let t = 0;
    const on = reader(db(true, calls), () => t);
    await on(); await on();
    t = 29999; await on();
    expect(calls.n).toBe(1);
    t = 30000; await on();
    expect(calls.n).toBe(2);
  });
});
