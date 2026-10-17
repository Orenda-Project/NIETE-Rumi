'use strict';
/**
 * Storybook files in storage (story-store.js): a content-addressed key under story/<env>/<book id>/, an upload that
 * marks the file immutable for a year, and the same-origin address the reader asks for (/s/<book id>/<file>).
 * And r2.js uploadBuffer's new optional cacheControl: absent → the PutObject input is exactly as before.
 * The AWS SDK is the faked network boundary.
 */
const crypto = require('crypto');

const sent = [];
jest.mock('@aws-sdk/client-s3', () => {
  const cmd = (name) => class { constructor(input) { this.name = name; this.input = input; } };
  return {
    S3Client: class { send(c) { sent.push(c); return Promise.resolve({}); } },
    PutObjectCommand: cmd('Put'), DeleteObjectCommand: cmd('Delete'), GetObjectCommand: cmd('Get'),
    HeadObjectCommand: cmd('Head'), ListObjectsV2Command: cmd('List'),
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn(async () => 'https://signed') }));

process.env.R2_BUCKET_NAME = 'default-bucket';
process.env.R2_ENDPOINT = 'https://r2.test';
process.env.R2_ACCESS_KEY_ID = 'x';
process.env.R2_SECRET_ACCESS_KEY = 'y';
const r2 = require('../../../shared/storage/r2');
const Store = require('../../../shared/services/quiz/story-store');

const BOOK = 'b0000000-0000-4000-8000-0000000000b1';
const IMG = Buffer.from('RIFF....WEBPVP8 asad-testwala');
const H8 = crypto.createHash('sha256').update(IMG).digest('hex').slice(0, 8);

beforeEach(() => { sent.length = 0; delete process.env.WEB_QUIZ_AUDIO_BUCKET; });

describe('r2.uploadBuffer cacheControl', () => {
  test('without it the PutObject input is exactly today\'s (no CacheControl key at all)', async () => {
    await r2.uploadBuffer(IMG, 'k/a.webp', 'image/webp');
    await r2.uploadBuffer(IMG, 'k/b.webp', 'image/webp', { bucket: 'b2' });
    expect(Object.keys(sent[0].input).sort()).toEqual(['Body', 'Bucket', 'ContentType', 'Key', 'Metadata']);
    expect(sent[1].input).not.toHaveProperty('CacheControl');
    expect(sent[1].input.Bucket).toBe('b2');
  });

  test('with it the object carries the header', async () => {
    await r2.uploadBuffer(IMG, 'k/c.webp', 'image/webp', { cacheControl: 'public, max-age=31536000, immutable' });
    expect(sent[0].input).toMatchObject({ Bucket: 'default-bucket', Key: 'k/c.webp', ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' });
  });
});

describe('story-store', () => {
  test('storyKey: story/<env>/<book>/<file>, env made safe; a bad book id or file name throws', () => {
    expect(Store.storyKey({ env: 'sandbox', bookId: BOOK, file: `p01-${H8}.webp` })).toBe(`story/sandbox/${BOOK}/p01-${H8}.webp`);
    expect(Store.storyKey({ env: 'Pull Request #9', bookId: BOOK, file: 'cover-0a1b2c3d.webp' })).toBe(`story/pull-request-9/${BOOK}/cover-0a1b2c3d.webp`);
    expect(() => Store.storyKey({ env: 'sandbox', bookId: '../x', file: 'p01.webp' })).toThrow(/book/);
    expect(() => Store.storyKey({ env: 'sandbox', bookId: BOOK, file: '../p01.webp' })).toThrow(/file/);
    expect(() => Store.storyKey({ env: 'sandbox', bookId: BOOK, file: 'P01.WEBP' })).toThrow(/file/);
  });

  test('hashedName: <stem>-<first 8 hex of sha256(bytes)>.<ext>', () => {
    expect(Store.hashedName('p01.webp', IMG)).toBe(`p01-${H8}.webp`);
    expect(Store.hashedName('a03.ogg', IMG)).toBe(`a03-${H8}.ogg`);
  });

  test('uploadStoryFile: the hashed name under the book, immutable for a year, the quiz-audio bucket', async () => {
    process.env.WEB_QUIZ_AUDIO_BUCKET = 'quiz-audio';
    const out = await Store.uploadStoryFile(IMG, { env: 'sandbox', bookId: BOOK, file: 'p01.webp', contentType: 'image/webp' });
    expect(out).toEqual({ file: `p01-${H8}.webp`, key: `story/sandbox/${BOOK}/p01-${H8}.webp`, url: `/s/${BOOK}/p01-${H8}.webp`, bytes: IMG.length });
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({ Bucket: 'quiz-audio', Key: out.key, ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' });
  });

  test('uploadStoryFile falls back to R2_BUCKET_NAME, as clips do', async () => {
    await Store.uploadStoryFile(IMG, { env: 'sandbox', bookId: BOOK, file: 'cover.webp', contentType: 'image/webp' });
    expect(sent[0].input.Bucket).toBe('default-bucket');
  });

  test('storyFileUrl: the same-origin address the reader fetches', () => {
    expect(Store.storyFileUrl({ bookId: BOOK, file: `p01-${H8}.webp` })).toBe(`/s/${BOOK}/p01-${H8}.webp`);
    expect(Store.storyFileUrl({ bookId: BOOK, file: null })).toBeNull();
  });

  test('FILE_RX and BOOK_RX are the edge\'s rules (dashboard /s/ route reads the same module)', () => {
    expect(Store.FILE_RX.test(`p01-${H8}.webp`)).toBe(true);
    expect(Store.FILE_RX.test(`a01-${H8}.ogg`)).toBe(true);
    expect(Store.FILE_RX.test(`a01-${H8}.mp3`)).toBe(true);
    expect(Store.FILE_RX.test('p01.png')).toBe(false);
    expect(Store.FILE_RX.test('.webp')).toBe(false);
    expect(Store.BOOK_RX.test(BOOK)).toBe(true);
    expect(Store.BOOK_RX.test(BOOK.toUpperCase())).toBe(false);
  });

  test('bookIdFor: a stable uuid (v5) from the catalogue id, the same on every run and every machine', () => {
    const a = Store.bookIdFor('src-asad-testwala');
    expect(a).toMatch(Store.BOOK_RX);
    expect(a[14]).toBe('5');
    expect('89ab').toContain(a[19]);
    expect(Store.bookIdFor('src-asad-testwala')).toBe(a);
    expect(Store.bookIdFor('src-sara-testwala')).not.toBe(a);
    // RFC 4122 v5 of the DNS namespace and 'www.example.com' (a published vector): the hash is the standard one.
    expect(Store.uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(() => Store.bookIdFor('')).toThrow(/source/);
  });
});
