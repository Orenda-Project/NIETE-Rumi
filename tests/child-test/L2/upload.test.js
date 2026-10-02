/**
 * Child-test stimulus (L2, bd-s1oo0.2) — putting the inline cards in R2 and handing out presigned
 * links. The S3 client and presigner are the network boundary and are mocked; the real r2.js
 * helpers run.
 *
 * Why presign: the staging build pointed WhatsApp at R2's private S3 address and every image send
 * failed with HTTP 400 (review-staging-build/findings/design.md §1). A stimulus key is never sent
 * bare.
 */

let sent, presign;

function load() {
  jest.resetModules();
  process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
  process.env.R2_ACCESS_KEY_ID = 'k';
  process.env.R2_SECRET_ACCESS_KEY = 's';
  process.env.R2_BUCKET_NAME = 'niete-sandbox-bucket';
  sent = [];
  jest.doMock('@aws-sdk/client-s3', () => {
    const cmd = (name) => class { constructor(input) { this.input = input; this.name = name; } };
    return {
      S3Client: class { constructor() { this.send = jest.fn(async (c) => { sent.push(c); return {}; }); } },
      PutObjectCommand: cmd('Put'), GetObjectCommand: cmd('Get'), DeleteObjectCommand: cmd('Delete'),
      HeadObjectCommand: cmd('Head'), ListObjectsV2Command: cmd('List'),
    };
  });
  presign = jest.fn(async (_client, command, opts) => `https://signed.example/${command.input.Key}?X-Amz-Signature=abc&exp=${opts.expiresIn}`);
  jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: presign }));
  return require('../../../bot/shared/services/child-test/render/upload');
}

afterEach(() => jest.resetModules());

describe('stimulus keys', () => {
  it('follows the contract layout child-test/stimulus/v1/g{grade}/{form}/{block}/{n}.png', () => {
    const up = load();
    expect(up.stimulusKey({ grade: 3, form: 'A', block: 'urdu', n: 1 })).toBe('child-test/stimulus/v1/g3/A/urdu/1.png');
    expect(up.stimulusKey({ grade: 5, form: 'B', block: 'maths', n: 4, variant: 'fallback' })).toBe('child-test/stimulus/v1/g5/B/maths-fallback/4.png');
    expect(() => up.stimulusKey({ grade: 3, form: 'A', block: '../x', n: 1 })).toThrow(/block/);
  });
});

describe('uploadInlineCards', () => {
  it('uploads each PNG at its key, then a manifest naming each card\'s part, and returns the keys', async () => {
    const up = load();
    const cards = [
      { part: 'story', index: 1, png: Buffer.from('a'), widthPx: 1080, heightPx: 1000 },
      { part: 'nonwords', index: 2, png: Buffer.from('b'), widthPx: 1080, heightPx: 900 },
    ];
    const out = await up.uploadInlineCards({ grade: 3, form: 'A', block: 'english', cards, itemBankVersion: 'v-test' });
    expect(out.keys).toEqual(['child-test/stimulus/v1/g3/A/english/1.png', 'child-test/stimulus/v1/g3/A/english/2.png']);
    expect(out.manifestKey).toBe('child-test/stimulus/v1/g3/A/english/manifest.json');
    const puts = sent.filter((c) => c.name === 'Put');
    expect(puts.map((p) => p.input.Key)).toEqual([...out.keys, out.manifestKey]);
    expect(puts[0].input).toMatchObject({ Bucket: 'niete-sandbox-bucket', ContentType: 'image/png' });
    const manifest = JSON.parse(puts[2].input.Body.toString());
    expect(manifest).toMatchObject({ version: 'child-test-stimulus-v1', itemBankVersion: 'v-test', grade: 3, form: 'A', block: 'english' });
    expect(manifest.cards.map((c) => c.part)).toEqual(['story', 'nonwords']);
  });

  it('refuses an empty card list rather than writing an empty manifest', async () => {
    const up = load();
    await expect(up.uploadInlineCards({ grade: 3, form: 'A', block: 'english', cards: [] })).rejects.toThrow(/no cards/i);
    expect(sent).toHaveLength(0);
  });
});

describe('presignStimulus', () => {
  it('signs the object key for a short-lived GET, never returns the bare private address', async () => {
    const up = load();
    const url = await up.presignStimulus('child-test/stimulus/v1/g3/A/urdu/1.png', 900);
    expect(url).toMatch(/X-Amz-Signature/);
    expect(presign).toHaveBeenCalledTimes(1);
    expect(presign.mock.calls[0][1].input).toMatchObject({ Bucket: 'niete-sandbox-bucket', Key: 'child-test/stimulus/v1/g3/A/urdu/1.png' });
    expect(presign.mock.calls[0][2]).toEqual({ expiresIn: 900 });
  });

  // r2.getPresignedUrl() swallows a signing error and hands back the bare private address —
  // the exact URL that failed every staging send. presignStimulus must turn that into a throw.
  it('throws when signing fails, so the sender can fall back to text and log it', async () => {
    const up = load();
    presign.mockRejectedValueOnce(new Error('no creds'));
    await expect(up.presignStimulus('child-test/stimulus/v1/g3/A/urdu/1.png')).rejects.toThrow(/could not presign/);
  });
});
